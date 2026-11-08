/**
 * Device identity, client address, and network-topology helpers.
 *
 * ESP32 firmware versions disagree about how they spell identity headers, and
 * reverse proxies disagree about where the real peer address lives, so every
 * entry point funnels its input through this module instead of reading raw
 * headers itself.
 */

const DEVICE_ID_HEADERS = ['device-id', 'device_id', 'deviceid', 'x-device-id']
const CLIENT_ID_HEADERS = ['client-id', 'client_id', 'clientid', 'x-client-id']
const DEVICE_ID_QUERY = ['Device-Id', 'device-id', 'device_id', 'deviceId']
const CLIENT_ID_QUERY = ['Client-Id', 'client-id', 'client_id', 'clientId']

/**
 * Normalize a device identifier to one canonical form.
 *
 * A MAC address is the documented identity (the firmware sends `Device-Id`), so
 * every spelling of one collapses to upper-case colon form: `02-4a-7d-e3-89-bf`
 * and `02:4A:7D:E3:89:BF` and `024A7DE389BF` all become `02:4A:7D:E3:89:BF`.
 * Anything that is not a MAC (older firmware sends a UUID) is preserved apart
 * from trimming and whitespace removal: rewriting it would silently split one
 * device into two records.
 */
export function normalizeDeviceId(raw) {
  if (typeof raw !== 'string') return ''
  const value = raw.trim().replace(/^["']+|["']+$/g, '').replace(/\s+/g, '')
  if (!value) return ''
  const hex = value.replace(/[:-]/g, '')
  if (/^[0-9a-fA-F]{12}$/.test(hex)) {
    return hex.toUpperCase().match(/../g).join(':')
  }
  return value
}

/** Normalize the client session id (a UUID on current firmware) to lower case. */
export function normalizeClientId(raw) {
  if (typeof raw !== 'string') return ''
  const value = raw.trim().replace(/^["']+|["']+$/g, '')
  if (!value) return ''
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    return value.toLowerCase()
  }
  return value
}

function headerValue(headers, names) {
  if (!headers) return ''
  for (const name of names) {
    const value = headers[name]
    if (typeof value === 'string' && value.trim()) return value
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string' && value[0].trim()) {
      return value[0]
    }
  }
  return ''
}

function queryValue(url, names) {
  if (!url || typeof url.searchParams?.forEach !== 'function') return ''
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  let found = ''
  url.searchParams.forEach((value, key) => {
    if (!found && wanted.has(key.toLowerCase()) && typeof value === 'string' && value.trim()) found = value
  })
  return found
}

/**
 * Read the identity pair from headers first, then the query string.
 *
 * Returns empty strings rather than throwing so each route can decide its own
 * status code, plus the field that supplied the value for audit logging.
 */
const FIRMWARE_VERSION_HEADERS = ['application-version', 'firmware-version', 'x-firmware-version']

/** OTA/hello 里带的固件版本，用于设备表格展示；老固件没有就返回空串。 */
export function readFirmwareVersion(req) {
  return headerValue(req?.headers, FIRMWARE_VERSION_HEADERS).trim().slice(0, 32)
}

export function readIdentity(req, url) {
  const headerDevice = headerValue(req.headers, DEVICE_ID_HEADERS)
  const headerClient = headerValue(req.headers, CLIENT_ID_HEADERS)
  const queryDevice = headerDevice ? '' : queryValue(url, DEVICE_ID_QUERY)
  const queryClient = headerClient ? '' : queryValue(url, CLIENT_ID_QUERY)
  return {
    deviceId: normalizeDeviceId(headerDevice || queryDevice),
    clientId: normalizeClientId(headerClient || queryClient),
    sources: {
      deviceId: headerDevice ? 'header' : queryDevice ? 'query' : 'none',
      clientId: headerClient ? 'header' : queryClient ? 'query' : 'none',
    },
  }
}

/**
 * Canonicalize one address so comparisons and logs agree: drop a port, unwrap
 * IPv6 brackets, and collapse IPv4-mapped IPv6 (`::ffff:192.168.1.7`) to IPv4.
 */
export function canonicalIp(value) {
  if (typeof value !== 'string') return ''
  let ip = value.trim().replace(/^["']+|["']+$/g, '')
  if (!ip) return ''
  if (ip.startsWith('[')) {
    const close = ip.indexOf(']')
    if (close > 0) ip = ip.slice(1, close)
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(':'))
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped) return mapped[1]
  const zone = ip.indexOf('%')
  if (zone > 0 && ip.includes(':')) ip = ip.slice(0, zone)
  return ip
}

/**
 * Extract the peer address, preferring proxy headers over the socket because
 * the socket address behind a reverse proxy is always the proxy.
 */
export function clientIp(req) {
  const real = headerValue(req.headers, ['x-real-ip'])
  if (real) return canonicalIp(real)
  const forwarded = headerValue(req.headers, ['x-forwarded-for'])
  if (forwarded) return canonicalIp(forwarded.split(',')[0])
  const remote = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
  return canonicalIp(remote)
}

function parseIpv4(text) {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const bytes = new Uint8Array(4)
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index]
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    bytes[index] = octet
  }
  return bytes
}

function parseIpv6(text) {
  if (!text.includes(':') || !/^[0-9a-fA-F:.]+$/.test(text)) return null
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : []
  let groups = head
  if (halves.length === 2) {
    const zeros = 8 - head.length - tail.length
    if (zeros < 0) return null
    groups = [...head, ...new Array(zeros).fill('0'), ...tail]
  }
  if (groups.length !== 8) return null
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 8; index += 1) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groups[index])) return null
    const group = Number.parseInt(groups[index], 16)
    bytes[index * 2] = (group >> 8) & 0xff
    bytes[index * 2 + 1] = group & 0xff
  }
  return bytes
}

