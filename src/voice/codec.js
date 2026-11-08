/**
 * Opus/PCM bridge backed by the ffmpeg binary.
 *
 * The reference implementation links libopus and libav directly. A Harness
 * plugin cannot compile native code, so the same two operations go through
 * ffmpeg: `ogg -> s16le` for the uplink (decoded once, shared by VAD and ASR) and
 * `s16le -> ogg opus` for the downlink (encoded per sentence, then paced).
 *
 * Consequences worth stating: ffmpeg must be on PATH (or configured), every
 * session owns its own decoder process, and a missing binary disables voice while
 * leaving the device gateway fully functional.
 */

import { spawn } from 'node:child_process'
import { demuxOggOpus, OggOpusMuxer } from './ogg.js'

const DECODE_ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-fflags',
  'nobuffer',
  '-flags',
  'low_delay',
  '-f',
  'ogg',
  '-i',
  'pipe:0',
  '-f',
  's16le',
  '-ac',
  '1',
]

function resolveFrameArgs({ sampleRate, frameMs, bitrate, application }) {
  const frameDuration = frameMs === 60 ? '60' : frameMs === 40 ? '40' : frameMs === 10 ? '10' : '20'
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    's16le',
    '-ar',
    String(sampleRate),
    '-ac',
    '1',
    '-i',
    'pipe:0',
    '-c:a',
    'libopus',
    '-b:a',
    bitrate,
    '-frame_duration',
    frameDuration,
    '-application',
    application,
    '-f',
    'ogg',
    'pipe:1',
  ]
}

/** Check once at startup instead of failing per turn. */
export function probeFfmpeg(ffmpegPath = 'ffmpeg') {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(ffmpegPath, ['-hide_banner', '-version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let text = ''
    child.stdout.on('data', (chunk) => {
      text += chunk.toString('utf8')
    })
    child.on('error', () => {
      if (settled) return
      settled = true
      resolve({ ok: false, version: '' })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      resolve({ ok: code === 0, version: /ffmpeg version (\S+)/.exec(text)?.[1] ?? '' })
    })
  })
}

/**
 * Long-lived decoder for one session's uplink.
 *
 * Each Opus packet arrives as its own WebSocket frame; the muxer wraps it into a
 * one-packet Ogg page so ffmpeg can keep a single demuxer alive for the whole
 * session. This is what allows VAD to run on real PCM without a native Opus
 * binding.
 */
export class UplinkDecoder {
  constructor({ ffmpegPath = 'ffmpeg', inputRate = 16_000, outputRate = 16_000, onPcm, onError, logger }) {
    this.ffmpegPath = ffmpegPath
    this.inputRate = inputRate
    this.outputRate = outputRate
    this.onPcm = onPcm
    this.onError = onError
    this.logger = logger ?? {}
    this.muxer = new OggOpusMuxer({ serial: Math.floor(Math.random() * 0xffff_ffff), inputSampleRate: inputRate })
    this.child = null
    this.closed = false
    this.pcmBytes = 0
  }

  start() {
    if (this.child) return
    this.child = spawn(this.ffmpegPath, [...DECODE_ARGS, '-ar', String(this.outputRate), 'pipe:1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.on('data', (chunk) => {
      this.pcmBytes += chunk.length
      try {
        this.onPcm?.(chunk)
      } catch (error) {
        this.logger.error?.(`dsh-xiaozhi: pcm consumer failed: ${error.message}`)
      }
    })
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim()
      if (text) this.onError?.(new Error(text))
    })
    this.child.on('error', (error) => {
      this.onError?.(error)
    })
    this.child.on('close', () => {
      this.child = null
    })
    this.child.stdin.on('error', () => {
      // ffmpeg exited; the close handler already reported it.
    })
  }

  push(packet, frameMs = 60) {
    if (this.closed) return
    this.start()
    try {
      // Header pages must precede the first audio page; `muxer.push` would
      // otherwise swallow them (it starts the stream lazily and drops the return).
      if (!this.headerSent) {
        this.headerSent = true
        this.child.stdin.write(this.muxer.start())
      }
      this.child.stdin.write(this.muxer.push(packet, frameMs))
    } catch (error) {
      this.onError?.(error)
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.child?.stdin.end()
    } catch {
      // Already closed.
    }
    const child = this.child
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL')
      } catch {
        // Gone.
      }
    }, 500)
    timer.unref?.()
    child?.once('close', () => clearTimeout(timer))
  }
}

/** Encode PCM (int16 LE mono) into Opus packets using ffmpeg, then unwrap them. */
export function encodePcmToOpus(pcm, options = {}) {
  const {
    ffmpegPath = 'ffmpeg',
    sampleRate = 24_000,
    frameMs = 20,
    bitrate = '32k',
    application = 'voip',
  } = options
  return new Promise((resolve, reject) => {
    const chunks = []
    let stderr = ''
    const child = spawn(ffmpegPath, resolveFrameArgs({ sampleRate, frameMs, bitrate, application }), {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg encode failed (${code}): ${stderr.trim().slice(0, 200)}`))
        return
      }
      try {
        const packets = demuxOggOpus(Buffer.concat(chunks))
        resolve({ packets, frameMs })
      } catch (error) {
        reject(error)
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(pcm)
  })
}

