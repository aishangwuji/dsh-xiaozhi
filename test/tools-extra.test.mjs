import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createToolRegistry } from '../src/tools.js'

test('handle_exit_intent returns a close action with the goodbye line', async () => {
  const registry = createToolRegistry()
  const result = await registry.invoke('handle_exit_intent', { say_goodbye: '拜拜，下次见' })
  assert.equal(result.action, 'close')
  assert.equal(result.response, '拜拜，下次见')
  assert.match(result.output, /退出意图已处理/)
  const fallback = await registry.invoke('handle_exit_intent', {})
  assert.match(fallback.response, /再见/)
})

test('get_lunar returns lunar date, sexagenary year and zodiac', async () => {
  const registry = createToolRegistry({ clock: () => new Date('2026-11-08T12:00:00+08:00') })
  const out = await registry.execute('get_lunar', {})
  assert.match(out, /农历：2026丙午年九月/)
  assert.match(out, /干支年：丙午/)
  assert.match(out, /生肖：马/)
})

test('change_role is gone: role switching lives in the console persona, not as a voice tool', async () => {
  const registry = createToolRegistry()
  // 2026-11-09 按用户要求下掉：角色只由控制台「智能体 → 配置 → 角色 → 人设」配置，
  // 语音侧不再提供切换角色的工具。这条断言防止有人把工具加回来。
  assert.ok(!registry.names().includes('change_role'))
  assert.equal(registry.catalog('agent').some((tool) => tool.name === 'change_role'), false)
})

test('call_device asks the manager API with callerMac and nickname', async () => {
  let request
  const registry = createToolRegistry({
    toolsConfig: { callDevice: { url: 'http://manager.local/api', secret: 's3cret' } },
    fetchImpl: async (url, init) => {
      request = { url, init }
      return { ok: true, async json() { return { code: 0, data: { status: 'ok' } } } }
    },
  })
  const out = await registry.execute('call_device', { nickname: '小陈' }, { deviceId: 'AA:BB:CC' })
  assert.match(out, /正在呼叫小陈/)
  assert.match(request.url, /callerMac=AA%3ABB%3ACC/)
  assert.match(request.url, /nickname=%E5%B0%8F%E9%99%88/)
  assert.equal(request.init.headers.authorization, 'Bearer s3cret')
})

test('hass tools read state, call services and play media', async () => {
  const calls = []
  const json = (data) => ({ ok: true, async json() { return data } })
  const registry = createToolRegistry({
    toolsConfig: { hass: { baseUrl: 'http://ha.local', apiKey: 'ha-key' } },
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (url.includes('/api/states/')) {
        return json({ state: 'on', attributes: { friendly_name: '客厅灯', brightness: 128 } })
      }
      return json({ ok: true })
    },
  })
  const state = await registry.execute('hass_get_state', { entity_id: 'light.living' })
  assert.match(state, /状态：on/)
  assert.match(state, /亮度：50%/)

  const set = await registry.execute('hass_set_state', {
    entity_id: 'light.living',
    state: { type: 'brightness_value', input: 30 },
  })
  assert.match(set, /已执行 brightness_value/)
  const call = calls.find((item) => item.url.includes('/api/services/light/turn_on'))
  assert.deepEqual(JSON.parse(call.init.body), { entity_id: 'light.living', brightness_pct: 30 })

  const music = await registry.execute('hass_play_music', {
    entity_id: 'media_player.living',
    media_content_id: '晴天',
  })
  assert.match(music, /正在播放：晴天/)
})

test('search_from_ragflow posts the question and formats chunks', async () => {
  let request
  const registry = createToolRegistry({
    toolsConfig: { ragflow: { baseUrl: 'http://rag.local', apiKey: 'rag-key', datasetIds: ['ds-1'] } },
    fetchImpl: async (url, init) => {
      request = { url, init }
      return {
        ok: true,
        async json() {
          return { code: 0, data: { chunks: [{ content: '知识库答案 A' }, { content: '知识库答案 B' }] } }
        },
      }
    },
  })
  const out = await registry.execute('search_from_ragflow', { question: '怎么退货' })
  assert.match(out, /知识库答案 A/)
  assert.match(out, /知识库答案 B/)
  assert.equal(request.url, 'http://rag.local/api/v1/retrieval')
  assert.deepEqual(JSON.parse(request.init.body), { question: '怎么退货', dataset_ids: ['ds-1'] })
  assert.equal(request.init.headers.authorization, 'Bearer rag-key')
})

test('play_music finds a local file and returns the play_music action', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-music-'))
  writeFileSync(join(dir, '晴天.mp3'), 'not-real-audio')
  try {
    const registry = createToolRegistry({ toolsConfig: { music: { dir, extensions: ['.mp3'] } } })
    const result = await registry.invoke('play_music', { song_name: '晴天' })
    assert.equal(result.action, 'play_music')
    assert.equal(result.title, '晴天')
    assert.match(result.file, /晴天\.mp3$/)
    assert.match(result.output, /正在为您播放/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('get_news_from_newsnow reads the newsnow items shape', async () => {
  const calls = []
  const registry = createToolRegistry({
    toolsConfig: { newsnow: { url: 'https://news.example/api?id=', sources: '澎湃新闻' } },
    fetchImpl: async (url) => {
      calls.push(url)
      return {
        ok: true,
        async json() {
          return { items: [{ title: '测试新闻标题', url: 'https://news.example/a' }] }
        },
      }
    },
  })
  const out = await registry.execute('get_news_from_newsnow', { source: '澎湃新闻' })
  assert.match(out, /测试新闻标题/)
  assert.match(calls[0], /id=thepaper/)
})

test('get_weather is gone: it needs a QWeather key the user does not want to configure', async () => {
  // 2026-11-09 按用户要求下掉：天气要配 QWeather API Key，用户明确不用。
  // 这条断言防止有人把工具加回来（加回来之前先回答：Key 从哪来、没 Key 时为什么还要注册）。
  const registry = createToolRegistry()
  assert.ok(!registry.names().includes('get_weather'))
  assert.equal(registry.catalog('agent').some((tool) => tool.name === 'get_weather'), false)
})
