/**
 * 火山引擎豆包语音合成 —— HTTP 单向流式（推荐接入方式）。
 *
 * `POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`
 *   header: X-Api-Key、X-Api-Resource-Id: seed-tts-2.0、Content-Type: application/json
 *   body  : { req_params: { text, speaker, audio_params: { format: "pcm", sample_rate } } }
 *   响应  : 按行返回 JSON `{ code, message, data(base64 音频), sentence }`，
 *           code === 20000000 表示合成结束，其余 >0 为错误。
 *
 * 比 WebSocket 双向版简单得多：一次请求、逐行收音频，正好贴合本管道的"分句 → 合成
 * → 编码"节奏，也不需要维护长连接会话状态。
 */

import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:https'
import { outputLanguageCode } from '../language.js'
import { trace } from '../trace.js'

export const VOLC_HTTP_TTS_DEFAULTS = {
  url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
  resourceId: 'seed-tts-2.0',
  model: 'seed-tts-2.0-standard',
  sampleRate: 24_000,
  timeoutMs: 20_000,
}

/** 结束标记：官方示例里 code=20000000 表示合成结束。 */
const CODE_FINISHED = 20_000_000

/**
 * 语种参数走 `req_params.additions.explicit_language`（JSON 字符串）。
 *
 * 只对"非中文"传：`explicit_language` 是**过滤**语义（只朗读该语种的文本），
 * 中文回复里常混英文词，传 zh 反而会把这些词跳读；不传时引擎按文本自动判断。
 */
export function buildRequestPayload({ text, voice, model, sampleRate, language }) {
  const req_params = {
    text,
    speaker: voice,
    model,
    audio_params: { format: 'pcm', sample_rate: sampleRate },
  }
  const code = outputLanguageCode(language)
  if (code && code !== 'zh') {
    req_params.additions = JSON.stringify({ explicit_language: code })
  }
  return { req_params }
}

/** 解析一行流式响应，返回 `{ audio: Buffer|null, finished: boolean }`。 */
export function parseChunk(line) {
  const text = String(line ?? '').trim()
  if (!text) return { audio: null, finished: false }
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return { audio: null, finished: false }
  }
  if (message.code === CODE_FINISHED) return { audio: null, finished: true }
  if (typeof message.code === 'number' && message.code > 0) {
    // 55000000 是“音色与资源族不同代”：2.0 资源只认 uranus / saturn 音色。
    // 直说原因，否则只看到“没声音”要查很久。
    if (message.code === 55_000_000) {
      throw new Error(
        `volc tts error 55000000: 音色与资源族不匹配（${message.message || 'resource mismatched'}）——` +
          'seed-tts-2.0 只能用 uranus / saturn 音色，moon / mars / jupiter / multi_* 属 1.x',
      )
    }
    throw new Error(`volc tts error ${message.code}: ${message.message || 'unknown'}`)
  }
  const audio = typeof message.data === 'string' && message.data ? Buffer.from(message.data, 'base64') : null
  return { audio, finished: false }
}

export function createVolcHttpTts({
  apiKey = '',
  url = VOLC_HTTP_TTS_DEFAULTS.url,
  resourceId = VOLC_HTTP_TTS_DEFAULTS.resourceId,
  model = VOLC_HTTP_TTS_DEFAULTS.model,
  voice = '',
  language = '',
  sampleRate = VOLC_HTTP_TTS_DEFAULTS.sampleRate,
  timeoutMs = VOLC_HTTP_TTS_DEFAULTS.timeoutMs,
} = {}) {
  if (!apiKey) throw new Error('volc tts: missing apiKey（配置 → TTS 里填火山 API Key）')
  if (!voice) throw new Error('volc tts: missing voice（需要填控制台音色 ID，如 zh_female_vv_uranus_bigtts）')

  return {
    name: 'volc',
    synthesize(text, { signal, sampleRate: requestedRate } = {}) {
      const sentence = String(text ?? '').trim()
      if (!sentence) {
        return (async function* empty() {})()
      }
      const rate = requestedRate || sampleRate
      const body = JSON.stringify(buildRequestPayload({ text: sentence, voice, model, sampleRate: rate, language }))
      const target = new URL(url)
      trace('volc.request', { voice, resourceId, model, language, chars: sentence.length, sampleRate: rate })

      return (async function* run() {
        const startedAt = Date.now()
        let bytes = 0
        const response = await new Promise((resolve, reject) => {
          const req = httpRequest(
            {
              hostname: target.hostname,
              path: `${target.pathname}${target.search}`,
              method: 'POST',
              headers: {
                'X-Api-Key': apiKey,
                'X-Api-Resource-Id': resourceId,
                'X-Api-Request-Id': randomUUID(),
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              },
              timeout: timeoutMs,
            },
            resolve,
          )
          req.on('timeout', () => req.destroy(new Error('volc tts: request timed out')))
          req.on('error', reject)
          signal?.addEventListener?.('abort', () => req.destroy(new Error('aborted')), { once: true })
          req.end(body)
        })

        if (response.statusCode !== 200) {
          let detail = ''
          for await (const chunk of response) detail += chunk.toString('utf8')
          trace('volc.http.error', { status: response.statusCode, detail: detail.slice(0, 300), ms: Date.now() - startedAt })
          throw new Error(`volc tts http ${response.statusCode}: ${detail.slice(0, 200)}`)
        }

        let buffer = ''
        for await (const chunk of response) {
          buffer += chunk.toString('utf8')
          let index = buffer.indexOf('\n')
          while (index >= 0) {
            const line = buffer.slice(0, index)
            buffer = buffer.slice(index + 1)
            const parsed = parseChunk(line)
            if (parsed.audio && parsed.audio.length > 0) {
              if (bytes === 0) trace('volc.first', { ms: Date.now() - startedAt, bytes: parsed.audio.length })
              bytes += parsed.audio.length
              yield parsed.audio
            }
            if (parsed.finished) {
              trace('volc.done', { ms: Date.now() - startedAt, bytes })
              return
            }
            index = buffer.indexOf('\n')
          }
          if (signal?.aborted) return
        }
        const tail = parseChunk(buffer)
        if (tail.audio && tail.audio.length > 0) yield tail.audio
      })()
    },
  }
}
