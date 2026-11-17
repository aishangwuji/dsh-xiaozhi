/**
 * DeepSeek 语音（ASR + TTS，2026-11-14）：描述符 / 适配器协议 / WAV 与上限的回归。
 *
 * 覆盖在别处验证不到的四件事：
 *  1. 描述符进了 ASR、TTS 两段，字段都能被 settings 白名单存下（否则控制台能选、保存被拒）；
 *  2. ASR 是**整段批处理**：缓存 PCM → WAV → multipart `file` 字段上传 → 取 `text`，
 *     并且采样率归一、120s/8MiB 截断、错误码映射都按官方约束；
 *  3. TTS 的请求体（voice_id/format/filter_markdown）、WAV 解析、24k→其它采样率的重采样；
 *  4. 计费字符上限（汉字算 2）在发请求前就拦住，不把 400 留给服务端。
 *
 * 两个适配器都只注入 fetch，不碰真实外网。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { providersForStage, stageDescriptor } from '../src/providers.js'
import { BACKUP_SPEC } from '../src/settings.js'
import { AdapterConfigError, buildAsrAdapter, buildTtsAdapter } from '../src/voice/adapters/index.js'
import {
  buildUploadBody,
  createDeepseekAsr,
  DEEPSEEK_ASR_DEFAULTS,
  describeAsrStatus,
} from '../src/voice/adapters/deepseek-asr.js'
import {
  billedChars,
  buildTtsRequest,
  createDeepseekTts,
  describeTtsStatus,
  DEEPSEEK_TTS_DEFAULTS,
} from '../src/voice/adapters/deepseek-tts.js'
import { DEFAULT_TTS_VOICES, resolveTtsVoice, voiceSupportsSpeed, VOICE_OPTIONS } from '../src/voice/voices.js'
import { encodeWav16, parseWav16, resamplePcm16 } from '../src/voice/wav.js'

/** 造一段 16-bit PCM（正弦，方便断言重采样后仍有信号）。 */
function pcmSine({ sampleRate = 16_000, seconds = 0.2, hz = 440 } = {}) {
  const samples = Math.round(sampleRate * seconds)
  const pcm = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(Math.round(Math.sin((index / sampleRate) * hz * 2 * Math.PI) * 8_000), index * 2)
  }
  return pcm
}

/** 记录调用的 fetch 替身。 */
function recordingFetch(respond) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  }
  return { fetchImpl, calls }
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const textResponse = (text, status) => new Response(text, { status })

test('descriptor: DeepSeek covers ASR and TTS with one API Key and no language field', () => {
  for (const stage of ['tts', 'asr']) {
    assert.ok(providersForStage(stage).includes('deepseek'), `deepseek 出现在 ${stage} 下拉里`)
    assert.ok(BACKUP_SPEC[stage].providers.includes('deepseek'), `deepseek 在 ${stage} 存储白名单里`)
    const desc = stageDescriptor('deepseek', stage)
    assert.deepEqual(desc.fields.map((field) => field.key), ['apiKey'], `${stage} 只要求 API Key`)
    assert.deepEqual(desc.secretFields, ['apiKey'])
    // 官方没有语种参数：任何 stage 都不许出现 language 字段（否则控制台会让人误以为能配）。
    assert.ok(!desc.fields.some((field) => field.key === 'language'), `${stage} 不应暴露语种字段`)
    assert.equal(desc.probe.kind, stage === 'tts' ? 'tts' : 'asr')
  }
  assert.equal(stageDescriptor('deepseek', 'tts').name, 'DeepSeek 语音合成')
  assert.equal(stageDescriptor('deepseek', 'asr').name, 'DeepSeek 语音识别')
})

test('voices: stella is the default, tide is selectable, and no speed control', () => {
  assert.equal(DEFAULT_TTS_VOICES.deepseek, 'stella')
  assert.deepEqual(VOICE_OPTIONS.deepseek.map((voice) => voice.value), ['stella', 'tide'])
  assert.equal(resolveTtsVoice('deepseek', ''), 'stella')
  // 从别的厂商残留过来的音色必须回落本厂商默认，否则会被服务端 400（整句没声）。
  assert.equal(resolveTtsVoice('deepseek', 'vivi'), 'stella')
  assert.equal(resolveTtsVoice('deepseek', 'tide'), 'tide')
  assert.equal(voiceSupportsSpeed('deepseek', 'stella'), false)
})

