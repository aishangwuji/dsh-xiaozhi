import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConnectionHub } from '../src/hub.js'
import { createControlHandler } from '../src/control.js'
import { SettingsStore } from '../src/settings.js'
import { DeviceStore } from '../src/store.js'

const silent = { info() {}, warn() {}, error() {} }
const CONTROL = '/dsh-xiaozhi-7c3a'

async function start({ probeLlm, probeProvider, llm } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-settings-'))
  const config = {
    host: '127.0.0.1',
    port: 0,
    onboarding: { autoProvision: true },
    endpoints: { lanWsUrl: '', wanWsUrl: '', token: '' },
    gateway: { enabled: true, token: 'boot-token', commands: {} },
    voice: { sampleRate: { uplink: 16000, downlink: 24000 }, frameMs: { uplink: 60, downlink: 20 } },
  }
  const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
  await store.load()
  const settings = new SettingsStore({ file: join(dir, 'settings.json'), logger: silent })
  await settings.load()

  const control = createControlHandler({
    store,
    hub: new ConnectionHub(),
    config,
    gatewayRef: { current: null },
    defaults: { systemPrompt: '插件默认人设', silenceMs: 400 },
    settings,
    probeLlm,
    probeProvider,
    llm,
    logger: silent,
  })
  const server = createServer((req, res) => control.handler(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${CONTROL}`

  return {
    dir,
    settings,
    base,
    async call(path, { method = 'GET', body, csrf = true } = {}) {
      const headers = { 'content-type': 'application/json' }
      if (csrf) headers['x-dsh-xiaozhi'] = '1'
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await response.text()
      let json
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
      return { status: response.status, json }
    },
    async dispose() {
      await store.persist()
      await settings.persist()
      await new Promise((resolve) => server.close(resolve))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** 落盘内容：备用列表的密钥必须真的在磁盘上（运行时适配器要明文），只是不出响应。 */
async function readDisk(harness) {
  return JSON.parse(await readFile(join(harness.dir, 'settings.json'), 'utf8'))
}

test('the console is open on loopback: no login, but mutations still need the CSRF header', async () => {
  const harness = await start()
  try {
    assert.equal((await harness.call('/state')).status, 200)
    assert.equal((await harness.call('/settings')).status, 200)
    assert.equal((await harness.call('/settings', { method: 'POST', body: {}, csrf: false })).status, 403)
    assert.equal((await harness.call('/settings', { method: 'POST', body: { voice: { systemPrompt: '测试人设' } } })).status, 200)
  } finally {
    await harness.dispose()
  }
})

test('the global persona and silence cutoff live in settings and fall back to the plugin config', async () => {
  const harness = await start()
  try {
    // 没设过时是空串 / null，defaults 告诉面板「留空」沿用的是哪份值。
    const initial = await harness.call('/settings')
    assert.equal(initial.status, 200)
    assert.equal(initial.json.settings.voice.systemPrompt, '')
    assert.equal(initial.json.settings.voice.silenceMs, null)
    assert.equal(initial.json.defaults.systemPrompt, '插件默认人设')
    assert.equal(initial.json.defaults.silenceMs, 400)

    const saved = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { systemPrompt: '  你是客厅音箱，回答不超过两句话。 ', silenceMs: 700 } },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.settings.voice.systemPrompt, '你是客厅音箱，回答不超过两句话。')
    assert.equal(saved.json.settings.voice.silenceMs, 700)
    // 保存后 defaults 仍是插件里的原值，不被面板写入覆盖。
    assert.equal(saved.json.defaults.systemPrompt, '插件默认人设')

    // 越界的静音收口回落为「沿用插件配置」，而不是写进文件。
    const bogus = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { silenceMs: 99_999 } },
    })
    assert.equal(bogus.status, 200)
    assert.equal(bogus.json.settings.voice.silenceMs, null)

    // 人设清空 = 回到插件默认（null），不是「空人设」。
    const cleared = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { systemPrompt: '   ' } },
    })
    assert.equal(cleared.json.settings.voice.systemPrompt, '')

    const reopened = new SettingsStore({ file: join(harness.dir, 'settings.json'), logger: silent })
    await reopened.load()
    assert.equal(reopened.snapshot().voice.systemPrompt, '')
    assert.equal(reopened.snapshot().voice.silenceMs, null)
  } finally {
    await harness.dispose()
  }
})

test('secrets are masked on read and blank-on-write keeps the stored value', async () => {
  const harness = await start()
  try {
    const saved = await harness.call('/settings', {
      method: 'POST',
      body: {
        endpoints: { lanWsUrl: 'ws://192.168.1.10:8989/xiaozhi/v1/', token: 'ota-secret-value' },
        gateway: { token: 'gateway-secret-value' },
        voice: { llm: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-very-secret-key-abcd' } },
      },
    })
    assert.equal(saved.status, 200)
    const snapshot = saved.json.settings
    // Never the raw value, not even a long prefix.
    assert.notEqual(snapshot.gateway.token, 'gateway-secret-value')
    assert.match(snapshot.gateway.token, /•/)
    assert.equal(snapshot.gateway.hasToken, true)
    assert.equal(snapshot.voice.llm.hasApiKey, true)
    assert.notEqual(snapshot.voice.llm.apiKey, 'sk-very-secret-key-abcd')
    assert.doesNotMatch(JSON.stringify(snapshot), /very-secret/)

    // Blank secrets mean "keep": the console posts the masked value back.
    const again = await harness.call('/settings', {
      method: 'POST',
      body: { gateway: { token: '' }, voice: { llm: { apiKey: '' } } },
    })
    assert.equal(again.status, 200)
    assert.equal(again.json.settings.gateway.hasToken, true)
    assert.equal(again.json.settings.voice.llm.hasApiKey, true)

    const onDisk = JSON.parse(await readFile(join(harness.dir, 'settings.json'), 'utf8'))
    assert.equal(onDisk.gateway.token, 'gateway-secret-value')

    // An explicit clear is honoured.
    await harness.call('/settings', { method: 'POST', body: { gateway: { clearToken: true } } })
    const cleared = await harness.call('/settings')
    assert.equal(cleared.json.settings.gateway.hasToken, false)
  } finally {
    await harness.dispose()
  }
})

test('TTS global entries are credentials only: voice/model/resource can be cleared', async () => {
  // 2026-11-08 归属约定：音色（= TTS 模型）只在设备级配置，全局条目只存厂商+凭据。
  // 控制台保存全局 TTS 时会显式清空 voice/model/resourceId，这里钉住服务端接受清空，
  // 且备用条目只带凭据也能保存（缺失字段按空串落盘，运行时用厂商默认音色）。
  const harness = await start()
  try {
    await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          tts: {
            provider: 'volc',
            apiKey: 'volc-key',
            voice: 'zh_female_xiaohe_uranus_bigtts',
            model: 'seed-tts-2.0-standard',
            resourceId: 'seed-tts-2.0',
          },
        },
      },
    })
    const cleared = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          tts: {
            provider: 'volc',
            apiKey: '',
            voice: '',
            model: '',
            resourceId: '',
            backups: [{ provider: 'edge' }, { provider: 'xunfei', appId: 'app', apiKey: 'k', apiSecret: 's' }],
          },
        },
      },
    })
    assert.equal(cleared.status, 200)
    const tts = cleared.json.settings.voice.tts
    assert.equal(tts.provider, 'volc')
    assert.equal(tts.voice, '')
    assert.equal(tts.model, '')
    assert.equal(tts.resourceId, '')
    assert.equal(tts.hasApiKey, true, 'blank secret keeps the stored key')
    assert.equal(tts.backups.length, 2)
    assert.equal(tts.backups[0].voice, '')
    assert.equal(tts.backups[0].model, '')
    assert.equal(tts.backups[0].resourceId, '')

    const disk = await readDisk(harness)
    assert.equal(disk.voice.tts.voice, '')
    assert.equal(disk.voice.tts.apiKey, 'volc-key')
  } finally {
    await harness.dispose()
  }
})

test('settings survive a restart and the console reports no auth surface', async () => {
  const harness = await start()
  try {
    await harness.call('/settings', {
      method: 'POST',
      body: { endpoints: { wanWsUrl: 'wss://example.com/xiaozhi/v1' }, firmware: { version: '2.5.3' } },
    })
    const reopened = new SettingsStore({ file: join(harness.dir, 'settings.json'), logger: silent })
    await reopened.load()
    assert.equal(reopened.snapshot().endpoints.wanWsUrl, 'wss://example.com/xiaozhi/v1')
    assert.equal(reopened.snapshot().firmware.version, '2.5.3')

    const state = await harness.call('/state')
    assert.equal(state.json.auth, undefined, 'the control API must not advertise a login surface')
    assert.equal((await harness.call('/auth/status')).status, 404)
    assert.equal((await harness.call('/security/events')).status, 404)
  } finally {
    await harness.dispose()
  }
})

// ---------------------------------------------------------------- 备用服务商（v3）

test('backup providers persist with server ids and only masks leave the process', async () => {
  const harness = await start()
  try {
    const saved = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            apiKey: 'sk-primary-llm-secret',
            backups: [
              {
                provider: 'deepseek',
                model: 'deepseek-chat',
                baseUrl: 'https://api.deepseek.com/v1',
                appId: 'deepseek-app',
                apiKey: 'sk-backup-deepseek-secret',
              },
              { provider: 'mimo', model: 'mimo-v2', apiKey: 'sk-backup-mimo-secret' },
            ],
          },
          tts: {
            provider: 'volc',
            backups: [{ provider: 'xunfei', appId: 'tts-app', apiKey: 'tts-key-raw', apiSecret: 'tts-secret-raw' }],
          },
          asr: {
            provider: 'funasr',
            backups: [
              { provider: 'local', language: 'zh' },
              { provider: 'volc', resourceId: 'volc-asr-res', apiKey: 'asr-key-raw', apiSecret: 'asr-secret-raw' },
            ],
          },
        },
      },
    })
    assert.equal(saved.status, 200)
    const voice = saved.json.settings.voice
    assert.equal(voice.llm.backups.length, 2)
    const [first, second] = voice.llm.backups
    assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.notEqual(first.id, second.id, 'each entry gets its own id')
    assert.equal(first.provider, 'deepseek')
    // 非密钥字段原样回显，顺序即优先级。
    assert.equal(first.model, 'deepseek-chat')
    assert.equal(first.baseUrl, 'https://api.deepseek.com/v1')
    assert.equal(first.appId, 'deepseek-app')
    assert.equal(second.provider, 'mimo')
    // 只有掩码 + has 布尔。
    assert.equal(first.hasApiKey, true)
    assert.match(first.apiKey, /•/)
    assert.notEqual(first.apiKey, 'sk-backup-deepseek-secret')
    assert.equal(voice.tts.backups[0].hasApiSecret, true)
    assert.match(voice.tts.backups[0].apiSecret, /•/)
    assert.equal(voice.asr.backups[0].provider, 'local')
    assert.equal(voice.asr.backups[0].hasApiKey, false)
    assert.equal(voice.asr.backups[1].hasApiSecret, true)
    assert.equal(voice.asr.backups[1].resourceId, 'volc-asr-res')
    // 整个响应（含主用）里没有任何明文密钥。
    assert.doesNotMatch(
      JSON.stringify(saved.json),
      /sk-primary-llm-secret|sk-backup-deepseek-secret|sk-backup-mimo-secret|tts-key-raw|tts-secret-raw|asr-key-raw|asr-secret-raw/,
    )

    // GET 与 POST 返回同一份掩码视图（前端回填后原样提交）。
    const readBack = await harness.call('/settings')
    assert.equal(readBack.status, 200)
    assert.deepEqual(
      readBack.json.settings.voice.llm.backups.map((entry) => entry.id),
      voice.llm.backups.map((entry) => entry.id),
    )
    assert.equal(readBack.json.settings.voice.llm.backups[0].apiKey, first.apiKey)

    // 明文只在 0600 的 settings.json 里（运行时适配器要真 Key），版本升到 3。
    const disk = await readDisk(harness)
    assert.equal(disk.version, 3)
    assert.equal(disk.voice.llm.backups[0].apiKey, 'sk-backup-deepseek-secret')
    assert.equal(disk.voice.tts.backups[0].apiSecret, 'tts-secret-raw')
    assert.equal(disk.voice.asr.backups[0].provider, 'local')
    assert.equal(disk.voice.asr.backups[0].apiKey, '')
    assert.doesNotMatch(JSON.stringify(disk.voice), /•/, '掩码永远不落盘')

    // 重启后 id / 顺序都不变，控制台下次才能按 id 回传保留密钥。
    const reopened = new SettingsStore({ file: join(harness.dir, 'settings.json'), logger: silent })
    await reopened.load()
    const restored = reopened.snapshot().voice
    assert.deepEqual(
      restored.llm.backups.map((entry) => [entry.id, entry.provider]),
      voice.llm.backups.map((entry) => [entry.id, entry.provider]),
    )
    assert.equal(restored.llm.backups[0].hasApiKey, true)
    assert.doesNotMatch(JSON.stringify(restored), /sk-backup-deepseek-secret/)
  } finally {
    await harness.dispose()
  }
})

test('a backup can be promoted to primary and the old primary drops into its slot', async () => {
  const harness = await start()
  try {
    const saved = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            apiKey: 'sk-primary-llm',
            maxTokens: 96,
            backups: [
              { provider: 'mimo', model: 'mimo-v2', apiKey: 'sk-backup-mimo' },
              { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-backup-deepseek' },
            ],
          },
          tts: {
            provider: 'volc',
            apiKey: 'tts-primary-key',
            backups: [{ provider: 'xunfei', appId: 'xf-app', apiKey: 'xf-key', apiSecret: 'xf-secret' }],
          },
        },
      },
    })
    assert.equal(saved.status, 200)
    const ttsBackupId = saved.json.settings.voice.tts.backups[0].id

    // 把唯一的 TTS 备用（讯飞）设为主用，旧主用（火山）落到备用 1。
    const promotedTts = await harness.call('/settings/provider/promote', {
      method: 'POST',
      body: { kind: 'tts', index: 0 },
    })
    assert.equal(promotedTts.status, 200)
    const ttsView = promotedTts.json.settings.voice.tts
    assert.equal(ttsView.provider, 'xunfei')
    assert.equal(ttsView.hasApiKey, true)
    assert.equal(ttsView.hasApiSecret, true, '被提升条目的密钥状态跟着它走')
    assert.equal(ttsView.backups.length, 1)
    assert.equal(ttsView.backups[0].provider, 'volc')
    assert.notEqual(ttsView.backups[0].id, ttsBackupId, '降级的主用拿到新 id')
    // 密钥不过 HTTP：响应里只有掩码。
    assert.doesNotMatch(JSON.stringify(promotedTts.json), /xf-key|xf-secret|tts-primary-key/)

    // 明文在磁盘上各归各位：讯飞的成了主用，火山的留在备用。
    const disk = await readDisk(harness)
    assert.equal(disk.voice.tts.provider, 'xunfei')
    assert.equal(disk.voice.tts.appId, 'xf-app')
    assert.equal(disk.voice.tts.apiKey, 'xf-key')
    assert.equal(disk.voice.tts.apiSecret, 'xf-secret')
    assert.equal(disk.voice.tts.backups[0].provider, 'volc')
    assert.equal(disk.voice.tts.backups[0].apiKey, 'tts-primary-key')

    // LLM：提升第 2 条 → 主用 deepseek；maxTokens 这类全局项不跟着搬；
    // 被提升的那条从列表里摘掉，旧主用落到它原来的位置（顺序不变）。
    const promotedLlm = await harness.call('/settings/provider/promote', {
      method: 'POST',
      body: { kind: 'llm', index: 1 },
    })
    assert.equal(promotedLlm.status, 200)
    const llmView = promotedLlm.json.settings.voice.llm
    assert.equal(llmView.provider, 'deepseek')
    assert.equal(llmView.maxTokens, 96, '全局项（回复长度上限）留在主用')
    assert.deepEqual(llmView.backups.map((entry) => entry.provider), ['mimo', 'deepseek'])
    assert.equal((await readDisk(harness)).voice.llm.apiKey, 'sk-backup-deepseek')
    // 降级的主用落在「被提升那条原来的位置」（index 1），不是列表头。
    assert.equal((await readDisk(harness)).voice.llm.backups[0].apiKey, 'sk-backup-mimo')
    assert.equal((await readDisk(harness)).voice.llm.backups[1].apiKey, 'sk-primary-llm')
  } finally {
    await harness.dispose()
  }
})

test('promoting a backup when no primary was ever configured leaves no empty entry', async () => {
  const harness = await start()
  try {
    const saved = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { tts: { backups: [{ provider: 'deepseek', apiKey: 'sk-ds' }] } } },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.settings.voice.tts.provider, '', '主用还没配过')

    const promoted = await harness.call('/settings/provider/promote', {
      method: 'POST',
      body: { kind: 'tts', index: 0 },
    })
    assert.equal(promoted.status, 200)
    assert.equal(promoted.json.settings.voice.tts.provider, 'deepseek')
    assert.deepEqual(promoted.json.settings.voice.tts.backups, [], '不留 provider 为空的空壳条目')
    assert.equal((await readDisk(harness)).voice.tts.apiKey, 'sk-ds')
  } finally {
    await harness.dispose()
  }
})

test('promote is CSRF-protected, validates the index, and rejects a broken DSH host provider', async () => {
  const harness = await start({ llm: { listProviders: () => [{ id: 'opencode-go' }] } })
  try {
    await harness.settings.update({ voice: { llm: { backups: [{ provider: 'host', hostProvider: 'opencode-go', model: 'x' }] } } })
    // /settings 本身会拦坏值；这里模拟「磁盘上已被手改坏」的那份，确认提升路径同样拦。
    harness.settings.state.voice.llm.backups[0].hostProvider = 'not-registered'

    const savedHost = await harness.call('/settings/provider/promote', {
      method: 'POST',
      body: { kind: 'llm', index: 0 },
    })
    assert.equal(savedHost.status, 400)
    assert.equal(savedHost.json.error.code, 'invalid-host-provider')
    assert.equal(harness.settings.state.voice.llm.provider, '', '被拒时不能改状态')

    assert.equal(
      (await harness.call('/settings/provider/promote', { method: 'POST', body: { kind: 'tts', index: 0 }, csrf: false })).status,
      403,
    )
    const badStage = await harness.call('/settings/provider/promote', { method: 'POST', body: { kind: 'voice', index: 0 } })
    assert.equal(badStage.status, 400)
    assert.equal(badStage.json.error.code, 'invalid-stage')
    const badIndex = await harness.call('/settings/provider/promote', { method: 'POST', body: { kind: 'asr', index: 3 } })
    assert.equal(badIndex.status, 400)
    assert.equal(badIndex.json.error.code, 'invalid-index')
  } finally {
    await harness.dispose()
  }
})

test('a blank or masked backup secret is kept only for the same id and provider', async () => {
  const harness = await start()
  try {
    const created = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            provider: 'deepseek',
            backups: [
              { provider: 'mimo', model: 'mimo-v2', apiKey: 'sk-mimo-old' },
              { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-deepseek-old' },
            ],
          },
        },
      },
    })
    assert.equal(created.status, 200)
    const [mimo, deepseek] = created.json.settings.voice.llm.backups

    // 掩码原样回传 / 空串 = 「留空 = 保留」。
    const kept = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            backups: [
              { id: mimo.id, provider: 'mimo', model: 'mimo-v2', apiKey: mimo.apiKey },
              { id: deepseek.id, provider: 'deepseek', model: 'deepseek-chat', apiKey: '' },
            ],
          },
        },
      },
    })
    assert.equal(kept.status, 200)
    let disk = await readDisk(harness)
    assert.equal(disk.voice.llm.backups[0].apiKey, 'sk-mimo-old')
    assert.equal(disk.voice.llm.backups[1].apiKey, 'sk-deepseek-old')
    assert.doesNotMatch(JSON.stringify(disk.voice.llm.backups), /•/)

    // 同一个 id 换了 provider：那是另一家的凭据，旧密钥不能跟过去。
    const switched = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            backups: [{ id: mimo.id, provider: 'deepseek', model: 'deepseek-chat', apiKey: mimo.apiKey }],
          },
        },
      },
    })
    assert.equal(switched.status, 200)
    assert.equal(switched.json.settings.voice.llm.backups[0].hasApiKey, false)
    disk = await readDisk(harness)
    assert.equal(disk.voice.llm.backups[0].provider, 'deepseek')
    assert.equal(disk.voice.llm.backups[0].apiKey, '')

    // 新值写入后，clearApiKey 即使顺手回填了掩码也按显式清除处理。
    const refilled = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: { backups: [{ id: mimo.id, provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-deepseek-new' }] },
        },
      },
    })
    const masked = refilled.json.settings.voice.llm.backups[0].apiKey
    assert.equal(refilled.json.settings.voice.llm.backups[0].hasApiKey, true)
    await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            backups: [{ id: mimo.id, provider: 'deepseek', model: 'deepseek-chat', apiKey: masked, clearApiKey: true }],
          },
        },
      },
    })
    disk = await readDisk(harness)
    assert.equal(disk.voice.llm.backups[0].apiKey, '')

    // 前端删条 = 该条密钥一并从磁盘消失，而不是「留空保留」。
    await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            backups: [{ id: deepseek.id, provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-deepseek-old' }],
          },
        },
      },
    })
    disk = await readDisk(harness)
    assert.equal(disk.voice.llm.backups.length, 1)
    assert.equal(disk.voice.llm.backups[0].provider, 'deepseek')
    assert.doesNotMatch(JSON.stringify(disk.voice.llm), /sk-mimo-old|sk-deepseek-new/)
  } finally {
    await harness.dispose()
  }
})

test('an invalid backup list fails the whole save instead of half-applying it', async () => {
  const harness = await start()
  try {
    const initial = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          systemPrompt: '请保留这份人设',
          llm: { provider: 'deepseek', backups: [{ provider: 'deepseek', apiKey: 'sk-keep-me' }] },
        },
      },
    })
    assert.equal(initial.status, 200)

    // mock 只用于桌面联调，不允许进备用列表。
    const unknown = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { systemPrompt: '不该被保存', llm: { backups: [{ provider: 'mock', apiKey: 'sk-x' }] } } },
    })
    assert.equal(unknown.status, 400)
    assert.match(unknown.json.error.message, /provider|服务商/)

    // 同一次请求里的人设也不能被半保存。
    const after = await harness.call('/settings')
    assert.equal(after.json.settings.voice.systemPrompt, '请保留这份人设')
    assert.equal(after.json.settings.voice.llm.backups.length, 1)
    assert.equal(after.json.settings.voice.llm.backups[0].hasApiKey, true)
    let disk = await readDisk(harness)
    assert.equal(disk.voice.systemPrompt, '请保留这份人设')
    assert.equal(disk.voice.llm.backups[0].apiKey, 'sk-keep-me')

    // 条数不设上限（2026-11-08）：原来这里断言「超过 5 条报错」，现在交给专门的
    // 「no count cap」用例验证 12 条能存能读，这里只保留非法形状的检查。

    // 非数组（含 null）与条目非对象都算非法形状。
    assert.equal(
      (await harness.call('/settings', { method: 'POST', body: { voice: { llm: { backups: 'nope' } } } })).status,
      400,
    )
    assert.equal(
      (await harness.call('/settings', { method: 'POST', body: { voice: { llm: { backups: null } } } })).status,
      400,
    )
    assert.equal(
      (await harness.call('/settings', { method: 'POST', body: { voice: { llm: { backups: ['deepseek'] } } } })).status,
      400,
    )

    // 失败若干次之后磁盘仍是最初那一条。
    disk = await readDisk(harness)
    assert.equal(disk.voice.llm.backups.length, 1)
    assert.equal(disk.voice.llm.backups[0].apiKey, 'sk-keep-me')
  } finally {
    await harness.dispose()
  }
})

test('backup lists have no count cap: 12 entries persist in order', async () => {
  const harness = await start()
  try {
    // 旧契约是「每段最多 5 条」，2026-11-08 去掉：顺序即优先级，用户想加几条就加几条。
    const many = Array.from({ length: 12 }, (_, index) => ({
      provider: index % 2 === 0 ? 'deepseek' : 'mimo',
      model: `model-${index}`,
      apiKey: `sk-${index}`,
    }))
    const saved = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { llm: { backups: many } } },
    })
    assert.equal(saved.status, 200)
    const list = saved.json.settings.voice.llm.backups
    assert.equal(list.length, 12, 'all 12 entries are accepted (no 5-entry cap)')
    assert.deepEqual(
      list.map((entry) => entry.model),
      many.map((entry) => entry.model),
      'order is priority and is preserved',
    )
    assert.equal(new Set(list.map((entry) => entry.id)).size, 12, 'each entry gets its own id')

    // 落盘与重启后仍是 12 条：加载路径也不再按 5 条截断。
    const disk = await readDisk(harness)
    assert.equal(disk.voice.llm.backups.length, 12)
    const reopened = new SettingsStore({ file: join(harness.dir, 'settings.json'), logger: silent })
    await reopened.load()
    assert.equal(reopened.snapshot().voice.llm.backups.length, 12)
  } finally {
    await harness.dispose()
  }
})

test('a version-2 settings file upgrades to version 3 with empty backup lists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-settings-'))
  try {
    const file = join(dir, 'settings.json')
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        voice: {
          llm: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            apiKey: 'sk-legacy-key',
            configured: true,
            // 旧/脏数据里可能混进不受支持的 provider：加载时丢弃，不让整份设置不可读。
            backups: [{ provider: 'mock', apiKey: 'sk-mock' }, { provider: 'mimo', model: 'mimo-v2', apiKey: 'sk-legacy-backup' }],
          },
        },
      }),
      'utf8',
    )
    const store = new SettingsStore({ file, logger: silent })
    await store.load()
    const before = store.snapshot()
    assert.equal(before.voice.llm.hasApiKey, true)
    assert.equal(before.voice.llm.backups.length, 1)
    assert.equal(before.voice.llm.backups[0].provider, 'mimo')
    assert.equal(before.voice.llm.backups[0].hasApiKey, true)
    assert.deepEqual(before.voice.tts.backups, [])
    assert.deepEqual(before.voice.asr.backups, [])

    await store.update({ voice: { tts: { provider: 'edge' } } })
    const disk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(disk.version, 3)
    assert.deepEqual(disk.voice.tts.backups, [])
    assert.deepEqual(disk.voice.asr.backups, [])
    // 旧文件里的密钥原样保留：只有 snapshot 会把它换成掩码。
    assert.equal(disk.voice.llm.apiKey, 'sk-legacy-key')
    assert.equal(disk.voice.llm.backups[0].provider, 'mimo')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a DSH-hosted LLM entry persists hostProvider without any key', async () => {
  const harness = await start()
  try {
    const saved = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          llm: {
            provider: 'host',
            hostProvider: 'deepseek',
            model: 'deepseek-chat',
            backups: [{ provider: 'host', hostProvider: 'mimo', model: 'mimo-v2' }],
          },
        },
      },
    })
    assert.equal(saved.status, 200)
    const llm = saved.json.settings.voice.llm
    assert.equal(llm.provider, 'host')
    assert.equal(llm.hostProvider, 'deepseek')
    assert.equal(llm.hasApiKey, false, 'host entries carry no key')
    assert.equal(llm.backups[0].provider, 'host')
    assert.equal(llm.backups[0].hostProvider, 'mimo', 'backups can also reuse DSH')
    assert.equal(llm.backups[0].hasApiKey, false)

    const disk = await readDisk(harness)
    assert.equal(disk.voice.llm.hostProvider, 'deepseek')
    assert.equal(disk.voice.llm.backups[0].hostProvider, 'mimo')
    assert.equal(disk.voice.llm.apiKey, '')

    // 切回直连：hostProvider 被显式清空，不留下「看起来还在复用 DSH」的残留。
    const direct = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { llm: { provider: 'deepseek', hostProvider: '', model: 'deepseek-chat' } } },
    })
    assert.equal(direct.json.settings.voice.llm.provider, 'deepseek')
    assert.equal(direct.json.settings.voice.llm.hostProvider, '')
  } finally {
    await harness.dispose()
  }
})

// ---------------------------------------------------------------- POST /test/provider

test('POST /test/provider proxies primary and backup probes and keeps failures in the body', async () => {
  const calls = []
  const probeProvider = async (request) => {
    calls.push(request)
    if (request.kind === 'asr') throw new Error('ASR 暂不支持在线测试')
    if (request.source === 'backup' && request.index > 0) {
      throw new Error(`没有第 ${request.index + 1} 个备用服务商`)
    }
    if (request.kind === 'llm') {
      return {
        kind: 'llm',
        provider: 'deepseek',
        model: 'deepseek-chat',
        firstTokenMs: 12,
        totalMs: 34,
        sample: '你好',
      }
    }
    return { kind: 'tts', provider: 'xunfei', voice: 'xiaoyan', bytes: 2048, firstChunkMs: 20, totalMs: 40 }
  }
  const harness = await start({ probeProvider })
  try {
    const primary = await harness.call('/test/provider', { method: 'POST', body: { kind: 'llm', source: 'primary' } })
    assert.equal(primary.status, 200)
    assert.equal(primary.json.ok, true)
    assert.equal(primary.json.provider, 'deepseek')
    assert.equal(primary.json.totalMs, 34)
    assert.equal(typeof primary.json.ms, 'number')
    // index 缺省为 0，并原样交给注入的探针。
    assert.deepEqual(calls[0], { kind: 'llm', source: 'primary', index: 0 })

    const backupOk = await harness.call('/test/provider', {
      method: 'POST',
      body: { kind: 'tts', source: 'backup', index: 0 },
    })
    assert.equal(backupOk.status, 200)
    assert.equal(backupOk.json.ok, true)
    assert.equal(backupOk.json.bytes, 2048)
    assert.deepEqual(calls[1], { kind: 'tts', source: 'backup', index: 0 })

    // 未保存的第 3 条备用：仍是 HTTP 200 + ok:false，控制台据此显示「探测失败」。
    const missing = await harness.call('/test/provider', {
      method: 'POST',
      body: { kind: 'tts', source: 'backup', index: 2 },
    })
    assert.equal(missing.status, 200)
    assert.equal(missing.json.ok, false)
    assert.equal(missing.json.error, '没有第 3 个备用服务商')
    assert.equal(typeof missing.json.ms, 'number')

    // ASR 的不支持由 probeProvider 自己回答，control 不特判。
    const asr = await harness.call('/test/provider', { method: 'POST', body: { kind: 'asr', source: 'primary' } })
    assert.equal(asr.status, 200)
    assert.equal(asr.json.ok, false)
    assert.equal(asr.json.error, 'ASR 暂不支持在线测试')

    // 写接口照旧要 CSRF 头；参数错误在进 probe 之前挡住。
    assert.equal(
      (await harness.call('/test/provider', { method: 'POST', body: { kind: 'llm' }, csrf: false })).status,
      403,
    )
    const beforeInvalid = calls.length
    assert.equal((await harness.call('/test/provider', { method: 'POST', body: { kind: 'asr2' } })).status, 400)
    assert.equal(
      (await harness.call('/test/provider', { method: 'POST', body: { kind: 'llm', source: 'sideways' } })).status,
      400,
    )
    assert.equal(
      (await harness.call('/test/provider', { method: 'POST', body: { kind: 'llm', source: 'backup', index: -1 } }))
        .status,
      400,
    )
    assert.equal(calls.length, beforeInvalid, 'invalid requests must not reach the probe')
  } finally {
    await harness.dispose()
  }
})

test('POST /test/provider is 409 without a probe, and /test/llm keeps its old contract', async () => {
  const offline = await start()
  try {
    const off = await offline.call('/test/provider', { method: 'POST', body: { kind: 'llm', source: 'primary' } })
    assert.equal(off.status, 409)
  } finally {
    await offline.dispose()
  }

  const calls = []
  const online = await start({
    probeLlm: async (prompt) => {
      calls.push(prompt)
      return { provider: 'deepseek', model: 'deepseek-chat', firstTokenMs: 30, totalMs: 80, sample: '你好' }
    },
  })
  try {
    const legacy = await online.call('/test/llm', { method: 'POST' })
    assert.equal(legacy.status, 200)
    assert.equal(legacy.json.ok, true)
    assert.equal(legacy.json.provider, 'deepseek')
    assert.equal(calls.length, 1)
    // 新路由没有把旧路由的注入点顶掉：只注入了 probeLlm 时 /test/provider 仍是 409。
    assert.equal((await online.call('/test/provider', { method: 'POST', body: { kind: 'llm' } })).status, 409)
  } finally {
    await online.dispose()
  }
})

test('ASR resource ID and LLM host provider are accepted on their own patch', async () => {
  const harness = await start()
  try {
    // 这两项曾错误地嵌在 tts 分支里：只发 asr.resourceId / llm.hostProvider 时会被静默忽略。
    const asrOnly = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { asr: { resourceId: 'volc.seedasr.sauc.duration' } } },
    })
    assert.equal(asrOnly.status, 200)
    assert.equal(asrOnly.json.settings.voice.asr.resourceId, 'volc.seedasr.sauc.duration')

    const llmOnly = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { llm: { hostProvider: 'opencode-go' } } },
    })
    assert.equal(llmOnly.status, 200)
    assert.equal(llmOnly.json.settings.voice.llm.hostProvider, 'opencode-go')
  } finally {
    await harness.dispose()
  }
})

test('LLM maxTokens can be set, clamped and cleared', async () => {
  const harness = await start()
  try {
    const initial = await harness.call('/settings')
    assert.equal(initial.json.settings.voice.llm.maxTokens, null, 'unset means "use the plugin default"')

    const saved = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { llm: { maxTokens: 96 } } },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.json.settings.voice.llm.maxTokens, 96)

    const clamped = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { llm: { maxTokens: 1 } } },
    })
    assert.equal(clamped.json.settings.voice.llm.maxTokens, 32, 'too small values clamp to 32 tokens')

    const cleared = await harness.call('/settings', {
      method: 'POST',
      body: { voice: { llm: { maxTokens: null } } },
    })
    assert.equal(cleared.json.settings.voice.llm.maxTokens, null, 'null clears back to the plugin default')
  } finally {
    await harness.dispose()
  }
})

test('removing the first provider promotes the next one (TTS pool semantics)', async () => {
  const harness = await start()
  try {
    await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          tts: {
            provider: 'deepseek',
            apiKey: 'sk-deepseek-pool',
            backups: [
              { provider: 'volc', apiKey: 'volc-pool-key', resourceId: 'seed-tts-2.0' },
              { provider: 'baizhi', apiKey: 'baizhi-pool-key' },
            ],
          },
        },
      },
    })

    // 删「第一家」= 火山（连同凭据）顶上，百智云顺延，旧主用整条消失、不生成空壳。
    const removed = await harness.call('/settings/provider/remove', {
      method: 'POST',
      body: { kind: 'tts', index: 0 },
    })
    assert.equal(removed.status, 200)
    const view = removed.json.settings.voice.tts
    assert.equal(view.provider, 'volc')
    assert.equal(view.hasApiKey, true, '被提升条目的密钥状态跟着它走')
    assert.equal(view.resourceId, 'seed-tts-2.0', '资源族跟着条目走')
    assert.deepEqual(view.backups.map((entry) => entry.provider), ['baizhi'])
    // 密钥不过 HTTP：响应里只有掩码。
    assert.doesNotMatch(JSON.stringify(removed.json), /volc-pool-key|baizhi-pool-key|sk-deepseek-pool/)

    const disk = await readDisk(harness)
    assert.equal(disk.voice.tts.provider, 'volc')
    assert.equal(disk.voice.tts.apiKey, 'volc-pool-key')
    assert.equal(disk.voice.tts.backups[0].provider, 'baizhi')
    assert.equal(disk.voice.tts.backups[0].apiKey, 'baizhi-pool-key')
  } finally {
    await harness.dispose()
  }
})

test('removing a backup keeps the primary, and removing the last one clears the stage', async () => {
  const harness = await start()
  try {
    const saved = await harness.call('/settings', {
      method: 'POST',
      body: {
        voice: {
          tts: { provider: 'deepseek', apiKey: 'sk-only-primary', backups: [{ provider: 'baizhi', apiKey: 'bz-only' }] },
        },
      },
    })
    assert.equal(saved.status, 200)

    // 扁平下标 1 = 第一条备用。
    const removed = await harness.call('/settings/provider/remove', {
      method: 'POST',
      body: { kind: 'tts', index: 1 },
    })
    assert.equal(removed.status, 200)
    assert.equal(removed.json.settings.voice.tts.provider, 'deepseek')
    assert.equal(removed.json.settings.voice.tts.hasApiKey, true)
    assert.deepEqual(removed.json.settings.voice.tts.backups, [])

    // 只剩主用时再删 → 清空该段，不留半份凭据。
    const cleared = await harness.call('/settings/provider/remove', {
      method: 'POST',
      body: { kind: 'tts', index: 0 },
    })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.json.settings.voice.tts.provider, '')
    assert.equal(cleared.json.settings.voice.tts.hasApiKey, false)
    assert.deepEqual(cleared.json.settings.voice.tts.backups, [])
    const disk = await readDisk(harness)
    assert.equal(disk.voice.tts.apiKey, '')
    assert.equal(disk.voice.tts.apiSecret, '')

    // 越界 / 未知环节 / 缺 CSRF 头。
    assert.equal((await harness.call('/settings/provider/remove', { method: 'POST', body: { kind: 'tts', index: 5 } })).status, 400)
    assert.equal((await harness.call('/settings/provider/remove', { method: 'POST', body: { kind: 'voice', index: 0 } })).status, 400)
    assert.equal((await harness.call('/settings/provider/remove', { method: 'POST', body: { kind: 'tts', index: 0 }, csrf: false })).status, 403)
  } finally {
    await harness.dispose()
  }
})
