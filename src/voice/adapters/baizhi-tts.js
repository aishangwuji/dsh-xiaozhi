/**
 * 百智云智能语音 —— 文字转语音（`POST https://asrmodel.app.baizhi.cloud/openapi/v1/audio`）。
 *
 * 请求：JSON `{ task:'text-to-speech', input:{ text }, parameters:{ voice, speed? } }`
 * 响应：`Content-Type: audio/wav`，**24 kHz / 单声道 / 16-bit PCM**，一次返回整段。
 *
 * 和火山（逐行流式 PCM）不同，这里是「整段 WAV」：
 *
 * - 好处是**不需要 ffmpeg**——WAV 头在 JS 里剥掉就是 PCM，这条链路少了外部进程依赖；
 * - 代价是首字延迟 = 整句合成时间（不能边合边播）。会话侧仍是「一句一合成」，所以只影响
 *   该句的第一帧，不影响整轮。
 *
 * 采样率：服务端固定 24k，本管道的下行也是 24k，正常路径直接透传。只有 ASR 在线测试
 * （`src/voice/asr-probe.js` 用 16k 喂 ASR）会请求 16k，这时用线性插值重采样——探针输入
 * 不需要更高保真，也不值得为此再拉一个 ffmpeg 进程。
 */

import { trace } from '../trace.js'

export const BAIZHI_TTS_DEFAULTS = {
  url: 'https://asrmodel.app.baizhi.cloud/openapi/v1/audio',
  voice: 'vivi',
  sampleRate: 24_000,
  timeoutMs: 20_000,
  // 官方限制：去除首尾空白后最多 2000 个 Unicode 字符。
  maxChars: 2_000,
}

/** 语速预设：服务端只有 slow(0.8) / normal(1.0) / fast(1.2) 三档。 */
export const BAIZHI_SPEED_PRESETS = { slow: 'slow', normal: 'normal', fast: 'fast' }

/**
 * 控制台/智能体里的「回复速度」（0.5–2 的倍数）→ 服务端预设。
 *
 * 中间档（0.95–1.05）返回 `normal`，让显式配过速度的用户看到确定行为；非数字返回空串
 * （= 不带 speed，用服务端默认），避免把垃圾值发给服务端换回 `invalid_request`。
 */
export function baizhiSpeedPreset(value) {
  const speed = Number(value)
  if (!Number.isFinite(speed) || speed <= 0) return ''
  if (speed < 0.95) return BAIZHI_SPEED_PRESETS.slow
  if (speed > 1.05) return BAIZHI_SPEED_PRESETS.fast
  return BAIZHI_SPEED_PRESETS.normal
}

/**
 * 解析 WAV（只接受 16-bit PCM 单声道）。
 *
 * 容错点：`data` 的 size 写成 `0xFFFFFFFF` 或超过实际长度时（流式/边写边读的封装很常见），
 * 按「到文件尾」处理，而不是直接报错——否则整段音频会被判成坏包。
 */
export function parseWav(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  if (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('baizhi tts: 响应不是 WAV（缺少 RIFF/WAVE 头）')
  }
  let format = 0
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataOffset = -1
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4)
    const declared = data.readUInt32LE(offset + 4)
    const payloadStart = offset + 8
    const available = data.length - payloadStart
    const size = Math.min(declared, available)
    if (id === 'fmt ') {
      if (size < 16) throw new Error('baizhi tts: WAV 的 fmt 块不完整')
      format = data.readUInt16LE(payloadStart)
      channels = data.readUInt16LE(payloadStart + 2)
      sampleRate = data.readUInt32LE(payloadStart + 4)
      bitsPerSample = data.readUInt16LE(payloadStart + 14)
    } else if (id === 'data') {
      dataOffset = payloadStart
      dataSize = size
      break
    }
    offset = payloadStart + size + (size % 2)
  }
  if (dataOffset < 0) throw new Error('baizhi tts: WAV 里没有 data 块')
  if (format !== 1) throw new Error(`baizhi tts: WAV 编码 ${format} 不是 PCM（只支持 16-bit PCM）`)
  if (bitsPerSample !== 16) throw new Error(`baizhi tts: WAV 位深 ${bitsPerSample}（只支持 16-bit）`)
  if (channels !== 1) throw new Error(`baizhi tts: WAV 声道数 ${channels}（只支持单声道）`)
  if (!sampleRate) throw new Error('baizhi tts: WAV 缺少采样率')
  // 奇数长度（半个采样）直接丢掉，下游按 16-bit 对齐读会越界。
  if (dataSize % 2 === 1) dataSize -= 1
  return { format, channels, sampleRate, bitsPerSample, pcm: data.subarray(dataOffset, dataOffset + dataSize) }
}