test('wav: encode/parse round-trip, stereo downmix, and a data chunk with a bogus size', () => {
  const pcm = pcmSine({ sampleRate: 16_000, seconds: 0.1 })
  const wav = encodeWav16(pcm, 16_000)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt16LE(20), 1, 'PCM')
  assert.equal(wav.readUInt16LE(22), 1, 'mono')
  assert.equal(wav.readUInt32LE(24), 16_000, 'sample rate')
  assert.equal(wav.readUInt16LE(34), 16, 'bits per sample')
  assert.equal(wav.readUInt32LE(40), pcm.length, 'data size')
  const parsed = parseWav16(wav)
  assert.equal(parsed.sampleRate, 16_000)
  assert.equal(parsed.channels, 1)
  assert.deepEqual(parsed.pcm, pcm)

  // 立体声：L=1000, R=3000 → 平均 2000。
  const stereoPcm = Buffer.alloc(8)
  stereoPcm.writeInt16LE(1_000, 0)
  stereoPcm.writeInt16LE(3_000, 2)
  stereoPcm.writeInt16LE(2_000, 4)
  stereoPcm.writeInt16LE(0, 6)
  const stereo = encodeWav16(stereoPcm, 16_000)
  stereo.writeUInt16LE(2, 22)
  stereo.writeUInt32LE(16_000 * 4, 28)
  stereo.writeUInt16LE(4, 32)
  const downmixed = parseWav16(stereo)
  assert.equal(downmixed.channels, 2)
  assert.equal(downmixed.pcm.readInt16LE(0), 2_000)
  assert.equal(downmixed.pcm.readInt16LE(2), 1_000)

  // 流式封装常见的 data size = 0xFFFFFFFF：按「到文件尾」处理，而不是判坏包。
  const bogus = Buffer.from(encodeWav16(pcm, 16_000))
  bogus.writeUInt32LE(0xffffffff, 40)
  assert.deepEqual(parseWav16(bogus).pcm, pcm)

  // 重采样后半长/双长。
  assert.equal(resamplePcm16(pcm, 24_000, 16_000).length, Math.round((pcm.length / 2) * (16_000 / 24_000)) * 2)
  assert.equal(resamplePcm16(pcm, 16_000, 16_000), pcm)
})

test('asr: buffers PCM, uploads one multipart WAV, and returns the transcript', async () => {
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse({ request_id: 'req-1', text: '上海今天天气怎么样？', duration_ms: 3_200 }),
  )
  const asr = createDeepseekAsr({ apiKey: 'sk-test', fetchImpl })
  const stream = asr.createStream({})
  await stream.write(pcmSine({ seconds: 0.1 }))
  await stream.write(pcmSine({ seconds: 0.1 }))
  const result = await stream.finish()

  assert.equal(result.text, '上海今天天气怎么样？')
  assert.equal(result.requestId, 'req-1')
  assert.equal(result.durationMs, 3_200)
  assert.equal(calls.length, 1)
  const [{ url, init }] = calls
  assert.equal(url, DEEPSEEK_ASR_DEFAULTS.url)
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.Authorization, 'Bearer sk-test')
  assert.match(init.headers['Content-Type'], /^multipart\/form-data; boundary=----dshxiaozhi[0-9a-f]{32}$/)
  // 请求体里必须有 file 字段的 WAV，且是 16kHz 单声道。
  const body = init.body
  assert.equal(body.toString('ascii', 0, 2), '--')
  assert.ok(body.includes('Content-Disposition: form-data; name="file"; filename="speech.wav"'))
  assert.ok(body.includes('Content-Type: audio/wav'))
  const riffAt = body.indexOf('RIFF')
  const wav = body.subarray(riffAt, body.indexOf('\r\n--', riffAt))
  const parsed = parseWav16(wav)
  assert.equal(parsed.sampleRate, 16_000)
  assert.equal(parsed.channels, 1)
  // 两段 0.2s 的 PCM 应该原样拼进 WAV。
  assert.equal(parsed.pcm.length, pcmSine({ seconds: 0.2 }).length)
})

