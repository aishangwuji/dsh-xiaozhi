/**
 * FunASR streaming ASR adapter.
 *
 * Wire protocol reproduced from the reference client
 * (`internal/domain/asr/funasr/funasr.go`): a plaintext WebSocket at
 * `ws://host:port/`, one JSON start frame, raw PCM16LE binary frames, one JSON
 * end frame, and JSON results routed by `wav_name` until `is_final`.
 *
 * The reference keeps one connection per stream and never sends a close frame;
 * this port does the same, but it does bound the wait for `is_final`, because a
 * silent server would otherwise hold the turn open forever.
 */

import { randomUUID } from 'node:crypto'
import { connectWebSocket } from '../ws-client.js'

export function createFunasrAsr({
  url = 'ws://127.0.0.1:10096/',
  sampleRate = 16_000,
  mode = 'offline',
  chunkInterval = 10,
  timeoutMs = 15_000,
  connectTimeoutMs = 5_000,
} = {}) {
  return {
    name: 'funasr',
    createStream({ onPartial } = {}) {
      const wavName = `funasr-stream-${randomUUID()}-${Date.now()}`
      let socket = null
      let closed = false
      let finalText = ''
      let lastText = ''
      let settle = null
      let rejectFinal = null
      let pending = []
      const pendingBinary = []

      const finalPromise = new Promise((resolve, reject) => {
        settle = resolve
        rejectFinal = reject
      })

      const send = (payload) => {
        if (!socket || closed) {
          pending.push(payload)
          return
        }
        try {
          socket.sendText(JSON.stringify(payload))
        } catch {
          // Socket died; the close handler settles the promise.
        }
      }

      const connection = connectWebSocket(url, { timeoutMs: connectTimeoutMs })
        .then((open) => {
          socket = open
          open.on('text', (frame) => {
            let result
            try {
              result = JSON.parse(frame)
            } catch {
              return
            }
            if (!result || typeof result !== 'object') return
            if (result.wav_name && result.wav_name !== wavName) return
            const text = typeof result.text === 'string' ? result.text : ''
            const isFinal = result.is_final === true || result.mode === '2pass-offline'
            if (text) {
              lastText = text
              onPartial?.(text)
            }
            if (isFinal) {
              finalText = text || lastText
              settle?.(finalText)
            }
          })
          open.on('close', () => {
            closed = true
            if (!finalText) settle?.(lastText)
          })
          open.on('socket-error', (error) => {
            closed = true
            rejectFinal?.(error)
          })
          send({
            mode,
            chunk_size: [5, 10, 5],
            chunk_interval: chunkInterval,
            audio_fs: sampleRate,
            wav_name: wavName,
            wav_format: 'pcm',
            is_speaking: true,
            itn: true,
          })
          for (const payload of pending.splice(0)) {
            try {
              socket?.sendText(JSON.stringify(payload))
            } catch {
              // Reported through close.
            }
          }
          for (const payload of pendingBinary.splice(0)) {
            try {
              socket?.sendBinary(payload)
            } catch {
              // Reported through close.
            }
          }
          return open
        })
        .catch((error) => {
          closed = true
          rejectFinal?.(error)
          return null
        })

      return {
        async write(pcm) {
          if (closed) return
          if (!socket) {
            if (pendingBinary.length < 200) pendingBinary.push(pcm)
            return
          }
          try {
            socket.sendBinary(pcm)
          } catch {
            // Reported through close.
          }
        },
        async finish() {
          send({
            mode,
            chunk_size: [5, 10, 5],
            chunk_interval: chunkInterval,
            wav_name: wavName,
            is_speaking: false,
          })
          const timeout = new Promise((resolve) => {
            const timer = setTimeout(() => resolve(lastText), timeoutMs)
            timer.unref?.()
          })
          const text = await Promise.race([finalPromise.catch(() => lastText), timeout])
          closed = true
          try {
            socket?.close(1000, 'stream end')
          } catch {
            // Already closed.
          }
          await connection
          return { text: text ?? lastText }
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
