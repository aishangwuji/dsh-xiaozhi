/**
 * `/models` 控制路由：模型清单只从厂商接口拉，不在插件里内置模型 id。
 *
 * 覆盖：
 *   1. GET 用**已保存**的 provider/baseUrl/apiKey 请求厂商 `GET {baseUrl}/models`；
 *   2. MiMo 的认证头是 `api-key`（不是 Bearer）；
 *   3. POST 给「弹窗里刚填了 Key、还没保存」的场景做即时预览（Key 走请求体）；
 *   4. 写接口仍然要 `x-dsh-xiaozhi: 1` CSRF 头；
 *   5. 厂商不可达时返回空 options（source=unavailable），前端退回文本框，不内置兜底。
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createControlHandler } from '../src/control.js'
import { createHistoryStore } from '../src/history.js'
import { ConnectionHub } from '../src/hub.js'
import { SettingsStore } from '../src/settings.js'
import { DeviceStore } from '../src/store.js'

const CONTROL = '/dsh-xiaozhi-7c3a'
const silent = { info() {}, warn() {}, error() {} }
const mutation = { 'x-dsh-xiaozhi': '1' }

/** 假厂商：记录请求，按 `respond` 说话。 */
async function startProvider(respond) {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw })
    respond(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function startHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'xz-models-http-'))
  const settings = new SettingsStore({ file: join(dir, 'settings.json'), logger: silent })
  await settings.load()
  const control = createControlHandler({
    store: new DeviceStore({ file: join(dir, 'devices.json'), logger: silent }),
    hub: new ConnectionHub({ logger: silent }),
    config: { host: '127.0.0.1', port: 0, dataRoot: dir, onboarding: { autoProvision: true, maxDevices: 10 } },
    gatewayRef: { current: null },
    settings,
    defaults: { systemPrompt: '', silenceMs: 400 },
    memory: { summary: async () => ({ facts: [], turns: [] }) },
    history: createHistoryStore({ dir: join(dir, 'history'), logger: silent }),
    logger: silent,
  })
  const server = createServer((req, res) => control.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    settings,
    base: `http://127.0.0.1:${server.address().port}`,
    async dispose() {
      await new Promise((resolve) => server.close(resolve))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function call(harness, path, { method = 'GET', body, headers = {} } = {}) {
  const finalHeaders = { ...headers }
  let payload
  if (body !== undefined) {
    finalHeaders['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const response = await fetch(`${harness.base}${CONTROL}${path}`, { method, headers: finalHeaders, body: payload })
  return { status: response.status, json: await response.json().catch(() => undefined) }
}

test('GET /models uses the saved MiMo key with api-key auth and returns live ids', async () => {
  const provider = await startProvider((res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'model-from-api-a' }, { id: 'model-from-api-b' }] }))
  })
  const harness = await startHarness()
  try {
    await harness.settings.update({
      voice: { llm: { provider: 'mimo', baseUrl: provider.baseUrl, apiKey: 'sk-saved-mimo' } },
    })
    const { status, json } = await call(harness, '/models?kind=llm&provider=mimo&source=primary')
    assert.equal(status, 200)
    assert.equal(json.source, 'live')
    assert.deepEqual(json.options.map((item) => item.value), ['model-from-api-a', 'model-from-api-b'])

    const request = provider.requests.at(-1)
    assert.equal(request.url, '/v1/models')
    assert.equal(request.headers['api-key'], 'sk-saved-mimo')
    assert.equal(request.headers.authorization, undefined)
  } finally {
    await harness.dispose()
    await provider.close()
  }
})

test('POST /models previews an unsaved key (body, not URL) and still requires the CSRF header', async () => {
  const provider = await startProvider((res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'preview-model' }] }))
  })
  const harness = await startHarness()
  try {
    const body = { kind: 'llm', provider: 'mimo', baseUrl: provider.baseUrl, apiKey: 'sk-unsaved-mimo' }

    const denied = await call(harness, '/models', { method: 'POST', body })
    assert.equal(denied.status, 403, '写接口必须带 x-dsh-xiaozhi 头')

    const { status, json } = await call(harness, '/models', { method: 'POST', body, headers: mutation })
    assert.equal(status, 200)
    assert.equal(json.source, 'live')
    assert.deepEqual(json.options.map((item) => item.value), ['preview-model'])
    assert.equal(provider.requests.at(-1).headers['api-key'], 'sk-unsaved-mimo')
    assert.equal(provider.requests.at(-1).url, '/v1/models')
  } finally {
    await harness.dispose()
    await provider.close()
  }
})

test('unreachable provider returns empty options (no built-in model fallback)', async () => {
  const dead = await startProvider((res) => {
    res.writeHead(503, { 'content-type': 'application/json' })
    res.end('{"error":"maintenance"}')
  })
  const harness = await startHarness()
  try {
    const { status, json } = await call(harness, '/models', {
      method: 'POST',
      body: { kind: 'llm', provider: 'mimo', baseUrl: dead.baseUrl, apiKey: 'sk-dead' },
      headers: mutation,
    })
    assert.equal(status, 200)
    assert.equal(json.source, 'unavailable')
    assert.deepEqual(json.options, [], '不允许内置模型兜底')
  } finally {
    await harness.dispose()
    await dead.close()
  }
})
