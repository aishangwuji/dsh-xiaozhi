/**
 * 百智云语音服务商（2026-11-09）：描述符 / 适配器协议 / WAV 解析 / 重采样的回归。
 *
 * 覆盖四件在别处验证不到的事：
 *  1. 描述符进了 ASR、TTS 两段，字段都能被 settings 白名单存下（否则控制台能选、保存被拒）；
 *  2. ASR 真的「按真实节奏」发 PCM、结束时发 input.commit、把 delta+final 拼成整句；
 *  3. TTS 的 WAV 剥离（24k 透传 / 16k 重采样）与请求体（task/voice/speed）；
 *  4. 语速只在音色声明支持时才下发——不支持时发 speed 会让整句合成失败。
 *
 * ASR 用本地 WS 服务（`src/ws.js` 的 acceptUpgrade）跑真实握手与帧收发，不 mock 协议；
 * TTS 只注入 fetch，避免真实外网调用。
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { providersForStage, stageDescriptor, stageProviderLabel, allProvidersForStage } from '../src/providers.js'
import { BACKUP_SPEC } from '../src/settings.js'
import { buildAsrAdapter, buildTtsAdapter } from '../src/voice/adapters/index.js'
import { AudioPacer, buildSessionStart, baizhiLanguageCode, createBaizhiAsr } from '../src/voice/adapters/baizhi-asr.js'
import {
  baizhiSpeedPreset,
  buildTtsRequest,
  createBaizhiTts,
  parseWav,
  resamplePcm16,
} from '../src/voice/adapters/baizhi-tts.js'
import { DEFAULT_TTS_VOICES, defaultTtsVoice, resolveTtsVoice, voiceSupportsSpeed } from '../src/voice/voices.js'
import { acceptUpgrade } from '../src/ws.js'

/** 造一段合法 WAV（默认 24k / 单声道 / 16-bit PCM）。 */
function makeWav({ sampleRate = 24_000, channels = 1, bitsPerSample = 16, format = 1, samples = 2_400 } = {}) {
  const pcm = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    // 一个可辨认的正弦，方便断言重采样后仍有信号。
    pcm.writeInt16LE(Math.round(Math.sin((index / 24) * 2 * Math.PI) * 8_000), index * 2)
  }
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(format, 0)
  fmt.writeUInt16LE(channels, 2)
  fmt.writeUInt32LE(sampleRate, 4)
  fmt.writeUInt32LE(byteRate, 8)
  fmt.writeUInt16LE(blockAlign, 12)
  fmt.writeUInt16LE(bitsPerSample, 14)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  const fmtChunk = Buffer.alloc(8)
  fmtChunk.write('fmt ', 0, 'ascii')
  fmtChunk.writeUInt32LE(fmt.length, 4)
  const dataChunk = Buffer.alloc(8)
  dataChunk.write('data', 0, 'ascii')
  dataChunk.writeUInt32LE(pcm.length, 4)
  return Buffer.concat([header, fmtChunk, fmt, dataChunk, pcm])
}

