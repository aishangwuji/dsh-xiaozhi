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
const DEVICE = '02:DE:AD:BE:EF:01'
const T0 = 1_700_000_000_000
const silent = { info() {}, warn() {}, error() {} }

async function startHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'xz-history-http-'))
  const history = createHistoryStore({ dir: join(dir, 'history'), clock: () => T0, logger: silent })
  const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
  await store.load()
  const hub = new ConnectionHub({ logger: silent })
  const settings = new SettingsStore({ file: join(dir, 'settings.json'), logger: silent })
  await settings.load()
  const config = {
    host: '127.0.0.1',
    port: 0,
    dataRoot: dir,
    onboarding: { autoProvision: true, maxDevices: 100 },
    endpoints: { lanWsUrl: '', wanWsUrl: '', token: '' },
  }
  const control = createControlHandler({
    store,
    hub,
    config,
    gatewayRef: { current: null },
    settings,
    defaults: { systemPrompt: '', silenceMs: 400 },
    memory: { summary: async () => ({ facts: [], turns: [] }) },
    history,
    logger: silent,
  })
  const server = createServer((req, res) => control.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    dir,
    history,
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
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, text, json, headers: response.headers }
}

const mutation = { 'x-dsh-xiaozhi': '1' }

async function seed(harness) {
  const audioId = await harness.history.saveAudio(DEVICE, Buffer.alloc(320), { sampleRate: 16_000 })
  await harness.history.appendMessages(DEVICE, 'sess-1', [
    { role: 'user', content: '你好，世界！', at: 1000, audioId },
    { role: 'assistant', content: '你好呀！', at: 1001 },
  ])
  await harness.history.appendMessages(DEVICE, 'sess-2', [
    { role: 'user', content: '第二段', at: 2000 },
    { role: 'assistant', content: '第二答', at: 2001 },
  ])
  return audioId
}

test('GET /history/conversations returns the console list shape', async () => {
  const harness = await startHarness()
  try {
    await seed(harness)
    const query = `deviceId=${encodeURIComponent(DEVICE)}&limit=50`
    const response = await call(harness, `/history/conversations?${query}`)
    assert.equal(response.status, 200)
    assert.equal(response.json.deviceId, DEVICE)
    assert.equal(Array.isArray(response.json.conversations), true)
    assert.equal(response.json.conversations.length, 2)

    const first = response.json.conversations[0]
    assert.equal(first.sessionId, 'sess-2', 'newest first')
    assert.equal(typeof first.messages, 'number', 'console renders the count, not the array')
    assert.equal(first.messages, 2)
    assert.equal(first.title, '第二段')
    assert.equal(first.preview, '第二答')
    assert.equal(first.hasAudio, false)
    assert.equal(Number.isSafeInteger(first.startedAt), true)
    assert.equal(Number.isSafeInteger(first.endedAt), true)

    const withAudio = response.json.conversations.find((entry) => entry.sessionId === 'sess-1')
    assert.equal(withAudio.hasAudio, true)

    assert.equal((await call(harness, '/history/conversations')).status, 400)
  } finally {
    await harness.dispose()
  }
})

test('GET /history/conversation returns messages or found:false', async () => {
  const harness = await startHarness()
  try {
    const audioId = await seed(harness)
    const query = `deviceId=${encodeURIComponent(DEVICE)}&sessionId=sess-1`
    const found = await call(harness, `/history/conversation?${query}`)
    assert.equal(found.status, 200)
    assert.equal(found.json.found, true)
    assert.equal(found.json.sessionId, 'sess-1')
    assert.equal(found.json.title, '你好世界')
    assert.equal(found.json.messages.length, 2)
    assert.deepEqual(found.json.messages[0], {
      role: 'user',
      content: '你好，世界！',
      at: 1000,
      audioId,
    })
    assert.equal(found.json.messages[1].audioId, null)

    const missing = await call(
      harness,
      `/history/conversation?deviceId=${encodeURIComponent(DEVICE)}&sessionId=missing`,
    )
    assert.equal(missing.status, 200)
    assert.equal(missing.json.found, false)
    assert.deepEqual(missing.json.messages, [])

    const noSession = await call(harness, `/history/conversation?deviceId=${encodeURIComponent(DEVICE)}`)
    assert.equal(noSession.status, 400)
    assert.equal(noSession.json.error.code, 'session-required')

    const noDevice = await call(harness, '/history/conversation?sessionId=sess-1')
    assert.equal(noDevice.status, 400)
    assert.equal(noDevice.json.error.code, 'device-required')
  } finally {
    await harness.dispose()
  }
})

