/**
 * 火山引擎豆包流式语音识别（seed-asr / bigmodel_async）。
 *
 * 帧格式与参考实现逐字段对齐（`internal/domain/asr/doubao/request/{header,payload}.go`
 * 与 `client/client_stream.go`）：
 *
 *   byte0 = PROTOCOL_VERSION(1)<<4 | headerSize(1)  → 0x11
 *   byte1 = messageType<<4 | flags
 *           messageType: 0b0001 完整客户端请求、0b0010 纯音频
 *           flags:       0b0001 POS_SEQUENCE、0b0011 NEG_WITH_SEQUENCE（末包）
 *   byte2 = serialization(1=JSON)<<4 | compression(1=GZIP)   → 0x11（音频帧同样 gzip）
 *   byte3 = 0x00
 *
 *   完整请求：[header][i32 长度][gzip(JSON)]
 *   音频帧  ：[header][i32 seq][i32 长度][gzip(PCM)]，末包 seq 取负、payload 为空
 *
 * 之前的实现把音频帧写成"不压缩、无序号"的裸 PCM，服务端虽然照常回包，但识别结果恒为空——
 * 错的就是这里。
 */

import { randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { connectWebSocket } from '../ws-client.js'

export const VOLC_ASR_DEFAULTS = {
  url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  resourceId: 'volc.seedasr.sauc.duration',
  model: 'bigmodel',
  sampleRate: 16_000,
  endWindowSize: 800,
  connectTimeoutMs: 8_000,
  finalTimeoutMs: 12_000,
}

const PROTOCOL_VERSION = 0b0001
const CLIENT_FULL_REQUEST = 0b0001
const CLIENT_AUDIO_ONLY_REQUEST = 0b0010
const SERVER_FULL_RESPONSE = 0b1001
const SERVER_ERROR_RESPONSE = 0b1111
const POS_SEQUENCE = 0b0001
const NEG_WITH_SEQUENCE = 0b0011
const SERIALIZATION_JSON = 0b0001
const COMPRESSION_GZIP = 0b0001

function header(messageType, flags) {
  return Buffer.from([
    (PROTOCOL_VERSION << 4) | 1,
    (messageType << 4) | flags,
    (SERIALIZATION_JSON << 4) | COMPRESSION_GZIP,
    0x00,
  ])
}

function uint32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value >>> 0, 0)
  return buffer
}

function int32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeInt32BE(value, 0)
  return buffer
}

/** 首包：header + 长度 + gzip(JSON)。 */
export function encodeStartRequest({ sampleRate, model, endWindowSize, enablePunc = true, enableItn = true, seq = 1 }) {
  const payload = {
    user: { uid: randomUUID() },
    audio: { format: 'pcm', codec: 'raw', rate: sampleRate, bits: 16, channel: 1 },
    request: {
      model_name: model,
      enable_itn: enableItn,
      enable_punc: enablePunc,
      enable_nonstream: true,
      show_utterances: true,
      end_window_size: endWindowSize,
    },
  }
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
  // 首包同样带序号（Go 参考写死 int32(1)），否则服务端会把长度字段当成 seq。
  return Buffer.concat([header(CLIENT_FULL_REQUEST, POS_SEQUENCE), int32(seq), uint32(compressed.length), compressed])
}

/** 音频帧：header + seq + 长度 + gzip(PCM)；末包 seq 取负且内容为空。 */
export function encodeAudioFrame(pcm, { seq = 0, last = false } = {}) {
  const body = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
  const compressed = gzipSync(last ? Buffer.alloc(0) : body)
  return Buffer.concat([
    header(CLIENT_AUDIO_ONLY_REQUEST, last ? NEG_WITH_SEQUENCE : POS_SEQUENCE),
    int32(last ? -seq : seq),
    uint32(compressed.length),
    compressed,
  ])
}

