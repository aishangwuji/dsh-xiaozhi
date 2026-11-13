import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { AdapterConfigError, createVoiceAdapters } from '../src/voice/adapters/index.js'
import { authDate, buildSignedUrl, IFLYTEK_ENDPOINTS } from '../src/voice/adapters/xunfei-auth.js'
import { buildTtsRequest, parseTtsResponse } from '../src/voice/adapters/xunfei-tts.js'
import { parseAsrResponse } from '../src/voice/adapters/xunfei-asr.js'

test('iflytek signing follows the documented HMAC-SHA256 request-line scheme', () => {
  const date = 'Wed, 05 Nov 2025 07:30:00 GMT'
  const url = buildSignedUrl({
    url: IFLYTEK_ENDPOINTS.tts,
    apiKey: 'key-123',
    apiSecret: 'secret-456',
    date,
  })
  const parsed = new URL(url)
  assert.equal(parsed.host, 'tts-api.xfyun.cn')
  assert.equal(parsed.searchParams.get('date'), date)
  assert.equal(parsed.searchParams.get('host'), 'tts-api.xfyun.cn')

  // Recompute independently: host + date + request line, then base64 wrapper.
  const origin = `host: tts-api.xfyun.cn\ndate: ${date}\nGET /v2/tts HTTP/1.1`
  const signature = createHmac('sha256', 'secret-456').update(origin).digest('base64')
  const expected = Buffer.from(
    `api_key="key-123", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`,
  ).toString('base64')
  assert.equal(parsed.searchParams.get('authorization'), expected)

  // A different secret must not produce the same authorization.
  const other = buildSignedUrl({ url: IFLYTEK_ENDPOINTS.tts, apiKey: 'key-123', apiSecret: 'nope', date })
  assert.notEqual(new URL(other).searchParams.get('authorization'), expected)

  assert.throws(() => buildSignedUrl({ url: IFLYTEK_ENDPOINTS.tts, apiKey: '', apiSecret: 'x' }), /apiKey/)
  assert.equal(authDate(new Date('2025-11-05T07:30:00Z')), date)
})

test('iflytek TTS request carries the whole sentence with status=2', () => {
  const request = buildTtsRequest({
    text: '打开客厅的灯',
    appId: 'app-1',
    voice: 'xiaoyan',
    speed: 50,
    volume: 50,
    pitch: 50,
    sampleRate: 24_000,
  })
  assert.equal(request.common.app_id, 'app-1')
  assert.equal(request.business.aue, 'raw', 'raw PCM avoids an MP3 decode step')
  assert.equal(request.business.auf, 'audio/L16;rate=24000')
  assert.equal(request.business.vcn, 'xiaoyan')
  assert.equal(request.business.tte, 'UTF8')
  assert.equal(request.data.status, 2)
  assert.equal(Buffer.from(request.data.text, 'base64').toString('utf8'), '打开客厅的灯')
})

test('iflytek TTS responses decode base64 audio and flag the last frame', () => {
  const audio = Buffer.from([1, 2, 3, 4])
  const middle = parseTtsResponse(JSON.stringify({ code: 0, data: { status: 1, audio: audio.toString('base64') } }))
  assert.deepEqual(middle.audio, audio)
  assert.equal(middle.done, false)

  const last = parseTtsResponse(JSON.stringify({ code: 0, data: { status: 2 } }))
  assert.equal(last.audio, null)
  assert.equal(last.done, true)

  assert.throws(() => parseTtsResponse(JSON.stringify({ code: 10105, message: 'invalid access', sid: 'x' })), /10105/)
  assert.throws(() => parseTtsResponse('not json'), /not JSON/)
})

test('iflytek ASR accumulates words and reports the final frame', () => {
  const partial = parseAsrResponse(JSON.stringify({
    code: 0,
    data: { status: 1, result: { sn: 1, ls: false, ws: [{ cw: [{ w: '打开' }] }, { cw: [{ w: '客厅' }] }] } },
  }))
  assert.equal(partial.text, '打开客厅')
  assert.equal(partial.final, false)

  const final = parseAsrResponse(JSON.stringify({
    code: 0,
    data: { status: 2, result: { ls: true, ws: [{ cw: [{ w: '的灯' }] }] } },
  }))
  assert.equal(final.text, '的灯')
  assert.equal(final.final, true)

  assert.throws(() => parseAsrResponse(JSON.stringify({ code: 10008, message: 'service instance invalid' })), /10008/)
})