/** 本地 WS 服务：模拟百智云 /realtime 的事件时序，并记录收到的帧。 */
async function startFakeRealtime({ onCommit } = {}) {
  const frames = []
  const starts = []
  const connections = []
  const server = createServer()
  server.on('upgrade', (req, socket, head) => {
    const connection = acceptUpgrade(req, socket, head)
    connections.push(connection)
    connection.on('message', (data, isBinary) => {
      if (isBinary) {
        frames.push({ bytes: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data), at: Date.now() })
        return
      }
      const event = JSON.parse(String(data))
      if (event.type === 'session.start') {
        starts.push(event)
        connection.sendJson({ type: 'session.created', session_id: 'sess-1', task: 'speech-to-text' })
        return
      }
      if (event.type === 'input.commit') {
        const reply = onCommit ? onCommit(connection) : null
        // 官方顺序：delta 增量 → final 整句 → completed。
        connection.sendJson({
          type: 'transcript.delta',
          session_id: 'sess-1',
          segment_id: 'segment-1',
          segment_index: 1,
          text: '实时',
        })
        connection.sendJson({
          type: 'transcript.delta',
          session_id: 'sess-1',
          segment_id: 'segment-1',
          segment_index: 1,
          text: '转写',
        })
        connection.sendJson({
          type: 'transcript.final',
          session_id: 'sess-1',
          segment_id: 'segment-1',
          segment_index: 1,
          text: reply?.text ?? '实时转写结果',
          final: true,
        })
        connection.sendJson({ type: 'session.completed', session_id: 'sess-1', task: 'speech-to-text' })
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    frames,
    starts,
    close: () =>
      new Promise((resolve) => {
        for (const connection of connections) connection.destroy(1001, 'test done')
        server.close(resolve)
      }),
  }
}

test('baizhi is offered for both ASR and TTS and its fields are storable', () => {
  assert.ok(providersForStage('asr').includes('baizhi'))
  assert.ok(providersForStage('tts').includes('baizhi'))
  assert.ok(!providersForStage('llm').includes('baizhi'), '百智云没有 LLM 能力')
  assert.equal(stageProviderLabel('tts', 'baizhi'), '百智云语音合成')
  assert.equal(stageProviderLabel('asr', 'baizhi'), '百智云语音识别')

  for (const stage of ['asr', 'tts']) {
    assert.ok(allProvidersForStage(stage).includes('baizhi'), `${stage} 存储白名单要含 baizhi`)
    const desc = stageDescriptor('baizhi', stage)
    assert.ok(desc, `${stage} 有描述符`)
    const allowed = new Set([...BACKUP_SPEC[stage].fields.map(([key]) => key), ...BACKUP_SPEC[stage].secrets])
    for (const field of desc.fields) assert.ok(allowed.has(field.key), `${stage} 字段 ${field.key} 必须可存储`)
    assert.equal(desc.probe.kind, stage)
  }
  // 识别语种可覆盖；合成只需要一把 Key。**端点内置，不暴露地址框**（2026-11-09）。
  assert.deepEqual(
    stageDescriptor('baizhi', 'asr').fields.map((field) => field.key),
    ['apiKey', 'language'],
  )
  assert.deepEqual(
    stageDescriptor('baizhi', 'tts').fields.map((field) => field.key),
    ['apiKey'],
  )
})

test('baizhi voice catalog: a default voice, and speed only where the vendor supports it', () => {
  assert.equal(DEFAULT_TTS_VOICES.baizhi, 'vivi')
  assert.equal(defaultTtsVoice('baizhi'), 'vivi')
  assert.equal(resolveTtsVoice('baizhi', ''), 'vivi')
  // 从别家换过来残留的音色要回落，否则合成会 voice_not_found（有字没声）。
  assert.equal(resolveTtsVoice('baizhi', DEFAULT_TTS_VOICES.volc), 'vivi')
  assert.equal(voiceSupportsSpeed('baizhi', 'vivi'), true)
  assert.equal(voiceSupportsSpeed('baizhi', 'xiaohe'), true)
  assert.equal(voiceSupportsSpeed('baizhi', 'custom-clone-id'), false, '未知音色不带 speed')
  assert.equal(voiceSupportsSpeed('volc', 'zh_female_vv_uranus_bigtts'), false, '其它厂商没有这项能力')
})

test('speed presets map the console multiplier onto the three supported values', () => {
  assert.equal(baizhiSpeedPreset(''), '')
  assert.equal(baizhiSpeedPreset('abc'), '')
  assert.equal(baizhiSpeedPreset('0.5'), 'slow')
  assert.equal(baizhiSpeedPreset(0.8), 'slow')
  assert.equal(baizhiSpeedPreset('1'), 'normal')
  assert.equal(baizhiSpeedPreset('1.2'), 'fast')
  assert.equal(baizhiSpeedPreset('2'), 'fast')
})

test('language codes are normalized; unknown values fall back to auto-detect', () => {
  assert.equal(baizhiLanguageCode(''), '')
  assert.equal(baizhiLanguageCode('zh_cn'), 'zh-CN')
  assert.equal(baizhiLanguageCode('ZH-CN'), 'zh-CN')
  assert.equal(baizhiLanguageCode('en_us'), 'en-US')
  assert.equal(baizhiLanguageCode('ja-JP'), '', '未核验的语种不能原样透传（会 invalid_option）')
  assert.deepEqual(buildSessionStart({ language: 'zh-CN' }), {
    type: 'session.start',
    task: 'speech-to-text',
    parameters: { speaker_diarization: false, language: 'zh-CN' },
  })
  assert.deepEqual(buildSessionStart({}).parameters, { speaker_diarization: false })
})

test('buildAsrAdapter/buildTtsAdapter wire baizhi and reject bad config at build time', () => {
  assert.equal(buildAsrAdapter({ provider: 'baizhi', apiKey: 'k' }).name, 'baizhi')
  assert.equal(buildTtsAdapter({ provider: 'baizhi', apiKey: 'k' }).name, 'baizhi')
  assert.throws(() => buildAsrAdapter({ provider: 'baizhi' }), /missing apiKey/)
  assert.throws(() => buildTtsAdapter({ provider: 'baizhi' }), /missing apiKey/)
  // 协议硬约束：上行必须是 16k。
  assert.throws(() => buildAsrAdapter({ provider: 'baizhi', apiKey: 'k' }, { sampleRate: 8_000 }), /16000/)
})

test('WAV parsing keeps the samples and rejects non-PCM payloads', () => {
  const wav = makeWav({ sampleRate: 24_000, samples: 480 })
  const parsed = parseWav(wav)
  assert.equal(parsed.sampleRate, 24_000)
  assert.equal(parsed.channels, 1)
  assert.equal(parsed.bitsPerSample, 16)
  assert.equal(parsed.pcm.length, 480 * 2)
  assert.equal(parsed.pcm.readInt16LE(0), 0)

  assert.throws(() => parseWav(Buffer.from('not a wav at all')), /RIFF/)
  assert.throws(() => parseWav(makeWav({ format: 3 })), /不是 PCM/)
  assert.throws(() => parseWav(makeWav({ bitsPerSample: 24 })), /位深/)
  assert.throws(() => parseWav(makeWav({ channels: 2 })), /声道数/)
})

test('resampling 24k → 16k keeps the duration and the signal', () => {
  const wav = makeWav({ sampleRate: 24_000, samples: 2_400 })
  const parsed = parseWav(wav)
  const resampled = resamplePcm16(parsed.pcm, 24_000, 16_000)
  assert.equal(resampled.length, 1_600 * 2)
  assert.ok(resampled.some((byte) => byte !== 0), '重采样后不能是一条静音')
  // 同采样率必须原样返回（会话下行 24k 走这条路，不额外拷贝）。
  assert.equal(resamplePcm16(parsed.pcm, 24_000, 24_000), parsed.pcm)
})

test('TTS request body and WAV passthrough (24k) without ffmpeg', async () => {
  const requests = []
  const wav = makeWav({ sampleRate: 24_000, samples: 2_400 })
  const tts = createBaizhiTts({
    apiKey: 'test-key',
    voice: 'vivi',
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return { ok: true, status: 200, arrayBuffer: async () => wav }
    },
  })
  const chunks = []
  for await (const chunk of tts.synthesize('你好，欢迎使用智能语音服务。', { sampleRate: 24_000 })) chunks.push(chunk)
  const pcm = Buffer.concat(chunks)
  assert.equal(pcm.length, 2_400 * 2)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].init.method, 'POST')
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key')
  const body = JSON.parse(requests[0].init.body)
  assert.deepEqual(body, {
    task: 'text-to-speech',
    input: { text: '你好，欢迎使用智能语音服务。' },
    parameters: { voice: 'vivi' },
  })
  // 显式给了 speed 才出现该字段。
  assert.deepEqual(buildTtsRequest({ text: 'hi', voice: 'vivi', speed: 'fast' }).parameters, {
    voice: 'vivi',
    speed: 'fast',
  })
})