/**
 * 16-bit PCM 线性插值重采样（只在「服务端固定 24k、调用方要别的采样率」时用，例如 ASR 探针要 16k）。
 *
 * 只做这一种轻量转换：语音会话的下行固定 24k，直接透传；这里不追求高保真，追求「不引入
 * 额外外部进程、结果可单测」。
 */
export function resamplePcm16(pcm, fromRate, toRate) {
  const source = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm ?? [])
  const from = Number(fromRate) || 0
  const to = Number(toRate) || 0
  if (!from || !to || from === to) return source
  const samples = Math.floor(source.length / 2)
  if (samples === 0) return Buffer.alloc(0)
  const ratio = to / from
  const total = Math.max(1, Math.round(samples * ratio))
  const output = Buffer.alloc(total * 2)
  for (let index = 0; index < total; index += 1) {
    const position = index / ratio
    const left = Math.min(Math.floor(position), samples - 1)
    const right = Math.min(left + 1, samples - 1)
    const fraction = position - Math.floor(position)
    const a = source.readInt16LE(left * 2)
    const b = source.readInt16LE(right * 2)
    const value = Math.max(-32_768, Math.min(32_767, Math.round(a + (b - a) * fraction)))
    output.writeInt16LE(value, index * 2)
  }
  return output
}

/** 请求体（导出给单测）。 */
export function buildTtsRequest({ text, voice, speed = '' }) {
  const parameters = { voice }
  if (speed) parameters.speed = speed
  return { task: 'text-to-speech', input: { text }, parameters }
}

export function createBaizhiTts({
  apiKey = '',
  url = BAIZHI_TTS_DEFAULTS.url,
  voice = BAIZHI_TTS_DEFAULTS.voice,
  speed = '',
  sampleRate = BAIZHI_TTS_DEFAULTS.sampleRate,
  timeoutMs = BAIZHI_TTS_DEFAULTS.timeoutMs,
  // 仅单测注入；运行时用全局 fetch。
  fetchImpl = null,
} = {}) {
  if (!apiKey) throw new Error('baizhi tts: missing apiKey（配置 → TTS 里填百智云 API Key）')
  const resolvedVoice = String(voice ?? '').trim() || BAIZHI_TTS_DEFAULTS.voice
  const resolvedSpeed = BAIZHI_SPEED_PRESETS[speed] ? BAIZHI_SPEED_PRESETS[speed] : ''
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('baizhi tts: 当前运行环境没有 fetch')

  return {
    name: 'baizhi',
    async *synthesize(text, { signal, sampleRate: requestedRate } = {}) {
      const sentence = String(text ?? '').trim()
      if (!sentence) return
      if (Array.from(sentence).length > BAIZHI_TTS_DEFAULTS.maxChars) {
        throw new Error(`baizhi tts: 单次合成超过 ${BAIZHI_TTS_DEFAULTS.maxChars} 字符上限`)
      }
      const rate = Number(requestedRate) > 0 ? Number(requestedRate) : sampleRate
      const body = JSON.stringify(buildTtsRequest({ text: sentence, voice: resolvedVoice, speed: resolvedSpeed }))
      const startedAt = Date.now()
      const response = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        trace('baizhi.tts.error', { status: response.status, detail: String(detail).slice(0, 300) })
        throw new Error(`baizhi tts http ${response.status}: ${String(detail).slice(0, 200)}`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      const wav = parseWav(bytes)
      const pcm = wav.sampleRate === rate ? wav.pcm : resamplePcm16(wav.pcm, wav.sampleRate, rate)
      trace('baizhi.tts.done', {
        voice: resolvedVoice,
        speed: resolvedSpeed,
        chars: Array.from(sentence).length,
        wavSampleRate: wav.sampleRate,
        outSampleRate: rate,
        bytes: pcm.length,
        ms: Date.now() - startedAt,
      })
      // 按 100ms 一块吐出，和火山/Edge 适配器的下游节奏一致（播放器按块入队）。
      const chunkBytes = Math.max(2, Math.round((rate * 100) / 1000) * 2)
      for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
        if (signal?.aborted) return
        yield pcm.subarray(offset, offset + chunkBytes)
      }
    },
  }
}
