/**
 * Downlink scheduling primitives: the generation counter, the audio queue, and
 * the paced player.
 *
 * The queue carries more than audio: sentence boundaries and TTS start/stop are
 * ordered events that must reach the device in the same order they were produced,
 * otherwise the device's decoder is opened after the first frame arrived or kept
 * open after speech ended.
 */

/** Monotonic conversation epoch. Every downlink element is stamped with it. */
export class Generation {
  constructor(initial = 0) {
    this.value = initial
  }

  get current() {
    return this.value
  }

  next() {
    this.value += 1
    return this.value
  }
}

export const KIND = Object.freeze({
  AUDIO_FRAME: 'audio_frame',
  SENTENCE_START: 'sentence_start',
  SENTENCE_END: 'sentence_end',
  TTS_START: 'tts_start',
  TTS_STOP: 'tts_stop',
})

export function audioFrame({ data, generation, frameMs = 20, sentenceId = '' }) {
  return { kind: KIND.AUDIO_FRAME, data, generation, frameMs, sentenceId }
}

export function controlElement(kind, { generation, text = '', sentenceId = '' }) {
  return { kind, generation, text, sentenceId }
}

/**
 * Bounded async queue.
 *
 * When full it drops the *oldest audio frame* and keeps control elements: an
 * overflow must never be able to swallow `tts_stop`, or the device would keep
 * its decoder open forever.
 */
export class AudioQueue {
  constructor({ capacity = 512 } = {}) {
    this.capacity = capacity
    this.items = []
    this.waiters = []
    this.closed = false
    this.droppedByOverflow = 0
  }

  get size() {
    return this.items.length
  }

  push(element) {
    if (this.closed) return false
    if (this.items.length >= this.capacity && element.kind === KIND.AUDIO_FRAME) {
      const index = this.items.findIndex((item) => item.kind === KIND.AUDIO_FRAME)
      if (index >= 0) {
        this.items.splice(index, 1)
        this.droppedByOverflow += 1
      }
    }
    this.items.push(element)
    this.#wake()
    return true
  }

  async take() {
    if (this.items.length > 0) return this.items.shift()
    if (this.closed) return null
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  /** Drop everything pending. Used by abort before the generation flips. */
  clear() {
    const dropped = this.items.length
    this.items = []
    return dropped
  }

  close() {
    this.closed = true
    for (const waiter of this.waiters) waiter(null)
    this.waiters = []
    this.items = []
  }

  #wake() {
    if (this.waiters.length === 0) return
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter(this.items.shift() ?? null)
  }
}

