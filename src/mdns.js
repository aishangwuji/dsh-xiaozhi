/**
 * Minimal mDNS responder (RFC 6762) — no dependencies.
 *
 * Why: the watch stores the WebSocket URL it got from the last OTA poll, and the
 * LAN OTA URL used to be compiled into the firmware. Both are the PC's DHCP
 * address, so switching networks (or a lease change) silently orphans the device
 * and it falls back to the cloud. Advertising `xiaozhi.local` lets the firmware
 * find us at whatever address we currently have.
 *
 * Scope: exactly what a device needs to discover us — PTR/SRV/TXT for
 * `_xiaozhi._tcp` and A for the host. No caching, no conflict resolution, no
 * known-answer suppression; those only matter for long-lived mDNS meshes.
 */

import dgram from 'node:dgram'
import os from 'node:os'

export const MDNS_ADDRESS = '224.0.0.251'
export const MDNS_PORT = 5353
export const SERVICE = '_xiaozhi._tcp.local'

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 }
const CLASS_IN = 1
const CACHE_FLUSH = 0x8000
const TTL_SECONDS = 120

/** `xiaozhi.local` -> wire-format buffer (labels + root). */
export function encodeName(name) {
  const labels = String(name)
    .split('.')
    .filter((label) => label.length > 0)
  const parts = labels.map((label) => {
    const bytes = Buffer.from(label, 'utf8')
    if (bytes.length > 63) throw new Error(`mDNS label too long: ${label}`)
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  })
  return Buffer.concat([...parts, Buffer.from([0])])
}

/** Wire-format name -> string, following compression pointers. */
export function decodeName(buffer, start) {
  const labels = []
  let offset = start
  let after = start
  let jumped = false

  for (let guard = 0; guard < 256; guard += 1) {
    if (offset >= buffer.length) throw new Error('truncated mDNS name')
    const length = buffer[offset]
    if ((length & 0xc0) === 0xc0) {
      const pointer = ((length & 0x3f) << 8) | buffer[offset + 1]
      if (!jumped) after = offset + 2
      jumped = true
      offset = pointer
      continue
    }
    offset += 1
    if (length === 0) {
      if (!jumped) after = offset
      return { name: labels.join('.'), offset: after }
    }
    labels.push(buffer.toString('utf8', offset, offset + length))
    offset += length
  }
  throw new Error('mDNS name compression loop')
}

/** Parse the question section of an incoming packet. */
export function parseMessage(packet) {
  if (packet.length < 12) return null
  const header = {
    id: packet.readUInt16BE(0),
    flags: packet.readUInt16BE(2),
    questions: packet.readUInt16BE(4),
  }
  let offset = 12
  const parsed = []
  for (let index = 0; index < header.questions; index += 1) {
    const { name, offset: after } = decodeName(packet, offset)
    offset = after
    if (offset + 4 > packet.length) return null
    const type = packet.readUInt16BE(offset)
    const klass = packet.readUInt16BE(offset + 2)
    offset += 4
    parsed.push({
      name: name.toLowerCase(),
      type,
      klass: klass & 0x7fff,
      unicastResponse: (klass & CACHE_FLUSH) !== 0,
    })
  }
  return { header, questions: parsed }
}

function resourceRecord(name, type, data, { cacheFlush = false } = {}) {
  const head = Buffer.alloc(10)
  head.writeUInt16BE(type, 0)
  head.writeUInt16BE(cacheFlush ? CLASS_IN | CACHE_FLUSH : CLASS_IN, 2)
  head.writeUInt32BE(TTL_SECONDS, 4)
  head.writeUInt16BE(data.length, 8)
  return Buffer.concat([encodeName(name), head, data])
}

const ptrRecord = (service, instance) => resourceRecord(service, TYPE.PTR, encodeName(instance))
const srvRecord = (instance, port, host) => {
  const data = Buffer.alloc(6)
  data.writeUInt16BE(0, 0)
  data.writeUInt16BE(0, 2)
  data.writeUInt16BE(port, 4)
  return resourceRecord(instance, TYPE.SRV, Buffer.concat([data, encodeName(host)]), { cacheFlush: true })
}
const txtRecord = (instance, entries) => {
  const chunks = entries.map((entry) => {
    const bytes = Buffer.from(entry, 'utf8')
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  })
  return resourceRecord(instance, TYPE.TXT, Buffer.concat(chunks.length > 0 ? chunks : [Buffer.from([0])]), {
    cacheFlush: true,
  })
}
const addressRecords = (host, addresses) =>
  addresses.map((address) => {
    const parts = address.split('.').map(Number)
    return resourceRecord(host, TYPE.A, Buffer.from(parts), { cacheFlush: true })
  })

