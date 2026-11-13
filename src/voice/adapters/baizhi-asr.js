/**
 * 百智云智能语音 —— 实时语音转文字（`wss://asrmodel.app.baizhi.cloud/openapi/v1/realtime`）。
 *
 * 协议（官方 openapi 文档「WSS /realtime · 实时语音转文字」）：
 *
 *   → {"type":"session.start","task":"speech-to-text","parameters":{"language":"zh-CN"}}
 *   ← {"type":"session.created","session_id":"…","task":"speech-to-text"}
 *   → <binary PCM16 16kHz mono 帧，按真实时间节奏每 100–200ms 一帧>
 *   ← {"type":"transcript.delta","segment_id":"segment-1","segment_index":1,"text":"实时"}
 *   ← {"type":"transcript.final","segment_id":"segment-1","segment_index":1,"text":"实时转写结果","final":true}
 *   → {"type":"input.commit"}
 *   ← {"type":"session.completed"}
 *   ← {"type":"error","code":"…","message":"…"}
 *
 * 三个必须照做的约束，违反任何一条都会被服务端拒绝或计费出错：
 *
 * 1. **音频规格固定** `PCM 16-bit / 16 kHz / 单声道`——正好是本管道的上行 PCM，不需要转换；
 * 2. **必须按真实时间节奏发**（100–200ms 一帧），不能把整段音频突发灌进去；断流会回
 *    `audio_idle_timeout`。所以这里有一个节拍发送器（`AudioPacer`）：会话喂多快都行，
 *    真正发出去的速度由它压到实时；
 * 3. **结束必须发 `input.commit`**，且只有 `session.completed` 表示识别完成；连接中途断掉是
 *    `realtime_interrupted`，此时保留已收到的原文。
 *
 * `transcript.delta.text` 是**增量**（同一 segment 逐次追加），`transcript.final.text` 是该
 * segment 的完整文本（用它替换增量）。多分句按 `segment_index` 升序拼接。
 */

import { connectWebSocket } from '../ws-client.js'
import { trace } from '../trace.js'

export const BAIZHI_ASR_DEFAULTS = {
  url: 'wss://asrmodel.app.baizhi.cloud/openapi/v1/realtime',
  // 服务端只接受 16kHz / 16-bit / 单声道；这里不是可调参数，是协议硬约束。
  sampleRate: 16_000,
  // 官方建议 100–200ms 一帧。取 100ms：静音段也能持续产生帧，节拍更密。
  chunkMs: 100,
  connectTimeoutMs: 8_000,
  finalTimeoutMs: 12_000,
  // 排队音频上限：正常会话里队列只有几十毫秒；只有「一次灌完整段」的探针才可能积压。
  maxQueuedMs: 60_000,
}

/**
 * 语种归一化到服务端认识的代码（`zh-CN` / `en-US`）。
 *
 * 留空 = 服务端在当前供应商支持范围内自动识别。未知值也返回空串而不是原样透传：
 * 传一个服务端不认识的值会直接 `unsupported_option`/`invalid_start`，比自动识别更糟。
 */
export function baizhiLanguageCode(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
  if (!raw || raw === 'auto') return ''
  if (raw === 'zh' || raw === 'zh-cn' || raw === 'cmn' || raw === 'chinese') return 'zh-CN'
  if (raw === 'en' || raw === 'en-us' || raw === 'english') return 'en-US'
  return ''
}

/** `session.start` 的请求体（导出给单测，避免把协议形状复制到测试里）。 */
export function buildSessionStart({ language = '' } = {}) {
  const code = baizhiLanguageCode(language)
  const parameters = { speaker_diarization: false }
  // language 留空 = 自动识别；speaker_diarization=true 时服务端要求 language 为空或 zh-CN，
  // 本管道一条流只有一个人说话，固定关掉分离。
  if (code) parameters.language = code
  return { type: 'session.start', task: 'speech-to-text', parameters }
}

/**
 * 按真实时间节奏发 PCM 的节拍器（单流一个）。
 *
 * `push()` 可以随时调用（不阻塞）；`enable()` 之前只排队不发（服务端要先回 `session.created`）。
 * 发完 `flushPartial()` 把不足一帧的尾巴也排进去，`drain(timeoutMs)` 等它全部发出去——
 * 只有发完才能 `input.commit`，否则服务端认为还有音频在路上。
 */
export class AudioPacer {
  constructor({ bytesPerChunk, intervalMs, send, onError } = {}) {
    this.bytesPerChunk = Math.max(2, Math.floor(Number(bytesPerChunk) || 0) || 2)
    this.intervalMs = Math.max(10, Math.floor(Number(intervalMs) || 100))
    this.send = typeof send === 'function' ? send : () => {}
    this.onError = typeof onError === 'function' ? onError : null
    this.pending = Buffer.alloc(0)
    this.queue = []
    this.nextAt = 0
    this.timer = null
    this.enabled = false
    this.stopped = false
    this.sentBytes = 0
    this.sentChunks = 0
    this.waiters = []
  }

