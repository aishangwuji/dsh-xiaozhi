/**
 * 智能体 → DSH 会话的绑定（`voice-sessions.json`）。
 *
 * 为什么要单独一个文件：`agents.json` 是「配置单位」，会话 id 是运行期状态
 * （首次连上时创建、删了可以重建），两者的生命周期不同；混进 agents.json 会让
 * 「删智能体重建」和「会话失效重绑」互相污染。这里只存最小映射，坏了就返回空、
 * 下次连接重新建一条，不阻断语音。
 *
 * 与官方参考服务端没有对应物：那边没有"宿主会话"概念。
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const STATE_VERSION = 1

export class SessionBindingStore {
  /**
   * @param {object} options
   * @param {string} options.file absolute path
   * @param {() => number} [options.clock]
   * @param {{ warn?: Function, error?: Function, info?: Function }} [options.logger]
   */
  constructor({ file, clock = () => Date.now(), logger } = {}) {
    if (typeof file !== 'string' || !file) throw new Error('dsh-xiaozhi: session bindings need a file path')
    this.file = file
    this.clock = clock
    this.logger = logger ?? {}
    this.agents = new Map()
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
      const rows = parsed?.agents && typeof parsed.agents === 'object' ? parsed.agents : {}
      for (const [agentId, sessionId] of Object.entries(rows)) {
        if (typeof agentId !== 'string' || !agentId) continue
        // 只收 session- 开头的 id：手改成别的值没有意义，还会让 prompt 永远失败。
        if (typeof sessionId === 'string' && /^session-[A-Za-z0-9._-]{1,80}$/.test(sessionId)) {
          this.agents.set(agentId, sessionId)
        }
      }
      this.logger.info?.(`dsh-xiaozhi: loaded ${this.agents.size} voice session binding(s)`)
    } catch (error) {
      // 与 agents.json 不同：这份是纯运行期缓存，坏了直接忽略，不值得隔离文件。
      this.logger.warn?.(`dsh-xiaozhi: voice session bindings unreadable (${error.message}); starting empty`)
    }
  }

  get(agentId) {
    return this.agents.get(String(agentId ?? '')) ?? ''
  }

  async set(agentId, sessionId) {
    const key = String(agentId ?? '')
    if (!key) throw new Error('session binding: agentId is required')
    const value = String(sessionId ?? '')
    if (!/^session-[A-Za-z0-9._-]{1,80}$/.test(value)) throw new Error(`session binding: invalid sessionId "${value}"`)
    this.agents.set(key, value)
    await this.persist()
    return value
  }

  async remove(agentId) {
    if (!this.agents.delete(String(agentId ?? ''))) return false
    await this.persist()
    return true
  }

  persist() {
    this.writeQueue = this.writeQueue.then(() => this.#write()).catch((error) => {
      this.logger.error?.(`dsh-xiaozhi: failed to persist session bindings: ${error.message}`)
    })
    return this.writeQueue
  }

  async #write() {
    const document = {
      version: STATE_VERSION,
      updatedAt: this.clock(),
      agents: Object.fromEntries(this.agents),
    }
    const body = `${JSON.stringify(document, null, 2)}\n`
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
    try {
      await chmod(this.file, 0o600)
    } catch {
      // Windows ignores POSIX modes; the file stays inside the user profile.
    }
  }
}
