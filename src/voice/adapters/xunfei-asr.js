/**
 * iFlytek (讯飞) streaming dictation — `wss://iat-api.xfyun.cn/v2/iat`.
 *
 * Ported from `internal/domain/asr/xunfei/engine.go`. One WebSocket per utterance:
 *
 *   first frame   → common{app_id} + business{language,domain,accent} + data{status:0, audio}
 *   middle frames → data{status:1, audio}
 *   last frame    → data{status:2, audio:''}
 *   responses     → data.result.ws[].cw[].w 累积；data.status === 2 为终态
 *
 * PCM must be 16 kHz / 16-bit / mono raw, which is exactly what the pipeline's
 * uplink decoder produces, so no conversion happens here.
 */

import { buildSignedUrl, IFLYTEK_ENDPOINTS } from './xunfei-auth.js'
import { connectWebSocket } from '../ws-client.js'

const DEFAULTS = {
  url: IFLYTEK_ENDPOINTS.asr,
  language: 'zh_cn',
  domain: 'iat',
  accent: 'mandarin',
  sampleRate: 16_000,
  connectTimeoutMs: 8_000,
  finalTimeoutMs: 10_000,
}

/** Response frame → `{ text, final }`; throws on a provider error code. */
export function parseAsrResponse(raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    throw new Error('xunfei asr: response is not JSON')
  }
  if (typeof message.code === 'number' && message.code !== 0) {
    throw new Error(`xunfei asr error ${message.code}: ${message.message || 'unknown'} (sid ${message.sid || '-'})`)
  }
  const result = message.data?.result ?? {}
  let text = ''
  for (const segment of result.ws ?? []) {
    const candidate = segment?.cw?.[0]?.w
    if (typeof candidate === 'string') text += candidate
  }
  return { text, final: message.data?.status === 2 }
}

export function createXunfeiAsr({
  appId = '',
  apiKey = '',
  apiSecret = '',
  url = DEFAULTS.url,
  language = DEFAULTS.language,
  domain = DEFAULTS.domain,
  accent = DEFAULTS.accent,
  sampleRate = DEFAULTS.sampleRate,
  connectTimeoutMs = DEFAULTS.connectTimeoutMs,
  finalTimeoutMs = DEFAULTS.finalTimeoutMs,
} = {}) {
  const missing = ['appId', 'apiKey', 'apiSecret'].filter((key) => !{ appId, apiKey, apiSecret }[key])
  if (missing.length > 0) {
    throw new Error(`xunfei asr: missing ${missing.join(', ')} (需要在「配置 → ASR」里填 APPID / APIKey / APISecret)`)
  }

  return {
    name: 'xunfei',
    createStream({ onPartial } = {}) {
      let socket = null
      let closed = false
      let recognised = ''
      let status = 0
      let settle = null
      let rejectFinal = null
      const earlyFrames = []

      const finalPromise = new Promise((resolve, reject) => {
        settle = resolve
        rejectFinal = reject
      })

      const send = (frame) => {
        if (!socket) {
          earlyFrames.push(frame)
          return
        }
        try {
          socket.sendJson(frame)
        } catch {
          // Reported through close.
        }
      }

      const connection = connectWebSocket(buildSignedUrl({ url, apiKey, apiSecret }), {
        timeoutMs: connectTimeoutMs,
      })
        .then((open) => {
          socket = open
          open.on('text', (frame) => {
            let parsed
            try {
              parsed = parseAsrResponse(frame)
            } catch (error) {
              rejectFinal?.(error)
              return
            }
            if (parsed.text) {
              recognised += parsed.text
              onPartial?.(recognised)
            }
            if (parsed.final) settle?.(recognised)
          })
          open.on('close', () => settle?.(recognised))
          open.on('socket-error', (error) => {
            if (error) rejectFinal?.(error)
            else settle?.(recognised)
          })
          for (const frame of earlyFrames.splice(0)) {
            try {
              socket.sendJson(frame)
            } catch {
              // Ignored; close handler settles.
            }
          }
          return open
        })
        .catch((error) => {
          closed = true
          rejectFinal?.(error)
          return null
        })

      const audioFrame = (buffer) => ({
        data: {
          status,
          format: `audio/L16;rate=${sampleRate}`,
          encoding: 'raw',
          audio: Buffer.from(buffer).toString('base64'),
        },
      })

      return {
        async write(pcm) {
          if (closed) return
          const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
          if (buffer.length === 0) return
          const frame = audioFrame(buffer)
          if (status === 0) {
            frame.common = { app_id: appId }
            frame.business = { language, domain, accent }
          }
          status = 1
          send(frame)
        },
        async finish() {
          send({ data: { status: 2, format: `audio/L16;rate=${sampleRate}`, encoding: 'raw', audio: '' } })
          const timeout = new Promise((resolve) => {
            const timer = setTimeout(() => resolve(recognised), finalTimeoutMs)
            timer.unref?.()
          })
          const text = await Promise.race([finalPromise.catch(() => recognised), timeout])
          closed = true
          try {
            socket?.close(1000, 'stream end')
          } catch {
            // Already closed.
          }
          await connection
          return { text: text ?? recognised }
        },
        abort() {
          closed = true
          try {
            socket?.close(1000, 'aborted')
          } catch {
            // Already closed.
          }
          settle?.('')
        },
      }
    },
  }
}
