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
import { basename, dirname, extname, join } from 'node:path'

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
  toolsConfig = {},
  // 按设备判定某个工具是否被关闭：不同设备的扩展能力互相隔离。
  isDisabled = () => false,
} = {}) {
  const tools = new Map()
  // 外部 MCP server 工具（`src/mcp/manager.js`）与入站 `/mcp` 工具在启动后异步接入；这里只做合并。
  let external = null
  let inbound = null
  const doFetch = fetchImpl ?? globalThis.fetch
  const hasLocalSearch = typeof web?.search === 'function'
  const hasLocalFetch = typeof web?.fetch === 'function'
  /** 每次调用时再取，保证运行时改 Key 立即生效。 */
  const currentSearchKey = () =>
    typeof searchApiKey === 'function' ? String(searchApiKey() ?? '') : String(searchApiKey ?? '')
  const hasRemoteSearch = () => Boolean(currentSearchKey()) && typeof doFetch === 'function'

  // 官方 newsnow 的新闻源映射（只收常用的一批，未知名字按原样当 id）。
  const NEWSNOW_CHANNELS = {
    V2EX: 'v2ex-share',
    知乎: 'zhihu',
    微博: 'weibo',
    联合早报: 'zaobao',
    酷安: 'coolapk',
    华尔街见闻: 'wallstreetcn-quick',
    '36氪': '36kr-quick',
    抖音: 'douyin',
    虎扑: 'hupu',
    百度贴吧: 'tieba',
    今日头条: 'toutiao',
    'IT之家': 'ithome',
    澎湃新闻: 'thepaper',
    参考消息: 'cankaoxiaoxi',
    财联社: 'cls-depth',
    雪球: 'xueqiu-hotstock',
    'Hacker News': 'hackernews',
    'Product Hunt': 'producthunt',
    GitHub: 'github-trending-today',
    哔哩哔哩: 'bilibili-hot-search',
    百度热搜: 'baidu',
    少数派: 'sspai',
    稀土掘金: 'juejin',
    凤凰网: 'ifeng',
  }
  const lastNewsByDevice = new Map()

  const stripHtml = (html) =>
    String(html ?? '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()

  const fetchJson = async (url, { signal, timeoutMs = 8000, method = 'GET', body, headers } = {}) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    const onAbort = () => controller.abort()
    signal?.addEventListener?.('abort', onAbort, { once: true })
    try {
      const response = await doFetch(url, {
        method,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; dsh-xiaozhi/1.0)',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(headers ?? {}),
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) return { error: `HTTP ${response.status}` }
      return { data: await response.json() }
    } catch (error) {
      return { error: error?.message ?? String(error) }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }
  }

  register({
    name: 'handle_exit_intent',
    description:
      '当用户明确表示要结束对话、说再见或要关闭设备时调用。调用后直接播报告别语并断开连接，' +
      '不要再用普通回复继续聊天。',
    parameters: {
      type: 'object',
      properties: {
        say_goodbye: { type: 'string', description: '和用户友好结束对话的告别语' },
      },
      additionalProperties: false,
    },
    run({ say_goodbye } = {}) {
      return {
        output: '退出意图已处理',
        action: 'close',
        response: String(say_goodbye ?? '').trim() || '再见，祝您生活愉快！',
      }
    },
  })

  const musicConfig = toolsConfig.music ?? {}
  const musicDir = String(musicConfig.dir ?? './music')
  const musicExtensions = (Array.isArray(musicConfig.extensions) ? musicConfig.extensions : ['.mp3', '.wav', '.p3'])
    .map((ext) => String(ext).toLowerCase())
  const similarity = (left, right) => {
    const a = String(left).toLowerCase().trim()
    const b = String(right).toLowerCase().trim()
    if (!a || !b) return 0
    if (a === b) return 1
    if (b.includes(a) || a.includes(b)) return 0.8
    const chars = new Set(b)
    let hit = 0
    for (const char of a) if (chars.has(char)) hit += 1
    return hit / Math.max(a.length, b.length)
  }
  if (musicDir && existsSync(musicDir)) {
    register({
      name: 'play_music',
      description: '当用户要求播放音乐、歌曲时调用。可以从本地音乐目录里按歌名匹配，未指定歌名时随机播放。',
      parameters: {
        type: 'object',
        properties: {
          song_name: {
            type: 'string',
            description: '歌曲名称；用户没指定具体歌名时填 random',
          },
        },
        required: ['song_name'],
        additionalProperties: false,
      },
      run({ song_name } = {}) {
        let files = []
        try {
          files = readdirSync(musicDir, { recursive: true })
            .map((entry) => String(entry))
            .filter((entry) => musicExtensions.includes(extname(entry).toLowerCase()))
        } catch (error) {
          return `读取音乐目录失败：${error?.message ?? error}`
        }
        if (files.length === 0) return '音乐目录里没有找到音频文件'
        const requested = String(song_name ?? 'random').trim()
        let picked = ''
        if (!requested || requested.toLowerCase() === 'random') {
          picked = files[Math.floor(Math.random() * files.length)]
        } else {
          const scored = files
            .map((file) => ({ file, score: similarity(requested, basename(file, extname(file))) }))
            .sort((left, right) => right.score - left.score)
          if (!scored[0] || scored[0].score < 0.4) return `没有找到《${requested}》`
          picked = scored[0].file
        }
        const title = basename(picked, extname(picked))
        const file = join(musicDir, picked)
        return {
          output: `正在为您播放《${title}》`,
          action: 'play_music',
          response: `正在为您播放《${title}》`,
          file,
          title,
        }
      },
    })
  }

  register({
    name: 'get_lunar',
    description:
      '查询农历日期、干支年、生肖与星期。用户问“今天农历多少”“某天农历”时用；' +
      '宜忌/节气/八字等完整黄历信息当前不提供。',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD；不传用今天' },
        query: { type: 'string', description: '想查的内容，例如农历日期、干支、生肖' },
      },
      additionalProperties: false,
    },
    async run({ date, query } = {}) {
      const now = date ? new Date(`${date}T12:00:00+08:00`) : clock()
      if (Number.isNaN(now.getTime())) return '日期格式错误，请使用 YYYY-MM-DD，例如 2026-11-08'
      let parts = []
      try {
        parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        }).formatToParts(now)
      } catch {
        return `无法获取农历：当前运行环境不支持中国农历日历（${now.toISOString().slice(0, 10)}）`
      }
      const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
      const yearName = get('yearName')
      const branch = yearName.slice(-1)
      const zodiac = '子鼠丑牛寅虎卯兔辰龙巳蛇午马未羊申猴酉鸡戌狗亥猪'
      const zodiacIndex = zodiac.indexOf(branch)
      const animal = zodiacIndex >= 0 ? zodiac[zodiacIndex + 1] : ''
      return [
        `农历：${get('relatedYear')}${yearName}年${get('month')}${get('day')}`,
        `干支年：${yearName}`,
        animal ? `生肖：${animal}` : '',
        get('weekday') ? `星期：${get('weekday')}` : '',
        query ? `（${query}：当前仅提供农历/干支/生肖/星期，宜忌与节气暂不支持）` : '',
      ].filter(Boolean).join('\n')
    },
  })

  if (doFetch) {
    register({
      name: 'get_news_from_newsnow',
      description:
        '当用户要求查看或收听新闻时调用（如“来条新闻”“今天有什么新闻”）。' +
        '可指定新闻源（澎湃新闻、百度热搜、财联社、知乎、微博、36氪、IT之家等）；不指定时用默认源。',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '新闻源中文名，例如 澎湃新闻 / 百度热搜 / 财联社' },
          detail: { type: 'boolean', description: 'true = 抓取上一条新闻的详细正文' },
          lang: { type: 'string', description: '语言 code，默认 zh_CN' },
        },
        additionalProperties: false,
      },
      async run({ source = '', detail = false, lang = 'zh_CN' } = {}, { signal, deviceId } = {}) {
        const key = deviceId || ''
        if (detail === true || String(detail).toLowerCase() === 'true') {
          const last = lastNewsByDevice.get(key)
          if (!last?.url) return '还没有上一条新闻，先让我播一条新闻吧'
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 8000)
          timer.unref?.()
          try {
            const response = await doFetch(last.url, {
              headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-xiaozhi/1.0)' },
              signal: controller.signal,
            })
            if (!response.ok) return `新闻详情返回 HTTP ${response.status}`
            const text = stripHtml(await response.text()).slice(0, 3000)
            return text || '无法解析新闻详情内容'
          } catch (error) {
            return `获取新闻详情失败：${error?.message ?? error}`
          } finally {
            clearTimeout(timer)
          }
        }
        const config = toolsConfig.newsnow ?? {}
        const configured = String(config.sources ?? '澎湃新闻;百度热搜;财联社')
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean)
        const picked =
          String(source || '').trim() ||
          configured[Math.floor(Math.random() * Math.max(1, configured.length))] ||
          '澎湃新闻'
        const id = NEWSNOW_CHANNELS[picked] ?? picked
        const base = String(config.url || 'https://newsnow.busiyi.world/api/s?id=')
        const url = base.includes('{source}')
          ? base.replace('{source}', encodeURIComponent(id))
          : (() => {
              const target = new URL(base)
              target.searchParams.set('id', id)
              return target.toString()
            })()
        const { data, error } = await fetchJson(url, { signal })
        if (error) return `新闻源请求失败：${error}`
        const items = Array.isArray(data?.items) ? data.items.filter((item) => item && item.title) : []
        if (items.length === 0) return `新闻源 ${picked} 暂时没有内容`
        const item = items[Math.floor(Math.random() * items.length)]
        lastNewsByDevice.set(key, { title: item.title, url: item.url ?? item.mobileUrl ?? '' })
        const extra = String(item.extra ?? item.desc ?? '').trim()
        return [
          `【${picked}】${item.title}`,
          extra ? `摘要：${extra.slice(0, 200)}` : '',
          lang && lang !== 'zh_CN' ? `（lang=${lang}）` : '',
        ]
          .filter(Boolean)
          .join('\n')
      },
    })

    const hassConfig = toolsConfig.hass ?? {}
    const hassBase = String(hassConfig.baseUrl ?? '').replace(/\/$/, '')
    const hassKey = String(hassConfig.apiKey ?? '').trim()
    if (hassBase && hassKey) {
      const hassHeaders = { authorization: `Bearer ${hassKey}` }
      const hassCall = (path, { method = 'GET', body } = {}) =>
        fetchJson(`${hassBase}${path}`, { method, body, headers: hassHeaders, timeoutMs: 10_000 })
      const describeState = (data) => {
        if (!data || typeof data !== 'object') return '没有取到设备状态'
        const attributes = data.attributes && typeof data.attributes === 'object' ? data.attributes : {}
        const bits = [`状态：${data.state ?? '未知'}`]
        if (attributes.friendly_name) bits.push(`名称：${attributes.friendly_name}`)
        if (Number.isFinite(Number(attributes.brightness))) {
          bits.push(`亮度：${Math.round((Number(attributes.brightness) / 255) * 100)}%`)
        }
        if (Number.isFinite(Number(attributes.color_temp_kelvin))) bits.push(`色温：${attributes.color_temp_kelvin}K`)
        if (Number.isFinite(Number(attributes.volume_level))) {
          bits.push(`音量：${Math.round(Number(attributes.volume_level) * 100)}%`)
        }
        if (attributes.media_title) bits.push(`正在播放：${attributes.media_title}`)
        return bits.join('，')
      }

      register({
        name: 'hass_get_state',
        description:
          '获取 Home Assistant 里设备的状态（灯光亮度/颜色/色温、媒体播放器音量、播放内容、开关状态）。',
        parameters: {
          type: 'object',
          properties: { entity_id: { type: 'string', description: 'Home Assistant 的 entity_id' } },
          required: ['entity_id'],
          additionalProperties: false,
        },
        async run({ entity_id } = {}, { signal } = {}) {
          const entity = String(entity_id ?? '').trim()
          if (!entity) return '请提供 Home Assistant 的 entity_id'
          const result = await fetchJson(`${hassBase}/api/states/${encodeURIComponent(entity)}`, {
            headers: hassHeaders,
            signal,
            timeoutMs: 8000,
          })
          if (result.error) return `获取设备状态失败：${result.error}`
          return describeState(result.data)
        },
      })

      register({
        name: 'hass_set_state',
        description:
          '设置 Home Assistant 设备状态：开/关、亮度、颜色、色温、音量、静音、暂停/继续。',
        parameters: {
          type: 'object',
          properties: {
            entity_id: { type: 'string', description: 'Home Assistant 的 entity_id' },
            state: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  description:
                    'turn_on / turn_off / brightness_up / brightness_down / brightness_value / volume_up / volume_down / volume_set / volume_mute / set_kelvin / set_color / pause / continue',
                },
                input: { type: 'integer', description: '亮度或音量 1-100；色温用 Kelvin' },
                is_muted: { type: 'boolean', description: '静音时为 true，取消静音为 false' },
                rgb_color: { type: 'array', items: { type: 'integer' }, description: 'RGB 三元组' },
              },
              required: ['type'],
            },
          },
          required: ['entity_id', 'state'],
          additionalProperties: false,
        },
        async run({ entity_id, state } = {}, { signal } = {}) {
          const entity = String(entity_id ?? '').trim()
          const type = String(state?.type ?? '').trim()
          if (!entity) return '请提供 Home Assistant 的 entity_id'
          if (!type) return '请提供要执行的动作类型'
          const input = Number(state?.input)
          const service = async (domain, name, body) => {
            const result = await hassCall(`/api/services/${domain}/${name}`, { method: 'POST', body })
            if (result.error) throw new Error(result.error)
            return result.data
          }
          try {
            if (type === 'turn_on' || type === 'turn_off') {
              await service('homeassistant', type, { entity_id: entity })
            } else if (type === 'brightness_up' || type === 'brightness_down') {
              const current = await fetchJson(`${hassBase}/api/states/${encodeURIComponent(entity)}`, {
                headers: hassHeaders,
                signal,
                timeoutMs: 8000,
              })
              const raw = Number(current.data?.attributes?.brightness)
              const base = Number.isFinite(raw) ? Math.round((raw / 255) * 100) : 50
              const pct = Math.max(1, Math.min(100, base + (type === 'brightness_up' ? 10 : -10)))
              await service('light', 'turn_on', { entity_id: entity, brightness_pct: pct })
            } else if (type === 'brightness_value') {
              if (!Number.isFinite(input)) return 'brightness_value 需要 1-100 的 input'
              await service('light', 'turn_on', { entity_id: entity, brightness_pct: Math.max(1, Math.min(100, input)) })
            } else if (type === 'set_kelvin') {
              if (!Number.isFinite(input)) return 'set_kelvin 需要 Kelvin 数值'
              await service('light', 'turn_on', { entity_id: entity, kelvin: input })
            } else if (type === 'set_color') {
              const rgb = Array.isArray(state?.rgb_color) ? state.rgb_color.map(Number) : null
              if (!rgb || rgb.length !== 3) return 'set_color 需要 rgb_color 三元组'
              await service('light', 'turn_on', { entity_id: entity, rgb_color: rgb })
            } else if (type === 'volume_up' || type === 'volume_down') {
              await service('media_player', type, { entity_id: entity })
            } else if (type === 'volume_set') {
              if (!Number.isFinite(input)) return 'volume_set 需要 1-100 的 input'
              await service('media_player', 'volume_set', {
                entity_id: entity,
                volume_level: Math.max(0, Math.min(1, input / 100)),
              })
            } else if (type === 'volume_mute') {
              await service('media_player', 'volume_mute', {
                entity_id: entity,
                is_volume_muted: state?.is_muted === true || String(state?.is_muted) === 'true',
              })
            } else if (type === 'pause') {
              await service('media_player', 'media_pause', { entity_id: entity })
            } else if (type === 'continue') {
              await service('media_player', 'media_play', { entity_id: entity })
            } else {
              return `不支持的动作：${type}`
            }
            return `已执行 ${type}：${entity}`
          } catch (error) {
            return `Home Assistant 操作失败：${error?.message ?? error}`
          }
        },
      })

      register({
        name: 'hass_play_music',
        description: '让 Home Assistant 的 media_player 播放指定音乐/有声书。',
        parameters: {
          type: 'object',
          properties: {
            entity_id: { type: 'string', description: 'media_player 的 entity_id' },
            media_content_id: { type: 'string', description: '歌曲/专辑/有声书名称；随机播放填 random' },
          },
          required: ['entity_id', 'media_content_id'],
          additionalProperties: false,
        },
        async run({ entity_id, media_content_id } = {}, { signal } = {}) {
          const entity = String(entity_id ?? '').trim()
          if (!entity) return '请提供 media_player 的 entity_id'
          const media = String(media_content_id ?? 'random').trim() || 'random'
          const result = await hassCall('/api/services/music_assistant/play_media', {
            method: 'POST',
            body: { entity_id: entity, media_id: media },
          })
          if (result.error) return `播放失败：${result.error}`
          return `正在播放：${media}`
        },
      })
    }

    const ragflowConfig = toolsConfig.ragflow ?? {}
    const ragflowBase = String(ragflowConfig.baseUrl ?? '').replace(/\/$/, '')
    const ragflowKey = String(ragflowConfig.apiKey ?? '').trim()
    if (ragflowBase && ragflowKey) {
      register({
        name: 'search_from_ragflow',
        description: '从 RAGFlow 知识库中检索信息来回答问题。',
        parameters: {
          type: 'object',
          properties: { question: { type: 'string', description: '要查询的问题' } },
          required: ['question'],
          additionalProperties: false,
        },
        async run({ question } = {}, { signal } = {}) {
          const text = String(question ?? '').trim()
          if (!text) return '请提供要查询的问题'
          const result = await fetchJson(`${ragflowBase}/api/v1/retrieval`, {
            method: 'POST',
            headers: { authorization: `Bearer ${ragflowKey}` },
            body: { question: text, dataset_ids: Array.isArray(ragflowConfig.datasetIds) ? ragflowConfig.datasetIds : [] },
            signal,
            timeoutMs: 10_000,
          })
          if (result.error) return `RAGFlow 请求失败：${result.error}`
          if (result.data?.code !== 0) {
            return `RAGFlow 返回异常（code=${result.data?.code ?? '未知'}）：${result.data?.message ?? result.data?.error?.message ?? ''}`
          }
          const chunks = Array.isArray(result.data?.data?.chunks) ? result.data.data.chunks : []
          const contents = chunks
            .map((chunk) => (typeof chunk?.content === 'string' ? chunk.content : ''))
            .filter(Boolean)
            .slice(0, 5)
          if (contents.length === 0) return '根据知识库查询结果，没有相关信息。'
          return `# 关于问题【${text}】查到知识库如下\n\`\`\`\n${contents.join('\n\n')}\n\`\`\``
        },
      })
    }

    const callDeviceConfig = toolsConfig.callDevice ?? {}
    const callBase = String(callDeviceConfig.url ?? '').replace(/\/$/, '')
    const callSecret = String(callDeviceConfig.secret ?? '').trim()
    if (callBase && callSecret) {
      register({
        name: 'call_device',
        description:
          '用于设备之间建立语音通话。用户说“呼叫XX/打电话给XX/连线XX”时调用，nickname 取目标设备备注名。',
        parameters: {
          type: 'object',
          properties: { nickname: { type: 'string', description: '目标设备的备注名，例如 小陈' } },
          required: ['nickname'],
          additionalProperties: false,
        },
        async run({ nickname } = {}, { signal, deviceId } = {}) {
          const target = String(nickname ?? '').trim()
          if (!target) return '请提供要呼叫的设备备注名'
          if (!deviceId) return '无法获取本机设备标识，不能发起呼叫'
          const url =
            `${callBase}/device/address-book/call?callerMac=${encodeURIComponent(deviceId)}` +
            `&nickname=${encodeURIComponent(target)}`
          const result = await fetchJson(url, {
            headers: { authorization: `Bearer ${callSecret}` },
            signal,
            timeoutMs: 10_000,
          })
          if (result.error) return `呼叫失败：${result.error}`
          if (result.data?.code !== 0) return `呼叫失败：${result.data?.msg ?? 'manager API 返回错误'}`
          if (result.data?.data?.status === 'error') return `呼叫失败：${result.data.data.message ?? '目标不可达'}`
          return `正在呼叫${target}，请等待对方接听`
        },
      })
    }
  }

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
      name: 'get_news_from_chinanews',      description:
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
    names: () =>
      [
        ...tools.keys(),
        ...(external?.definitions?.() ?? []).map((tool) => tool.function?.name),
        ...(inbound?.definitions?.() ?? []).map((tool) => tool.function?.name),
      ].filter(Boolean),

    /** 外部 MCP 管理器（可为空；启动后异步注入）。 */
    setExternal(manager) {
      external = manager
    },

    /** 入站 `/mcp` 工具注册表（可为空；连接建立后异步注入）。 */
    setInbound(registry) {
      inbound = registry
    },

    /** 控制台展示用：名字、分类与说明。 */
    catalog(deviceId) {
      const builtins = [...tools.values()].map((tool) => ({
        name: tool.name,
        toolType: tool.toolType,
        action: tool.action,
        description: tool.description,
        enabled: !isDisabled(tool.name, deviceId),
      }))
      const externalTools = (external?.definitions?.() ?? []).map((tool) => ({
        name: tool.function?.name ?? '',
        toolType: 'mcp',
        action: 'reqlm',
        description: tool.function?.description ?? '',
        enabled: true,
      }))
      const inboundTools = (inbound?.definitions?.() ?? []).map((tool) => ({
        name: tool.function?.name ?? '',
        toolType: 'mcp',
        action: 'reqlm',
        description: tool.function?.description ?? '',
        enabled: true,
      }))
      const extra = [...externalTools, ...inboundTools].filter(
        (tool) => tool.name && !builtins.some((item) => item.name === tool.name),
      )
      return [...builtins, ...extra]
    },

    isEnabled: (name, deviceId) => !isDisabled(name, deviceId),

    definitions(deviceId) {
      const builtins = [...tools.values()].filter((tool) => !isDisabled(tool.name, deviceId)).map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
        },
      }))
      const names = new Set(builtins.map((tool) => tool.function.name))
      const externalTools = (external?.definitions?.() ?? []).filter((tool) => !names.has(tool.function?.name))
      for (const tool of externalTools) names.add(tool.function.name)
      const inboundTools = (inbound?.definitions?.() ?? []).filter((tool) => !names.has(tool.function?.name))
      return [...builtins, ...externalTools, ...inboundTools]
    },

    /** `{ output, action, response }`；失败也返回文本，让模型自己圆场。 */
    async invoke(name, args, options) {
      const tool = tools.get(name)
      if (!tool && external?.has?.(name)) {
        try {
          const value = await external.execute(name, args ?? {})
          return { output: String(value ?? '').slice(0, 4000), action: 'reqlm', response: '' }
        } catch (error) {
          return { output: `工具 ${name} 执行失败：${error?.message ?? error}`, action: 'reqlm', response: '' }
        }
      }
      if (!tool && inbound?.has?.(name)) {
        try {
          const value = await inbound.execute(name, args ?? {})
          return { output: String(value ?? '').slice(0, 4000), action: 'reqlm', response: '' }
        } catch (error) {
          return { output: `工具 ${name} 执行失败：${error?.message ?? error}`, action: 'reqlm', response: '' }
        }
      }
      if (!tool) return { output: `没有名为 ${name} 的工具`, action: 'reqlm', response: '' }
      try {
        const value = await tool.run(args ?? {}, options ?? {})
        if (value && typeof value === 'object' && typeof value.output === 'string') {
          return {
            output: value.output,
            action: value.action ?? tool.action,
            response: value.response ?? '',
            ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
            ...(typeof value.file === 'string' ? { file: value.file } : {}),
            ...(typeof value.title === 'string' ? { title: value.title } : {}),
          }
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

import { existsSync, readFileSync, readdirSync } from 'node:fs'

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