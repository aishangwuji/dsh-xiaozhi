/**
 * 工具注册表 —— 对齐 Python 版服务端 `plugins_func/register.py` 的设计：
 * 每个工具声明 OpenAI function-calling 的 JSON Schema，`run()` 返回文本，
 * 作为 `role: "tool"` 消息回灌给模型。
 *
 * 联网工具走 DeepSeek 官方 Search / Fetch API（Bearer 鉴权，按成功请求计费）：
 *   - `web_search`：`POST /v1/tools/search`，固定 `need_content: true`，回传正文摘录；
 *   - `web_fetch`：`POST /v1/tools/fetch`，抓单个网页返回 Markdown 正文。
 * 没配 DeepSeek Key 时 `web_search` 退回 Harness 自带的 `ctx.web.search`（工具始终可用），
 * `web_fetch` 明确回报「不可用」而不是静默失败。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 一次对话里最多跑几轮工具，防止模型自己绕圈。 */
export const MAX_TOOL_ROUNDS = 3

export const DEEPSEEK_SEARCH_URL = 'https://api.deepseek.com/v1/tools/search'
export const DEEPSEEK_FETCH_URL = 'https://api.deepseek.com/v1/tools/fetch'

const pad = (value) => String(value).padStart(2, '0')

function formatTime(date) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return (
    `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${weekdays[date.getDay()]}`
  )
}

/** 与 Python 版一致的三个新闻频道；换源只需要改这张表。 */
export const NEWS_CHANNELS = {
  society: { label: '社会', url: 'https://www.chinanews.com.cn/rss/society.xml' },
  world: { label: '国际', url: 'https://www.chinanews.com.cn/rss/world.xml' },
  finance: { label: '财经', url: 'https://www.chinanews.com.cn/rss/finance.xml' },
}

const CATEGORY_ALIASES = {
  社会: 'society',
  社会新闻: 'society',
  国际: 'world',
  国际新闻: 'world',
  财经: 'finance',
  财经新闻: 'finance',
  金融: 'finance',
  经济: 'finance',
}

function pickChannel(category) {
  const key = String(category ?? '').trim()
  if (!key) return 'society'
  return CATEGORY_ALIASES[key] ?? (key in NEWS_CHANNELS ? key : 'society')
}

/** 极简 RSS 解析：只取 item 里的 title/description，够播报用，不引依赖。 */
export function parseRss(xml, limit = 5) {
  const items = []
  const blocks = String(xml ?? '').match(/<item[\s>][\s\S]*?<\/item>/g) ?? []
  for (const block of blocks) {
    const clean = (text) =>
      String(text ?? '')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
    const title = clean(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1])
    if (!title) continue
    items.push({ title, description: clean(/<description>([\s\S]*?)<\/description>/.exec(block)?.[1]).slice(0, 160) })
    if (items.length >= limit) break
  }
  return items
}

/**
 * 把 DeepSeek Search 的返回压成模型好读的文本。
 *
 * 2026-11-07 之前只回标题 + 摘要，模型拿不到网页正文，只能复述搜索片段——用户体感
 * 就是「搜得到、但读不到里面写了什么」。现在搜索请求固定 `need_content: true`，
 * 这里把 `content` 一起带上（每条截断、总量封顶），模型才能真正基于正文回答；
 * 需要更细的内容时再调 `web_fetch` 抓单个 URL。
 *
 * 预算：语音链路一次工具回灌最多 4000 字符（invoke() 兜底），这里按 maxChars 主动
 * 收口，避免后面的结果被硬截断：
 *   - 每条：摘要 ≤ summaryChars、正文 ≤ contentChars；
 *   - 整批：≤ maxChars（放不下就不再加下一条，保证每条都是完整的）。
 */