/** @returns {{ version: 4|6, bytes: Uint8Array } | null} */
export function parseIp(text) {
  const ip = canonicalIp(text)
  if (!ip) return null
  const v4 = parseIpv4(ip)
  if (v4) return { version: 4, bytes: v4 }
  const v6 = parseIpv6(ip)
  if (v6) return { version: 6, bytes: v6 }
  return null
}

/**
 * Match one address against a CIDR block. Unparseable input never matches, so a
 * malformed configuration can only ever narrow the LAN set, never widen it.
 */
export function ipInCidr(ip, cidr) {
  if (typeof cidr !== 'string' || !cidr.includes('/')) return false
  const [base, prefixText] = cidr.split('/')
  const prefix = Number(prefixText)
  const target = parseIp(ip)
  const network = parseIp(base)
  if (!target || !network || target.version !== network.version) return false
  const maxBits = target.version === 4 ? 32 : 128
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) return false
  let remaining = prefix
  for (let index = 0; index < target.bytes.length && remaining > 0; index += 1) {
    const bits = Math.min(8, remaining)
    const mask = (0xff << (8 - bits)) & 0xff
    if ((target.bytes[index] & mask) !== (network.bytes[index] & mask)) return false
    remaining -= bits
  }
  return true
}

const PRIVATE_IPV4_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '100.64.0.0/10',
]

const PRIVATE_IPV6_CIDRS = ['::1/128', 'fc00::/7', 'fe80::/10']

/**
 * Whether an address is reachable only from a local network.
 *
 * The answer decides which WebSocket URL the OTA response hands out: a LAN
 * address must never be handed to a WAN device (it would be unroutable), so an
 * address that fails to parse is treated as WAN, the conservative side.
 */
export function isPrivateAddress(ip, extraCidrs = []) {
  const parsed = parseIp(ip)
  if (!parsed) return false
  const builtin = parsed.version === 4 ? PRIVATE_IPV4_CIDRS : PRIVATE_IPV6_CIDRS
  const cidrs = [...builtin, ...(Array.isArray(extraCidrs) ? extraCidrs : [])]
  return cidrs.some((cidr) => ipInCidr(ip, cidr))
}
