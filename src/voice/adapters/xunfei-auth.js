/**
 * iFlytek (讯飞) open-platform authentication.
 *
 * Every WebSocket service on the platform (iat / tts / spark) shares one signing
 * scheme, documented as "接口鉴权" and implemented in the Go reference at
 * `internal/domain/tts/xunfei/xunfei.go:buildSignedURL` and
 * `internal/domain/asr/xunfei/engine.go:buildWebSocketURL`:
 *
 *   signature = base64(HMAC-SHA256(apiSecret, "host: <host>\ndate: <RFC1123 GMT>\nGET <path> HTTP/1.1"))
 *   authorization = base64(`api_key="…", algorithm="hmac-sha256",
 *                           headers="host date request-line", signature="…"`)
 *
 * then `?authorization=…&date=…&host=…` is appended to the wss URL. The date must
 * be RFC 1123 in GMT; a stale clock is the most common cause of 401 from them.
 */

import { createHmac } from 'node:crypto'

/** RFC 1123 date in GMT, e.g. `Wed, 05 Nov 2025 07:30:00 GMT`. */
export function authDate(now = new Date()) {
  return now.toUTCString()
}

/**
 * @param {{ url: string, apiKey: string, apiSecret: string, date?: string }} input
 * @returns {string} signed `wss://…?authorization=…&date=…&host=…`
 */
export function buildSignedUrl({ url, apiKey, apiSecret, date = authDate() }) {
  if (!url) throw new Error('xunfei: url is required')
  if (!apiKey) throw new Error('xunfei: apiKey is required')
  if (!apiSecret) throw new Error('xunfei: apiSecret is required')

  const parsed = new URL(url)
  const host = parsed.host
  const requestUri = `${parsed.pathname || '/'}${parsed.search || ''}`

  const origin = `host: ${host}\ndate: ${date}\nGET ${requestUri} HTTP/1.1`
  const signature = createHmac('sha256', apiSecret).update(origin).digest('base64')

  const authorizationOrigin =
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  const authorization = Buffer.from(authorizationOrigin, 'utf8').toString('base64')

  const search = new URLSearchParams()
  search.set('authorization', authorization)
  search.set('date', date)
  search.set('host', host)

  return `${parsed.origin}${parsed.pathname}?${search.toString()}`
}

/** Provider presets, so a profile only has to name the vendor. */
export const IFLYTEK_ENDPOINTS = {
  asr: 'wss://iat-api.xfyun.cn/v2/iat',
  tts: 'wss://tts-api.xfyun.cn/v2/tts',
  llm: 'https://spark-api-open.xf-yun.com/v1',
}
