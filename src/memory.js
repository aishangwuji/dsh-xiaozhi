/**
 * Per-agent memory.
 *
 * 2026-11-08 起记忆属于智能体（`AgentStore`），键是 `agent.id`：同一智能体绑定的
 * 多台设备共用一份记忆（换一块表说话，它还记得你）。旧版本按设备键存的文件由
 * `adopt()` 在启动迁移时复制到智能体键下，所以升级不丢记忆。
 *
 * The Go server keeps two things alive between sessions (`llm.go:1182`):
 * a `MemoryContext` block appended to the system prompt as
 * `"\n用户个性化信息: \n%s"`, and a rolling history the model can lean on. This
 * module is the local-file equivalent — no Redis, no vector store, no extra LLM
 * call: what the human said last time is what the model sees next time.
 *
 * Two kinds of memory, deliberately separated:
 *   - `turns`  — the last N exchanges, verbatim. Cheap, always safe to inject.
 *   - `facts`  — lines the human asked to keep ("记住我喜欢喝冰美式"). Only
 *                explicit requests land here, so the model never invents a
 *                profile from a single ambiguous sentence.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_TURNS = 8
const MAX_FACTS = 20
const MAX_FACT_LENGTH = 200
const MAX_TURN_LENGTH = 400

function sanitizeId(deviceId) {
  return String(deviceId ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')
}

function clip(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

/** "记住xxx" / "帮我记住 xxx" / "记一下 xxx" — the only way a fact is created. */
export function extractFact(text) {
  const match = /(?:记住|记一下|记下)\s*[:：,，]?\s*(.+)$/u.exec(String(text ?? ''))
  if (!match) return ''
  const fact = clip(match[1], MAX_FACT_LENGTH)
  return fact.length >= 2 ? fact : ''
}

export function createMemoryStore({ dir, maxTurns = MAX_TURNS, maxFacts = MAX_FACTS, now = () => Date.now() } = {}) {
  if (!dir) throw new Error('memory: dir is required')
  const cache = new Map()

  const file = (deviceId) => join(dir, `${sanitizeId(deviceId)}.json`)

  async function load(deviceId) {
    const key = sanitizeId(deviceId)
    if (cache.has(key)) return cache.get(key)
    let record = { deviceId: String(deviceId ?? ''), facts: [], turns: [] }
    try {
      const raw = JSON.parse(await readFile(file(deviceId), 'utf8'))
      record = {
        deviceId: String(raw.deviceId ?? deviceId ?? ''),
        facts: Array.isArray(raw.facts)
          ? raw.facts
              .map((item) => (typeof item === 'string' ? { key: '', value: item } : item))
              .filter((item) => item && typeof item.value === 'string' && item.value.trim())
              .map((item) => ({ key: String(item.key ?? '').slice(0, 24), value: String(item.value).slice(0, MAX_FACT_LENGTH) }))
          : [],
        turns: Array.isArray(raw.turns) ? raw.turns.filter((item) => item && item.user) : [],
      }
    } catch {
      // First contact (or an unreadable file): start empty rather than failing.
    }
    cache.set(key, record)
    return record
  }

  async function save(record) {
    const key = sanitizeId(record.deviceId)
    cache.set(key, record)
    await mkdir(dir, { recursive: true })
    const target = file(record.deviceId)
    const temp = `${target}.tmp`
    await writeFile(temp, JSON.stringify(record, null, 2), { mode: 0o600 })
    await rename(temp, target)
  }

  return {
    file,
    load,

    /** Keep one exchange. Trims to the newest `maxTurns`. */
    async recordTurn(deviceId, { user, assistant }) {
      const spoken = clip(user, MAX_TURN_LENGTH)
      if (!spoken) return
      const record = await load(deviceId)
      record.turns.push({ at: now(), user: spoken, assistant: clip(assistant, MAX_TURN_LENGTH) })
      record.turns = record.turns.slice(-maxTurns)
      await save(record)
    },

    /** 新增一条记忆（键可选）。同键覆盖，同值去重。 */
    async remember(deviceId, fact, key = '') {
      const value = clip(fact, MAX_FACT_LENGTH)
      if (value.length < 2) return false
      const label = clip(key, 24)
      const record = await load(deviceId)
      const existing = record.facts.findIndex((item) => (label ? item.key === label : item.value === value))
      if (existing >= 0) {
        if (record.facts[existing].value === value) return false
        record.facts[existing] = { key: label, value }
      } else {
        record.facts.push({ key: label, value })
      }
      record.facts = record.facts.slice(-maxFacts)
      await save(record)
      return true
    },

    /** 删除第 index 条记忆。 */
    async removeFact(deviceId, index) {
      const record = await load(deviceId)
      if (index < 0 || index >= record.facts.length) return false
      record.facts.splice(index, 1)
      await save(record)
      return true
    },

    /** Regenerate from the stored facts and turns. */
    async contextFor(deviceId) {
      const record = await load(deviceId)
      if (record.facts.length === 0 && record.turns.length === 0) return ''
      // Plain lines only. The Go server injects whatever its memory provider
      // returns (`memoryProvider.GetContext(ctx, deviceID, 500)`) — it does not
      // add headings of its own, and neither do we, so the resulting prompt keeps
      // exactly the original shape:
      //   systemPrompt + "\n用户个性化信息: \n" + context
      const lines = []
      for (const fact of record.facts) lines.push(fact.key ? `${fact.key}: ${fact.value}` : fact.value)
      for (const turn of record.turns.slice(-4)) {
        lines.push(`用户: ${turn.user}`)
        if (turn.assistant) lines.push(`助手: ${turn.assistant}`)
      }
      // 500 is the same budget the Go server passes to GetContext.
      return lines.join('\n').slice(0, 500)
    },

    /**
     * 把「设备键」的旧记忆文件复制到「智能体键」下（目标已存在则不动）。
     * 只做文件级复制，不预热缓存；返回是否真的复制了。
     */
    async adopt(fromId, toId) {
      const from = sanitizeId(fromId)
      const to = sanitizeId(toId)
      if (!fromId || !toId || from === to) return false
      const target = join(dir, `${to}.json`)
      try {
        await readFile(target, 'utf8')
        return false
      } catch (error) {
        if (error.code !== 'ENOENT') return false
      }
      try {
        const body = await readFile(file(fromId), 'utf8')
        // 文件内的 deviceId 必须改成新键：save() 按 record.deviceId 落盘，不改的话
        // 之后的「记住…」会写回旧设备的文件，智能体键下永远是升级前那份。
        const parsed = JSON.parse(body)
        parsed.deviceId = String(toId)
        await mkdir(dir, { recursive: true })
        await writeFile(target, JSON.stringify(parsed, null, 2), { mode: 0o600 })
        return true
      } catch {
        return false
      }
    },

    /** Read-only view for the console. */
    async summary(deviceId) {
      const record = await load(deviceId)
      return {
        deviceId: record.deviceId,
        facts: [...record.facts],
        turns: record.turns.slice(-4),
        updatedAt: record.turns.at(-1)?.at ?? null,
      }
    },

    async forget(deviceId) {
      const record = { deviceId: String(deviceId ?? ''), facts: [], turns: [] }
      await save(record)
      return record
    },
  }
}

/** Compose the final system prompt the way the Go server does. */
export function withMemory(systemPrompt, memoryText) {
  const base = String(systemPrompt ?? '')
  const extra = String(memoryText ?? '').trim()
  if (!extra) return base
  return `${base}\n用户个性化信息: \n${extra}`
}
