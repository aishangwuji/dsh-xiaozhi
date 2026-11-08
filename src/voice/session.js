/**
 * One device's full-duplex voice session.
 *
 * Turn structure, in the order the device perceives it:
 *
 *   uplink opus ──decode──> PCM ──VAD──> utterance ──ASR──> text
 *        └── pre-roll ring (so the first syllable is never clipped)
 *   text ──LLM stream──> segmenter ──sentence──> TTS ──encode──> paced frames
 *
 * The two invariants that everything else is built around:
 *
 * 1. Every downlink element carries the epoch it was produced in. Aborting bumps
 *    the epoch, so audio already inside the box can never be spoken into the next
 *    turn ("ghost audio"), even if a provider ignores its cancellation signal.
 * 2. The first sentence must leave before the model finishes, which is why the
 *    segmenter sits between the LLM and TTS rather than after the completion.
 */

import { AudioPlayer, controlElement, Generation, KIND, audioFrame } from './elements.js'
import { EnergyVad } from './vad.js'
import { OutputSegmenter } from './segmenter.js'
import { withMemory, extractFact } from '../memory.js'
import { MAX_TOOL_ROUNDS } from '../tools.js'
import { trace } from './trace.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PRE_ROLL_MS = 300

export class VoiceSession {
  /**
   * @param {object} options
   * @param {{ sendJson: Function, sendBinary: Function }} options.sink transport
   * @param {object} options.adapters `{ asr, tts, llm }` implementations
   * @param {object} options.config resolved voice configuration
   * @param {Function} [options.createDecoder] uplink opus->pcm bridge factory
   * @param {Function} [options.encodeSpeech] pcm->opus packet encoder
   */
  constructor({
    sink,
    adapters,
    config,
    logger,
    deviceId = '',
    sessionId = '',
    createDecoder,
    encodeSpeech,
    clock = () => Date.now(),
  }) {
    this.deviceId = deviceId
    // 记忆按智能体走（2026-11-08）：同一智能体的多台设备共用一份记忆；
    // 历史对话仍按设备落盘（每台设备的音频/消息互不混淆）。缺省回落到设备键，
    // 兼容还没迁移的老数据。
    this.memoryKey = String(config?.memoryKey ?? '') || deviceId
    // 与控制台历史对话的会话 id 对齐：ingress 把连接 id 传进来，hello 下发的也是它。
    this.sessionId = String(sessionId ?? '')
    // 落盘日志要能看到「服务器到底发了什么」：JSON 状态 + 二进制帧的条数与字节数。
    // 包一层 sink 比在每个出站点上埋 trace 更不容易漏。
    let outFrames = 0
    let outBytes = 0
    this.sink = {
      sendJson: (message) => {
        if (message?.type === 'tts' || message?.type === 'stt') {
          trace('ws.json', { device: deviceId, type: message.type, state: message.state, frames: outFrames, bytes: outBytes })
          if (message.type === 'tts' && message.state === 'stop') {
            outFrames = 0
            outBytes = 0
          }
        }
        sink.sendJson(message)
      },
      sendBinary: (data) => {
        outFrames += 1
        outBytes += data?.length ?? 0
        sink.sendBinary(data)
      },
    }
    this.adapters = adapters
    this.config = config
    this.logger = logger ?? {}
    this.clock = clock
    this.createDecoder = createDecoder
    this.encodeSpeech = encodeSpeech
    // 调试用：把每段上行 PCM 存成 WAV（%TEMP%\dsh-xiaozhi-pcm），并在 trace 里记
    // rms/peak。用来区分「设备上行是静音/很小」还是「音频内容坏了」。
    this.dumpPcm = config.dumpPcm === true
    // 历史对话音频：与 dumpPcm 解耦（排障开关关着也要能回放）。默认开。
    this.historyAudio = config.historyAudio !== false

    this.generation = new Generation()
    this.player = new AudioPlayer({
      sink: this.sink,
      generation: this.generation,
      marginMs: config.pacingMarginMs,
      logger,
      clock,
    })
    this.vad = new EnergyVad({
      frameMs: config.frameMs.uplink,
      energyThreshold: config.vadThreshold,
      silenceMs: config.silenceMs,
      minSpeechMs: config.minSpeechMs,
    })
    this.segmenter = new OutputSegmenter({ firstChunkChars: config.firstChunkChars })

    this.state = 'idle' // idle | listening | thinking | speaking
    this.listenMode = 'auto'
    this.capturing = false
    this.closed = false
    this.history = []
    this.turn = 0
    // 本轮所有句子的下行 PCM（24k），closing 后拼成一条 WAV 写进历史对话。
    this.turnAudioChunks = []
    this.turnAbort = null
    this.asrStream = null
    this.utterance = null
    this.preRoll = []
    this.preRollBytes = 0
    this.decoder = null
    this.synthesisChain = Promise.resolve()
    this.metrics = {
      turns: 0,
      speechEnds: 0,
      firstAudioLatencies: [],
      interrupts: [],
      droppedFrames: 0,
      asrMs: [],
      firstTokenMs: [],
    }
    this.startedAt = clock()
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    trace('session.start', {
      device: this.deviceId,
      vad: {
        threshold: this.vad.energyThreshold,
        silenceMs: this.vad.silenceMs,
        minSpeechMs: this.vad.minSpeechMs,
        frameMs: this.vad.frameMs,
      },
    })
    this.player.start()
    this.decoder = this.createDecoder?.({
      onPcm: (pcm) => this.#onPcm(pcm),
      onError: (error) => this.logger.warn?.(`dsh-xiaozhi: uplink decode failed: ${error.message}`),
    })
  }