/**
 * Build the answer packet for a query, or null when the query is not ours.
 *
 * A PTR answer also carries SRV + TXT + A in the additional section. espressif's
 * mDNS client (`mdns_query_ptr`) fills `port` / `txt` from those additional
 * records, so one round trip gives the firmware host, port and OTA path.
 */
export function buildResponse({ questions, name = 'xiaozhi', port = 8989, path = '/xiaozhi/ota/', addresses = [] }) {
  const host = `${name}.local`
  const instance = `${name}.${SERVICE}`
  const answers = []
  const additionals = []
  let wantsServiceGlue = false
  let wantsAddressGlue = false

  for (const question of questions) {
    if (question.type === TYPE.PTR || question.type === TYPE.ANY) {
      if (question.name === SERVICE) {
        answers.push(ptrRecord(SERVICE, instance))
        wantsServiceGlue = true
      }
    }
    if (question.type === TYPE.SRV || question.type === TYPE.ANY) {
      if (question.name === instance) {
        answers.push(srvRecord(instance, port, host))
        wantsAddressGlue = true
      }
    }
    if (question.type === TYPE.TXT || question.type === TYPE.ANY) {
      if (question.name === instance) answers.push(txtRecord(instance, [`path=${path}`]))
    }
    if (question.type === TYPE.A || question.type === TYPE.ANY) {
      if (question.name === host) answers.push(...addressRecords(host, addresses))
    }
  }

  if (answers.length === 0) return null
  if (wantsServiceGlue) {
    additionals.push(srvRecord(instance, port, host), txtRecord(instance, [`path=${path}`]))
    wantsAddressGlue = true
  }
  if (wantsAddressGlue) additionals.push(...addressRecords(host, addresses))

  const header = Buffer.alloc(12)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(0x8400, 2) // response + authoritative
  header.writeUInt16BE(0, 4)
  header.writeUInt16BE(answers.length, 6)
  header.writeUInt16BE(0, 8)
  header.writeUInt16BE(additionals.length, 10)

  return Buffer.concat([header, ...answers, ...additionals])
}

/** Unsolicited announcement: everything, no questions. */
export function buildAnnouncement({ name = 'xiaozhi', port = 8989, path = '/xiaozhi/ota/', addresses = [] }) {
  const host = `${name}.local`
  const instance = `${name}.${SERVICE}`
  const records = [
    ptrRecord(SERVICE, instance),
    srvRecord(instance, port, host),
    txtRecord(instance, [`path=${path}`]),
    ...addressRecords(host, addresses),
  ]
  const header = Buffer.alloc(12)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(0x8400, 2)
  header.writeUInt16BE(records.length, 6)
  return Buffer.concat([header, ...records])
}

/**
 * 只广播真正能给局域网设备用的地址：RFC1918 私网 + CGNAT 段。
 *
 * 这台机器上同时有 Clash TUN（198.18.0.0）、2.0.1.9、169.254 链路本地地址这些
 * 虚拟网卡，全广播出去会让设备拿到一个不可达的地址；固件虽然会按同网段挑，
 * 但少发一条无用的 A 记录更省事。
 */
export function isLanAddress(address) {
  const [a, b] = address.split('.').map(Number)
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function lanAddresses() {
  const addresses = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isLanAddress(entry.address)) {
        addresses.push(entry.address)
      }
    }
  }
  return addresses
}

/**
 * Start the responder. Returns `{ stop, host, enabled }`; a bind failure is
 * reported and **retried in the background** — 5353 is shared with the OS
 * responder, Chrome, ChatGPT and friends, and whichever process grabs it first
 * often releases it later. Discovery is a convenience, never a reason to fail
 * the plugin (2026-11-06: bind failed once and the watch silently fell back to
 * the cloud OTA).
 */
