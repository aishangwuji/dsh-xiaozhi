/**
 * Local network address discovery.
 *
 * The console must show a device the address it can actually reach: an ESP32
 * cannot resolve "本机 LAN IP", and `127.0.0.1` is useless to it. So the server
 * enumerates its own interfaces and offers the real candidates.
 *
 * Two rules that matter on a developer machine:
 *   - virtual adapters (WSL, Hyper-V, Docker, VirtualBox, Tailscale…) are ranked
 *     last, because a watch on the Wi-Fi cannot reach them;
 *   - the list is ordered so the first entry is the best guess, but the console
 *     lets the operator pick another one when a machine has several NICs.
 */

import { networkInterfaces } from 'node:os'

import { isPrivateAddress } from './identity.js'

const VIRTUAL_HINTS = /(wsl|vethernet|hyper-v|virtualbox|vmware|docker|br-|veth|tailscale|zerotier|loopback|meta|npcap|tap|tun)/i

function isUsable(ip) {
  if (!ip || ip === '0.0.0.0') return false
  if (ip.startsWith('127.')) return false
  if (ip.startsWith('169.254.')) return false
  return isPrivateAddress(ip)
}

/**
 * @param {ReturnType<typeof networkInterfaces>} [interfaces] injectable for tests
 * @returns {Array<{ iface: string, ip: string, virtual: boolean }>} best first
 */
export function listLanAddresses(interfaces = networkInterfaces()) {
  const found = []
  for (const [iface, infos] of Object.entries(interfaces ?? {})) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' && info.family !== 4) continue
      if (info.internal) continue
      if (!isUsable(info.address)) continue
      found.push({ iface, ip: info.address, virtual: VIRTUAL_HINTS.test(iface) })
    }
  }
  found.sort((left, right) => {
    if (left.virtual !== right.virtual) return left.virtual ? 1 : -1
    // 192.168/16 is the most common home network, then 10/8, then 172.16/12.
    const rank = (ip) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3
    const byRank = rank(left.ip) - rank(right.ip)
    if (byRank !== 0) return byRank
    return left.ip.localeCompare(right.ip)
  })
  return found
}

/** The address a device on the same network most likely reaches. */
export function preferredLanAddress(interfaces) {
  const list = listLanAddresses(interfaces)
  return list.length > 0 ? list[0].ip : ''
}