  get queuedBytes() {
    return this.pending.length + this.queue.reduce((total, chunk) => total + chunk.length, 0)
  }

  push(pcm) {
    if (this.stopped) return
    const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
    if (buffer.length === 0) return
    this.pending = this.pending.length === 0 ? buffer : Buffer.concat([this.pending, buffer])
    while (this.pending.length >= this.bytesPerChunk) {
      this.queue.push(this.pending.subarray(0, this.bytesPerChunk))
      this.pending = this.pending.subarray(this.bytesPerChunk)
    }
    this.#pump()
  }

  /** 会话已建立：开始按节拍发。 */
  enable() {
    if (this.stopped) return
    this.enabled = true
    this.nextAt = 0
    this.#pump()
  }

  /** 把不足一帧的尾巴排进队列（`finish()` 前调用，保证最后一个音节不被丢掉）。 */
  flushPartial() {
    if (this.stopped) return
    if (this.pending.length > 0) {
      this.queue.push(this.pending)
      this.pending = Buffer.alloc(0)
    }
    this.#settleDrained()
  }

  /** 等队列清空；`timeoutMs` 到期返回 false（调用方决定是否继续）。 */
  drain(timeoutMs = 0) {
    if (this.queue.length === 0 && this.pending.length === 0) return Promise.resolve(true)
    return new Promise((resolve) => {
      const waiter = { resolve, timer: null }
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter)
          resolve(false)
        }, timeoutMs)
        waiter.timer.unref?.()
      }
      this.waiters.push(waiter)
    })
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.#clearTimer()
    this.queue = []
    this.pending = Buffer.alloc(0)
    this.#settleDrained()
  }

  #pump() {
    if (!this.enabled || this.stopped) return
    const now = Date.now()
    while (this.queue.length > 0 && now >= this.nextAt) {
      const chunk = this.queue.shift()
      // 首帧立即发；之后每 intervalMs 一帧，把"喂进来的速度"压回真实时间。
      this.nextAt = (this.nextAt === 0 ? now : Math.max(this.nextAt, now)) + this.intervalMs
      try {
        this.send(chunk)
      } catch (error) {
        this.onError?.(error)
        this.stop()
        return
      }
      this.sentBytes += chunk.length
      this.sentChunks += 1
    }
    this.#settleDrained()
    if (this.queue.length > 0) this.#schedule(Math.max(0, this.nextAt - Date.now()))
    else this.#clearTimer()
  }

  #schedule(delay) {
    if (this.timer || this.stopped) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.#pump()
    }, delay)
    this.timer.unref?.()
  }

  #clearTimer() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  #settleDrained() {
    if (this.queue.length > 0 || this.pending.length > 0) return
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.resolve(true)
    }
  }
}

