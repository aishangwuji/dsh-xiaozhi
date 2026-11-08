/**
 * Microsoft Edge TTS adapter.
 *
 * Protocol details are taken from the reference implementation's pinned
 * `edge-tts-go@v0.0.3` (the wrapper in `internal/domain/tts/edge/edge.go` only
 * forwards to it):
 *
 *   wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1
 *     ?Ocp-Apim-Subscription-Key=<trusted token>
 *     &Sec-MS-GEC=<sha256>&Sec-MS-GEC-Version=1-140.0.3485.14&ConnectionId=<uuid>
 *
 * then two text frames (`speech.config`, `ssml`) and binary frames whose first
 * two bytes are a big-endian header length. Audio comes back as MP3, which ffmpeg
 * turns into the PCM this pipeline encodes to Opus.
 *
 * The GEC value is a time-window token: Windows file-time ticks rounded down to
 * five minutes, followed by the trusted token, SHA-256'd and upper-cased. Go
 * computes it in float64, and so does this port — a BigInt variant would produce a
 * different hash for the same instant because the tick count exceeds 2^53.
 */

import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { connectWebSocket } from '../ws-client.js'

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const CHROMIUM_VERSION = '140.0.3485.14'
const WIN_EPOCH = 11_644_473_600
const BASE_URL = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'

const HEADERS = {
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
}

export function secMsGec(now = Date.now()) {
  const seconds = Math.floor(now / 1000) + WIN_EPOCH
  const rounded = Math.floor(seconds / 300) * 300
  const ticks = rounded * 1e7
  return createHash('sha256').update(`${ticks.toFixed(0)}${TRUSTED_TOKEN}`).digest('hex').toUpperCase()
}

/** `zh-CN-XiaoxiaoNeural` → the long form the service expects. */
export function normalizeVoice(voice) {
  const match = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(voice ?? '')
  if (!match) return voice
  // The language tag is two groups: `zh-CN-XiaoxiaoNeural` → region `zh-CN`.
  let region = `${match[1]}-${match[2]}`
  let name = match[3]
  if (name.includes('-')) {
    const [prefix, ...rest] = name.split('-')
    region = `${region}-${prefix}`
    name = rest.join('-')
  }
  return `Microsoft Server Speech Text to Speech Voice (${region}, ${name})`
}

function escapeXml(text) {
  return String(text)
    .replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch])
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The service wants Go's `Mon Jan 02 2006 15:04:05 GMT+0000 (…Ed Time)` shape —
 * no comma after the weekday, unlike HTTP-date.
 */
function edgeDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    `${WEEKDAYS[now.getUTCDay()]} ${MONTHS[now.getUTCMonth()]} ${pad(now.getUTCDate())} ${now.getUTCFullYear()} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} ` +
    'GMT+0000 (Coordinated Universal Time)'
  )
}

function speechConfigFrame(boundarySentence = true) {
  const body = JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: boundarySentence ? 'true' : 'false',
            wordBoundaryEnabled: boundarySentence ? 'false' : 'true',
          },
          outputFormat: OUTPUT_FORMAT,
        },
      },
    },
  })
  return [
    `X-Timestamp:${edgeDate()}`,
    'Content-Type:application/json; charset=utf-8',
    'Path:speech.config',
    '',
    body,
  ].join('\r\n')
}

