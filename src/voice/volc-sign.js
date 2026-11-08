/**
 * 火山引擎 OpenAPI 的 HMAC-SHA256 签名（V4）。
 *
 * 官方文档：https://www.volcengine.com/docs/6369/67269
 * 音色列表接口：`ListSpeakers`（Version=2025-05-20，Service=speech_saas_prod，Region=cn-beijing）
 *
 * 注意：这是 **AK/SK** 签名，和 TTS 数据面的 `X-Api-Key` 不是一回事；`ListSpeakers`
 * 只能用它调。签名算法与 AWS SigV4 同源，这里按火山文档的字段名实现。
 */
import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'HMAC-SHA256'

function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex')
}

function hmac(key, text) {
  return createHmac('sha256', key).update(text).digest()
}

/** `2025-03-29T18:09:37.000Z` → `20250329T180937Z`（官方要求 UTC+0、秒精度）。 */
export function volcDate(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

/**
 * 生成一次火山 OpenAPI 请求的签名。
 *
 * @param {object} options
 * @param {'GET'|'POST'} options.method
 * @param {string} options.host 例如 `open.volcengineapi.com`
 * @param {string} [options.path] 默认 `/`
 * @param {string} [options.query] **已按参数名 ASCII 升序**的查询串，如 `Action=ListSpeakers&Version=2025-05-20`
 * @param {string} [options.body] 请求体原文（GET 传空串）
 * @param {string} options.accessKey
 * @param {string} options.secretKey
 * @param {string} options.service 例如 `speech_saas_prod`
 * @param {string} [options.region] 默认 `cn-beijing`
 * @param {string[]} [options.signedHeaders] 默认 `['host', 'x-date']`；ListSpeakers 用 `['host','x-content-sha256','x-date']`
 * @param {Date} [options.date]
 * @returns {{ url: string, headers: object, signature: string, canonicalRequest: string, stringToSign: string }}
 */
export function signVolcRequest({
  method,
  host,
  path = '/',
  query = '',
  body = '',
  accessKey,
  secretKey,
  service,
  region = 'cn-beijing',
  signedHeaders = ['host', 'x-date'],
  date = new Date(),
} = {}) {
  if (!accessKey || !secretKey) throw new Error('火山 OpenAPI 需要 AccessKey / SecretKey')
  if (!service) throw new Error('火山 OpenAPI 需要 service')
  const xDate = volcDate(date)
  const shortDate = xDate.slice(0, 8)
  const payloadHash = sha256Hex(body)
  const values = {
    host,
    'x-date': xDate,
    'x-content-sha256': payloadHash,
  }
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${values[name]}\n`).join('')
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n')
  const scope = `${shortDate}/${region}/${service}/request`
  const stringToSign = [ALGORITHM, xDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(secretKey, shortDate)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const url = `https://${host}${path}${query ? `?${query}` : ''}`
  const headers = {
    'content-type': 'application/json; charset=UTF-8',
    'x-date': xDate,
    'x-content-sha256': payloadHash,
    authorization: `${ALGORITHM} Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  }
  return { url, headers, signature, canonicalRequest, stringToSign }
}