test('GET /history/audio streams a wav, or explains 404/400', async () => {
  const harness = await startHarness()
  try {
    const audioId = await seed(harness)
    const response = await fetch(
      `${harness.base}${CONTROL}/history/audio?deviceId=${encodeURIComponent(DEVICE)}&audioId=${audioId}`,
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'audio/wav')
    assert.equal(response.headers.get('content-length'), String(44 + 320))
    assert.match(response.headers.get('content-disposition'), /inline; filename="dsh-xiaozhi-/)
    assert.match(response.headers.get('content-disposition'), new RegExp(`${audioId}\\.wav"`))
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(bytes.length, 44 + 320)
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF')
    assert.equal(bytes.readUInt32LE(24), 16_000)

    const missing = await call(
      harness,
      `/history/audio?deviceId=${encodeURIComponent(DEVICE)}&audioId=deadbeefdeadbeefdeadbeefdeadbeef`,
    )
    assert.equal(missing.status, 404)
    assert.equal(missing.json.error.code, 'audio-not-found')

    // 路径穿越/非法字符：400，不是 404（参数错误与"已被清理"要能区分）。
    for (const bad of ['..%2Fsecret', 'a%2Fb', '..', '']) {
      const response = await call(
        harness,
        `/history/audio?deviceId=${encodeURIComponent(DEVICE)}&audioId=${bad}`,
      )
      assert.equal(response.status, 400, `audioId=${bad} must be rejected`)
      assert.equal(response.json.error.code, 'invalid-audio-id')
    }
    assert.equal((await call(harness, '/history/audio?audioId=deadbeef')).status, 400)
  } finally {
    await harness.dispose()
  }
})

test('POST /history/clear needs the CSRF header, then clears one session or the device', async () => {
  const harness = await startHarness()
  try {
    const audioId = await seed(harness)

    const untrusted = await call(harness, '/history/clear', {
      method: 'POST',
      body: { deviceId: DEVICE, sessionId: 'sess-1' },
    })
    assert.equal(untrusted.status, 403)
    assert.equal(untrusted.json.error.code, 'csrf')

    const one = await call(harness, '/history/clear', {
      method: 'POST',
      headers: mutation,
      body: { deviceId: DEVICE, sessionId: 'sess-1' },
    })
    assert.equal(one.status, 200)
    assert.equal(one.json.cleared, true)
    assert.equal(one.json.sessionId, 'sess-1')
    assert.equal(one.json.removedMessages, 2)
    assert.equal(one.json.removedAudio, 1)
    assert.deepEqual(one.json.entries, [], 'old response field kept for compatibility')

    const left = await call(harness, `/history/conversations?deviceId=${encodeURIComponent(DEVICE)}`)
    assert.deepEqual(left.json.conversations.map((entry) => entry.sessionId), ['sess-2'])
    const audioGone = await call(
      harness,
      `/history/audio?deviceId=${encodeURIComponent(DEVICE)}&audioId=${audioId}`,
    )
    assert.equal(audioGone.status, 404)

    const all = await call(harness, '/history/clear', {
      method: 'POST',
      headers: mutation,
      body: { deviceId: DEVICE },
    })
    assert.equal(all.status, 200)
    assert.equal(all.json.cleared, true)
    assert.equal(all.json.removedMessages, 2)
    const empty = await call(harness, `/history/conversations?deviceId=${encodeURIComponent(DEVICE)}`)
    assert.deepEqual(empty.json.conversations, [])

    const noDevice = await call(harness, '/history/clear', { method: 'POST', headers: mutation, body: {} })
    assert.equal(noDevice.status, 400)
    assert.equal(noDevice.json.error.code, 'device-required')
  } finally {
    await harness.dispose()
  }
})

test('the legacy /history route keeps returning flat entries', async () => {
  const harness = await startHarness()
  try {
    await seed(harness)
    const listed = await call(harness, `/history?deviceId=${encodeURIComponent(DEVICE)}&limit=10`)
    assert.equal(listed.status, 200)
    assert.equal(listed.json.deviceId, DEVICE)
    assert.equal(listed.json.entries.length, 2)
    assert.equal(listed.json.entries[0].user, '你好，世界！')
    assert.equal(listed.json.entries[0].assistant, '你好呀！')
  } finally {
    await harness.dispose()
  }
})
