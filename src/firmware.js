/**
 * 固件升级通道的本地固件仓库（2026-11-16）。
 *
 * 设备侧的 OTA 协议只认 `firmware { version, url, force }`：版本比当前新（或
 * force）就去 GET `url` 拿整包。控制台把 .bin 上传到这里，仓库负责：
 *
 * - 落盘到 `<dataRoot>/firmware/<name>`，元数据写 `index.json`（原子替换）；
 * - 只保留一个现役文件，上传新文件自动清掉旧的；
 * - 拒绝路径穿越 / 非 .bin / 超过 16 MiB 的输入（这是设备面能 GET 到的文件，
 *   边界校验放在这里，而不是只靠控制台前端）。
 *
 * OTA 响应里的绝对 URL 由 ingress 按请求的 `Host` 拼，不在这里固化——PC 换网段
 * 后设备仍能拿到正确地址。
 */

import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const MAX_FIRMWARE_BYTES = 16 * 1024 * 1024
const NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}\.bin$/

export class FirmwareError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FirmwareError'
    this.code = code
  }
}

export function createFirmwareStore({ dir, logger, maxBytes = MAX_FIRMWARE_BYTES } = {}) {
  const indexPath = join(dir, 'index.json')
  let info = null

  /** 同步读取元数据：插件启动时在非 async 的装配段调用，文件很小。 */
  function load() {
    try {
      const raw = JSON.parse(readFileSync(indexPath, 'utf8'))
      if (!raw || typeof raw !== 'object') return null
      if (!NAME_PATTERN.test(String(raw.fileName ?? ''))) return null
      const stat = statSync(join(dir, raw.fileName), { throwIfNoEntry: false })
      if (!stat || !stat.isFile()) return null
      info = {
        fileName: raw.fileName,
        size: stat.size,
        sha256: typeof raw.sha256 === 'string' ? raw.sha256 : '',
        version: typeof raw.version === 'string' ? raw.version : '',
        uploadedAt: Number(raw.uploadedAt) || stat.mtimeMs,
      }
    } catch {
      info = null
    }
    return info
  }

  async function persist(next) {
    await fs.mkdir(dir, { recursive: true })
    const temp = `${indexPath}.tmp`
    await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600 })
    await fs.rename(temp, indexPath)
  }

  async function save(buffer, { fileName = '', version = '' } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new FirmwareError('empty', '固件文件为空')
    }
    if (buffer.length > maxBytes) {
      throw new FirmwareError('too-large', `固件超过上限 ${Math.floor(maxBytes / 1024 / 1024)} MiB`)
    }
    const name = String(fileName || '').trim()
    if (!NAME_PATTERN.test(name)) {
      throw new FirmwareError('invalid-name', '固件文件名只能包含字母/数字/._-，且必须以 .bin 结尾')
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    await fs.mkdir(dir, { recursive: true })
    const target = join(dir, name)
    await fs.writeFile(target, buffer)
    const previous = info
    const next = {
      fileName: name,
      size: buffer.length,
      sha256,
      version: String(version ?? '').trim().slice(0, 40),
      uploadedAt: Date.now(),
    }
    await persist(next)
    info = next
    if (previous && previous.fileName !== name) {
      await fs.rm(join(dir, previous.fileName), { force: true }).catch(() => {})
    }
    logger?.info?.(`dsh-xiaozhi: firmware stored ${name} (${buffer.length} bytes, sha256 ${sha256.slice(0, 12)})`)
    return { ...info }
  }

  async function remove() {
    const previous = info
    info = null
    await fs.rm(indexPath, { force: true }).catch(() => {})
    if (previous) await fs.rm(join(dir, previous.fileName), { force: true }).catch(() => {})
    return Boolean(previous)
  }

  /** @returns {{ fileName: string, size: number, path: string } | null} */
  function resolve(name) {
    const file = info
    if (!file || name !== file.fileName) return null
    return { fileName: file.fileName, size: file.size, path: join(dir, file.fileName) }
  }

  function stream(name) {
    const file = resolve(name)
    if (!file) return null
    return { ...file, stream: createReadStream(file.path) }
  }

  return {
    get dir() {
      return dir
    },
    load,
    save,
    remove,
    resolve,
    stream,
    info: () => (info ? { ...info } : null),
  }
}
