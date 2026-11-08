/**
 * iFlytek (讯飞) online TTS — `wss://tts-api.xfyun.cn/v2/tts`.
 *
 * Ported from the reference implementation (`internal/domain/tts/xunfei`). The
 * service is request/response over one WebSocket: send the whole sentence with
 * `data.status = 2`, then read `data.audio` chunks (base64) until `data.status = 2`.
 *
 * We ask for `aue=raw`, i.e. 16-bit little-endian PCM at the requested rate, so the
 * chunks can go straight into the Opus encoder — no MP3 decode step, which is also
 * why this adapter does not touch ffmpeg.
 */

import { buildSignedUrl, IFLYTEK_ENDPOINTS } from './xunfei-auth.js'
import { connectWebSocket } from '../ws-client.js'

const DEFAULTS = {
  url: IFLYTEK_ENDPOINTS.tts,
  voice: 'xiaoyan',
  speed: 50,
  volume: 50,
  pitch: 50,
  sampleRate: 24_000,
  connectTimeoutMs: 8_000,
  idleTimeoutMs: 15_000,
}

/** One request frame; exported because the payload shape is a protocol detail. */
export function buildTtsRequest({ text, appId, voice, speed, volume, pitch, sampleRate }) {
  return {
    common: { app_id: appId },
    business: {
      aue: 'raw',
      auf: `audio/L16;rate=${sampleRate}`,
      vcn: voice,
      speed,
      volume,
      pitch,
      tte: 'UTF8',
    },
    data: { status: 2, text: Buffer.from(String(text), 'utf8').toString('base64') },
  }
}

/** One response frame; returns `{ audio: Buffer|null, done: boolean }`. */
export function parseTtsResponse(raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    throw new Error('xunfei tts: response is not JSON')
  }
  if (typeof message.code === 'number' && message.code !== 0) {
    throw new Error(`xunfei tts error ${message.code}: ${message.message || 'unknown'} (sid ${message.sid || '-'})`)
  }
  const data = message.data ?? {}
  const audio = typeof data.audio === 'string' && data.audio ? Buffer.from(data.audio, 'base64') : null
  return { audio, done: data.status === 2 }
}

export function createXunfeiTts({
  appId = '',
  apiKey = '',
  apiSecret = '',
  url = DEFAULTS.url,
  voice = DEFAULTS.voice,
  speed = DEFAULTS.speed,
  volume = DEFAULTS.volume,
  pitch = DEFAULTS.pitch,
  sampleRate = DEFAULTS.sampleRate,
  connectTimeoutMs = DEFAULTS.connectTimeoutMs,
  idleTimeoutMs = DEFAULTS.idleTimeoutMs,
} = {}) {
  const missing = ['appId', 'apiKey', 'apiSecret'].filter((key) => !{ appId, apiKey, apiSecret }[key])
  if (missing.length > 0) {
    throw new Error(`xunfei tts: missing ${missing.join(', ')} (需要在「配置 → TTS」里填 APPID / APIKey / APISecret)`)
  }

  return {
    name: 'xunfei',
    async *synthesize(text, { signal, sampleRate: requestedRate } = {}) {
      const sentence = String(text ?? '').trim()
      if (!sentence) return
      const rate = requestedRate || sampleRate

      const signedUrl = buildSignedUrl({ url, apiKey, apiSecret })
      const socket = await connectWebSocket(signedUrl, { timeoutMs: connectTimeoutMs })

      const queue = []
      let pending = null
      let failure = null
      let done = false

      const wake = () => {
        if (pending) {
          const resolve = pending
          pending = null
          resolve()
        }
      }

      socket.on('text', (frame) => {
        try {
          const { audio, done: finished } = parseTtsResponse(frame)
          if (audio) queue.push(audio)
          if (finished) done = true
          wake()
        } catch (error) {
          failure = error
          done = true
          wake()
        }
      })
      socket.on('close', () => {
        done = true
        wake()
      })
      socket.on('socket-error', (error) => {
        failure = failure ?? error
        done = true
        wake()
      })

      const abort = () => {
        done = true
        wake()
        try {
          socket.close(1000, 'aborted')
        } catch {
          // Already gone.
        }
      }
      signal?.addEventListener?.('abort', abort, { once: true })

      socket.sendJson(
        buildTtsRequest({ text: sentence, appId, voice, speed, volume, pitch, sampleRate: rate }),
      )

      const idle = new Promise((resolve) => {
        const timer = setTimeout(() => {
          failure = failure ?? new Error('xunfei tts: timed out waiting for audio')
          done = true
          resolve()
        }, idleTimeoutMs)
        timer.unref?.()
      })

      try {
        for (;;) {
          while (queue.length > 0) {
            yield queue.shift()
          }
          if (done) break
          await Promise.race([
            new Promise((resolve) => {
              pending = resolve
            }),
            idle,
          ])
          if (signal?.aborted) break
        }
        while (queue.length > 0) yield queue.shift()
        if (failure) throw failure
      } finally {
        signal?.removeEventListener?.('abort', abort)
        try {
          socket.close(1000, 'done')
        } catch {
          // Already gone.
        }
      }
    },
  }
}
