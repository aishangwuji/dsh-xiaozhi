/**
 * 模型清单 —— **只信厂商接口，不在代码里内置任何模型 id**。
 *
 *   1. 服务商真实接口 —— OpenAI 兼容的 `GET {baseUrl}/models`（DeepSeek、Ark、MiMo、vLLM
 *      都实现了），带当前 apiKey 请求，返回的就是这个账号真正可用的模型；
 *   2. 接口不可达 / 没填 Key 时返回**空列表**，前端退回文本框让用户手填——不做猜测式兜底。
 *
 * 认证头按厂商风格选：绝大多数是 `Authorization: Bearer`，小米 MiMo 的 /v1/models 只认
 * `api-key: <key>`（见 Docs/xiaomi.md「列出模型」），所以用 `authStyle` 参数而不是厂商 if。
 *
 * 只对 **LLM 模型**走这个接口。TTS 模型 / ASR·TTS Resource ID 是语音协议里的枚举
 * （火山语音没有公开的模型列表接口），仍是插件内置目录。
 *
 * 只缓存成功结果（10 分钟）：空结果不缓存，否则刚填完 Key 也要等 10 分钟才拉得到模型。
 */

const CACHE_TTL_MS = 10 * 60 * 1000

/** 火山语音合成（seed-tts / seed-icl）的模型与资源 ID 对应关系，来自官方文档。 */
export const VOLC_TTS_MODELS = [
  { value: 'seed-tts-2.0-standard', label: 'seed-tts-2.0-standard（默认，复刻音色专用）' },
]

/**
 * 火山流式识别（`bigmodel_async` 协议）支持的资源 ID。
 *
 * 适配器固定走 2.0（`volc.seedasr.*`）：1.0 的 `volc.bigasr.*` 与当前 endpoint/model
 * 不匹配，握手直接 403（实测），所以不再在控制台里列出，避免选中后“识别恒为空”。
 */
export const VOLC_ASR_RESOURCES = [
  { value: 'volc.seedasr.sauc.duration', label: '豆包流式识别 2.0 · 小时版' },
  { value: 'volc.seedasr.sauc.concurrent', label: '豆包流式识别 2.0 · 并发版' },
]

export const VOLC_TTS_RESOURCES = [
  { value: 'seed-tts-2.0', label: 'seed-tts-2.0（语音合成大模型 2.0）' },
  { value: 'seed-icl-2.0', label: 'seed-icl-2.0（声音复刻大模型 2.0）' },
]

const cache = new Map()

async function fetchOpenAiModels({ baseUrl, apiKey, authStyle = 'bearer', timeoutMs = 6000, fetchImpl } = {}) {
  const root = String(baseUrl ?? '').replace(/\/+$/, '')
  if (!root || !apiKey) return null
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  const headers = authStyle === 'api-key' ? { 'api-key': apiKey } : { authorization: `Bearer ${apiKey}` }
  try {
    const response = await doFetch(`${root}/models`, {
      headers,
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = await response.json()
    const ids = (body?.data ?? [])
      .map((item) => (typeof item?.id === 'string' ? item.id : ''))
      .filter(Boolean)
      .sort()
    return ids.length > 0 ? ids : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {{kind: 'llm'|'tts'|'ttsResource'|'asrResource', provider: string,
 *          baseUrl?: string, apiKey?: string, authStyle?: 'bearer'|'api-key',
 *          fetchImpl?: Function}} query
 * @returns {Promise<{source: 'live'|'catalog'|'unavailable', options: {value: string, label: string}[]}>}
 *   `unavailable` = 调用了厂商接口但不可达/没有 Key，前端用文本框手填（不内置模型 id）。
 */
export async function modelsFor({ kind, provider, baseUrl, apiKey, authStyle = 'bearer', fetchImpl } = {}) {
  const key = `${kind}:${provider}:${baseUrl ?? ''}:${authStyle}:${apiKey ? apiKey.slice(-4) : ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  let value
  if (kind === 'tts') {
    value = { source: 'catalog', options: provider === 'volc' ? VOLC_TTS_MODELS : [] }
  } else if (kind === 'asrResource') {
    value = { source: 'catalog', options: provider === 'volc' ? VOLC_ASR_RESOURCES : [] }
  } else if (kind === 'ttsResource') {
    value = { source: 'catalog', options: provider === 'volc' ? VOLC_TTS_RESOURCES : [] }
  } else {
    const live = await fetchOpenAiModels({ baseUrl, apiKey, authStyle, fetchImpl })
    if (!live) return { source: 'unavailable', options: [] }
    value = { source: 'live', options: live.map((id) => ({ value: id, label: id })) }
  }

  cache.set(key, { at: Date.now(), value })
  return value
}