test('asr: an unsupported uplink rate is normalised to 16k before upload', async () => {
  let captured = null
  const { fetchImpl } = recordingFetch((url, init) => {
    captured = init.body
    return jsonResponse({ text: '你好' })
  })
  const asr = createDeepseekAsr({ apiKey: 'sk-test', sampleRate: 12_000, fetchImpl })
  const stream = asr.createStream({})
  await stream.write(pcmSine({ sampleRate: 12_000, seconds: 0.2 }))
  const result = await stream.finish()
  assert.equal(result.text, '你好')
  const riffAt = captured.indexOf('RIFF')
  const parsed = parseWav16(captured.subarray(riffAt, captured.indexOf('\r\n--', riffAt)))
  assert.equal(parsed.sampleRate, 16_000)
  assert.equal(parsed.pcm.length, Math.round((12_000 * 0.2) * (16_000 / 12_000)) * 2)
})

test('asr: audio longer than 120s is truncated instead of rejected', async () => {
  let captured = null
  const { fetchImpl } = recordingFetch((url, init) => {
    captured = init.body
    return jsonResponse({ text: '前半段' })
  })
  const asr = createDeepseekAsr({ apiKey: 'sk-test', fetchImpl })
  const stream = asr.createStream({})
  // 121s：超过官方 120s 上限 1 秒。
  await stream.write(Buffer.alloc(121 * 16_000 * 2))
  const result = await stream.finish()
  assert.equal(result.text, '前半段')
  const riffAt = captured.indexOf('RIFF')
  const parsed = parseWav16(captured.subarray(riffAt, captured.indexOf('\r\n--', riffAt)))
  assert.equal(parsed.pcm.length, 120 * 16_000 * 2, '按 120s 截断后上传')
  // 也要落在 8 MiB 以内（WAV 头 44 字节）。
  assert.ok(parsed.pcm.length + 44 <= DEEPSEEK_ASR_DEFAULTS.maxBytes)
})

test('asr: the in-memory buffer is capped so a stuck capture cannot exhaust memory', async () => {
  let captured = null
  const { fetchImpl } = recordingFetch((url, init) => {
    captured = init.body
    return jsonResponse({ text: 'ok' })
  })
  // 48k 是官方允许的采样率，但 8 MiB 只够 ~87.4s：按字节截断必须比 120s 先生效。
  const asr = createDeepseekAsr({ apiKey: 'sk-test', sampleRate: 48_000, fetchImpl })
  const stream = asr.createStream({})
  // 121s @48k ≈ 11.6 MB，超过 8 MiB；写入阶段就该被截住（不是等 finish 才裁）。
  for (let index = 0; index < 121; index += 1) await stream.write(Buffer.alloc(48_000 * 2))
  const result = await stream.finish()
  assert.equal(result.text, 'ok')
  const riffAt = captured.indexOf('RIFF')
  const parsed = parseWav16(captured.subarray(riffAt, captured.indexOf('\r\n--', riffAt)))
  assert.equal(parsed.sampleRate, 48_000)
  assert.equal(parsed.pcm.length, Math.floor((DEEPSEEK_ASR_DEFAULTS.maxBytes - 44) / 2) * 2)
  assert.ok(parsed.pcm.length + 44 <= DEEPSEEK_ASR_DEFAULTS.maxBytes)
})

test('asr: a 200 response without a usable text field is a failure, not an empty success', async () => {
  // 200 + 形状不对（缺字段 / 类型错 / 服务端错误）必须带 error，否则会话只记 asr.empty、
  // 既不报 asr_failed 也不切备用，表现为「一直聆听中」。
  for (const payload of [{}, { request_id: 'r1' }, { text: 123 }, { error: { message: 'boom' } }, null]) {
    const { fetchImpl } = recordingFetch(() => jsonResponse(payload))
    const asr = createDeepseekAsr({ apiKey: 'sk-test', fetchImpl })
    const stream = asr.createStream({})
    await stream.write(pcmSine({ seconds: 0.1 }))
    const result = await stream.finish()
    assert.equal(result.text, '', `${JSON.stringify(payload)} 不该产出文本`)
    assert.ok(result.error, `${JSON.stringify(payload)} 必须带 error`)
    assert.match(result.error, /text|JSON|对象/)
  }
})