  async close() {
    if (this.closed) return
    this.closed = true
    trace('session.close', { device: this.deviceId, turns: this.metrics.turns })
    this.capturing = false
    this.#cancelTurn('session closed')
    this.asrStream?.abort?.()
    this.asrStream = null
    this.decoder?.close?.()
    this.decoder = null
    await this.player.stop()
  }

  // --------------------------------------------------------------- device I/O

  /** Device binary frame: one Opus packet (60 ms on current firmware). */
  handleAudio(packet, frameMs) {
    if (this.closed) return
    this.decoder?.push(packet, frameMs)
  }

  handleListen(message) {
    const state = typeof message.state === 'string' ? message.state : 'auto'
    this.listenMode = state
    // 与设备端串口日志对照：listen start 到底有没有到、当时在不在捕获。
    trace('listen', {
      device: this.deviceId,
      state,
      mode: message.mode ?? '',
      capturing: this.capturing,
      hasStream: Boolean(this.asrStream),
      hasUtterance: Boolean(this.utterance),
    })
    if (state === 'stop') {
      this.capturing = false
      if (!this.asrStream || !this.utterance) {
        // 设备还在 Listening，但服务端这一侧已经收口（空回合后不再给设备回 tts）。
        // 直接重开捕获：不回 tts（会弹设备），也不能忽略——忽略的话设备不会重新发
        // listen start，用户下一段话全被丢弃（2026-11-07 实测：连续 50s/113s 的哑采集）。
        this.#beginCapture()
        return
      }
      void this.#finalizeUtterance('listen-stop')
      return
    }
    // start / detect / auto all open capture; detect arrives after a wake word.
    if (!this.capturing) this.#beginCapture()
    if (message.mode === 'manual' || message.mode === 'realtime') this.listenMode = message.mode
  }

  handleAbort(reason = 'client abort') {
    this.#cancelTurn(reason)
    this.#interrupt('client abort')
  }