test('TTS resamples when the caller asks for 16k (ASR probe path)', async () => {
  const wav = makeWav({ sampleRate: 24_000, samples: 2_400 })
  const tts = createBaizhiTts({
    apiKey: 'k',
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => wav }),
  })
  const chunks = []
  for await (const chunk of tts.synthesize('测试一句', { sampleRate: 16_000 })) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).length, 1_600 * 2)
})

test('TTS surfaces HTTP failures instead of emitting silence', async () => {
  const tts = createBaizhiTts({
    apiKey: 'k',
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => '{"code":"provider_auth_error"}' }),
  })
  await assert.rejects(async () => {
    for await (const chunk of tts.synthesize('你好', { sampleRate: 24_000 })) void chunk
  }, /401/)
})

test('ASR streams PCM at a real-time cadence, commits, and joins delta+final', async () => {
  const server = await startFakeRealtime()
  try {
    const adapter = createBaizhiAsr({
      apiKey: 'test-key',
      url: `ws://127.0.0.1:${server.port}/openapi/v1/realtime`,
      language: 'zh_cn',
    })
    const partials = []
    const stream = adapter.createStream({ onPartial: (text) => partials.push(text) })
    try {
      // 0.5s 的 16k PCM，分 5 次喂（模拟上行 100ms 帧）。
      const pcm = Buffer.alloc(16_000 * 2 * 0.5, 0x11)
      for (let offset = 0; offset < pcm.length; offset += 3_200) await stream.write(pcm.subarray(offset, offset + 3_200))
      const startedAt = Date.now()
      const result = await stream.finish()
      const elapsed = Date.now() - startedAt

      assert.equal(result.error, undefined)
      assert.equal(result.text, '实时转写结果', 'final 覆盖 delta，按 segment_index 拼接')
      assert.ok(partials.length >= 1, '识别过程中应推送 partial（会话默认关闭，但适配器要支持）')
      assert.equal(stream.failed, false)
      // 5 帧 × 100ms 节拍：首帧立即，总耗时约 400ms。给足容差，避免慢机器误报。
      assert.equal(server.frames.length, 5, `应按 100ms 一帧发出 5 帧，实际 ${server.frames.length}`)
      assert.ok(
        server.frames.every((frame) => frame.bytes === 3_200),
        '帧大小必须是 100ms 的 16k PCM（3200 字节）',
      )
      assert.ok(elapsed >= 250, `必须按真实节奏发送（不能突发），实际 ${elapsed}ms`)
      assert.deepEqual(server.starts[0].parameters, { speaker_diarization: false, language: 'zh-CN' })
    } finally {
      stream.abort()
    }
  } finally {
    await server.close()
  }
})

