/**
 * DeepSeek 语音识别（`POST https://api.deepseek.com/v1/tools/asr`，2026-11-14）。
 *
 * 官方文档：<https://api-docs.deepseek.com/zh-cn/api/asr>（语种/限制/错误见「语音识别指南」）。
 *
 * 与火山/百智云的**实时**识别不同，这是**整段批处理**：一次请求发送完整音频，返回完整
 * 转写文本，不支持流式、也没有中间结果。所以这里和 `local-asr.js` 同一形态——先把 PCM
 * 缓存起来，`finish()` 时再一次性上传：
 *
 *   → multipart/form-data（`file` 字段 = 16-bit PCM WAV）
 *   ← {"request_id":"…","text":"…","duration_ms":3200}
 *
 * 官方约束（违反会被 400/413 直接拒掉）：
 * - 只收 **16 位 PCM WAV** 或 Ogg Opus，由文件内容判断；WAV 采样率 ∈
 *   8000/16000/22050/24000/32000/44100/48000，单/双声道（双声道只识别左声道）；
 * - 文件 ≤ 8 MiB，上传要在 10 分钟内完成，时长 ≤ 120 秒；
 * - **没有语种参数**，语种根据音频自动识别——控制台因此不提供「识别语种」，
 *   智能体级的 `language`（本是 TTS 输出语种）在这里也会被忽略。
 *
 * 上限处理：超过 120 秒或 8 MiB 时**截断到上限再上传**（保留开头，尽量别让整轮对话因为
 * 一句特别长的话而彻底没有识别结果），并记一条 trace，方便排障时看出「被截过」。
 *
 * 错误处理：HTTP 失败与网络失败都回 `{ text: '', error }`（与火山适配器同一约定），
 * 这样会话侧会发一次 `asr_failed`、failover 会换下一家；抛异常也一样会切换，但返回值
 * 让「这一轮确实失败了」在日志里更明确。
 */

import { randomUUID } from 'node:crypto'

import { encodeWav16, resamplePcm16, WAV_SAMPLE_RATES } from '../wav.js'
import { trace } from '../trace.js'

export const DEEPSEEK_ASR_DEFAULTS = {
  url: 'https://api.deepseek.com/v1/tools/asr',
  // 本管道的上行就是 16 kHz / 16-bit / 单声道（`voice.sampleRate.uplink`）。
  sampleRate: 16_000,
  maxSeconds: 120,
  maxBytes: 8 * 1024 * 1024,
  // 120s 音频的整段识别；官方另有 10 分钟上传窗口，这里按「一次识别」给 60s。
  timeoutMs: 60_000,
}

/** 官方错误码 → 一句能直接给用户看的原因。 */
export function describeAsrStatus(status) {
  switch (Number(status)) {
    case 400:
      return '音频不是 16 位 PCM WAV / Ogg Opus，或缺少 file 字段'
    case 408:
      return '上传未在 10 分钟内完成'
    case 413:
      return '文件大于 8 MiB'
    case 429:
      return '账号同时进行的识别请求数超过上限'
    case 503:
      return '服务繁忙，请稍后重试'
    case 504:
      return '识别超时'
    case 401:
    case 403:
      return 'API Key 无效或无权限'
    default:
      return '识别失败'
  }
}

/**
 * 组一个 multipart/form-data 请求体（只用于一个文件字段）。
 *
 * 不依赖全局 `FormData`：单测要能直接断言字节流里的文件名与 RIFF 头，而且这里只有
 * 一个字段，手写边界比透过 undici 的封装更好验证。
 */