export async function startMdns({ name = 'xiaozhi', port = 8989, path = '/xiaozhi/ota/', logger, announceMs = 60_000 } = {}) {
  const host = `${name}.local`
  const sameSubnet = (a, b) => a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.')
  let stopped = false
  let socket = null
  let announceTimer = null
  let retryTimer = null

  const api = {
    host,
    get enabled() {
      return Boolean(socket)
    },
    stop() {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      if (announceTimer) clearInterval(announceTimer)
      try {
        socket?.close()
      } catch {}
      socket = null
    },
  }

  const bind = () =>
    new Promise((resolve, reject) => {
      const candidate = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      candidate.once('error', (error) => {
        try {
          candidate.close()
        } catch {}
        reject(error)
      })
      candidate.bind(MDNS_PORT, () => {
        candidate.removeAllListeners('error')
        resolve(candidate)
      })
    })

  const attach = (bound) => {
    // 换 Wi-Fi（比如从 5G 路由切到手机热点）后网卡地址会变；记住已经 join 过的
    // 接口，announce 时把新接口补进来，否则收不到新网段上的 mDNS 查询。
    const joined = new Set()
    const joinInterfaces = () => {
      for (const address of lanAddresses()) {
        if (joined.has(address)) continue
        try {
          bound.addMembership(MDNS_ADDRESS, address)
          joined.add(address)
          logger?.info?.(`dsh-xiaozhi: mDNS joined interface ${address}`)
        } catch {}
      }
    }
    joinInterfaces()

    // 一台机器上常有多个虚拟网卡（VMware、Clash TUN、169.254 自分配）。多播默认跟着
    // 路由表走，可能从虚拟网卡出去，真实局域网上的设备就收不到；所以按网卡逐个发。
    const sendVia = (packet, interfaceAddress) => {
      try {
        if (interfaceAddress) bound.setMulticastInterface(interfaceAddress)
        bound.send(packet, MDNS_PORT, MDNS_ADDRESS)
      } catch (error) {
        logger?.warn?.(`dsh-xiaozhi: mDNS send failed on ${interfaceAddress ?? 'default'}: ${error.message}`)
      }
    }

    const send = (packet, rinfo) => {
      // **永远先单播回查询方**（2026-11-14 实测修）。
      //
      // esp-idf 的 `mdns_query_ptr` 发出的查询 `QU=0`（在手表上抓包可见 qu=false）。
      // 旧逻辑只在 QU=1 时单播，其余只发 multicast；而这台机器有 VMware / Clash TUN
      // 等多块虚拟网卡，Windows 上 multicast egress 由路由表决定，`setMulticastInterface`
      // 未必生效，回答会从 192.168.10.1 之类的虚拟网卡出去——手表永远收不到，于是
      // 每次开机都报 `mDNS: no _xiaozhi._tcp service on this LAN`，再落到官方云。
      // esp-idf 的 mDNS 客户端对**单播应答照收**，所以单播是最可靠的路径。
      if (rinfo) {
        try {
          bound.send(packet, rinfo.port, rinfo.address)
        } catch (error) {
          logger?.warn?.(`dsh-xiaozhi: mDNS unicast reply failed: ${error.message}`)
        }
        // 同网段再补一包 multicast（标准 mDNS 行为，其他 mDNS 客户端也能看到）。
        const sameNet = lanAddresses().find((address) => sameSubnet(address, rinfo.address))
        if (sameNet) sendVia(packet, sameNet)
        return
      }
      // 没有来源（本机探测或异常报文）才按所有 LAN 网卡逐个发。
      for (const address of lanAddresses()) sendVia(packet, address)
    }

    bound.on('message', (packet, rinfo) => {
      let message
      try {
        message = parseMessage(packet)
      } catch {
        return
      }
      if (!message || (message.header.flags & 0x8000) !== 0) return
      logger?.debug?.(
        `dsh-xiaozhi: mDNS query ${message.questions.map((question) => question.name).join(', ') || '(none)'}`,
      )
      // A 记录只回「和查询方同网段」的地址：服务端常带 VMware/Clash 虚拟网卡，
      // 全发回去时固件（mdns_query_a 只取一条）可能拿到不可达的 192.168.10.1。
      const allAddresses = lanAddresses()
      const sameNetAddresses = rinfo
        ? allAddresses.filter((address) => sameSubnet(address, rinfo.address))
        : []
      const response = buildResponse({
        questions: message.questions,
        name,
        port,
        path,
        addresses: sameNetAddresses.length > 0 ? sameNetAddresses : allAddresses,
      })
      logger?.debug?.(`dsh-xiaozhi: mDNS answer ${response ? `${response.length} bytes` : 'none'}`)
      // 不再看 QU 位：见 `send()` 里的说明，esp-idf 发的就是 QU=0，单播才收得到。
      if (response) send(response, rinfo)
    })
    bound.on('error', (error) => logger?.warn?.(`dsh-xiaozhi: mDNS socket error: ${error.message}`))

    const announce = () => {
      joinInterfaces()
      const addresses = lanAddresses()
      if (addresses.length === 0) return
      const packet = buildAnnouncement({ name, port, path, addresses })
      for (const address of addresses) sendVia(packet, address)
    }
    announce()
    announceTimer = setInterval(announce, announceMs)
    announceTimer.unref?.()
    socket = bound
    logger?.info?.(`dsh-xiaozhi: mDNS advertised ${host} on ${lanAddresses().join(', ') || '(no LAN address)'}`)
  }

  const attempt = async () => {
    if (stopped) return
    try {
      const bound = await bind()
      if (stopped) {
        try {
          bound.close()
        } catch {}
        return
      }
      attach(bound)
    } catch (error) {
      logger?.warn?.(
        `dsh-xiaozhi: mDNS bind failed (${error.message}); retrying in 10s — the watch needs mDNS or a fixed IP`,
      )
      retryTimer = setTimeout(attempt, 10_000)
      retryTimer.unref?.()
    }
  }

  await attempt()
  return api
}