function ssmlFrame({ text, voice, rate, volume, pitch }) {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${escapeXml(voice)}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>` +
    `${escapeXml(text)}</prosody></voice></speak>`
  return [
    `X-RequestId:${randomUUID().replace(/-/g, '')}`,
    'Content-Type:application/ssml+xml',
    `X-Timestamp:${edgeDate()}Z`,
    'Path:ssml',
    '',
    ssml,
  ].join('\r\n')
}

function parseHeaders(text) {
  const headers = {}
  for (const line of text.split('\r\n')) {
    const index = line.indexOf(':')
    if (index < 0) continue
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return headers
}

/** Minimal async queue so the ffmpeg stdout callback can feed a generator. */
class PcmQueue {
  constructor() {
    this.items = []
    this.waiters = []
    this.closed = false
  }

  push(chunk) {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value: chunk, done: false })
    else this.items.push(chunk)
  }

  close() {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true })
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift(), done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

export function createEdgeTts({
  voice = 'zh-CN-XiaoxiaoNeural',
  rate = '+0%',
  volume = '+0%',
  pitch = '+0Hz',
  ffmpegPath = 'ffmpeg',
  sampleRate = 24_000,
  timeoutMs = 15_000,
} = {}) {
  const resolvedVoice = normalizeVoice(voice)

  return {
    name: 'edge',
    async *synthesize(text, { signal } = {}) {
      const connectionId = randomUUID().replace(/-/g, '')
      const url = `${BASE_URL}?Ocp-Apim-Subscription-Key=${TRUSTED_TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}&ConnectionId=${connectionId}`
      const socket = await connectWebSocket(url, { headers: HEADERS, protocols: 'synthesize', timeoutMs })
      const debug =
        process.env.DSH_XIAOZHI_EDGE_DEBUG === '1' ? (...args) => console.error('[edge-tts]', ...args) : () => {}
      debug('connected', url.slice(0, 120))
      if (signal?.aborted) {
        socket.close(1000, 'aborted')
        return
      }

      // MP3 → PCM happens *while* the audio arrives: waiting for the whole
      // sentence would add the provider's full synthesis time to first-audio.
      const pcm = new PcmQueue()
      const decoder = spawn(ffmpegPath, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'mp3',
        '-i',
        'pipe:0',
        '-f',
        's16le',
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        'pipe:1',
      ])
      decoder.stdout.on('data', (chunk) => pcm.push(chunk))
      decoder.on('close', () => pcm.close())
      decoder.on('error', () => pcm.close())
      decoder.stdin.on('error', () => {})

      let audioBytes = 0
      let ended = false
      const finish = (error) => {
        if (ended) return
        ended = true
        try {
          decoder.stdin.end()
        } catch {
          // Already closed.
        }
        socket.close(1000, 'done')
        if (error) pcm.close()
      }

      const timeout = setTimeout(() => finish(new Error('edge tts timed out waiting for turn.end')), timeoutMs)
      timeout.unref?.()

      socket.on('text', (frame) => {
        const split = frame.indexOf('\r\n\r\n')
        const headers = parseHeaders(split < 0 ? frame : frame.slice(0, split))
        debug('text', headers.Path, split < 0 ? '' : frame.slice(split + 4).slice(0, 200))
        if (headers.Path === 'turn.end') {
          clearTimeout(timeout)
          finish(null)
        }
      })
      socket.on('binary', (frame) => {
        if (frame.length < 2) return
        const headerLength = frame.readUInt16BE(0)
        if (2 + headerLength > frame.length) return
        const headers = parseHeaders(frame.subarray(2, 2 + headerLength).toString('utf8'))
        if (headers.Path !== 'audio') return
        const payload = frame.subarray(2 + headerLength)
        if (payload.length === 0) return
        audioBytes += payload.length
        try {
          decoder.stdin.write(payload)
        } catch {
          // ffmpeg died; the queue closes through its own events.
        }
      })
      socket.on('close', () => {
        clearTimeout(timeout)
        finish(null)
      })

      const onAbort = () => {
        try {
          decoder.kill('SIGKILL')
        } catch {
          // Gone.
        }
        socket.close(1000, 'aborted')
        pcm.close()
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const configFrame = speechConfigFrame(true)
      const ssml = ssmlFrame({ text, voice: resolvedVoice, rate, volume, pitch })
      debug('send config', configFrame.replace(/\r\n/g, ' | '))
      debug('send ssml', ssml.replace(/\r\n/g, ' | '))
      socket.sendText(configFrame)
      socket.sendText(ssml)

      try {
        for await (const chunk of pcm) {
          if (signal?.aborted) break
          yield chunk
        }
      } finally {
        signal?.removeEventListener('abort', onAbort)
        clearTimeout(timeout)
        if (!ended) {
          try {
            decoder.kill('SIGKILL')
          } catch {
            // Gone.
          }
          socket.close(1000, 'done')
        }
        if (audioBytes === 0) {
          // Nothing was synthesized; surface it rather than emitting silence.
          if (!signal?.aborted) throw new Error('edge tts returned no audio')
        }
      }
    },
  }
}
