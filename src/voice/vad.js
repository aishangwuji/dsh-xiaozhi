/**
 * Energy-based voice activity detection.
 *
 * The reference implementation uses a neural VAD (ten-vad / silero). This is the
 * dependency-free successor: RMS over already-decoded PCM with hysteresis, which
 * is enough to cut a turn on silence and to notice a barge-in. It intentionally
 * errs towards "speech continues" — a premature cut-off truncates the user's
 * sentence, while a late cut-off only costs a few hundred milliseconds.
 *
 * 参数出处（尽量不自己编）：
 *   - `silenceMs = 400`：与 Go 服务端 `chat_max_silence_duration: 400` 对齐
 *     （xiaozhi-golang-src/config/config.yaml:15）。
 *   - `minSpeechMs = 120`、`energyThreshold = 0.012`：**这两项是能量 VAD 自己的**。
 *     官方用的是神经网络 VAD，阈值是模型打分（Silero 0.5 / ten-vad 0.4，
 *     见两份 config.yaml 的 vad 段），与本文件 0..1 的 RMS 不是同一量纲，抄不过来。
 *     要和原厂一致，正确做法是换用官方 VAD（已登记 TD-6）。
 */

export class EnergyVad {
  /**
   * @param {object} options
   * @param {number} [options.frameMs] analysis window
   * @param {number} [options.energyThreshold] RMS in the 0..1 scale (int16 / 32768)
   * @param {number} [options.silenceMs] trailing silence that ends an utterance
   * @param {number} [options.minSpeechMs] voiced time that starts an utterance
   */
  constructor({ frameMs = 60, energyThreshold = 0.012, silenceMs = 400, minSpeechMs = 120 } = {}) {
    this.frameMs = frameMs
    this.energyThreshold = energyThreshold
    this.silenceMs = silenceMs
    this.minSpeechMs = minSpeechMs
    this.speaking = false
    this.voicedMs = 0
    this.silentMs = 0
    this.residual = Buffer.alloc(0)
    this.turn = 0
  }

  /** Frame size in bytes for 16-bit mono PCM. */
  bytesPerFrame(sampleRate = 16_000) {
    return Math.floor((sampleRate * this.frameMs) / 1000) * 2
  }

  reset() {
    this.speaking = false
    this.voicedMs = 0
    this.silentMs = 0
    this.residual = Buffer.alloc(0)
  }

  /**
   * Feed PCM (int16 LE mono). Returns the transitions that happened, in order.
   * @returns {Array<{ type: 'speech-start'|'speech-continue'|'speech-end', energy: number, turn: number }>}
   */
  push(pcm, sampleRate = 16_000) {
    const events = []
    const frameBytes = this.bytesPerFrame(sampleRate)
    const buffer = this.residual.length > 0 ? Buffer.concat([this.residual, pcm]) : pcm
    let offset = 0
    while (offset + frameBytes <= buffer.length) {
      const frame = buffer.subarray(offset, offset + frameBytes)
      offset += frameBytes
      const energy = rms16(frame)
      const voiced = energy >= this.energyThreshold
      if (voiced) {
        this.voicedMs += this.frameMs
        this.silentMs = 0
      } else {
        this.silentMs += this.frameMs
      }
      if (!this.speaking) {
        if (this.voicedMs >= this.minSpeechMs) {
          this.speaking = true
          this.turn += 1
          this.silentMs = 0
          events.push({ type: 'speech-start', energy, turn: this.turn })
        }
      } else {
        events.push({ type: 'speech-continue', energy, turn: this.turn })
        if (this.silentMs >= this.silenceMs) {
          this.speaking = false
          this.voicedMs = 0
          events.push({ type: 'speech-end', energy, turn: this.turn })
        }
      }
    }
    this.residual = buffer.subarray(offset)
    return events
  }
}

/** RMS of an int16 LE buffer, normalized to 0..1. */
export function rms16(buffer) {
  const samples = Math.floor(buffer.length / 2)
  if (samples === 0) return 0
  let sum = 0
  for (let index = 0; index < samples; index += 1) {
    const value = buffer.readInt16LE(index * 2) / 32_768
    sum += value * value
  }
  return Math.sqrt(sum / samples)
}
