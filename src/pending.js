/**
 * 待审核设备队列。
 *
 * `autoProvision: false` 时，陌生设备不再直接建档，也不会被永久拒绝：OTA/WS 第一次
 * 见到它时只写进 `pending.json`，控制台管理员选择智能体后再批准。批准后设备下一次
 * OTA/WS 请求会正常通过；拒绝则把它从队列里移除（之后仍可再次申请）。
 *
 * 与 `devices.json` 分开存：待审核记录不参与智能体列表、历史、记忆与工具装配。
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const VERSION = 1
const MAX_PENDING_DEFAULT = 100

function normalize(raw, now) {
  if (!raw || typeof raw !== 'object' || typeof raw.deviceId !== 'string' || !raw.deviceId) return null
  return {
    deviceId: raw.deviceId,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : '',
    lastIp: typeof raw.lastIp === 'string' ? raw.lastIp : '',
    firmwareVersion: typeof raw.firmwareVersion === 'string' ? raw.firmwareVersion.slice(0, 32) : '',
    firstSeenAt: Number.isFinite(Number(raw.firstSeenAt)) ? Number(raw.firstSeenAt) : now,
    lastSeenAt: Number.isFinite(Number(raw.lastSeenAt)) ? Number(raw.lastSeenAt) : now,
    attempts: Number.isFinite(Number(raw.attempts)) ? Math.max(1, Math.floor(Number(raw.attempts))) : 1,
  }
}

export class PendingStore {
  constructor({ file, maxPending = MAX_PENDING_DEFAULT, clock = () => Date.now(), logger } = {}) {
    if (typeof file !== 'string' || !file) throw new Error('dsh-xiaozhi: pending store needs a file path')
    this.file = file
    this.maxPending = maxPending
    this.clock = clock
    this.logger = logger ?? {}
    this.records = new Map()
    this.loaded = false
    this.writeQueue = Promise.resolve()
  }

  async load() {
    if (this.loaded) return
    this.loaded = true
    let text
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    try {
      const parsed = JSON.parse(text)
      const rows = Array.isArray(parsed?.pending) ? parsed.pending : []
      const now = this.clock()
      for (const row of rows) {
        const record = normalize(row, now)
        if (record) this.records.set(record.deviceId, record)
      }
      this.logger.info?.(`dsh-xiaozhi: loaded ${this.records.size} pending device(s)`)
    } catch (error) {
      const quarantine = `${this.file}.corrupt-${Date.now()}`
      this.logger.error?.(`dsh-xiaozhi: pending store is unreadable (${error.message}); moved to ${quarantine}`)
      try {
        await rename(this.file, quarantine)
      } catch {
        // Starting empty beats refusing to boot.
      }
    }
  }

  list() {
    return [...this.records.values()].sort((left, right) => left.firstSeenAt - right.firstSeenAt)
  }

  get(deviceId) {
    return this.records.get(String(deviceId ?? '')) ?? null
  }

  async upsert({ deviceId, clientId = '', ip = '', firmwareVersion = '' }) {
    const id = String(deviceId ?? '').trim()
    if (!id) return null
    const now = this.clock()
    const existing = this.records.get(id)
    if (existing) {
      existing.lastSeenAt = now
      existing.attempts += 1
      if (clientId) existing.clientId = clientId
      if (ip) existing.lastIp = ip
      if (firmwareVersion) existing.firmwareVersion = String(firmwareVersion).slice(0, 32)
      await this.persist()
      return existing
    }
    if (this.records.size >= this.maxPending) {
      this.logger.warn?.(`dsh-xiaozhi: pending device queue is full (${this.maxPending}); ${id} not queued`)
      return null
    }
    const record = {
      deviceId: id,
      clientId,
      lastIp: ip,
      firmwareVersion: String(firmwareVersion ?? '').slice(0, 32),
      firstSeenAt: now,
      lastSeenAt: now,
      attempts: 1,
    }
    this.records.set(id, record)
    await this.persist()
    return record
  }

  async remove(deviceId) {
    const id = String(deviceId ?? '').trim()
    if (!this.records.delete(id)) return false
    await this.persist()
    return true
  }

  persist() {
    this.writeQueue = this.writeQueue.then(() => this.#write()).catch((error) => {
      this.logger.error?.(`dsh-xiaozhi: failed to persist pending store: ${error.message}`)
    })
    return this.writeQueue
  }

  async #write() {
    const document = { version: VERSION, updatedAt: this.clock(), pending: this.list() }
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
    try {
      await chmod(this.file, 0o600)
    } catch {
      // Windows ignores POSIX modes; the file is still user-scoped by profile.
    }
  }
}