test('asr: abort() cancels the in-flight upload instead of letting it finish', async () => {
  let seenSignal = null
  const { fetchImpl } = recordingFetch((url, init) => {
    seenSignal = init.signal
    // 慢请求：只有被 abort 才结束（模拟“打断后请求还在传”的场景）。
    return new Promise((resolve) => {
      init.signal.addEventListener('abort', () => resolve(jsonResponse({ text: '迟到的识别结果' })))
    })
  })
  const asr = createDeepseekAsr({ apiKey: 'sk-test', fetchImpl })
  const stream = asr.createStream({})
  await stream.write(pcmSine({ seconds: 0.1 }))
  const pending = stream.finish()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(seenSignal.aborted, false, '还没打断时请求应在途')
  stream.abort()
  assert.equal(seenSignal.aborted, true, 'abort() 必须掐断在途请求')
  assert.deepEqual(await pending, { text: '' }, '被打断的一轮不返回迟到的文本')
})

test('asr: empty audio never hits the network; HTTP errors become {text:"", error}', async () => {
  const { fetchImpl, calls } = recordingFetch((url, init) => {
    void url
    void init
    return textResponse('{"error":{"message":"too large"}}', 413)
  })
  const asr = createDeepseekAsr({ apiKey: 'sk-test', fetchImpl })
  const empty = asr.createStream({})
  assert.deepEqual(await empty.finish(), { text: '' })
  assert.equal(calls.length, 0)

  const stream = asr.createStream({})
  await stream.write(pcmSine({ seconds: 0.1 }))
  const result = await stream.finish()
  assert.equal(result.text, '')
  assert.match(result.error, /413/)
  assert.match(result.error, /8 MiB/)
  assert.equal(describeAsrStatus(429), '账号同时进行的识别请求数超过上限')
  assert.equal(describeAsrStatus(504), '识别超时')
})

test('asr: abort() drops the buffer so a cancelled turn never uploads', async () => {
  const { fetchImpl, calls } = recordingFetch(() => jsonResponse({ text: '不该出现' }))
  const asr = createDeepseekAsr({ apiKey: 'sk-test', fetchImpl })
  const stream = asr.createStream({})
  await stream.write(pcmSine({ seconds: 0.1 }))
  stream.abort()
  assert.deepEqual(await stream.finish(), { text: '' })
  assert.equal(calls.length, 0)
})

test('tts: request shape, WAV decode, and the default voice', async () => {
  const source = pcmSine({ sampleRate: 24_000, seconds: 0.2 })
  const { fetchImpl, calls } = recordingFetch(() => new Response(encodeWav16(source, 24_000), { status: 200 }))
  const tts = createDeepseekTts({ apiKey: 'sk-test', fetchImpl })
  const chunks = []
  for await (const chunk of tts.synthesize('你好，我是 DeepSeek。', { sampleRate: 24_000 })) chunks.push(chunk)
  assert.deepEqual(Buffer.concat(chunks), source)

  const [{ url, init }] = calls
  assert.equal(url, DEEPSEEK_TTS_DEFAULTS.url)
  assert.equal(init.headers.Authorization, 'Bearer sk-test')
  assert.equal(init.headers['Content-Type'], 'application/json')
  const body = JSON.parse(init.body)
  assert.deepEqual(body, { text: '你好，我是 DeepSeek。', voice_id: 'stella', format: 'wav', filter_markdown: true })
  // 导出给单测的构造器与运行时用的是同一份形状。
  assert.deepEqual(buildTtsRequest({ text: 'x', voice: 'tide' }), {
    text: 'x',
    voice_id: 'tide',
    format: 'wav',
    filter_markdown: true,
  })
})

test('tts: resamples to the downlink rate and honours an explicit voice', async () => {
  const source = pcmSine({ sampleRate: 24_000, seconds: 0.2 })
  const { fetchImpl, calls } = recordingFetch(() => new Response(encodeWav16(source, 24_000), { status: 200 }))
  const tts = createDeepseekTts({ apiKey: 'sk-test', voice: 'tide', sampleRate: 16_000, fetchImpl })
  assert.equal(tts.name, 'deepseek')
  const chunks = []
  for await (const chunk of tts.synthesize('hello', {})) chunks.push(chunk)
  const pcm = Buffer.concat(chunks)
  assert.equal(pcm.length, Math.round((source.length / 2) * (16_000 / 24_000)) * 2)
  assert.equal(JSON.parse(calls[0].init.body).voice_id, 'tide')
  // 装配层把「智能体音色」传进适配器（空值已在本厂商目录里回落默认）。
  assert.equal(buildTtsAdapter({ provider: 'deepseek', apiKey: 'k' }).name, 'deepseek')
})

