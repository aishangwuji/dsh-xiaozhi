/**
 * 火山「大模型音色列表」：`ListSpeakers`（官方 OpenAPI，AK/SK 签名）。
 *
 * 文档：https://docs.volcengine.com/docs/doubao-voice/list-speakers-large-model-sound-list-new-interface
 *
 * 只用于控制台的音色下拉；TTS 合成仍然走数据面的 `X-Api-Key`（`volc-http-tts.js`）。
 * 结果缓存 10 分钟，避免每次打开智能体配置都打一次 OpenAPI。
 */
import { createHash } from 'node:crypto'
import { signVolcRequest } from './volc-sign.js'

const HOST = 'open.volcengineapi.com'
const SERVICE = 'speech_saas_prod'
const REGION = 'cn-beijing'
const VERSION = '2025-05-20'
const PAGE_SIZE = 100
const MAX_PAGES = 10
const CACHE_TTL_MS = 10 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000
const cache = new Map()

/** 把官方 `Speakers[]` 映射成 PillSelect 的选项；`tier` 用于和资源族对齐。 */
export function speakerOptions(speakers) {
  return (Array.isArray(speakers) ? speakers : [])
    .filter((speaker) => speaker && typeof speaker.VoiceType === 'string' && speaker.VoiceType)
    .map((speaker) => ({
      value: speaker.VoiceType,
      label: [speaker.Name, speaker.Gender, speaker.Age].filter(Boolean).join(' · ') || speaker.VoiceType,
      tier: speaker.ResourceID || '',
    }))
}

/**
 * 拉取某个资源族的全部音色（自动翻页，最多 5 页）。
 * 失败时抛错，由调用方决定回退内置清单还是展示错误。
 */
export async function listVolcSpeakers({
  accessKey,
  secretKey,
  resourceId = 'seed-tts-2.0',
  fetchImpl = fetch,
  date = new Date(),
  pageSize = PAGE_SIZE,
} = {}) {
  const speakers = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = JSON.stringify({ ResourceIDs: [resourceId], Page: page, Limit: pageSize })
    const signed = signVolcRequest({
      method: 'POST',
      host: HOST,
      path: '/',
      query: `Action=ListSpeakers&Version=${VERSION}`,
      body,
      accessKey,
      secretKey,
      service: SERVICE,
      region: REGION,
      signedHeaders: ['host', 'x-content-sha256', 'x-date'],
      date,
    })
    const response = await fetchImpl(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await response.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
    if (!response.ok || !data?.Result) {
      const message =
        data?.ResponseMetadata?.Error?.Message ||
        data?.message ||
        text.slice(0, 300) ||
        `HTTP ${response.status}`
      throw new Error(message)
    }
    const batch = Array.isArray(data.Result.Speakers) ? data.Result.Speakers : []
    speakers.push(...batch)
    const total = Number(data.Result.Total ?? 0)
    if (batch.length === 0 || batch.length < pageSize || (total > 0 && speakers.length >= total)) break
  }
  return speakers
}

/** 带缓存的版本；缓存 key 只含 AK 的哈希，不落明文 AK/SK。 */
export async function listVolcSpeakersCached({
  accessKey,
  secretKey,
  resourceId = 'seed-tts-2.0',
  fetchImpl = fetch,
  now = Date.now(),
  date = new Date(),
} = {}) {
  const key = `${resourceId}:${createHash('sha256').update(`${accessKey}:${secretKey}`).digest('hex').slice(0, 16)}`
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.speakers
  const speakers = await listVolcSpeakers({ accessKey, secretKey, resourceId, fetchImpl, date })
  cache.set(key, { at: now, speakers })
  return speakers
}

/** 测试用：清空缓存。 */
export function clearVolcSpeakerCache() {
  cache.clear()
}
