/**
 * 小米 MiMo 直连 LLM（provider id = `mimo`）。
 *
 * 覆盖四件容易悄悄回归的事：
 *   1. 认证头是 `api-key`，且**不能**同时发 `authorization`（MiMo 文档“两种方式选一种”，
 *      混发会让同一请求被按另一种凭据解析）；
 *   2. 语音场景默认 `thinking: {type:'disabled'}`（MiMo 默认 enabled，先吐思维链会打穿首字预算）；
 *   3. SSE 文本增量与分片 tool_calls 的累积语义与其它 OpenAI 兼容厂商一致；
 *   4. 备用服务商白名单认 mimo（settings 的 BACKUP_SPEC 与适配器 preset 必须同步）。
 *
 * 用本地假 HTTP server 而不是 stub fetch：header 大小写规范化、SSE 分帧都经过真实 undici
 * 才可信，stub 里看到的是调用方原样传的对象，测不出真实发出的头。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { AdapterConfigError, buildLlmAdapter, createVoiceAdapters, openAiCompatiblePreset } from '../src/voice/adapters/index.js'
import { createOpenAiLlm } from '../src/voice/adapters/openai-llm.js'
import { modelsFor } from '../src/models.js'
import { SettingsStore } from '../src/settings.js'

/** 起一个只服务单个测试的假厂商；记录每次请求的头与 JSON body。 */
async function startServer(respond) {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const record = {
      method: req.method,
      url: req.url ?? '',
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    }
    requests.push(record)
    await respond(res, record)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    // 和真实 baseUrl 一样带 `/v1`，适配器再拼 `/chat/completions`。
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** 按 OpenAI 兼容 SSE 写一组 chunk，最后补 [DONE]。 */
function sse(res, frames) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`)
  res.end('data: [DONE]\n\n')
}

test('mimo preset carries no hardcoded model id (models come from GET /v1/models)', () => {
  // 用户明确要求：能从接口拿到的都不内置。模型清单由 models.js 调 /v1/models 拉，
  // 这里只允许有端点/认证/思维链这些「接口约定」，不允许出现任何模型 id。
  const preset = openAiCompatiblePreset('mimo')
  assert.equal(preset.model, undefined, 'preset 不得写死模型 id')
  assert.equal(preset.baseUrl, 'https://api.xiaomimimo.com/v1')
  assert.equal(preset.authStyle, 'api-key')
})

test('mimo preset sends api-key (no authorization), stream=true and thinking disabled', async () => {
  const server = await startServer((res) =>
    sse(res, [{ choices: [{ delta: { content: '你' } }] }, { choices: [{ delta: { content: '好' } }] }]),
  )
  try {
    // 模型名由控制台从 /v1/models 拉取后显式传入；不显式给 authStyle/thinking，这两个必须来自 preset。
    const model = 'mimo-v2.6-pro'
    const llm = buildLlmAdapter({ provider: 'mimo', apiKey: 'sk-test-mimo-key', model, baseUrl: server.baseUrl })
    assert.equal(llm.model, model)

    const out = []
    for await (const text of llm.stream({ messages: [{ role: 'user', content: '在吗' }] })) out.push(text)
    assert.deepEqual(out, ['你', '好'], 'SSE 文本增量逐条下发，不攒成整句')

    const request = server.requests.at(-1)
    assert.equal(request.url, '/v1/chat/completions')
    assert.equal(request.headers['api-key'], 'sk-test-mimo-key')
    assert.equal(request.headers.authorization, undefined, 'api-key 风格不得同时发 authorization')
    assert.equal(request.body.model, model)
    assert.equal(request.body.stream, true)
    assert.deepEqual(request.body.thinking, { type: 'disabled' }, '语音场景默认关掉思维链')
  } finally {
    await server.close()
  }
})

test('mimo default baseUrl is api.xiaomimimo.com/v1 and auth style is api-key', async () => {
  const original = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
    return new Response('data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', { status: 200 })
  }
  try {
    const llm = buildLlmAdapter({ provider: 'mimo', apiKey: 'sk-test-default-endpoint', model: 'mimo-v2.6-pro' })
    for await (const _text of llm.stream({ messages: [] })) void _text
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, 'https://api.xiaomimimo.com/v1/chat/completions')
    assert.equal(seen[0].headers['api-key'], 'sk-test-default-endpoint')
    assert.equal(seen[0].headers.authorization, undefined)
  } finally {
    globalThis.fetch = original
  }
})

test('mimo baseUrl / model / thinking can be overridden per entry', async () => {
  const server = await startServer((res) => sse(res, [{ choices: [{ delta: { content: 'x' } }] }]))
  try {
    const llm = buildLlmAdapter({
      provider: 'mimo',
      apiKey: 'sk-test-override',
      baseUrl: server.baseUrl,
      model: 'mimo-v2.6-pro',
      thinking: 'enabled',
    })
    assert.equal(llm.model, 'mimo-v2.6-pro')
    for await (const _text of llm.stream({ messages: [] })) void _text
    const request = server.requests.at(-1)
    assert.equal(request.body.model, 'mimo-v2.6-pro')
    assert.deepEqual(request.body.thinking, { type: 'enabled' }, '显式 enabled 才发 enabled')
  } finally {
    await server.close()
  }
})

test('mimo streamWithTools accumulates fragmented tool_calls and keeps tools in the body', async () => {
  const server = await startServer((res) =>
    sse(res, [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'npc_act' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"action":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"walk"}' } }] } }] },
    ]),
  )
  try {
    const llm = buildLlmAdapter({ provider: 'mimo', apiKey: 'sk-test-tools', model: 'mimo-v2.6-pro', baseUrl: server.baseUrl })
    const tools = [{ type: 'function', function: { name: 'npc_act', parameters: { type: 'object' } } }]
    const events = []
    for await (const event of llm.streamWithTools({ messages: [{ role: 'user', content: '走两步' }], tools })) {
      events.push(event)
    }

    assert.deepEqual(events, [
      {
        type: 'tool_calls',
        calls: [{ id: 'call_1', name: 'npc_act', arguments: '{"action":"walk"}' }],
      },
    ])
    const request = server.requests.at(-1)
    assert.deepEqual(request.body.tools, tools)
    assert.equal(request.body.tool_choice, 'auto')
    assert.equal(request.headers['api-key'], 'sk-test-tools')
  } finally {
    await server.close()
  }
})

test('bearer auth stays the default for the other OpenAI-compatible vendors', async () => {
  const server = await startServer((res) => sse(res, [{ choices: [{ delta: { content: '嗯' } }] }]))
  try {
    // 直接走客户端默认：deepseek 等厂商仍是 Bearer，不能被 mimo 的改动带跑。
    const llm = createOpenAiLlm({ apiKey: 'sk-test-bearer', model: 'deepseek-chat', baseUrl: server.baseUrl })
    for await (const _text of llm.stream({ messages: [] })) void _text
    const request = server.requests.at(-1)
    assert.equal(request.headers.authorization, 'Bearer sk-test-bearer')
    assert.equal(request.headers['api-key'], undefined)
    assert.equal(request.body.thinking, undefined, '不带 thinking 的厂商请求体里不应出现该字段')
  } finally {
    await server.close()
  }
})

test('missing apiKey / missing model are configuration errors, and the unknown-provider message lists mimo', () => {
  assert.throws(
    () => buildLlmAdapter({ provider: 'mimo' }),
    (error) => error instanceof AdapterConfigError && /voice\.llm\.apiKey.*mimo/.test(error.message),
  )
  // 模型清单从厂商接口拉；没填 model 时必须显式报错，不能偷偷用写死的默认模型。
  assert.throws(
    () => buildLlmAdapter({ provider: 'mimo', apiKey: 'sk-test' }),
    (error) => error instanceof AdapterConfigError && /voice\.llm\.model.*mimo/.test(error.message),
  )
  assert.throws(
    () => buildLlmAdapter({ provider: 'mimo-x', apiKey: 'sk-test' }),
    (error) => error instanceof AdapterConfigError && /unknown LLM provider.*mimo/.test(error.message),
  )
  // 备用链里一条缺 Key 的 mimo 只跳过、不打死整条语音；主用必须是真正可用的那家。
  const adapters = createVoiceAdapters({
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: { provider: 'mock', reply: '本地', deltaMs: 0, backups: [{ provider: 'mimo' }] },
    tts: { provider: 'mock' },
    asr: { provider: 'mock' },
  })
  assert.equal(adapters.llm.name, 'mock')
})

test('BACKUP_SPEC accepts a mimo backup entry and keeps the key masked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-mimo-'))
  const file = join(dir, 'settings.json')
  const logger = { error() {}, warn() {} }
  try {
    const store = new SettingsStore({ file, logger })
    await store.load()
    const snapshot = await store.update({
      voice: {
        llm: {
          backups: [{ provider: 'mimo', model: 'mimo-v2.6-flash', apiKey: 'sk-test-mimo-backup' }],
        },
      },
    })
    const [backup] = snapshot.voice.llm.backups
    assert.equal(backup.provider, 'mimo')
    assert.equal(backup.model, 'mimo-v2.6-flash')
    assert.equal(backup.hasApiKey, true)
    assert.match(backup.apiKey, /•/, 'snapshot 只出掩码')

    // 落盘的是原值，掩码只在控制台视图里。
    const disk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(disk.voice.llm.backups[0].apiKey, 'sk-test-mimo-backup')

    // 白名单仍然生效：没同步进 BACKUP_SPEC 的 provider 必须被拒，不能落成“保存能过、运行时跳过”。
    await assert.rejects(
      store.update({ voice: { llm: { backups: [{ provider: 'mimo-ultra', apiKey: 'sk-test-x' }] } } }),
      /不受支持/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('mimo GET /models uses api-key and returns live ids; unavailable API yields an empty list (no built-in models)', async () => {
  const live = await startServer((res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mimo-v2.6-pro' }, { id: 'mimo-v2.6-flash' }] }))
  })
  const dead = await startServer((res) => {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end('{"error":"maintenance"}')
  })
  try {
    const listed = await modelsFor({
      kind: 'llm',
      provider: 'mimo',
      baseUrl: live.baseUrl,
      apiKey: 'sk-test-live',
      authStyle: 'api-key',
    })
    assert.equal(listed.source, 'live')
    assert.deepEqual(listed.options.map((item) => item.value), ['mimo-v2.6-flash', 'mimo-v2.6-pro'])
    assert.equal(live.requests.at(-1).headers['api-key'], 'sk-test-live')
    assert.equal(live.requests.at(-1).headers.authorization, undefined)

    // 用户要求：能从接口获得的都不硬编码。接口不可达 = 空列表，控制台退回文本框手填。
    const unavailable = await modelsFor({
      kind: 'llm',
      provider: 'mimo',
      baseUrl: dead.baseUrl,
      apiKey: 'sk-test-dead',
      authStyle: 'api-key',
    })
    assert.equal(unavailable.source, 'unavailable')
    assert.deepEqual(unavailable.options, [])
  } finally {
    await live.close()
    await dead.close()
  }
})

test('modelsFor uses Bearer for bearer-style vendors and never falls back to a built-in list', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers })
    return new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }), { status: 200 })
  }
  const listed = await modelsFor({ kind: 'llm', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', fetchImpl })
  assert.equal(listed.source, 'live')
  assert.equal(seen[0].url, 'https://api.deepseek.com/v1/models')
  assert.equal(seen[0].headers.authorization, 'Bearer sk-x')

  const empty = await modelsFor({ kind: 'llm', provider: 'openai', baseUrl: '', apiKey: 'sk-x', fetchImpl })
  assert.deepEqual(empty.options, [], '没有 baseUrl 时也不许用内置模型兜底')
})