/** 解析服务端响应：`{ text, final }`。 */
export function parseResponse(buffer) {
  const headerSize = (buffer[0] & 0x0f) * 4
  const messageType = buffer[1] >> 4
  const compression = buffer[2] & 0x0f
  const payload = buffer.subarray(headerSize)

  if (messageType === SERVER_ERROR_RESPONSE) {
    const code = payload.length >= 4 ? payload.readUInt32BE(0) : 0
    let detail = payload.subarray(8)
    if (compression === COMPRESSION_GZIP && detail.length) {
      try {
        detail = gunzipSync(detail)
      } catch {
        // Keep raw bytes.
      }
    }
    throw new Error(`volc asr error ${code}: ${detail.toString('utf8').slice(0, 300)}`)
  }

  if (messageType !== SERVER_FULL_RESPONSE) return { text: '', final: false }
  if (payload.length < 8) return { text: '', final: false }

  const size = payload.readUInt32BE(4)
  let body = payload.subarray(8, 8 + size)
  if (compression === COMPRESSION_GZIP && body.length) {
    try {
      body = gunzipSync(body)
    } catch {
      // Some frames arrive uncompressed despite the flag.
    }
  }
  let message
  try {
    message = JSON.parse(body.toString('utf8'))
  } catch {
    return { text: '', final: false }
  }
  // bigmodel_async 把结果放在顶层 result；v1 协议才是 payload_msg.result。
  const text = message?.result?.text ?? message?.payload_msg?.result?.text ?? ''
  return {
    text,
    final: Boolean(message?.is_last_package ?? message?.payload_msg?.is_last_package),
  }
}

export function createVolcAsr({
  apiKey = '',
  url = VOLC_ASR_DEFAULTS.url,
  resourceId = VOLC_ASR_DEFAULTS.resourceId,
  model = VOLC_ASR_DEFAULTS.model,
  sampleRate = VOLC_ASR_DEFAULTS.sampleRate,
  endWindowSize = VOLC_ASR_DEFAULTS.endWindowSize,
  connectTimeoutMs = VOLC_ASR_DEFAULTS.connectTimeoutMs,
  finalTimeoutMs = VOLC_ASR_DEFAULTS.finalTimeoutMs,
} = {}) {
  if (!apiKey) throw new Error('volc asr: missing apiKey（配置 → ASR 里填火山 API Key）')

  return {
    name: 'volc',
    createStream({ onPartial } = {}) {
      let socket = null
      let closed = false
      let recognised = ''
      let seq = 2
      let settle = null
      let failure = null
      const early = []

      // Never reject this promise. When the server times a stream out
      // (45000081 "Timed out waiting for the next audio packet") the error frame
      // arrives before anything calls finish(), so a rejection has no handler and
      // Node escalates it to an unhandled rejection — that is what killed the
      // Harness process.
      const finalPromise = new Promise((resolve) => {
        settle = resolve
      })

      let handle = null

      const fail = (error) => {
        failure = error ?? new Error('volc asr: stream failed')
        // The session checks this before feeding more audio: a stream the server
        // already closed silently drops writes, which would swallow the next
        // utterance.
        if (handle) handle.failed = true
        settle?.('')
      }

      const send = (buffer) => {
        if (!socket) {
          early.push(buffer)
          return
        }
        try {
          socket.sendTextBytes(buffer)
        } catch {
          // Reported through close.
        }
      }

      const connection = connectWebSocket(url, {
        timeoutMs: connectTimeoutMs,
        headers: {
          'X-Api-Key': apiKey,
          'X-Api-Resource-Id': resourceId,
          'X-Api-Request-Id': randomUUID(),
        },
      })
        .then((open) => {
          socket = open
          open.on('frame', (opcode, payload) => {
            let parsed
            try {
              parsed = parseResponse(payload)
            } catch (error) {
              fail(error)
              return
            }
            if (parsed.text && parsed.text !== recognised) {
              recognised = parsed.text
              onPartial?.(recognised)
            }
            if (parsed.final) settle?.(recognised)
          })
          open.on('close', () => settle?.(recognised))
          open.on('socket-error', (error) => {
            if (error) fail(error)
            else settle?.(recognised)
          })
          for (const buffer of early.splice(0)) {
            try {
              socket.sendTextBytes(buffer)
            } catch {
              // Ignored; close settles.
            }
          }
          return open
        })
        .catch((error) => {
          closed = true
          fail(error)
          return null
        })

      send(encodeStartRequest({ sampleRate, model, endWindowSize }))

      handle = {
        failed: false,
        async write(pcm) {
          if (closed || handle.failed) return
          const buffer = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
          if (buffer.length === 0) return
          send(encodeAudioFrame(buffer, { seq }))
          seq += 1
        },
        async finish() {
          // A stream the server already ended cannot accept more frames; skip the
          // trailing packet and return whatever was recognised so far.
          if (!failure) send(encodeAudioFrame(Buffer.alloc(0), { seq, last: true }))
          const timeout = new Promise((resolve) => {
            const timer = setTimeout(() => resolve(recognised), finalTimeoutMs)
            timer.unref?.()
          })
          const text = await Promise.race([finalPromise, timeout])
          closed = true
          try {
            socket?.close(1000, 'stream end')
          } catch {
            // Already closed.
          }
          await connection
          return { text: text ?? recognised, error: failure?.message }
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

      return handle
    },
  }
}
