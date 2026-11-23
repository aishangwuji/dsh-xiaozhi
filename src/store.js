/**
 * Durable device registry backed by one JSON document.
 *
 * There is no account, no code, and no approval step: a device that reaches the
 * LAN ingress is the device the operator plugged in, so first contact creates the
 * row (`autoProvision`). What the operator keeps is control, not consent —
 * rename, forget, disconnect.
 *
 * A JSON file with atomic replace is enough for a household roster, and it stays
 * inspectable by hand. The invariant here is that `lastSeenAt` only ever moves
 * forward, so a stale request cannot reorder the audit trail.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const STATE_VERSION = 2
const MAX_DEVICES_DEFAULT = 1000

export class DeviceStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DeviceStoreError'
    this.code = code
  }
}

function createRecord({ deviceId, clientId, ip, now }) {
  return {
    deviceId,
    nickName: '',
    clientId,
    // 绑定的智能体（配置单位）。空串 = 未绑定；启动时 adoptLegacyDevices 会给旧设备补建。
    agentId: '',
    // 绑定的家庭成员（dsh-family 的成员 id，2026-11-23）。空串 = 未绑定。
    // 归属在 family 侧（成员/会话/记忆/审批），这里只记「这台设备替谁说话」；
    // 成员被删后这里可能留下孤儿 id，运行时按「成员已失效」处理，不自动清理（M2）。
    familyMemberId: '',
    notes: '',
    lastIp: ip,
    lastSeenAt: now,
    lastConnectedAt: 0,
    connectionCount: 0,
    // UI「设备」表格用：固件版本来自 OTA 请求头，OTA 开关决定还允不允许升级。
    firmwareVersion: '',
    otaEnabled: true,
    // 每台设备单独关闭的扩展能力（工具名），与其它设备互不影响。
    // @deprecated 2026-11-08 起工具开关属于智能体（AgentStore.toolDisabled）；这里只留给迁移/回滚。
    toolDisabled: [],
    // 设备级配置覆盖：改了只影响这台设备，其余项沿用全局设置。
    // @deprecated 2026-11-08 起人设/模型/音色归智能体（AgentStore.overrides）；这里只留给迁移/回滚。
    overrides: {},
    // 记忆开关：关掉后不再把该设备的记忆注入 system prompt。
    // @deprecated 2026-11-08 起记忆属于智能体（AgentStore.memoryEnabled）；这里只留给迁移/回滚。
    memoryEnabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** Repair a hand-edited or older document instead of refusing to boot. */
function normalizeRecord(raw, now) {
  if (!raw || typeof raw !== 'object' || typeof raw.deviceId !== 'string' || !raw.deviceId) return null
  const record = createRecord({
    deviceId: raw.deviceId,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : '',
    ip: typeof raw.lastIp === 'string' ? raw.lastIp : '',
    now,
  })
  record.nickName = typeof raw.nickName === 'string' ? raw.nickName.slice(0, 64) : ''
  record.agentId = typeof raw.agentId === 'string' ? raw.agentId.slice(0, 64) : ''
  // family 成员 id：只接受字符串，超长/非字符串一律当未绑定（坏文件也要能启动）。
  record.familyMemberId = typeof raw.familyMemberId === 'string' ? raw.familyMemberId.trim().slice(0, 128) : ''
  record.notes = typeof raw.notes === 'string' ? raw.notes.slice(0, 200) : ''
  record.lastSeenAt = Number.isSafeInteger(raw.lastSeenAt) ? raw.lastSeenAt : 0
  record.lastConnectedAt = Number.isSafeInteger(raw.lastConnectedAt) ? raw.lastConnectedAt : 0
  record.connectionCount = Number.isSafeInteger(raw.connectionCount) ? raw.connectionCount : 0
  record.firmwareVersion = typeof raw.firmwareVersion === 'string' ? raw.firmwareVersion.slice(0, 32) : ''
  record.otaEnabled = raw.otaEnabled !== false
  record.memoryEnabled = raw.memoryEnabled !== false
  record.overrides = raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? raw.overrides : {}
  record.toolDisabled = Array.isArray(raw.toolDisabled) ? raw.toolDisabled.filter((name) => typeof name === 'string').slice(0, 50) : []
  record.createdAt = Number.isSafeInteger(raw.createdAt) ? raw.createdAt : now
  record.updatedAt = Number.isSafeInteger(raw.updatedAt) ? raw.updatedAt : now
  return record
}