  /**
   * Operator-driven speech: read `text` out through the same TTS/pacing path a
   * normal answer uses, without involving the LLM. Used by the console's
   * "inject message" action so announcements sound exactly like replies.
   */
  async speak(text) {
    if (this.closed) throw new Error('session is closed')
    const sentence = String(text ?? '').trim()
    if (!sentence) return false
    const generation = this.generation.current
    this.state = 'speaking'
    this.player.push(controlElement(KIND.TTS_START, { generation }))
    this.synthesisChain = this.synthesisChain
      .then(() =>
        this.#speakSentence({
          sentence,
          sentenceId: `inject:${this.clock()}`,
          generation,
          signal: new AbortController().signal,
        }),
      )
      .catch((error) => this.logger.warn?.(`dsh-xiaozhi: injected speech failed: ${error.message}`))
    await this.synthesisChain
    if (generation === this.generation.current) {
      this.player.push(controlElement(KIND.TTS_STOP, { generation }))
      this.state = this.capturing ? 'listening' : 'idle'
    }
    return true
  }

  // ------------------------------------------------------------------- capture

  #beginCapture() {
    this.capturing = true
    this.vad.reset()
    this.preRoll = []
    this.preRollBytes = 0
    trace('capture.begin', { device: this.deviceId })
    this.#openAsr()
  }

  #openAsr() {
    this.asrStream?.abort?.()
    const stream = this.adapters.asr.createStream({
      sampleRate: this.config.sampleRate.uplink,
      language: this.config.language,
      // 默认不推 partial：固件对每条 stt 都会新建一个气泡（lcd_display.cc:539 起），
      // 逐字推会堆出几十个气泡把字幕顶出屏幕。官方服务端也只在整句结束时发一次。
      onPartial: this.config.partialStt
        ? (text) => this.sink.sendJson({ type: 'stt', text, partial: true })
        : undefined,
    })
    this.asrStream = stream
    this.utterance = {
      beganAt: this.clock(),
      preRollFed: false,
      text: '',
      audioBytes: 0,
      sumSq: 0,
      sampleCount: 0,
      peak: 0,
      // dumpPcm 或历史音频任一开启都要留 PCM：前者排障，后者每轮落 WAV。
      pcm: this.dumpPcm || this.historyAudio ? [] : null,
      pcmBytes: 0,
    }
  }

  /**
   * 判停模式：
   *   - `device`（默认）：固件 AFE 判到静音就发 `listen stop`，这里只负责收口。
   *     阈值只有一份——esp-sr 的 `VAD_MODE_0` + `vad_min_noise_ms=100`（原厂调好的）。
   *   - `energy`：老固件没有 listen stop，退回插件自己的能量 VAD 判停。
   */
  get #deviceVad() {
    return (this.config.vadMode ?? 'device') !== 'energy'
  }

  #onPcm(pcm) {
    if (this.closed) return
    for (const event of this.vad.push(pcm, this.config.sampleRate.uplink)) {
      if (event.type === 'speech-start') {
        trace('vad.start', { device: this.deviceId, energy: Number(event.energy?.toFixed(4) ?? 0), state: this.state })
        if (this.state === 'speaking' || this.state === 'thinking') {
          // Barge-in: the human wins. Interrupt first so the device goes quiet
          // before the ASR stream even starts producing text.
          this.#interrupt('barge-in')
        }
        // A barge-in lands while the previous turn's answer() is still running,
        // and that path only reopens ASR when it finishes — so the new utterance
        // needs its own stream right now or its audio would be written nowhere.
        if (!this.asrStream || this.asrStream.failed) this.#openAsr()
        this.#feedPreRoll()
        this.state = 'listening'
      } else if (event.type === 'speech-end') {
        this.metrics.speechEnds += 1
        this.lastSpeechEndAt = this.clock()
        trace('vad.end', { device: this.deviceId, energy: Number(event.energy?.toFixed(4) ?? 0), mode: this.#deviceVad ? 'device' : 'energy' })
        // 设备判停模式下，句尾以固件的 listen stop 为准；否则我们自己收。
        if (!this.#deviceVad) void this.#finalizeUtterance('vad-silence')
      }
    }
    if (!this.capturing) {
      // 有音频但没在捕获：说明设备没发 listen start（或 stop 先到了）。
      // 只在第一次记一条，避免刷屏。
      if (!this.uncapturedAudioBytes) {
        trace('audio.uncaptured', { device: this.deviceId, state: this.state })
      }
      this.uncapturedAudioBytes = (this.uncapturedAudioBytes ?? 0) + pcm.length
      return
    }
    // 设备判停时音频持续喂给 ASR（谁说完由设备说），能量 VAD 只在老模式下做门控。
    if (this.#deviceVad) {
      this.#trackUplink(pcm)
      this.asrStream?.write?.(pcm)
      return
    }
    if (!this.vad.speaking) {
      this.#pushPreRoll(pcm)
      return
    }
    this.#trackUplink(pcm)
    this.asrStream?.write?.(pcm)
  }

  /** 统计这一段上行音频的 RMS/峰值，必要时留一份 PCM 供落盘。 */
  #trackUplink(pcm) {
    const utterance = this.utterance
    if (!utterance) return
    utterance.audioBytes += pcm.length
    const view = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
    for (let index = 0; index < view.length; index += 1) {
      const sample = view[index]
      utterance.sumSq += sample * sample
      const magnitude = Math.abs(sample)
      if (magnitude > utterance.peak) utterance.peak = magnitude
    }
    utterance.sampleCount += view.length
    if (utterance.pcm) {
      // 上界与历史音频的单条上限一致（120s），避免用户长时间按住说话时内存无限涨。
      const maxBytes = (this.config.sampleRate?.uplink ?? 16_000) * 2 * 120
      if ((utterance.pcmBytes ?? 0) < maxBytes) {
        utterance.pcm.push(Buffer.from(pcm))
        utterance.pcmBytes = (utterance.pcmBytes ?? 0) + pcm.length
      }
    }
  }

  #uplinkStats(utterance) {
    const samples = utterance.sampleCount
    const rms = samples > 0 ? Math.sqrt(utterance.sumSq / samples) / 32_768 : 0
    return {
      bytes: utterance.audioBytes ?? 0,
      seconds: Number((samples / (this.config.sampleRate?.uplink ?? 16_000)).toFixed(2)),
      rms: Number(rms.toFixed(4)),
      peak: Number(((utterance.peak ?? 0) / 32_768).toFixed(3)),
    }
  }

  /** 异步落盘一段 16-bit 单声道 WAV（只用于排障，失败不影响语音）。 */
  async #writeUtteranceWav(utterance, trigger) {
    if (!utterance?.pcm || utterance.pcm.length === 0) return null
    try {
      const dir = join(tmpdir(), 'dsh-xiaozhi-pcm')
      await mkdir(dir, { recursive: true })
      const rate = this.config.sampleRate?.uplink ?? 16_000
      const data = Buffer.concat(utterance.pcm)
      const header = Buffer.alloc(44)
      header.write('RIFF', 0)
      header.writeUInt32LE(36 + data.length, 4)
      header.write('WAVE', 8)
      header.write('fmt ', 12)
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)
      header.writeUInt16LE(1, 22)
      header.writeUInt32LE(rate, 24)
      header.writeUInt32LE(rate * 2, 28)
      header.writeUInt16LE(2, 32)
      header.writeUInt16LE(16, 34)
      header.write('data', 36)
      header.writeUInt32LE(data.length, 40)
      const name = `${(this.deviceId || 'device').replace(/[^A-Za-z0-9]/g, '')}-${Date.now()}-${trigger}.wav`
      const file = join(dir, name)
      await writeFile(file, Buffer.concat([header, data]))
      return file
    } catch {
      return null
    }
  }

  #pushPreRoll(pcm) {
    this.preRoll.push(pcm)
    this.preRollBytes += pcm.length
    const maxBytes = (this.config.sampleRate.uplink * PRE_ROLL_MS * 2) / 1000
    while (this.preRollBytes > maxBytes && this.preRoll.length > 1) {
      const dropped = this.preRoll.shift()
      this.preRollBytes -= dropped.length
    }
  }

  #feedPreRoll() {
    if (this.utterance?.preRollFed) return
    for (const chunk of this.preRoll) this.asrStream?.write?.(chunk)
    this.preRoll = []
    this.preRollBytes = 0
    if (this.utterance) this.utterance.preRollFed = true
  }

  async #finalizeUtterance(trigger) {
    if (!this.asrStream || !this.utterance) return
    const stream = this.asrStream
    const utterance = this.utterance
    this.asrStream = null
    this.utterance = null
    if (utterance.beganAt === 0) return
    this.lastSpeechEndAt = this.clock()
    const startedAt = this.clock()
    const stats = this.#uplinkStats(utterance)
    const dumpWav = async () => {
      if (!this.dumpPcm) return
      const file = await this.#writeUtteranceWav(utterance, trigger)
      if (file) trace('utterance.wav', { device: this.deviceId, file, ...stats })
    }
    let text = ''
    try {
      const result = await stream.finish()
      text = (result?.text ?? '').trim()
      // 有的适配器把失败放在返回值里（火山 ASR：握手 403 / 服务端错误帧 → {text:'', error}）。
      // 只记 asr.empty 会让「识别恒为空、设备卡在聆听中」看起来像没说话；这里必须留证据。
      if (!text && result?.error) {
        this.logger.warn?.(`dsh-xiaozhi: ASR failed: ${result.error}`)
        trace('asr.error', { device: this.deviceId, message: String(result.error).slice(0, 300), ...stats })
        this.sink.sendJson({ type: 'stt', text: '', error: 'asr_failed' })
        await dumpWav()
        return
      }
    } catch (error) {
      this.logger.warn?.(`dsh-xiaozhi: ASR failed: ${error.message}`)
      trace('asr.error', { device: this.deviceId, message: error.message, ...stats })
      this.sink.sendJson({ type: 'stt', text: '', error: 'asr_failed' })
      await dumpWav()
      return
    }
    this.metrics.asrMs.push(this.clock() - startedAt)
    if (!text) {
      this.logger.info?.(`dsh-xiaozhi: empty utterance (${trigger})`)
      trace('asr.empty', { device: this.deviceId, trigger, ...stats })
      // 空结果不再补 tts start/stop（固件修好后每轮都会自己发 listen start）；
      // 只有「收到了音频却没识别出字」才算正常空回合，用 bytes 区分。
      if ((utterance.audioBytes ?? 0) === 0) {
        this.logger.warn?.(`dsh-xiaozhi: ASR received no audio for this utterance (${trigger})`)
        trace('asr.no_audio', { device: this.deviceId, trigger })
      }
      await dumpWav()
      if (this.capturing && this.listenMode !== 'stop') this.#openAsr()
      return
    }
    this.logger.info?.(`dsh-xiaozhi: heared "${text}" (${trigger})`)
    trace('asr.result', { device: this.deviceId, trigger, ms: this.clock() - startedAt, ...stats, text: text.slice(0, 120) })
    await dumpWav()
    // 用户这段话的 PCM（16k）留给历史对话，和文本一起落库；空/失败不写。
    const userPcm = this.historyAudio && utterance.pcm?.length ? Buffer.concat(utterance.pcm) : null
    this.sink.sendJson({ type: 'stt', text })
    await this.#answer(text, { userPcm })
  }

  // ------------------------------------------------------------------ dialogue

  /**
   * Persist the exchange, plus any explicit 记住… fact, off the hot path.
   * 历史对话（会话/消息/音频）不在这里写：它要等本轮所有 TTS 句子合成完才能拼出
   * 完整的助手音频，落库点在 #answer 的 closing（见 #recordTurn）。
   */
  #remember(userText, answerText) {
    const memory = this.adapters.memory
    if (!memory || !this.memoryKey) return
    const fact = extractFact(userText)
    const jobs = [memory.recordTurn(this.memoryKey, { user: userText, assistant: answerText })]
    if (fact) jobs.push(memory.remember(this.memoryKey, fact))
    Promise.allSettled(jobs).catch(() => {})
  }

  /** 不支持工具的适配器包装成同一事件流，调用方不必分叉。 */
  async *#textOnly(stream) {
    for await (const text of stream) yield { type: 'text', text }
  }

  async #answer(userText, { userPcm = null } = {}) {
    this.turn += 1
    const turn = this.turn
    const controller = new AbortController()
    this.turnAbort = controller
    const generation = this.generation.current
    this.segmenter.reset()
    // 本轮助手音频：各句 #speakSentence 成功后按顺序累积，closing 后写一条 WAV。
    this.turnAudioChunks = []
    this.state = 'thinking'
    this.player.push(controlElement(KIND.TTS_START, { generation }))
    const queued = []
    let firstTokenAt = 0
    const requestStartedAt = this.clock()

    const speak = (sentence) => {
      const sentenceId = `${turn}:${queued.length + 1}`
      queued.push(sentence)
      this.synthesisChain = this.synthesisChain
        .then(() =>
          this.#speakSentence({ sentence, sentenceId, generation, signal: controller.signal, captureAudio: true }),
        )
        .catch((error) => {
          if (!controller.signal.aborted) this.logger.warn?.(`dsh-xiaozhi: TTS failed: ${error.message}`)
        })
    }

    try {
      // Memory lives on the adapters so one device's history never leaks into
      // another's prompt; the Go server injects it the same way, right before the
      // completion (`systemPrompt += "\n用户个性化信息: \n%s"`).
      const memoryText = this.config.memoryEnabled === false ? '' : await this.adapters.memory?.contextFor?.(this.memoryKey)
      if (this.adapters.llm && 'systemPrompt' in this.adapters.llm) {
        this.adapters.llm.systemPrompt = withMemory(this.config.systemPrompt ?? '', memoryText)
      }
      const messages = [...this.history, { role: 'user', content: userText }]
      const answerParts = []
      const tools = this.config.toolsEnabled === false ? [] : (this.adapters.tools?.definitions?.(this.deviceId) ?? [])
      const supportsTools = tools.length > 0 && typeof this.adapters.llm.streamWithTools === 'function'
      // 工具循环：拿到的 tool_calls 执行后作为 role:"tool" 回灌，再让模型续写。
      // 最多 MAX_TOOL_ROUNDS 轮，避免模型自问自答绕圈（Go 侧同样是有限轮次）。
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const pending = []
        const stream = supportsTools
          ? this.adapters.llm.streamWithTools({ messages, tools, signal: controller.signal })
          : this.#textOnly(this.adapters.llm.stream({ messages, signal: controller.signal }))
        for await (const event of stream) {
          if (controller.signal.aborted) break
          if (event.type === 'tool_calls') {
            pending.push(...event.calls)
            continue
          }
          if (event.type !== 'text') continue
          if (!firstTokenAt) {
            firstTokenAt = this.clock()
            this.metrics.firstTokenMs.push(firstTokenAt - requestStartedAt)
          }
          answerParts.push(event.text)
          for (const sentence of this.segmenter.push(event.text)) speak(sentence)
        }
        if (pending.length === 0 || controller.signal.aborted) break
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: pending.map((call) => ({
            id: call.id || `call_${round}_${call.name}`,
            type: 'function',
            function: { name: call.name, arguments: call.arguments || '{}' },
          })),
        })
        for (const call of pending) {
          let args = {}
          try {
            args = JSON.parse(call.arguments || '{}')
          } catch {
            args = {}
          }
          const output = await this.adapters.tools.execute(call.name, args, { signal: controller.signal, deviceId: this.deviceId })
          this.logger.info?.(`dsh-xiaozhi: tool ${call.name} -> ${String(output).slice(0, 80)}`)
          messages.push({
            role: 'tool',
            tool_call_id: call.id || `call_${round}_${call.name}`,
            content: String(output),
          })
        }
      }
      if (!controller.signal.aborted) {
        for (const sentence of this.segmenter.flush()) speak(sentence)
      }
      this.#remember(userText, answerParts.join(''))
    } catch (error) {
      if (!controller.signal.aborted) {
        this.logger.warn?.(`dsh-xiaozhi: LLM failed: ${error.message}`)
        trace('llm.error', { device: this.deviceId, message: String(error.message).slice(0, 300) })
        this.sink.sendJson({ type: 'stt', text: userText, error: 'llm_failed' })
      }
    }

    const closing = this.synthesisChain
      .then(() => {
        const answer = queued.join('')
        if (controller.signal.aborted) {
          // 被打断也记这一轮：用户确实说了话，助手也确实播了一部分。
          void this.#recordTurn(userText, answer, userPcm)
          return
        }
        this.player.push(controlElement(KIND.TTS_STOP, { generation }))
        this.state = this.capturing ? 'listening' : 'idle'
        this.history.push({ role: 'user', content: userText })
        this.history.push({ role: 'assistant', content: answer })
        this.history = this.history.slice(-this.config.historyTurns * 2)
        this.metrics.turns += 1
        // fire-and-forget：落库/写 WAV 全异步，失败只 warn，绝不影响语音收尾。
        void this.#recordTurn(userText, answer, userPcm)
      })
      .catch(() => {})
    await closing
    if (this.turnAbort === controller) this.turnAbort = null
    if (this.capturing && !this.asrStream) this.#openAsr()
  }

  /**
   * 一轮对话落历史：user/assistant 两条消息 + 各自一条 WAV（用户 16k、助手 24k）。
   * 音频与文本互相独立——saveAudio 失败只丢音频，文本照写；任何异常只 warn。
   */
  async #recordTurn(userText, answerText, userPcm) {
    const history = this.adapters.history
    if (!history || !this.deviceId) return
    try {
      const at = this.clock()
      const sessionId = this.sessionId || `legacy-${at}`
      const uplinkRate = this.config.sampleRate?.uplink ?? 16_000
      const downlinkRate = this.config.sampleRate?.downlink ?? 24_000
      const assistantPcm = this.turnAudioChunks.length > 0 ? Buffer.concat(this.turnAudioChunks) : null
      this.turnAudioChunks = []
      const [userAudioId, assistantAudioId] = await Promise.all([
        this.historyAudio && userPcm?.length
          ? history.saveAudio(this.deviceId, userPcm, { sampleRate: uplinkRate }).catch(() => null)
          : Promise.resolve(null),
        this.historyAudio && assistantPcm?.length
          ? history.saveAudio(this.deviceId, assistantPcm, { sampleRate: downlinkRate }).catch(() => null)
          : Promise.resolve(null),
      ])
      const messages = [
        { role: 'user', content: userText, at, audioId: userAudioId ?? null },
        { role: 'assistant', content: answerText, at, audioId: assistantAudioId ?? null },
      ].filter((message) => String(message.content ?? '').trim())
      if (messages.length === 0) return
      await history.appendMessages(this.deviceId, sessionId, messages)
    } catch (error) {
      this.logger.warn?.(`dsh-xiaozhi: history write failed: ${error.message}`)
    }
  }

  async #speakSentence({ sentence, sentenceId, generation, signal, captureAudio = false }) {
    if (signal.aborted || generation !== this.generation.current) return
    const startedAt = this.clock()
    trace('tts.begin', { device: this.deviceId, sentenceId, chars: sentence.length })
    const chunks = []
    try {
      for await (const chunk of this.adapters.tts.synthesize(sentence, {
        signal,
        sampleRate: this.config.sampleRate.downlink,
      })) {
        if (signal.aborted || generation !== this.generation.current) return
        if (chunk?.length) chunks.push(chunk)
      }
    } catch (error) {
      this.logger.warn?.(`dsh-xiaozhi: TTS failed: ${error.message}`)
      trace('tts.error', { device: this.deviceId, sentenceId, ms: this.clock() - startedAt, message: String(error.message).slice(0, 300) })
      throw error
    }
    if (signal.aborted || generation !== this.generation.current) {
      trace('tts.cancelled', { device: this.deviceId, sentenceId })
      return
    }
    if (chunks.length === 0) {
      trace('tts.empty', { device: this.deviceId, sentenceId, ms: this.clock() - startedAt })
      return
    }
    const pcm = Buffer.concat(chunks)
    trace('tts.pcm', { device: this.deviceId, sentenceId, bytes: pcm.length, chunks: chunks.length, ms: this.clock() - startedAt })
    let encoded
    try {
      encoded = await this.encodeSpeech(pcm, {
        sampleRate: this.config.sampleRate.downlink,
        frameMs: this.config.frameMs.downlink,
      })
    } catch (error) {
      this.logger.warn?.(`dsh-xiaozhi: opus encode failed: ${error.message}`)
      trace('tts.encode.error', { device: this.deviceId, sentenceId, message: String(error.message).slice(0, 200) })
      return
    }
    if (signal.aborted || generation !== this.generation.current) return
    trace('tts.encoded', { device: this.deviceId, sentenceId, packets: encoded.packets.length, frameMs: encoded.frameMs })
    // 只在真正要播出去时累积历史音频：encode 失败的句子设备没听到，不应该进 WAV。
    if (captureAudio && this.historyAudio) this.turnAudioChunks.push(pcm)
    this.state = 'speaking'
    this.player.push(controlElement(KIND.SENTENCE_START, { generation, text: sentence, sentenceId }))
    encoded.packets.forEach((packet, index) => {
      this.player.push(
        audioFrame({ data: packet, generation, frameMs: encoded.frameMs, sentenceId }),
      )
      if (index === 0) this.#markFirstAudio(generation)
    })
    this.player.push(controlElement(KIND.SENTENCE_END, { generation, sentenceId }))
  }

  #markFirstAudio(generation) {
    if (this.firstAudioAt === undefined || this.firstAudioGeneration !== generation) {
      this.firstAudioGeneration = generation
      const now = this.clock()
      if (this.lastSpeechEndAt) {
        this.metrics.firstAudioLatencies.push({ turn: this.turn, ms: now - this.lastSpeechEndAt })
        this.lastSpeechEndAt = 0
      }
    }
    this.firstAudioAt = this.clock()
  }

  // -------------------------------------------------------------------- abort

  #interrupt(reason) {
    if (this.state !== 'speaking' && this.state !== 'thinking') return
    const at = this.clock()
    this.#cancelTurn(reason)
    // Invalidate the epoch first: from here on, every element stamped with the
    // old generation is stale by construction, including one a provider is about
    // to hand us after its cancellation signal.
    this.generation.next()
    const dropped = this.player.abort({ reason })
    this.segmenter.reset()
    this.state = this.capturing ? 'listening' : 'idle'
    this.metrics.interrupts.push({ reason, at, dropped })
    trace('turn.interrupt', { device: this.deviceId, reason, dropped, state: this.state })
    this.logger.info?.(`dsh-xiaozhi: interrupted (${reason}), dropped ${dropped} queued element(s)`)
  }

  #cancelTurn(reason) {
    const controller = this.turnAbort
    this.turnAbort = null
    if (controller && !controller.signal.aborted) {
      try {
        controller.abort(reason)
      } catch {
        // AbortController.abort(reason) throws only for exotic reasons.
      }
    }
  }

  /** Operator/metrics snapshot. */
  snapshot() {
    const latencies = this.metrics.firstAudioLatencies.map((entry) => entry.ms)
    return {
      state: this.state,
      turn: this.turn,
      generation: this.generation.current,
      capturing: this.capturing,
      turns: this.metrics.turns,
      queueDepth: this.player.queue.size,
      sentFrames: this.player.stats.sentFrames,
      droppedFrames: this.player.stats.droppedFrames,
      interrupts: this.metrics.interrupts.length,
      firstAudioLatencyMs: latencies.length
        ? { last: latencies[latencies.length - 1], avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) }
        : null,
    }
  }
}
