import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createToolRegistry,
  formatSearchResults,
  parseRss,
  DEEPSEEK_FETCH_URL,
  DEEPSEEK_SEARCH_URL,
} from '../src/tools.js'

/** 构造一个假 fetch：按 URL 返回 search / fetch 两种响应。 */
function fakeFetch({ search, fetchPage, calls = [] } = {}) {
  return async (url, init) => {
    calls.push({ url, init })
    if (url === DEEPSEEK_SEARCH_URL) return search()
    if (url === DEEPSEEK_FETCH_URL) return fetchPage()
    throw new Error(`unexpected url ${url}`)
  }
}

test('web_search asks for page content and formats it for the model', async () => {
  const calls = []
  const registry = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: fakeFetch({
      calls,
      search: async () => ({
        ok: true,
        async json() {
          return {
            results: [
              {
                title: '杭州天气',
                url: 'https://example.com/a',
                summary: '明天多云 18 度',
                content: '杭州市气象台发布：明天多云，最高气温 18 度，东北风 2 级。',
              },
              { title: '空结果', url: '' },
            ],
          }
        },
      }),
    }),
  })

  assert.ok(registry.names().includes('web_search'))
  const out = await registry.execute('web_search', { query: '杭州 天气' })
  assert.match(out, /杭州天气/)
  assert.match(out, /明天多云/)
  assert.match(out, /正文：.*18 度/, '正文必须进工具回灌，否则模型只能复述摘要')
  assert.equal(calls[0].url, DEEPSEEK_SEARCH_URL)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: '杭州 天气', count: 5, need_content: true })
})

test('web_search honours the optional count parameter (clamped to 1..10)', async () => {
  const calls = []
  const registry = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: fakeFetch({
      calls,
      search: async () => ({ ok: true, async json() { return { results: [] } } }),
    }),
  })
  await registry.execute('web_search', { query: 'x', count: 3 })
  assert.equal(JSON.parse(calls[0].init.body).count, 3)
  await registry.execute('web_search', { query: 'x', count: 99 })
  assert.equal(JSON.parse(calls[1].init.body).count, 10)
  await registry.execute('web_search', { query: 'x', count: 0 })
  assert.equal(JSON.parse(calls[2].init.body).count, 1)
})

test('search failures are reported as text so the model can apologise', async () => {
  const registry = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
  })
  assert.match(await registry.execute('web_search', { query: 'x' }), /HTTP 429/)
})

test('without a DeepSeek key it falls back to the host web service', async () => {
  const registry = createToolRegistry({
    web: { search: async () => ({ summary: '来自宿主搜索', sources: ['https://a'] }) },
  })
  const out = await registry.execute('web_search', { query: 'x' })
  assert.match(out, /来自宿主搜索/)
})

test('search key can be a getter: a key saved after registration takes effect immediately', async () => {
  let key = ''
  const calls = []
  const registry = createToolRegistry({
    searchApiKey: () => key,
    fetchImpl: fakeFetch({
      calls,
      search: async () => ({ ok: true, async json() { return { results: [{ title: 'T', summary: 'S' }] } } }),
    }),
  })
  // 注册时没有 Key：工具仍然存在，调用明确说不可用（而不是悄悄消失）。
  assert.ok(registry.names().includes('web_search'))
  assert.match(await registry.execute('web_search', { query: 'x' }), /还没有配置 DeepSeek API Key/)

  key = 'sk-later'
  assert.match(await registry.execute('web_search', { query: 'x' }), /1\. T/)
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-later')
})

test('web_fetch posts the URL and returns title + markdown content', async () => {
  const calls = []
  const registry = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: fakeFetch({
      calls,
      fetchPage: async () => ({
        ok: true,
        async json() {
          return {
            title: 'Example article',
            content: '# Example article\n\nArticle content.',
          }
        },
      }),
    }),
  })

  assert.ok(registry.names().includes('web_fetch'))
  const out = await registry.execute('web_fetch', { url: 'https://example.com/article' })
  assert.match(out, /Example article/)
  assert.match(out, /Article content/)
  assert.equal(calls[0].url, DEEPSEEK_FETCH_URL)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://example.com/article' })
})

test('web_fetch trims long content and explains 403/404 in plain language', async () => {
  const registry = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: fakeFetch({
      fetchPage: async () => ({
        ok: true,
        async json() {
          return { title: '', content: 'x'.repeat(9000) }
        },
      }),
    }),
  })
  const out = await registry.execute('web_fetch', { url: 'https://example.com/long', max_chars: 500 })
  assert.match(out, /…（正文过长已截断）/)
  assert.ok(out.length < 600, `cap should apply, got ${out.length}`)

  const denied = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'denied' }),
  })
  assert.match(await denied.execute('web_fetch', { url: 'https://x.test' }), /安全策略拒绝/)

  const missing = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => 'no content' }),
  })
  assert.match(await missing.execute('web_fetch', { url: 'https://x.test' }), /无法从 .* 提取正文/)
})

test('web_fetch rejects non-http URLs before any network call', async () => {
  const calls = []
  const registry = createToolRegistry({
    searchApiKey: 'sk-test',
    fetchImpl: fakeFetch({ calls, fetchPage: async () => ({ ok: true, json: async () => ({}) }) }),
  })
  assert.match(await registry.execute('web_fetch', { url: 'file:///etc/passwd' }), /必须是 http\/https/)
  assert.equal(calls.length, 0)
})

test('news tool parses the chinanews RSS shape', async () => {
  const rss = `<rss><channel>
    <item><title><![CDATA[第一条新闻]]></title><description>摘要一</description></item>
    <item><title>第二条新闻</title><description>摘要二</description></item>
  </channel></rss>`
  const registry = createToolRegistry({
    fetchImpl: async () => ({ ok: true, text: async () => rss }),
  })
  const out = await registry.execute('get_news_from_chinanews', { category: '国际' })
  assert.match(out, /国际新闻/)
  assert.match(out, /1\. 第一条新闻/)
  assert.match(out, /2\. 第二条新闻/)
  assert.deepEqual(parseRss(rss).map((i) => i.title), ['第一条新闻', '第二条新闻'])
})

test('formatSearchResults degrades gracefully and respects the total budget', () => {
  assert.equal(formatSearchResults({ results: [] }), '')
  assert.equal(formatSearchResults(null), '')
  assert.match(formatSearchResults({ results: [{ title: 'T', summary: 'S' }] }), /1\. T/)
  const long = {
    results: Array.from({ length: 5 }, (_, index) => ({
      title: `T${index}`,
      url: `https://e/${index}`,
      summary: 's'.repeat(400),
      content: 'c'.repeat(900),
    })),
  }
  const text = formatSearchResults(long, 5)
  assert.ok(text.length <= 3800, `total budget exceeded: ${text.length}`)
})