export function formatSearchResults(
  body,
  limit = 5,
  { summaryChars = 400, contentChars = 900, maxChars = 3800 } = {},
) {
  const results = Array.isArray(body?.results) ? body.results : []
  const blocks = []
  let used = 0
  for (const result of results.slice(0, limit)) {
    const title = String(result?.title ?? '').trim()
    const url = String(result?.url ?? '').trim()
    const summary = String(result?.summary ?? result?.snippet ?? '').trim().slice(0, summaryChars)
    // 正文常带换行/空白，压成单行再截断，省 token 也让 Log 好读。
    const content = String(result?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, contentChars)
    if (!title && !summary && !content) continue
    const block = [
      `${blocks.length + 1}. ${title || url}`,
      url ? `   ${url}` : '',
      summary ? `   摘要：${summary}` : '',
      content ? `   正文：${content}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    if (used + block.length > maxChars) break
    blocks.push(block)
    used += block.length
  }
  return blocks.join('\n\n')
}

/**
 * @param {{web?: {search?: Function, fetch?: Function}, clock?: () => Date,
 *          searchApiKey?: string | (() => string), searchBaseUrl?: string, fetchUrl?: string,
 *          fetchImpl?: Function}} options
 *   `searchApiKey` 允许传函数：运行时设置是异步加载的，工具注册发生在它之前；
 *   用 getter 才能让「控制台刚保存的 DeepSeek Key」在下一句话就生效，不需要重启。
 */
export function createToolRegistry({
  web,
  clock = () => new Date(),
  searchApiKey = '',
  searchBaseUrl = DEEPSEEK_SEARCH_URL,
  fetchUrl = DEEPSEEK_FETCH_URL,
  fetchImpl,
  // 按设备判定某个工具是否被关闭：不同设备的扩展能力互相隔离。
  isDisabled = () => false,
} = {}) {
  const tools = new Map()
  const doFetch = fetchImpl ?? globalThis.fetch
  const hasLocalSearch = typeof web?.search === 'function'
  const hasLocalFetch = typeof web?.fetch === 'function'
  /** 每次调用时再取，保证运行时改 Key 立即生效。 */
  const currentSearchKey = () =>
    typeof searchApiKey === 'function' ? String(searchApiKey() ?? '') : String(searchApiKey ?? '')
  const hasRemoteSearch = () => Boolean(currentSearchKey()) && typeof doFetch === 'function'

  function register(tool) {
    if (!tool?.name || typeof tool.run !== 'function') {
      throw new Error('tool 需要 name 与 run()')
    }
    tools.set(tool.name, { toolType: 'wait', action: 'reqlm', ...tool })
    return () => tools.delete(tool.name)
  }

  register({
    name: 'get_current_time',
    description: '获取当前日期和时间。当用户问“现在几点”“今天几号”“星期几”时使用。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => formatTime(clock()),
  })

  if (typeof doFetch === 'function' || hasLocalSearch) {
    register({
      name: 'web_search',
      description:
        '联网搜索最新信息。当用户问新闻、天气、实时数据、你不确定或可能过时的事情时使用。' +
        '返回每条结果的标题、链接、摘要和网页正文摘录，可以直接据此回答；' +
        'query 支持 site:/lang:/after:/before: 等搜索语法。' +
        '如果正文摘录不足以回答，再用 web_fetch 抓取最相关的 1~2 个链接读全文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词，尽量具体，例如“杭州 明天 天气”' },
          count: {
            type: 'integer',
            description: '返回条数 1~10，默认 5。问题越宽泛可以取越多。',
            minimum: 1,
            maximum: 10,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async run({ query, count } = {}, { signal } = {}) {
        const keyword = String(query ?? '').trim()
        if (!keyword) return '搜索关键词为空'
        const limit = Math.min(10, Math.max(1, Number.isInteger(Number(count)) ? Number(count) : 5))

        if (hasRemoteSearch()) {
          const response = await doFetch(searchBaseUrl, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${currentSearchKey()}`,
              'content-type': 'application/json',
            },
            // need_content=true：按次计费不变（Search 只按成功请求收费），
            // 换到的是模型能直接读的正文，不再只是复述摘要。
            body: JSON.stringify({ query: keyword, count: limit, need_content: true }),
            signal,
          })
          if (!response.ok) {
            const detail = await response.text().catch(() => '')
            return `搜索失败：HTTP ${response.status} ${detail.slice(0, 120)}`
          }
          const body = await response.json()
          const text = formatSearchResults(body, limit)
          return text || '没有搜到相关结果'
        }

        if (hasLocalSearch) {
          const result = await web.search({ query: keyword })
          const summary = String(result?.summary ?? '').trim()
          const sources = (result?.sources ?? [])
            .slice(0, limit)
            .map((source) => (typeof source === 'string' ? source : source?.url ?? ''))
            .filter(Boolean)
          return (
            [summary, sources.length ? `来源：${sources.join(' ')}` : ''].filter(Boolean).join('\n').slice(0, 2000) ||
            '没有搜到结果'
          )
        }

        return '搜索不可用：还没有配置 DeepSeek API Key'
      },
    })
  }

  if (typeof doFetch === 'function' || hasLocalFetch) {
    register({
      name: 'web_fetch',
      description:
        '抓取一个网页并返回正文（Markdown）。当搜索摘要/正文摘录不够、用户给了链接、' +
        '或需要看页面具体内容（价格、原文、公告、文档）时使用。一次只抓一个 URL；' +
        '优先抓搜索结果里最相关的那条。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的 http/https 网页地址' },
          max_chars: {
            type: 'integer',
            description: '正文最多返回多少字符，默认 3000，范围 500~3500',
            minimum: 500,
            maximum: 3500,
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      async run({ url, max_chars: maxChars } = {}, { signal } = {}) {
        const target = String(url ?? '').trim()
        if (!/^https?:\/\//i.test(target)) return '抓取失败：url 必须是 http/https 地址'
        const cap = Math.min(3500, Math.max(500, Number.isInteger(Number(maxChars)) ? Number(maxChars) : 3000))

        // 有 DeepSeek Key 走官方 Fetch（Markdown 正文、按成功请求计费）；
        // 没有 Key 时退回宿主 web.fetch（如果装配了），否则明确说不可用。
        if (hasRemoteSearch()) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 20_000)
          timer.unref?.()
          const onAbort = () => controller.abort()
          signal?.addEventListener?.('abort', onAbort, { once: true })
          try {
            const response = await doFetch(fetchUrl, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${currentSearchKey()}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({ url: target }),
              signal: controller.signal,
            })
            if (!response.ok) {
              const detail = await response.text().catch(() => '')
              if (response.status === 403) return `抓取失败：目标站点被安全策略拒绝（HTTP 403）`
              if (response.status === 404) return `抓取失败：无法从 ${target} 提取正文（HTTP 404，可能被站点拦截或页面无可读内容）`
              return `抓取失败：HTTP ${response.status} ${detail.slice(0, 120)}`
            }
            const page = await response.json()
            const title = String(page?.title ?? '').trim()
            const content = String(page?.content ?? '').replace(/\r\n/g, '\n').trim()
            if (!content) return `抓取失败：${target} 没有可提取的正文`
            const excerpt = content.slice(0, cap)
            return `${title ? `${title}\n\n` : ''}${excerpt}${content.length > cap ? '\n…（正文过长已截断）' : ''}`
          } catch (error) {
            if (signal?.aborted) return '抓取已取消'
            return `抓取失败：${error?.message ?? error}`
          } finally {
            clearTimeout(timer)
            signal?.removeEventListener?.('abort', onAbort)
          }
        }

        if (hasLocalFetch) {
          const page = await web.fetch({ url: target })
          const content = String(page?.content ?? page?.text ?? '').trim()
          if (!content) return `抓取失败：${target} 没有可提取的正文`
          return content.slice(0, cap)
        }
        return '抓取不可用：还没有配置 DeepSeek API Key'
      },
    })
  }

  if (doFetch) {
    register({
      name: 'get_news_from_chinanews',
      description:
        '当用户要求查看或收听新闻时调用（如“来条新闻”“今天有什么新闻”）。' +
        '可以指定类别：社会、国际、财经；不指定时是社会新闻。',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: '新闻类别：社会、国际、财经；不传默认社会' },
        },
        additionalProperties: false,
      },
      async run({ category } = {}, { signal } = {}) {
        const channel = pickChannel(category)
        const source = NEWS_CHANNELS[channel]
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        timer.unref?.()
        const onAbort = () => controller.abort()
        signal?.addEventListener?.('abort', onAbort, { once: true })
        try {
          const response = await doFetch(source.url, {
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-xiaozhi/1.0)' },
            signal: controller.signal,
          })
          if (!response.ok) return `新闻源返回 HTTP ${response.status}`
          const items = parseRss(await response.text(), 5)
          if (items.length === 0) return '暂时没有取到新闻'
          return [`${source.label}新闻：`, ...items.map((item, index) => `${index + 1}. ${item.title}`)].join('\n')
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener?.('abort', onAbort)
        }
      },
    })
  }

  return {
    names: () => [...tools.keys()],

    /** 控制台展示用：名字、分类与说明。 */
    catalog(deviceId) {
      return [...tools.values()].map((tool) => ({
        name: tool.name,
        toolType: tool.toolType,
        action: tool.action,
        description: tool.description,
        enabled: !isDisabled(tool.name, deviceId),
      }))
    },

    isEnabled: (name, deviceId) => !isDisabled(name, deviceId),

    definitions(deviceId) {
      return [...tools.values()].filter((tool) => !isDisabled(tool.name, deviceId)).map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
        },
      }))
    },

    /** `{ output, action, response }`；失败也返回文本，让模型自己圆场。 */
    async invoke(name, args, options) {
      const tool = tools.get(name)
      if (!tool) return { output: `没有名为 ${name} 的工具`, action: 'reqlm', response: '' }
      try {
        const value = await tool.run(args ?? {}, options ?? {})
        if (value && typeof value === 'object' && typeof value.output === 'string') {
          return { output: value.output, action: value.action ?? tool.action, response: value.response ?? '' }
        }
        return { output: String(value ?? '').slice(0, 4000), action: tool.action, response: '' }
      } catch (error) {
        return { output: `工具 ${name} 执行失败：${error?.message ?? error}`, action: 'reqlm', response: '' }
      }
    },

    async execute(name, args, options) {
      return (await this.invoke(name, args, options)).output
    },
  }
}

import { readFileSync } from 'node:fs'

/** 同步读取（apply() 不是 async，启动时没有 await 的机会）。 */
export function loadToolPrefsSync(file) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return new Set(Array.isArray(raw?.disabled) ? raw.disabled.filter((name) => typeof name === 'string') : [])
  } catch {
    return new Set()
  }
}

/** 读取被关闭的工具名单；文件不存在视为全部启用。 */
export async function loadToolPrefs(file) {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    return new Set(Array.isArray(raw?.disabled) ? raw.disabled.filter((name) => typeof name === 'string') : [])
  } catch {
    return new Set()
  }
}

/** 落盘被关闭的工具名单（原子写）。 */
export async function saveToolPrefs(file, disabled) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify({ disabled: [...disabled] }, null, 2), { mode: 0o600 })
  await rename(temp, file)
}