const defaultSleep = (ms, signal) =>
  new Promise((resolve) => {
    if (!signal || signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/**
 * Paced downlink sender.
 *
 * TTS providers are bursty — a second of speech can arrive in 150 ms. Writing
 * that straight to the socket overruns the ESP32's few dozen KB of DMA buffer,
 * so frames leave on a clock derived from their own duration, with a small
 * margin that biases towards underrun (a tiny gap) rather than overflow (a
 * crash or dropped packets).
 */
export class AudioPlayer {
  constructor({
    sink,
    generation,
    frameIntervalMs = 18,
    marginMs = 2,
    creditMs = 120,
    logger,
    sleep = defaultSleep,
    clock = () => Date.now(),
  }) {
    this.sink = sink
    this.generation = generation
    this.frameIntervalMs = frameIntervalMs
    this.marginMs = marginMs
    this.creditMs = creditMs
    this.logger = logger ?? {}
    this.sleep = sleep
    this.clock = clock
    this.queue = new AudioQueue({})
    this.running = false
    this.abortController = new AbortController()
    this.playbackTail = 0
    this.stats = { sentFrames: 0, droppedFrames: 0, sentBytes: 0, controlEvents: 0, lastSendAt: 0 }
    this.loop = null
    this.drained = false
    this.drainWaiters = []
  }

  start() {
    if (this.running) return
    this.running = true
    this.abortController = new AbortController()
    this.loop = this.#run().catch((error) => {
      this.logger.error?.(`dsh-xiaozhi: audio player stopped: ${error.message}`)
      this.running = false
    })
  }

  push(element) {
    if (element?.kind === KIND.TTS_START) this.drained = false
    this.queue.push(element)
  }

  /** Resolves once the final `tts stop` of the current turn has been sent. */
  whenDrained() {
    if (this.drained) return Promise.resolve()
    return new Promise((resolve) => this.drainWaiters.push(resolve))
  }

  #resolveDrained() {
    this.drained = true
    for (const waiter of this.drainWaiters.splice(0)) waiter()
  }

  /**
   * Interrupt: invalidate everything already queued and silence the device now.
   *
   * The caller bumps the generation *before* calling this, so any frame that was
   * already handed to the socket can no longer be attributed to the new epoch,
   * and anything still queued is dropped twice over (cleared here, generation
   * mismatch in the loop).
   */
  abort({ sendStop = true, reason = 'aborted' } = {}) {
    const dropped = this.queue.clear()
    // Rotate the controller: the sleep in flight must be woken, but the loop must
    // keep running afterwards, so a permanently aborted signal would silently
    // kill every later turn.
    const controller = this.abortController
    this.abortController = new AbortController()
    controller.abort()
    this.playbackTail = 0
    if (sendStop) {
      try {
        this.sink.sendJson({ type: 'tts', state: 'stop', reason })
      } catch {
        // The socket is gone; nothing left to silence.
      }
    }
    // 打断同样意味着这一轮的音频通道走到头：会等的调用方（会话收尾里的
    // whenDrained）不能被永久挂住——队列已经被清空，那条 tts stop 元素再也不会发出去。
    this.#resolveDrained()
    return dropped
  }

  async stop() {
    this.running = false
    this.abortController.abort()
    this.queue.close()
    this.#resolveDrained()
    if (this.loop) await this.loop.catch(() => {})
    this.loop = null
  }

  async #run() {
    while (this.running) {
      const signal = this.abortController.signal
      const element = await this.queue.take()
      if (!element) break
      // Ghost-audio guard: anything produced before the current epoch is
      // physically dropped, not merely skipped — including a stale tts_stop,
      // which would otherwise cut off the turn that just replaced it.
      if (element.generation !== this.generation.current) {
        if (element.kind === KIND.AUDIO_FRAME) this.stats.droppedFrames += 1
        continue
      }
      if (element.kind === KIND.AUDIO_FRAME) {
        const wait = this.#planFrame(element)
        if (wait > 0) await this.sleep(wait, signal)
        if (!this.running || signal.aborted) continue
        this.sink.sendBinary(element.data)
        this.stats.sentFrames += 1
        this.stats.sentBytes += element.data.length
        this.stats.lastSendAt = this.clock()
        continue
      }
      if (element.kind === KIND.TTS_STOP) {
        // Let the device finish the audio it already has before telling it to
        // stop, otherwise the last syllable is cut off mid-word.
        const tail = Math.max(0, this.playbackTail - this.clock()) + this.marginMs
        if (tail > 0) await this.sleep(tail, signal)
        if (!this.running || signal.aborted) {
          this.playbackTail = 0
          continue
        }
        this.playbackTail = 0
      }
      this.#sendControl(element)
      if (element.kind === KIND.TTS_STOP && this.queue.size === 0) this.#resolveDrained()
    }
  }

  /**
   * Virtual playback clock, ported from the reference sender loop.
   *
   * `playbackTail` is when the device will finish what it has been sent. Frames
   * may run up to `creditMs` ahead of that clock, which converts a bursty
   * provider into a smooth stream without an unbounded write to a small device
   * buffer. Returns how long to wait before sending this frame.
   */
  #planFrame(element) {
    const now = this.clock()
    if (this.playbackTail === 0 || now > this.playbackTail) this.playbackTail = now
    const sendAt = this.playbackTail - this.creditMs
    this.playbackTail += element.frameMs || this.frameIntervalMs
    return Math.max(0, sendAt - now)
  }

  #sendControl(element) {
    switch (element.kind) {
      case KIND.TTS_START:
        this.sink.sendJson({ type: 'tts', state: 'start' })
        this.stats.controlEvents += 1
        return
      case KIND.SENTENCE_START:
        this.sink.sendJson({ type: 'tts', state: 'sentence_start', text: element.text })
        this.stats.controlEvents += 1
        return
      case KIND.SENTENCE_END:
        this.sink.sendJson({ type: 'tts', state: 'sentence_end' })
        this.stats.controlEvents += 1
        return
      case KIND.TTS_STOP:
        this.sink.sendJson({ type: 'tts', state: 'stop' })
        this.stats.controlEvents += 1
        return
      default:
    }
  }
}
