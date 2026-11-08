/**
 * 本地音乐文件 → 24k 单声道 PCM。
 *
 * 插件的 TTS 链路只吃 PCM；`play_music` 需要先把 mp3/wav 等解码成
 * `s16le / mono / 24k`，再交给 `encodePcmToOpus` 走原有的 paced player。
 * 与 TTS 的 Edge 适配器一样，ffmpeg 是外部依赖，找不到就明确报错。
 */
import { spawn } from 'node:child_process'

export function decodeAudioToPcm(
  file,
  { ffmpegPath = 'ffmpeg', sampleRate = 24_000, signal, maxSeconds = 300, timeoutMs = 30_000 } = {},
) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(sampleRate), 'pipe:1']
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    const maxBytes = sampleRate * 2 * maxSeconds
    let bytes = 0
    let stderr = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      fn(value)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish(reject, new Error('音频解码超时'))
    }, timeoutMs)
    const onAbort = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      finish(reject, new Error('音频解码已取消'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
        finish(reject, new Error(`音频超过 ${maxSeconds} 秒上限`))
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => finish(reject, error))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        finish(reject, new Error(`ffmpeg 解码失败（${code}）：${stderr.trim().slice(0, 200)}`))
        return
      }
      finish(resolve, Buffer.concat(chunks))
    })
  })
}