export function createBaizhiAsr({
  apiKey = '',
  url = BAIZHI_ASR_DEFAULTS.url,
  language = '',
  sampleRate = BAIZHI_ASR_DEFAULTS.sampleRate,
  speakerDiarization = false,
  connectTimeoutMs = BAIZHI_ASR_DEFAULTS.connectTimeoutMs,
  finalTimeoutMs = BAIZHI_ASR_DEFAULTS.finalTimeoutMs,
  chunkMs = BAIZHI_ASR_DEFAULTS.chunkMs,
  maxQueuedMs = BAIZHI_ASR_DEFAULTS.maxQueuedMs,
  // 仅单测注入：默认走插件自己的 WS 客户端（供应商要求自定义头，不能用内置 WebSocket）。
  connect = connectWebSocket,
} = {}) {
  if (!apiKey) throw new Error('baizhi asr: missing apiKey（配置 → ASR 里填百智云 API Key）')
  if (Number(sampleRate) !== BAIZHI_ASR_DEFAULTS.sampleRate) {
    throw new Error(
      `baizhi asr: 只支持 ${BAIZHI_ASR_DEFAULTS.sampleRate}Hz 上行 PCM（当前 voice.sampleRate.uplink=${sampleRate}）——` +
        '把上行采样率改回 16000，或换一家 ASR',
    )
  }
  const bytesPerChunk = Math.round((BAIZHI_ASR_DEFAULTS.sampleRate * chunkMs) / 1000) * 2

  return {
    name: 'baizhi',
    createStream({ onPartial } = {}) {
      let socket = null
      let closed = false
      let failure = null
      let created = false
      let recognised = ''
      let dropped = false
      const segments = new Map()
      const handle = { failed: false }

      let settle = null
      // 与 volc 适配器同样的理由：服务端可能在 finish() 之前就报错，reject 会变成
      // 无人处理的 rejection 并把 Harness 进程带崩，所以这里永不 reject。
      const finalPromise = new Promise((resolve) => {
        settle = resolve
      })

      // 由 fail() 引用：连接/协议失败后先把节拍器停掉，否则 finish() 还要空等一个排空超时。
      let pacer = null

      const composeText = () =>
        [...segments.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(([, entry]) => entry.text)
          .join('')

      const absorb = (event) => {
        const index = Number.isFinite(event.segment_index) ? Number(event.segment_index) : segments.size + 1
        const entry = segments.get(index) ?? { text: '' }
        if (event.type === 'transcript.final') entry.text = String(event.text ?? '')
        else entry.text += String(event.text ?? '')
        segments.set(index, entry)
        const text = composeText()
        if (text && text !== recognised) {
          recognised = text
          onPartial?.(text)
        }
      }

      function fail(error) {
        failure = error ?? new Error('baizhi asr: stream failed')
        handle.failed = true
        pacer?.stop()
        settle?.(composeText())
      }

      pacer = new AudioPacer({
        bytesPerChunk,
        intervalMs: chunkMs,
        send: (chunk) => {
          if (closed || !socket) return
          socket.sendBinary(chunk)
        },
        onError: (error) => fail(error),
      })

      const connection = connect(url, {
        timeoutMs: connectTimeoutMs,
        headers: { Authorization: `Bearer ${apiKey}` },
      })
        .then((open) => {
          socket = open
          open.on('text', (frame) => {
            let event
            try {
              event = JSON.parse(frame)
            } catch {
              return
            }
            switch (event?.type) {
              case 'session.created': {
                created = true
                trace('baizhi.asr.created', { session: event.session_id ?? '', language: event.task ?? '' })
                pacer.enable()
                return
              }
              case 'transcript.delta':
              case 'transcript.final':
                absorb(event)
                return
              case 'session.completed':
                settle?.(composeText())
                return
              case 'error':
                fail(new Error(`baizhi asr error ${event.code ?? 'unknown'}: ${event.message ?? 'unknown'}`))
                return
              default:
                // 未知事件（心跳/统计之类）不影响识别，忽略。
                return
            }
          })
          open.on('close', () => settle?.(composeText()))
          open.on('socket-error', (error) => {
            if (error) fail(error)
            else settle?.(composeText())
          })
          // 先建会话再发音频；pacer 在 session.created 之后才放开。
          open.sendJson(buildSessionStart({ language }))
          return open
        })
        .catch((error) => {
          closed = true
          fail(error)
          return null
        })

      handle.write = async (pcm) => {
        if (closed || handle.failed) return
        const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
        if (buffer.length === 0) return
        const queuedMs = (pacer.queuedBytes / (BAIZHI_ASR_DEFAULTS.sampleRate * 2)) * 1000
        if (!dropped && queuedMs > maxQueuedMs) {
          dropped = true
          fail(new Error(`baizhi asr: 待发音频超过 ${Math.round(maxQueuedMs / 1000)}s，已中断（节拍发送跟不上）`))
          return
        }
        pacer.push(buffer)
      }

      handle.finish = async () => {
        pacer.flushPartial()
        // 排队的音频必须按真实节奏发完才能 commit；按剩余时长算等待上限，再加 3s 余量。
        const remainingMs = (pacer.queuedBytes / (BAIZHI_ASR_DEFAULTS.sampleRate * 2)) * 1000
        await pacer.drain(Math.min(30_000, Math.round(remainingMs) + 3_000))
        if (!failure && created && socket) {
          try {
            // 结束时立即发 input.commit（官方要求），晚发会让服务端先回 audio_idle_timeout。
            socket.sendJson({ type: 'input.commit' })
            trace('baizhi.asr.commit', { queued: pacer.queuedBytes, sent: pacer.sentBytes, chunks: pacer.sentChunks })
          } catch {
            // 连接已断：close 分支会 settle，按已收到的原文返回。
          }
        }
        const timeout = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(composeText()), finalTimeoutMs)
          timer.unref?.()
        })
        const text = await Promise.race([finalPromise, timeout])
        closed = true
        pacer.stop()
        try {
          socket?.close(1000, 'stream end')
        } catch {
          // 已经关了。
        }
        await connection
        return { text: text ?? composeText(), error: failure?.message }
      }

      handle.abort = () => {
        closed = true
        pacer.stop()
        try {
          socket?.close(1000, 'aborted')
        } catch {
          // 已经关了。
        }
        settle?.(composeText())
      }

      // 会话在 created 之前就断掉时，close/socket-error 分支已经 settle，finish() 不会一直等。
      return handle
    },
  }
}