test('tts: a truncated WAV is a failure rather than half a sentence', async () => {
  const source = pcmSine({ sampleRate: 24_000, seconds: 0.2 })
  const wav = Buffer.from(encodeWav16(source, 24_000))
  // 官方明确「音频已开始返回后失败会中途断开」：把 data 块声明长度改大，
  // 模拟“传输层以干净 EOF 结束、但音频只收了一半”。
  wav.writeUInt32LE(source.length + 1_600, 40)
  const { fetchImpl } = recordingFetch(() => new Response(wav, { status: 200 }))
  const tts = createDeepseekTts({ apiKey: 'sk-test', fetchImpl })
  await assert.rejects(
    async () => {
      for await (const chunk of tts.synthesize('你好', {})) void chunk
    },
    /截断/,
  )
})

test('billedChars counts Han as 2 and kana/latin as 1', () => {
  assert.equal(billedChars(''), 0)
  assert.equal(billedChars('汉字'), 4)
  // 官方只对汉字算 2：日文假名/英文/emoji 都算 1（旧实现把假名算成 2，会误拦长日文）。
  assert.equal(billedChars('あ'.repeat(5_001)), 5_001)
  assert.equal(billedChars('漢'.repeat(5_001)), 10_002)
  assert.equal(billedChars('😀'), 1)
})

test('tts: errors are explicit and the billed-char cap is enforced before the request', async () => {
  const { fetchImpl, calls } = recordingFetch(() => textResponse('{"error":{"message":"Content Exists Risk"}}', 400))
  const tts = createDeepseekTts({ apiKey: 'sk-test', fetchImpl })
  await assert.rejects(
    async () => {
      for await (const chunk of tts.synthesize('正常的一句话', {})) void chunk
    },
    (error) => {
      assert.match(error.message, /400/)
      assert.match(error.message, /内容审核/)
      return true
    },
  )
  assert.equal(describeTtsStatus(429), '账号同时进行的合成请求数超过上限')
  assert.equal(describeTtsStatus(504), '合成超时')

  calls.length = 0
  const long = '字'.repeat(5_001) // 汉字算 2 → 10,002 个计费字符
  await assert.rejects(
    async () => {
      for await (const chunk of tts.synthesize(long, {})) void chunk
    },
    /计费字符上限/,
  )
  assert.equal(calls.length, 0, '上限在发请求前拦住')
  assert.equal(billedChars('你好'), 4)
  assert.equal(billedChars('abc'), 3)
})

test('tts/asr adapters reject a missing key at build time', () => {
  // 与百智云同样的口径：缺 Key 在**构建期**就抛（adapter 自己抛普通 Error，buildStage
  // 会 warn 后跳过这条候选），而不是等设备说完第一句话才失败。
  assert.throws(() => buildTtsAdapter({ provider: 'deepseek' }), /apiKey/)
  assert.throws(() => buildAsrAdapter({ provider: 'deepseek' }), /apiKey/)
  // 未知 provider 仍然要明确报错（不静默换厂商）。
  assert.throws(
    () => buildTtsAdapter({ provider: 'not-a-provider', apiKey: 'k' }),
    (error) => error instanceof AdapterConfigError && /unknown TTS provider/.test(error.message),
  )
  // 造出来的适配器名字必须是 provider id（failover 日志/标签靠它）。
  assert.equal(buildAsrAdapter({ provider: 'deepseek', apiKey: 'k' }).name, 'deepseek')
  assert.equal(buildTtsAdapter({ provider: 'deepseek', apiKey: 'k' }).name, 'deepseek')
})

test('buildUploadBody escapes the file field as a single multipart part', () => {
  const { body, contentType } = buildUploadBody({ data: Buffer.from([1, 2, 3, 4]) })
  assert.match(contentType, /^multipart\/form-data; boundary=/)
  const boundary = contentType.slice('multipart/form-data; boundary='.length)
  const head =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="speech.wav"\r\n' +
    'Content-Type: audio/wav\r\n\r\n'
  const tail = `\r\n--${boundary}--\r\n`
  const text = body.toString('latin1')
  assert.ok(text.startsWith(head), 'multipart 头必须只声明一个 file 字段')
  assert.ok(text.endsWith(tail), 'multipart 必须以结束边界收尾')
  const data = body.subarray(Buffer.byteLength(head), body.length - Buffer.byteLength(tail))
  assert.deepEqual([...data], [1, 2, 3, 4], '文件字节原样放在头与尾之间')
})
