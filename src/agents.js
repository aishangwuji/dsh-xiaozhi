/**
 * 智能体（agent）：配置单位；设备（device）是物理单位。
 *
 * 对齐参考服务端（xiaozhi-esp32-server 的 `ai_agent` / `ai_device.agent_id`）：
 * 人设、模型、音色、语种、语速、静音、记忆开关、工具开关都属于**智能体**，
 * 一台智能体可以绑定多台设备（同一个人格在几块表上说话）。设备记录只留物理属性
 * （MAC、别名、在线、OTA 开关、封禁）和 `agentId` 绑定。
 *
 * 存储是一个可手改的 JSON 文档（`agents.json`，0600），与 devices.json 分开：
 * 智能体是配置，设备是硬件名册，两者的生命周期不同（删智能体会级联删绑定设备，
 * 删单台设备不该影响智能体）。
 *
 * 旧版（v1 只有设备）的迁移在 `adoptLegacyDevices()`：每台还没有 `agentId` 的设备
 * 各建一个智能体，把原来设备上的 overrides / 工具开关 / 记忆开关搬过来，并把它
 * 按设备键存的记忆文件复制到智能体键下——行为与升级前完全一致，只是多了可绑定性。
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const STATE_VERSION = 1
const MAX_NAME = 64
const MAX_TOOLS = 50

export class AgentStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AgentStoreError'
    this.code = code
  }
}

function clipName(value) {
  return String(value ?? '').trim().slice(0, MAX_NAME)
}

/** 智能体名是操作者用来认人的，默认要求唯一（空名不参与比较，避免迁移数据无法启动）。 */
function assertNameAvailable(agents, name, excludeId = '') {
  const candidate = clipName(name)
  if (!candidate) return
  for (const agent of agents.values()) {
    if (agent.id === excludeId) continue
    if (clipName(agent.name) === candidate) {
      throw new AgentStoreError('duplicate-name', `智能体名称「${candidate}」已存在，请换一个`)
    }
  }
}

function createAgent({ name = '', now }) {
  return {
    id: randomUUID(),
    name: clipName(name),
    // 与参考服务端 ai_agent 对齐：人设/模型/音色/语种/语速/静音都在这里，
    // 同一智能体绑定的多台设备共用这一份配置（设备只保留物理属性）。
    overrides: {},
    // 该智能体关闭了哪些扩展能力（工具名）。
    toolDisabled: [],
    // 记忆开关：关掉后不再把该智能体的记忆注入 system prompt。
    memoryEnabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** Repair a hand-edited or older document instead of refusing to boot. */
function normalizeAgent(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : ''
  if (!id) return null
  const agent = createAgent({ name: raw.name, now })
  agent.id = id
  agent.overrides =
    raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides) ? raw.overrides : {}
  agent.toolDisabled = Array.isArray(raw.toolDisabled)
    ? raw.toolDisabled.filter((name) => typeof name === 'string').slice(0, MAX_TOOLS)
    : []
  agent.memoryEnabled = raw.memoryEnabled !== false
  agent.createdAt = Number.isSafeInteger(raw.createdAt) ? raw.createdAt : now
  agent.updatedAt = Number.isSafeInteger(raw.updatedAt) ? raw.updatedAt : now
  return agent
}

export class AgentStore {
  /**
   * @param {object} options
   * @param {string} options.file absolute path of the JSON document
   * @param {() => number} [options.clock] injectable clock for tests
   * @param {{ warn?: Function, error?: Function, info?: Function }} [options.logger]
   */
  constructor({ file, clock = () => Date.now(), logger } = {}) {
    if (typeof file !== 'string' || !file) throw new Error('dsh-xiaozhi: agent store needs a file path')
    this.file = file
    this.clock = clock
    this.logger = logger ?? {}
    this.agents = new Map()
    this.loaded = false
    this.writeQueue = Promise.resolve()
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
      const rows = Array.isArray(parsed?.agents) ? parsed.agents : []
      const now = this.clock()
      for (const row of rows) {
        const agent = normalizeAgent(row, now)
        if (agent) this.agents.set(agent.id, agent)
      }
      this.logger.info?.(`dsh-xiaozhi: loaded ${this.agents.size} agent record(s)`)
    } catch (error) {
      const quarantine = `${this.file}.corrupt-${Date.now()}`
      this.logger.error?.(`dsh-xiaozhi: agent store is unreadable (${error.message}); moved to ${quarantine}`)
      try {
        await rename(this.file, quarantine)
      } catch {
        // Starting empty beats refusing to boot; the original file stays intact
        // for an operator when the rename itself fails.
      }
    }
  }

  get size() {
    return this.agents.size
  }

  get(agentId) {
    return this.agents.get(String(agentId ?? ''))
  }

  list() {
    return [...this.agents.values()]
  }

  async create({ name = '', overrides = {}, toolDisabled = [], memoryEnabled = true } = {}) {
    const now = this.clock()
    assertNameAvailable(this.agents, name)
    const agent = createAgent({ name, now })
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) agent.overrides = { ...overrides }
    agent.toolDisabled = Array.isArray(toolDisabled)
      ? toolDisabled.filter((item) => typeof item === 'string').slice(0, MAX_TOOLS)
      : []
    agent.memoryEnabled = memoryEnabled !== false
    this.agents.set(agent.id, agent)
    await this.persist()
    return agent
  }

  /** 改名 / 改 overrides（`null`、`''` 表示删掉该覆盖项）。 */
  async update({ agentId, name, overrides } = {}) {
    const agent = this.agents.get(String(agentId ?? ''))
    if (!agent) throw new AgentStoreError('not-found', '智能体不存在')
    if (typeof name === 'string') {
      assertNameAvailable(this.agents, name, agent.id)
      agent.name = clipName(name)
    }
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      const next = { ...(agent.overrides ?? {}) }
      for (const [key, value] of Object.entries(overrides)) {
        if (value === null || value === undefined || value === '') delete next[key]
        else next[key] = value
      }
      agent.overrides = next
    }
    agent.updatedAt = this.clock()
    await this.persist()
    return agent
  }

  async setMemoryEnabled({ agentId, enabled }) {
    const agent = this.agents.get(String(agentId ?? ''))
    if (!agent) throw new AgentStoreError('not-found', '智能体不存在')
    agent.memoryEnabled = enabled !== false
    agent.updatedAt = this.clock()
    await this.persist()
    return agent
  }

  /** 按智能体开关一个工具，返回最新的关闭集合。 */
  async setToolEnabled({ agentId, name, enabled }) {
    const agent = this.agents.get(String(agentId ?? ''))
    if (!agent) throw new AgentStoreError('not-found', '智能体不存在')
    const disabled = new Set(agent.toolDisabled ?? [])
    if (enabled) disabled.delete(name)
    else disabled.add(name)
    agent.toolDisabled = [...disabled].slice(0, MAX_TOOLS)
    agent.updatedAt = this.clock()
    await this.persist()
    return agent.toolDisabled
  }

  async remove({ agentId }) {
    if (!this.agents.delete(String(agentId ?? ''))) throw new AgentStoreError('not-found', '智能体不存在')
    await this.persist()
  }

  /** Serialize writes: last writer wins, and a rename is atomic on both OSes. */
  persist() {
    this.writeQueue = this.writeQueue.then(() => this.#write()).catch((error) => {
      this.logger.error?.(`dsh-xiaozhi: failed to persist agent store: ${error.message}`)
    })
    return this.writeQueue
  }

  async #write() {
    const document = { version: STATE_VERSION, updatedAt: this.clock(), agents: this.list() }
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

