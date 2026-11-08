import { test } from 'node:test'
import assert from 'node:assert/strict'
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

test('get_weather explains missing key and formats QWeather 3-day data', async () => {
  const missing = createToolRegistry({ toolsConfig: { weather: {} } })
  assert.match(await missing.execute('get_weather', { location: '杭州' }), /未配置/)

  const registry = createToolRegistry({
    toolsConfig: { weather: { key: 'k', host: 'weather.example' } },
    fetchImpl: async (url) => {
      if (url.includes('/geo/v2/city/lookup')) {
        return {
          ok: true,
          async json() {
            return { code: '200', location: [{ id: '101210101', name: '杭州' }] }
          },
        }
      }
      return {
        ok: true,
        async json() {
          return {
            code: '200',
            daily: [{ fxDate: '2026-11-08', textDay: '晴', tempMin: '12', tempMax: '20', windDirDay: '东风', windScaleDay: '2' }],
          }
        },
      }
    },
  })
  const out = await registry.execute('get_weather', { location: '杭州' })
  assert.match(out, /杭州未来 1 天天气/)
  assert.match(out, /晴 12~20℃/)
})
