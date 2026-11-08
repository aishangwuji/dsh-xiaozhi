import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolRegistry } from '../src/tools.js'

test('get_lunar returns lunar date, sexagenary year and zodiac', async () => {
  const registry = createToolRegistry({ clock: () => new Date('2026-11-08T12:00:00+08:00') })
  const out = await registry.execute('get_lunar', {})
  assert.match(out, /农历：2026丙午年九月/)
  assert.match(out, /干支年：丙午/)
  assert.match(out, /生肖：马/)
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