test('ASR reports a server error frame instead of hanging', async () => {
  const server = await startFakeRealtime({
    onCommit: (connection) => {
      connection.sendJson({ type: 'error', code: 'insufficient_balance', message: '余额不足' })
      return {}
    },
  })
  try {
    const adapter = createBaizhiAsr({ apiKey: 'k', url: `ws://127.0.0.1:${server.port}/openapi/v1/realtime` })
    const stream = adapter.createStream({})
    await stream.write(Buffer.alloc(3_200, 0))
    const result = await stream.finish()
    assert.match(result.error ?? '', /insufficient_balance/)
    assert.equal(stream.failed, true)
  } finally {
    await server.close()
  }
})

test('AudioPacer never sends more than one frame per interval', async () => {
  const sent = []
  const pacer = new AudioPacer({
    bytesPerChunk: 4,
    intervalMs: 20,
    send: (chunk) => sent.push({ chunk, at: Date.now() }),
  })
  try {
    // 未 enable 前只排队，不发。
    pacer.push(Buffer.alloc(12, 1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(sent.length, 0)
    pacer.enable()
    pacer.flushPartial()
    const drained = await pacer.drain(2_000)
    assert.equal(drained, true)
    assert.equal(sent.length, 3)
    assert.ok(sent[1].at - sent[0].at >= 15, '第二帧要等一个节拍')
    assert.ok(sent[2].at - sent[1].at >= 15, '第三帧要等一个节拍')
  } finally {
    pacer.stop()
  }
})