export function buildUploadBody({ data, field = 'file', filename = 'speech.wav', contentType = 'audio/wav' } = {}) {
  const boundary = `----dshxiaozhi${randomUUID().replace(/-/g, '')}`
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  const audio = Buffer.isBuffer(data) ? data : Buffer.from(data ?? [])
  return {
    body: Buffer.concat([head, audio, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export function createDeepseekAsr({
  apiKey = '',
  url = DEEPSEEK_ASR_DEFAULTS.url,
  language = '',
  sampleRate = DEEPSEEK_ASR_DEFAULTS.sampleRate,
  timeoutMs = DEEPSEEK_ASR_DEFAULTS.timeoutMs,
  maxSeconds = DEEPSEEK_ASR_DEFAULTS.maxSeconds,
  maxBytes = DEEPSEEK_ASR_DEFAULTS.maxBytes,
  // 仅单测注入；运行时用全局 fetch。
  fetchImpl = null,
} = {}) {
  if (!apiKey) throw new Error('deepseek asr: missing apiKey（配置 → ASR 里填 DeepSeek API Key）')
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('deepseek asr: 当前运行环境没有 fetch')
  const inputRate = Number(sampleRate) > 0 ? Number(sampleRate) : DEEPSEEK_ASR_DEFAULTS.sampleRate
  // 没有语种参数：官方按音频自动识别。这里显式忽略智能体级 language，避免「配了没用」的误会。
  void language

  /** 上行采样率不在官方白名单里就归一到 16k（否则会 400，整段白跑）。 */
  const normalize = (pcm) => {
    if (WAV_SAMPLE_RATES.includes(inputRate)) return { pcm, rate: inputRate, resampled: false }
    return { pcm: resamplePcm16(pcm, inputRate, DEEPSEEK_ASR_DEFAULTS.sampleRate), rate: DEEPSEEK_ASR_DEFAULTS.sampleRate, resampled: true }
  }

  return {
    name: 'deepseek',
    createStream({ onPartial } = {}) {
      let chunks = []
      let closed = false
      let aborted = false
      // 缓存上限：官方文件上限 8 MiB（含 44 字节头）。**写入时就截住**，而不是等 finish()
      // 再裁——否则「设备一直不发 listen stop」时这段 PCM 会无限增长，把这台机器的内存吃光。
      // 8k/12k 上行归一到 16k 时样本变多，最坏再涨一倍，仍是有界内存。
      const maxBufferedBytes = Math.floor((maxBytes - 44) / 2) * 2
      let bufferedBytes = 0
      let dropped = false
      // 在途请求的 controller：`abort()`（用户打断）必须能立刻掐断上传，而不是等 60s 超时。
      let inflight = null

      return {
        async write(pcm) {
          if (closed || aborted) return
          const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm ?? [])
          if (buffer.length === 0) return
          const room = maxBufferedBytes - bufferedBytes
          if (room <= 0) {
            dropped = true
            return
          }
          const kept = buffer.length > room ? buffer.subarray(0, room) : buffer
          chunks.push(kept)
          bufferedBytes += kept.length
          if (kept.length < buffer.length) dropped = true
        },

        async finish() {
          if (aborted) {
            chunks = []
            return { text: '' }
          }
          closed = true
          const raw = Buffer.concat(chunks)
          chunks = []
          bufferedBytes = 0
          if (raw.length === 0) return { text: '' }

          const { pcm: normalized, rate, resampled } = normalize(raw)
          // 上限：时长 120s + 文件 8 MiB（WAV 头 44 字节）；按采样点截断，保持 16-bit 对齐。
          const maxByDuration = Math.floor(maxSeconds * rate)
          const maxByBytes = Math.floor((maxBytes - 44) / 2)
          const cap = Math.max(1, Math.min(maxByDuration, maxByBytes))
          const samples = Math.floor(normalized.length / 2)
          const truncated = dropped || samples > cap
          const pcm = samples > cap ? normalized.subarray(0, cap * 2) : normalized
          const wav = encodeWav16(pcm, rate)
          const upload = buildUploadBody({ data: wav })
          const startedAt = Date.now()
          trace('deepseek.asr.request', {
            seconds: Number((pcm.length / (rate * 2)).toFixed(2)),
            bytes: wav.length,
            sampleRate: rate,
            inputSampleRate: inputRate,
            resampled,
            truncated,
          })

          const controller = new AbortController()
          inflight = controller
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          timer.unref?.()
          try {
            const response = await doFetch(url, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': upload.contentType,
                Accept: 'application/json',
              },
              body: upload.body,
              signal: controller.signal,
            })
            if (!response.ok) {
              const detail = await response.text().catch(() => '')
              const message = `deepseek asr http ${response.status}: ${describeAsrStatus(response.status)}` +
                (detail ? `（${String(detail).slice(0, 160)}）` : '')
              trace('deepseek.asr.error', { status: response.status, detail: String(detail).slice(0, 300), ms: Date.now() - startedAt })
              return { text: '', error: message }
            }
            let payload
            try {
              payload = await response.json()
            } catch (error) {
              trace('deepseek.asr.error', { message: String(error?.message ?? error).slice(0, 300) })
              return { text: '', error: `deepseek asr: 响应不是 JSON（${error.message}）` }
            }
            // 200 但形状不对（缺 text / 类型不对 / 甚至 `{"error":…}`）必须当**失败**返回：
            // 当成“成功但为空”会让会话只记一条 asr.empty，既不报 asr_failed 也不切备用，
            // 表现就是「设备一直聆听中、说什么都没反应」——这正是 2026-11-06 火山那次的坑。
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              trace('deepseek.asr.error', { message: 'response is not an object' })
              return { text: '', error: 'deepseek asr: 响应不是 JSON 对象' }
            }
            if (typeof payload.text !== 'string') {
              trace('deepseek.asr.error', {
                message: `missing text field (got ${typeof payload.text})`,
                requestId: String(payload.request_id ?? ''),
              })
              return {
                text: '',
                error: `deepseek asr: 响应缺少 text 字段（${typeof payload.text}）` +
                  (payload.error ? `，服务端报错：${String(JSON.stringify(payload.error)).slice(0, 120)}` : ''),
              }
            }
            // 识别期间被用户打断：别再推 partial / 记成功，直接按“本轮作废”返回。
            if (aborted || controller.signal.aborted) return { text: '' }
            const text = payload.text.trim()
            trace('deepseek.asr.result', {
              requestId: String(payload?.request_id ?? ''),
              durationMs: Number(payload?.duration_ms ?? 0),
              chars: text.length,
              ms: Date.now() - startedAt,
              truncated,
            })
            if (text) onPartial?.(text)
            return { text, requestId: payload?.request_id, durationMs: payload?.duration_ms }
          } catch (error) {
            // 用户打断（barge-in）不是失败：本轮作废，不要把 asr_failed 推给设备。
            if (aborted) return { text: '' }
            const message = controller.signal.aborted
              ? `deepseek asr: 识别超时（${Math.round(timeoutMs / 1000)}s）`
              : `deepseek asr: ${error?.message ?? error}`
            trace('deepseek.asr.error', { message: message.slice(0, 300), ms: Date.now() - startedAt })
            return { text: '', error: message }
          } finally {
            clearTimeout(timer)
            inflight = null
          }
        },

        abort() {
          aborted = true
          closed = true
          chunks = []
          bufferedBytes = 0
          // 在途请求也一起掐掉：否则用户已经打断、音频还在按秒上传（最长 60s、最多 8 MiB）。
          try {
            inflight?.abort()
          } catch {
            // 已经结束了。
          }
        },
      }
    },
  }
}