/**
 * 旧版设备记录 → 智能体。
 *
 * 规则（只跑一次，幂等）：
 *   - 设备已经有 `agentId` 且该智能体存在 → 什么都不做；
 *   - 否则按设备现有配置建一个智能体（**名字与设备无关**，用「智能体 N」），
 *     把 overrides / toolDisabled / memoryEnabled 搬过去，再写回 `device.agentId`；
 *   - 记忆文件从「设备键」复制到「智能体键」（目标已存在就不覆盖）。
 *
 * 设备上的旧字段保留不删：回滚到旧版本时还能按设备配置跑，代价只是多占几十字节。
 *
 * 名字模型（对齐参考服务端 `ai_agent.agent_name` / `ai_device.alias`）：智能体和设备
 * 各自有名字，**不共用**。旧迁移曾把设备昵称抄成智能体名字，这里对「从未编辑过、
 * 名字恰好等于绑定设备昵称」的自动建智能体做一次改名（`updatedAt === createdAt` 是
 * 关键判据，用户改过名或配置的不会被误伤）。
 */
export async function adoptLegacyDevices({ devices, agents, memory, logger } = {}) {
  if (!devices || !agents) return { adopted: 0 }
  const pending = devices.list().filter((device) => {
    if (!device) return false
    const bound = device.agentId ? agents.get(device.agentId) : null
    return !bound
  })
  let adopted = 0
  for (const device of pending) {
    try {
      const agent = await agents.create({
        name: nextAgentName(agents),
        overrides: device.overrides ?? {},
        toolDisabled: device.toolDisabled ?? [],
        memoryEnabled: device.memoryEnabled !== false,
      })
      await devices.setAgentId({ deviceId: device.deviceId, agentId: agent.id })
      await memory?.adopt?.(device.deviceId, agent.id)
      adopted += 1
    } catch (error) {
      logger?.warn?.(`dsh-xiaozhi: 无法为设备 ${device.deviceId} 建智能体: ${error.message}`)
    }
  }

  // 旧迁移留下的「智能体名 = 设备昵称」一次性纠正（幂等：改完名字就不再匹配）。
  let renamed = 0
  for (const agent of agents.list()) {
    const bound = devices.list().filter((device) => device.agentId === agent.id)
    if (bound.length !== 1) continue
    const device = bound[0]
    if (!device?.nickName || agent.name !== device.nickName) continue
    // 从未被编辑过（改名/改配置都会刷新 updatedAt）才认为是迁移产物。
    if (agent.updatedAt !== agent.createdAt) continue
    try {
      await agents.update({ agentId: agent.id, name: nextAgentName(agents) })
      renamed += 1
    } catch (error) {
      logger?.warn?.(`dsh-xiaozhi: 无法重命名智能体 ${agent.id}: ${error.message}`)
    }
  }

  if (adopted > 0) logger?.info?.(`dsh-xiaozhi: adopted ${adopted} legacy device(s) into agents`)
  if (renamed > 0) logger?.info?.(`dsh-xiaozhi: renamed ${renamed} agent(s) away from device nicknames`)
  return { adopted, renamed }
}

/**
 * 智能体的默认名字：与设备名无关，取现有名字里最小的「智能体 N」。
 * 参考服务端里 `agent_name` 由用户创建时填写；这里只是给自动建/迁移一个不冲突的占位名。
 */
export function nextAgentName(agents) {
  const used = new Set((agents?.list?.() ?? []).map((agent) => agent.name).filter(Boolean))
  let n = 1
  while (used.has(`智能体 ${n}`)) n += 1
  return `智能体 ${n}`
}
