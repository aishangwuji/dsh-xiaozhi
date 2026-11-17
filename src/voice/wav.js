/**
 * WAV（16-bit PCM）小工具：编码、解析、线性重采样。
 *
 * 为什么单独一个文件：DeepSeek 语音的 ASR 要「整段 16-bit PCM WAV」，TTS 回的是 WAV，
 * 两头都要编/解，且都不该依赖 ffmpeg（与百智云 TTS 同样的选择：WAV 头在 JS 里剥掉就是 PCM）。
 *
 * 百智云适配器（`adapters/baizhi-tts.js`）保留自己那份 `parseWav`：它的错误文案是厂商级的，
 * 且已被 `test/baizhi.test.mjs` 钉住。新代码统一走这里，不要再去复制第三份。
 */

/** DeepSeek ASR 明确接受的采样率（WAV 头里写别的会被 400 拒掉）。 */
export const WAV_SAMPLE_RATES = [8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000]

/**
 * 把 16-bit 单声道 PCM 包成 WAV（44 字节头）。
 *
 * 长度写真实值（不是 0xFFFFFFFF）：这个字节流是**上传**给别人的文件，不是流式封装，
 * 头部与实际长度不一致只会让对端认为文件被截断。
 */
export function encodeWav16(pcm, sampleRate) {
  const audio = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm ?? [])
  const rate = Math.max(1, Math.round(Number(sampleRate) || 0))
  // 奇数长度（半个采样）会让对端按 16-bit 对齐读时越界，尾部丢掉半个采样。
  const data = audio.subarray(0, audio.length - (audio.length % 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * 解析 WAV，返回**16-bit PCM**（单声道，双声道做 L/R 平均下混）。
 *
 * 容错点同百智云那份：`data` 块声明的长度写成 `0xFFFFFFFF` 或大于实际可读长度时按
 * 「到文件尾」处理——流式/边写边读的封装很常见，直接报错会把整段音频判成坏包。
 */
export function parseWav16(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  if (data.length < 12 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('wav: 响应不是 WAV（缺少 RIFF/WAVE 头）')
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
    // 声明长度不可信：超过可读长度就截到文件尾。
    const size = Math.min(declared, available)
    if (id === 'fmt ') {
      if (size < 16) throw new Error('wav: fmt 块不完整')
      format = data.readUInt16LE(payloadStart)
      channels = data.readUInt16LE(payloadStart + 2)
      sampleRate = data.readUInt32LE(payloadStart + 4)
      bitsPerSample = data.readUInt16LE(payloadStart + 14)
    } else if (id === 'data') {
      dataOffset = payloadStart
      // 声明的长度比实际可读字节多 = 文件被截断（TTS 边合成边返回时中途断开）。
      // `0` / `0xFFFFFFFF` 是「长度未知」的流式写法，按到文件尾处理，不能判成截断。
      if (declared !== 0 && declared !== 0xffffffff && declared > available) {
        throw new Error(`wav: data 块被截断（声明 ${declared} 字节，实际 ${available}）`)
      }
      dataSize = size
      break
    }
    // 块长度按偶数字节对齐（RIFF 规定），否则下一个块头会错位。
    offset = payloadStart + size + (size % 2)
  }
  if (dataOffset < 0) throw new Error('wav: 没有 data 块')
  if (format !== 1) throw new Error(`wav: 编码 ${format} 不是 PCM（只支持 16-bit PCM）`)
  if (bitsPerSample !== 16) throw new Error(`wav: 位深 ${bitsPerSample}（只支持 16-bit）`)
  if (channels !== 1 && channels !== 2) throw new Error(`wav: 声道数 ${channels}（只支持 1 或 2）`)
  if (!sampleRate) throw new Error('wav: 缺少采样率')
  // 只保留完整的采样帧；双声道按帧对齐。
  const frameBytes = channels * 2
  const usable = dataSize - (dataSize % frameBytes)
  const body = data.subarray(dataOffset, dataOffset + usable)
  let pcm = body
  if (channels === 2) {
    const frames = usable / 4
    const mono = Buffer.alloc(frames * 2)
    for (let index = 0; index < frames; index += 1) {
      const left = body.readInt16LE(index * 4)
      const right = body.readInt16LE(index * 4 + 2)
      // 取平均而不是只留左声道：TTS 若回立体声，丢右声道会明显变小/丢内容。
      mono.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round((left + right) / 2))), index * 2)
    }
    pcm = mono
  }
  return { format, channels, sampleRate, bitsPerSample, pcm }
}

/**
 * 16-bit PCM 线性插值重采样。
 *
 * 只服务两个很窄的场景：ASR 上行采样率不是 DeepSeek 认可的那 7 个值时归一到 16k；
 * TTS 回的采样率与下行配置不一致时改成下行值。不追求高保真，追求「不引入 ffmpeg、
 * 结果可单测」。
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
