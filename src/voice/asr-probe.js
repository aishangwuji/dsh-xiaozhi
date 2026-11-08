/**
 * ASR 在线测试：没有「自带一句话」的探针，所以先用 TTS 合成一句固定话，再把 PCM 喂给
 * 被测 ASR。测的是真实识别链路（凭据 / 端点 / Resource ID），代价是 TTS 也必须可用。
 *
 * 这里只做编排，具体厂商调用由注入的 `buildTts` / `buildAsr` 完成，方便单测用假适配器。
 *
 * @param {object} options
 * @param {object} options.spec        被测 ASR 配置（一条主用/备用条目）
 * @param {object} options.ttsSpec     全局 TTS 配置（用来生成测试语音）
 * @param {Function} options.buildTts  `buildTtsAdapter` 或等价函数
 * @param {Function} options.buildAsr  `buildAsrAdapter` 或等价函数
 * @param {object} [options.speechToText] 本地 ASR 需要的宿主服务
 * @param {number} [options.sampleRate] 识别采样率（默认 16000）
 * @param {string} [options.ffmpegPath]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ text: string, bytes: number }>}
 */
export async function probeAsr({
  spec,
  ttsSpec,
  buildTts,
  buildAsr,
  speechToText,
  sampleRate = 16_000,
  ffmpegPath = 'ffmpeg',
  signal,
} = {}) {
  if (!ttsSpec?.provider || ttsSpec.provider === 'mock') {
    throw new Error('ASR 测试需要先配置可用的 TTS（用来生成测试语音）')
  }
  let pcm
  try {
    const tts = buildTts(ttsSpec, { ffmpegPath, sampleRate })
    const chunks = []
    for await (const chunk of tts.synthesize('你好，小智，这是一次语音识别测试。', { signal, sampleRate })) {
      if (chunk?.length) chunks.push(chunk)
    }
    pcm = Buffer.concat(chunks)
  } catch (error) {
    throw new Error(`ASR 测试需要可用的 TTS：${error.message}`)
  }
  if (!pcm?.length) throw new Error('TTS 没有返回音频，无法测试 ASR')

  const asr = buildAsr(spec, { sampleRate, speechToText })
  if (typeof asr?.createStream !== 'function') {
    throw new Error(`ASR 适配器不支持 ${spec?.provider ?? 'unknown'}`)
  }
  const stream = asr.createStream({})
  try {
    // 按 ~100ms 一块写，接近真实上行节奏；流式 ASR 一次灌太多容易丢帧。
    const chunkSize = Math.max(2, Math.round(sampleRate * 0.1)) * 2
    for (let offset = 0; offset < pcm.length; offset += chunkSize) {
      await stream.write(pcm.subarray(offset, offset + chunkSize))
    }
    const result = await stream.finish()
    if (result?.error) throw new Error(result.error)
    return { text: String(result?.text ?? '').trim(), bytes: pcm.length }
  } finally {
    stream.abort?.()
  }
}
