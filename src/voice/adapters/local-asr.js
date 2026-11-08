/**
 * 本地识别适配器 —— 复用 Harness 自带的 `speechToText` 服务（SenseVoice 等）。
 *
 * 与云端适配器的差别：
 *   - 不建长连接，音频先缓存，`finish()` 时一次性送给本地模型（SenseVoice 是整段推理）；
 *   - 因此没有流式中间结果（`onPartial` 不会触发），但延迟可控且完全离线；
 *   - 数据不出本机，适合"不想把录音送到云端"的场景。
 *
 * 服务契约（来自 Host Service inspect）：
 *   resolve({ audio, providerId?, language? }) -> SpeechSpec
 *   transcribe(spec, signal) -> { text, audioSeconds, inferenceSeconds }
 */

function toWav(pcm, sampleRate) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 列出本机可用的识别提供方（供控制台展示）。 */
export function localProviders(speechToText) {
  try {
    return (speechToText?.listProviders?.() ?? []).map((provider) => ({
      id: String(provider.id),
      name: provider.name,
      location: provider.location,
      languages: [...(provider.languages ?? [])],
    }))
  } catch {
    return []
  }
}

export function createLocalAsr({ speechToText, sampleRate = 16_000, language = 'zh', providerId, timeoutMs = 30_000 } = {}) {
  if (!speechToText?.transcribe) {
    throw new Error('local asr: speechToText 服务不可用（Harness 未装配语音识别插件）')
  }

  return {
    name: 'local',
    createStream({ onPartial } = {}) {
      const chunks = []
      let closed = false

      return {
        async write(pcm) {
          if (closed) return
          chunks.push(Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm))
        },
        async finish() {
          closed = true
          const pcm = Buffer.concat(chunks)
          if (pcm.length === 0) return { text: '' }
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          timer.unref?.()
          try {
            const spec = speechToText.resolve({
              audio: new Uint8Array(toWav(pcm, sampleRate)),
              ...(providerId ? { providerId } : {}),
              language,
            })
            const transcript = await speechToText.transcribe(spec, controller.signal)
            const text = String(transcript?.text ?? '').trim()
            if (text) onPartial?.(text)
            return { text, audioSeconds: transcript?.audioSeconds, inferenceSeconds: transcript?.inferenceSeconds }
          } finally {
            clearTimeout(timer)
          }
        },
        abort() {
          closed = true
          chunks.length = 0
        },
      }
    },
  }
}