export class DeviceStore {
  /**
   * @param {object} options
   * @param {string} options.file absolute path of the JSON document
   * @param {number} [options.maxDevices] hard cap so scans and the file stay small
   * @param {() => number} [options.clock] injectable clock for tests
   * @param {{ warn?: Function, error?: Function, info?: Function }} [options.logger]
   */
  constructor({ file, maxDevices = MAX_DEVICES_DEFAULT, clock = () => Date.now(), logger } = {}) {
    if (typeof file !== 'string' || !file) throw new Error('dsh-xiaozhi: device store needs a file path')
    this.file = file
    this.maxDevices = maxDevices
    this.clock = clock
    this.logger = logger ?? {}
    this.devices = new Map()
    this.loaded = false
    this.writeQueue = Promise.resolve()
    /**
     * 新设备登记后的回调（index.js 用它自动建智能体，保持「零接触入网」）。
     * 回调失败只 warn，不影响设备登记本身。
     */
    this.onCreated = null
  }

  /** Load once; a corrupt document is quarantined rather than silently reset. */
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
      const rows = Array.isArray(parsed?.devices) ? parsed.devices : []
      const now = this.clock()
      for (const row of rows) {
        const record = normalizeRecord(row, now)
        if (record) this.devices.set(record.deviceId, record)
      }
      this.logger.info?.(`dsh-xiaozhi: loaded ${this.devices.size} device record(s)`)
    } catch (error) {
      const quarantine = `${this.file}.corrupt-${Date.now()}`
      this.logger.error?.(`dsh-xiaozhi: device store is unreadable (${error.message}); moved to ${quarantine}`)
      try {
        await rename(this.file, quarantine)
      } catch {
        // Starting empty beats refusing to boot; the original file stays intact
        // for an operator when the rename itself fails.
      }
    }
  }

  get size() {
    return this.devices.size
  }

  get(deviceId) {
    return this.devices.get(deviceId)
  }

  list() {
    return [...this.devices.values()]
  }

  /** 绑定了某智能体的设备（顺序 = devices.json 里的顺序）。 */
  listByAgent(agentId) {
    const wanted = String(agentId ?? '')
    if (!wanted) return []
    return this.list().filter((device) => device.agentId === wanted)
  }

  /** 绑定 / 解绑（`agentId` 为空串 = 解绑）。绑定是可逆的，不碰设备的其它字段。 */
  async setAgentId({ deviceId, agentId }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    device.agentId = String(agentId ?? '').trim().slice(0, 64)
    device.updatedAt = this.clock()
    await this.persist()
    return device
  }

  /**
   * 绑定 / 解绑家庭成员（`memberId` 为空串 = 解绑）。
   *
   * 这里**不校验成员是否存在**：成员名册在 dsh-family 里，插件只在控制 API 层校验
   * （服务不可用时也必须允许解绑）。运行时每轮重新读这个字段，所以切成员下一轮生效。
   */
  async setFamilyMemberId({ deviceId, memberId }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    device.familyMemberId = String(memberId ?? '').trim().slice(0, 128)
    device.updatedAt = this.clock()
    await this.persist()
    return device
  }

  /**
   * First contact creates the record (when `autoProvision`), later contacts only
   * refresh the address. Returns what changed so the caller can log a real
   * transition instead of a touch.
   */
  async ensureDevice({ deviceId, clientId = '', ip = '', firmwareVersion = '', autoProvision = true, provisionAgent = true }) {
    const now = this.clock()
    let device = this.devices.get(deviceId)
    let created = false
    if (!device) {
      if (!autoProvision) throw new DeviceStoreError('device-unknown', '设备未登记')
      if (this.devices.size >= this.maxDevices) {
        throw new DeviceStoreError('too-many-devices', `设备数量已达上限 ${this.maxDevices}`)
      }
      device = createRecord({ deviceId, clientId, ip, now })
      if (firmwareVersion) device.firmwareVersion = String(firmwareVersion).slice(0, 32)
      this.devices.set(deviceId, device)
      created = true
      // 零接触入网：新设备立刻有属于自己的智能体（之后可以再绑定到别的智能体上）。
      // 控制台批准时已经选好智能体，会传 provisionAgent=false，避免先多建一个再改绑。
      if (provisionAgent) {
        try {
          await this.onCreated?.(device)
        } catch (error) {
          this.logger.warn?.(`dsh-xiaozhi: auto-provision agent for ${deviceId} failed: ${error.message}`)
        }
      }
    } else {
      if (clientId) device.clientId = clientId
      if (ip) device.lastIp = ip
      if (firmwareVersion) device.firmwareVersion = String(firmwareVersion).slice(0, 32)
      device.lastSeenAt = now
      device.updatedAt = now
    }
    await this.persist()
    return { device, created }
  }

  async recordConnection({ deviceId, ip }) {
    const device = this.devices.get(deviceId)
    if (!device) return
    const now = this.clock()
    device.lastConnectedAt = now
    device.lastSeenAt = now
    device.connectionCount += 1
    if (ip) device.lastIp = ip
    device.updatedAt = now
    await this.persist()
  }

  /** 写入设备级覆盖（人设 / 音色 / 模型），只影响这台设备。 */
  async setOverrides({ deviceId, patch }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    const next = { ...(device.overrides ?? {}) }
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (value === null || value === undefined || value === '') delete next[key]
      else next[key] = value
    }
    device.overrides = next
    device.updatedAt = this.clock()
    await this.persist()
    return device
  }

  /** 记忆开关。 */
  async setMemoryEnabled({ deviceId, enabled }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    device.memoryEnabled = enabled !== false
    device.updatedAt = this.clock()
    await this.persist()
    return device
  }

  /** 该设备关闭了哪些工具。 */
  toolDisabledOf(deviceId) {
    const device = this.devices.get(deviceId)
    return new Set(device?.toolDisabled ?? [])
  }

  /** 按设备开关一个工具，返回最新的关闭集合。 */
  async setToolEnabled({ deviceId, name, enabled }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    const disabled = new Set(device.toolDisabled ?? [])
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    device.toolDisabled = [...disabled]
    device.updatedAt = this.clock()
    await this.persist()
    return device.toolDisabled
  }

  /** OTA 升级开关：关掉后 ingress 不再给这台设备下发新固件。 */
  async setOtaEnabled({ deviceId, enabled }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    device.otaEnabled = enabled !== false
    device.updatedAt = this.clock()
    await this.persist()
    return device
  }

  async rename({ deviceId, nickName }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    device.nickName = String(nickName ?? '').trim().slice(0, 64)
    device.updatedAt = this.clock()
    await this.persist()
    return device
  }

  /** Rename and annotate in one write. */
  async updateSettings({ deviceId, nickName, notes }) {
    const device = this.devices.get(deviceId)
    if (!device) throw new DeviceStoreError('not-found', '设备不存在')
    if (nickName !== undefined) device.nickName = String(nickName ?? '').trim().slice(0, 64)
    if (notes !== undefined) device.notes = String(notes ?? '').trim().slice(0, 200)
    device.updatedAt = this.clock()
    await this.persist()
    return device
  }

  async remove({ deviceId }) {
    if (!this.devices.delete(deviceId)) throw new DeviceStoreError('not-found', '设备不存在')
    await this.persist()
  }

  /** Serialize writes: last writer wins, and a rename is atomic on both OSes. */
  persist() {
    this.writeQueue = this.writeQueue.then(() => this.#write()).catch((error) => {
      this.logger.error?.(`dsh-xiaozhi: failed to persist device store: ${error.message}`)
    })
    return this.writeQueue
  }

  async #write() {
    const document = { version: STATE_VERSION, updatedAt: this.clock(), devices: this.list() }
    const body = `${JSON.stringify(document, null, 2)}\n`
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
    try {
      await chmod(this.file, 0o600)
    } catch {
      // Windows ignores POSIX modes; the file is still user-scoped by profile.
    }
  }
}
