/**
 * Local adapters: a deterministic voice loop with no vendor and no network.
 *
 * Two jobs. It is the `voice.provider: 'mock'` mode an operator can use to prove
 * the gateway, the pacing, and the interrupt path on a desk before wiring a real
 * vendor; and it is what the automated tests drive, so latency assertions measure
 * the pipeline rather than a provider's mood.
 */

const DEFAULT_REPLY = '我在呢，这是一次本地自检回复。'

/** PCM sine burst, 24 kHz int16 mono, one chunk per `chunkMs`. */
export function* sinePcm({ text, sampleRate = 24_000, chunkMs = 20, amplitude = 0.18 }) {
  const chars = Array.from(String(text ?? '')).length
  const totalMs = Math.max(240, Math.min(1800, chars * 55))
  const chunkSamples = Math.round((sampleRate * chunkMs) / 1000)
  const totalSamples = Math.round((sampleRate * totalMs) / 1000)
  const frequency = 220
  let phase = 0
  for (let produced = 0; produced < totalSamples; produced += chunkSamples) {
    const samples = Math.min(chunkSamples, totalSamples - produced)
    const buffer = Buffer.alloc(samples * 2)
    for (let index = 0; index < samples; index += 1) {
      const value = Math.round(Math.sin(phase) * amplitude * 32_767)
      buffer.writeInt16LE(value, index * 2)
      phase += (2 * Math.PI * frequency) / sampleRate
    }
    yield buffer
  }
}

export function createMockLlm({ reply = DEFAULT_REPLY, deltaMs = 4, chunkChars = 4, onDelta } = {}) {
  return {
    name: 'mock',
    async *stream({ signal } = {}) {
      const chars = Array.from(reply)
      for (let index = 0; index < chars.length; index += chunkChars) {
        if (signal?.aborted) return
        const piece = chars.slice(index, index + chunkChars).join('')
        onDelta?.(piece)
        if (deltaMs > 0) await new Promise((resolve) => setTimeout(resolve, deltaMs))
        yield piece
      }
    },
  }
}

export function createMockTts({ sampleRate = 24_000, chunkMs = 20, chunkDelayMs = 0, onSentence } = {}) {
  return {
    name: 'mock',
    async *synthesize(text, { signal } = {}) {
      onSentence?.(text)
      for (const chunk of sinePcm({ text, sampleRate, chunkMs })) {
        if (signal?.aborted) return
        if (chunkDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, chunkDelayMs))
        yield chunk
      }
    },
  }
}

/**
 * ASR that reports whatever the test tells it to.
 * `plan` maps utterance index (1-based) to the text to return; the last entry is
 * reused when the plan runs out, so a 20-round test only declares one phrase.
 */
export function createMockAsr({ plan = ['你好'], onPartial, onFinish } = {}) {
  let utterance = 0
  return {
    name: 'mock',
    createStream({ onPartial: partial } = {}) {
      utterance += 1
      const text = plan[Math.min(utterance - 1, plan.length - 1)]
      let bytes = 0
      let aborted = false
      return {
        write(pcm) {
          bytes += pcm.length
          onPartial?.(text)
          partial?.(text)
        },
        async finish() {
          if (aborted) return { text: '' }
          onFinish?.({ utterance, text, bytes })
          return { text }
        },
        abort() {
          aborted = true
        },
      }
    },
  }
}

export function createMockAdapters(options = {}) {
  return {
    llm: createMockLlm(options),
    tts: createMockTts(options),
    asr: createMockAsr(options),
  }
}