test('vendor providers are wired to real adapters and refuse to start without credentials', () => {
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: { provider: 'deepseek', apiKey: 'sk-key', model: 'deepseek-chat' },
    tts: { provider: 'xunfei', appId: 'a', apiKey: 'k', apiSecret: 's', voice: 'xiaoyan' },
    asr: { provider: 'xunfei', appId: 'a', apiKey: 'k', apiSecret: 's' },
  }
  const adapters = createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg' })
  assert.equal(adapters.llm.name, 'openai', 'LLM 共用 OpenAI 兼容客户端')
  assert.equal(adapters.tts.name, 'xunfei')
  assert.equal(adapters.asr.name, 'xunfei')

  // A missing secret is a configuration error, never a silent fallback to mock.
  assert.throws(
    () => createVoiceAdapters({ ...voice, tts: { provider: 'xunfei', appId: 'a', apiKey: 'k' } }),
    /apiSecret/,
  )
  assert.throws(
    () => createVoiceAdapters({ ...voice, llm: { provider: 'deepseek' } }),
    (error) => error instanceof AdapterConfigError && /apiKey/.test(error.message),
  )
  // 火山 / OpenAI / 星火已不是 LLM 厂商：手写 settings 里残留会明确报错，不会静默换厂商。
  assert.throws(
    () => createVoiceAdapters({ ...voice, llm: { provider: 'volc', apiKey: 'k' } }),
    (error) => error instanceof AdapterConfigError && /unknown LLM provider "volc"/.test(error.message),
  )
})

test('volcengine HTTP streaming TTS payload and chunk parsing', async () => {
  const { buildRequestPayload, parseChunk } = await import('../src/voice/adapters/volc-http-tts.js')

  const payload = buildRequestPayload({
    text: '你好',
    voice: 'zh_female_vv_uranus_bigtts',
    model: 'seed-tts-2.0-standard',
    sampleRate: 24000,
  })
  assert.equal(payload.req_params.text, '你好')
  assert.equal(payload.req_params.speaker, 'zh_female_vv_uranus_bigtts')
  assert.equal(payload.req_params.audio_params.format, 'pcm', 'pcm avoids a decode step')
  assert.equal(payload.req_params.audio_params.sample_rate, 24000)

  const pcm = Buffer.from([9, 8, 7, 6])
  const chunk = parseChunk(JSON.stringify({ code: 0, message: 'OK', data: pcm.toString('base64') }))
  assert.deepEqual(chunk.audio, pcm)
  assert.equal(chunk.finished, false)

  assert.equal(parseChunk(JSON.stringify({ code: 20000000 })).finished, true, 'code 20000000 ends the stream')
  assert.throws(() => parseChunk(JSON.stringify({ code: 45000010, message: 'bad grant' })), /45000010/)
  // 55000000 是“音色与资源族不同代”，报错必须直接说人话，否则只有“没声音”可查。
  assert.throws(
    () => parseChunk(JSON.stringify({ code: 55000000, message: 'resource ID is mismatched with speaker related resource' })),
    /55000000.*uranus.*saturn/s,
  )
  assert.deepEqual(parseChunk(''), { audio: null, finished: false })
})
test('openai-compatible LLM retries once on a transient 5xx before emitting text', async () => {
  const { createOpenAiLlm } = await import('../src/voice/adapters/openai-llm.js')
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return new Response('{"error":"boom"}', { status: 500 })
    return new Response('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  try {
    const llm = createOpenAiLlm({ apiKey: 'k', model: 'm', baseUrl: 'https://example.invalid/v1' })
    const out = []
    for await (const text of llm.stream({ messages: [{ role: 'user', content: 'hi' }] })) out.push(text)
    assert.deepEqual(out, ['你', '好'])
    assert.equal(calls, 2, 'the 5xx is retried once')
  } finally {
    globalThis.fetch = original
  }
})
