/**
 * 对话历史 v2：「会话 + 消息 + 音频」。
 *
 * 与记忆的区别：记忆是"要记住的信息"（可编辑、会注入 prompt），历史是
 * "说过什么"的流水（只读、不注入）。参考官方 manager 的
 * `ai_agent_chat_history`（session_id + chat_type + content + audio_id）与
 * `ai_agent_chat_audio`，这里用本地文件实现，零依赖：
 *
 *   history/<sanitize(deviceId)>.jsonl
 *     {"at":<epoch ms>,"session":"<sessionId>","role":"user"|"assistant","content":"…","audioId":"<32hex>"|null}
 *   history/audio/<sanitize(deviceId)>/<audioId>.wav   PCM16 单声道（用户 16k / 助手 24k）
 *
 * 兼容：旧格式 `{at,user,assistant}` 在**读取时**迁移。连续旧行按 10 分钟间隔
 * 聚合成 legacy 会话（`session="legacy-<该会话首行的 at>"`），每行拆成 user/assistant
 * 两条消息——否则真实数据里 48 行旧记录会变成 48 个「会话」，控制台根本没法用。
 * 新写入只写新格式。
 *
 * 保留策略：
 *   - 文本：每设备最多 maxMessages 条（默认 5000），超出裁到最近 maxMessages；
 *   - 音频：保留 retentionDays 天（默认 30），并限制总容量（默认 500MB，最旧优先清理）；
 *   - 单条音频 > maxAudioSeconds（默认 120s）截断。
 * cleanup() 启动时跑一次 + 每日跑；任何失败只 warn，不抛。
 *
 * 失败降级：appendMessages/saveAudio 是「尽力而为」——调用方（VoiceSession）用
 * fire-and-forget + catch，绝不影响语音主链路；音频写盘失败也不影响文本落库
 * （两条路径互相独立，见 session.js 的 #recordTurn）。
 */

import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000

/** 连续旧格式行聚合成同一 legacy 会话的最大时间间隔。 */
export const LEGACY_SESSION_GAP_MS = 10 * 60 * 1000

const DEFAULT_MAX_MESSAGES = 5000
const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_AUDIO_MAX_BYTES = 500 * 1024 * 1024
const DEFAULT_AUDIO_MAX_SECONDS = 120
const MAX_CONTENT_CHARS = 2000
const MAX_SESSION_ID_CHARS = 120
const MAX_PREVIEW_CHARS = 80
const TITLE_CHARS = 20

function sanitizeId(deviceId) {
  return String(deviceId ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')
}

/** audioId 只允许字母数字：它直接拼进文件路径，绝不能让 `../` 之类进来。 */
export function isAudioId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9]{1,64}$/.test(value)
}

/** 标题：去掉空白/标点/符号，最多 20 个字符；不调 LLM。 */
export function deriveTitle(content) {
  const cleaned = String(content ?? '').replace(/[\s\u3000\p{P}\p{S}]+/gu, '')
  return Array.from(cleaned).slice(0, TITLE_CHARS).join('')
}

/**
 * 把 PCM16 单声道数据包成 WAV。数据按偶数长度截断（半个采样没有意义）。
 * @param {Buffer|Uint8Array} pcm
 * @param {number} sampleRate
 */
export function pcmToWav(pcm, sampleRate) {
  const raw = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm ?? [])
  const data = raw.subarray(0, raw.length - (raw.length % 2))
  const rate = Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0 ? Math.trunc(Number(sampleRate)) : 24_000
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function clockLabel(ms) {
  const date = new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now())
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 把一行 JSONL 解成「新格式记录」或「旧格式记录」，坏行直接跳过。 */
function parseRecords(text) {
  const records = []
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue
    let raw
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const at = Number.isFinite(Number(raw.at)) ? Math.trunc(Number(raw.at)) : 0
    if (typeof raw.session === 'string' && (raw.role === 'user' || raw.role === 'assistant')) {
      const content = typeof raw.content === 'string' ? raw.content.trim() : String(raw.content ?? '').trim()
      records.push({
        legacy: false,
        session: String(raw.session).slice(0, MAX_SESSION_ID_CHARS),
        role: raw.role,
        content: content.slice(0, MAX_CONTENT_CHARS),
        at,
        audioId: isAudioId(raw.audioId) ? raw.audioId : null,
      })
      continue
    }
    const user = typeof raw.user === 'string' ? raw.user.trim() : ''
    const assistant = typeof raw.assistant === 'string' ? raw.assistant.trim() : ''
    if (!user && !assistant) continue
    records.push({ legacy: true, at, user, assistant })
  }
  return records
}

/**
 * 兼容读：旧记录按 10 分钟间隔聚合成 legacy 会话，新记录原样带 session。
 * @returns {Array<{session:string,role:string,content:string,at:number,audioId:string|null}>}
 */
function materializeMessages(records) {
  const messages = []
  let legacySession = ''
  let legacyAt = 0
  for (const record of records) {
    if (record.legacy) {
      if (!legacySession || record.at - legacyAt > LEGACY_SESSION_GAP_MS || record.at < legacyAt) {
        legacySession = `legacy-${record.at}`
      }
      legacyAt = record.at
      if (record.user) {
        messages.push({ session: legacySession, role: 'user', content: record.user.slice(0, MAX_CONTENT_CHARS), at: record.at, audioId: null })
      }
      if (record.assistant) {
        messages.push({
          session: legacySession,
          role: 'assistant',
          content: record.assistant.slice(0, MAX_CONTENT_CHARS),
          at: record.at,
          audioId: null,
        })
      }
      continue
    }
    // 新格式记录打断 legacy 连续段：之后即便再出现旧行也不该和前面合并。
    legacySession = ''
    messages.push(record)
  }
  return messages
}

/** 按 session 聚合，新会话在前。返回对象里的 messages 是完整消息数组（内部用）。 */
function groupConversations(messages, clock) {
  const bySession = new Map()
  for (const message of messages) {
    let group = bySession.get(message.session)
    if (!group) {
      group = { sessionId: message.session, list: [] }
      bySession.set(message.session, group)
    }
    group.list.push(message)
  }
  const conversations = []
  for (const group of bySession.values()) {
    const list = group.list
    const times = list.map((message) => message.at).filter((at) => Number.isFinite(at) && at > 0)
    const startedAt = times.length > 0 ? Math.min(...times) : clock()
    const endedAt = times.length > 0 ? Math.max(...times) : startedAt
    const firstUser = list.find((message) => message.role === 'user' && message.content)
    const firstAssistant = list.find((message) => message.role === 'assistant' && message.content)
    const last = list[list.length - 1]
    conversations.push({
      sessionId: group.sessionId,
      title: deriveTitle(firstUser?.content) || deriveTitle(firstAssistant?.content) || `对话 ${clockLabel(startedAt)}`,
      startedAt,
      endedAt,
      preview: String(last?.content ?? '').slice(0, MAX_PREVIEW_CHARS),
      hasAudio: list.some((message) => Boolean(message.audioId)),
      list,
    })
  }
  conversations.sort((a, b) => b.endedAt - a.endedAt || b.startedAt - a.startedAt)
  return conversations
}

function publicConversation(conversation) {
  return {
    sessionId: conversation.sessionId,
    title: conversation.title,
    startedAt: conversation.startedAt,
    endedAt: conversation.endedAt,
    messages: conversation.list.length,
    preview: conversation.preview,
    hasAudio: conversation.hasAudio,
  }
}

function publicMessages(conversation) {
  return conversation.list.map((message) => ({
    role: message.role,
    content: message.content,
    at: message.at,
    audioId: message.audioId ?? null,
  }))
}

/**
 * @param {object} options
 * @param {string} options.dir 消息目录（`<dataRoot>/history`）
 * @param {string} [options.audioDir] 音频根目录，默认 `<dir>/audio`
 * @param {number} [options.maxMessages] 每设备文本消息上限
 * @param {number} [options.retentionDays] 音频保留天数
 * @param {number} [options.maxAudioBytes] 音频总容量上限
 * @param {number} [options.maxAudioSeconds] 单条音频最长秒数
 * @param {Function} [options.clock] 可注入时钟（测试用）
 * @param {object} [options.logger]
 */
export function createHistoryStore({
  dir,
  audioDir,
  maxMessages = DEFAULT_MAX_MESSAGES,
  retentionDays = DEFAULT_RETENTION_DAYS,
  maxAudioBytes = DEFAULT_AUDIO_MAX_BYTES,
  maxAudioSeconds = DEFAULT_AUDIO_MAX_SECONDS,
  clock = () => Date.now(),
  logger = {},
} = {}) {
  if (!dir) throw new Error('history: dir is required')

  const messageLimit = Number.isSafeInteger(maxMessages) && maxMessages > 0 ? maxMessages : DEFAULT_MAX_MESSAGES
  const retentionMs = (Number.isFinite(Number(retentionDays)) && Number(retentionDays) >= 0 ? Number(retentionDays) : DEFAULT_RETENTION_DAYS) * DAY_MS
  const audioBytesLimit = Number.isFinite(Number(maxAudioBytes)) && Number(maxAudioBytes) > 0 ? Number(maxAudioBytes) : DEFAULT_AUDIO_MAX_BYTES
  const audioSecondLimit = Number.isFinite(Number(maxAudioSeconds)) && Number(maxAudioSeconds) > 0 ? Number(maxAudioSeconds) : DEFAULT_AUDIO_MAX_SECONDS
  const audioRoot = resolve(audioDir ?? join(dir, 'audio'))

  // 行数缓存：避免「刚追加完为了判断是否超限又整文件读一遍」。只在首次写入或
  // 已知超限时才读文件；读取失败时清掉缓存，下一次重试。
  const lineCounts = new Map()

  const messageFile = (deviceId) => join(dir, `${sanitizeId(deviceId)}.jsonl`)
  const audioDirOf = (deviceId) => join(audioRoot, sanitizeId(deviceId))

  async function readRecords(deviceId) {
    try {
      const text = await readFile(messageFile(deviceId), 'utf8')
      return parseRecords(text)
    } catch {
      return []
    }
  }

  /** 裁剪单文件到最新 messageLimit 条；返回被删条数。 */
  async function trimMessageFile(target) {
    let count = lineCounts.get(target)
    let text
    if (count === undefined) {
      try {
        text = await readFile(target, 'utf8')
      } catch {
        return 0
      }
      count = text.split('\n').filter(Boolean).length
      lineCounts.set(target, count)
    }
    if (count <= messageLimit) return 0
    if (text === undefined) {
      try {
        text = await readFile(target, 'utf8')
      } catch {
        lineCounts.delete(target)
        return 0
      }
    }
    const lines = text.split('\n').filter(Boolean)
    const kept = lines.slice(-messageLimit)
    await writeFile(target, kept.length > 0 ? `${kept.join('\n')}\n` : '', { mode: 0o600 })
    lineCounts.set(target, kept.length)
    return lines.length - kept.length
  }

  async function writeMessages(deviceId, messages) {
    const target = messageFile(deviceId)
    await mkdir(dir, { recursive: true })
    const lines = messages.map((message) =>
      JSON.stringify({
        at: message.at,
        session: message.session,
        role: message.role,
        content: message.content,
        audioId: message.audioId ?? null,
      }),
    )
    await writeFile(target, lines.length > 0 ? `${lines.join('\n')}\n` : '', { mode: 0o600 })
    lineCounts.set(target, lines.length)
  }

  async function removeAudioFiles(deviceId, audioIds) {
    let removed = 0
    for (const audioId of new Set(audioIds.filter(isAudioId))) {
      try {
        await rm(join(audioDirOf(deviceId), `${audioId}.wav`), { force: true })
        removed += 1
      } catch {
        // 文件本来就不在也无所谓。
      }
    }
    return removed
  }

  return {
    file: messageFile,
    audioDir: audioDirOf,

    // ------------------------------------------------------------ 新格式写入

    /**
     * 追加一轮（或几条）消息。异步、会抛 fs 错误——调用方负责 catch 并降级。
     * @param {string} deviceId
     * @param {string} sessionId
     * @param {Array<{role:string,content:string,at?:number,audioId?:string|null}>} messages
     * @returns {Promise<number>} 实际写入条数
     */
    async appendMessages(deviceId, sessionId, messages) {
      if (!Array.isArray(messages) || messages.length === 0) return 0
      const session = String(sessionId ?? '').trim().slice(0, MAX_SESSION_ID_CHARS)
      const normalized = []
      for (const message of messages) {
        const role = message?.role === 'user' || message?.role === 'assistant' ? message.role : ''
        const content = String(message?.content ?? '').trim()
        if (!role || !content) continue
        const at = Number.isFinite(Number(message?.at)) ? Math.trunc(Number(message.at)) : clock()
        normalized.push({
          at,
          session,
          role,
          content: content.slice(0, MAX_CONTENT_CHARS),
          audioId: isAudioId(message?.audioId) ? message.audioId : null,
        })
      }
      if (normalized.length === 0) return 0
      const target = messageFile(deviceId)
      await mkdir(dir, { recursive: true })
      await appendFile(target, `${normalized.map((message) => JSON.stringify(message)).join('\n')}\n`, { mode: 0o600 })
      const cached = lineCounts.get(target)
      if (cached !== undefined) lineCounts.set(target, cached + normalized.length)
      await trimMessageFile(target)
      return normalized.length
    },

    /** 兼容旧调用：把一轮问答转成新格式（每轮一个 legacy 会话）。 */
    async append(deviceId, { user, assistant } = {}) {
      const question = String(user ?? '').trim()
      if (!question) return
      const at = clock()
      await this.appendMessages(deviceId, `legacy-${at}`, [
        { role: 'user', content: question, at },
        { role: 'assistant', content: String(assistant ?? '').trim(), at },
      ])
    },

    // ------------------------------------------------------------ 新格式读取

    /** 会话列表，新→旧；messages 是条数（控制台列表按这个显示 N 条）。 */
    async listConversations(deviceId, limit = 50) {
      const bounded = Number.isFinite(Number(limit))
        ? Math.max(1, Math.min(Math.trunc(Number(limit)), 200))
        : 50
      // 只读一次：解析 + 分组 + 截断都在内存里完成，不为了「先数会话再取详情」读第二遍。
      const records = await readRecords(deviceId)
      const conversations = groupConversations(materializeMessages(records), clock)
      return conversations.slice(0, bounded).map(publicConversation)
    },

    /** 单个会话详情；找不到返回 null。 */
    async getConversation(deviceId, sessionId) {
      const wanted = String(sessionId ?? '').trim()
      if (!wanted) return null
      const records = await readRecords(deviceId)
      const conversations = groupConversations(materializeMessages(records), clock)
      const conversation = conversations.find((entry) => entry.sessionId === wanted)
      if (!conversation) return null
      return {
        sessionId: conversation.sessionId,
        title: conversation.title,
        startedAt: conversation.startedAt,
        endedAt: conversation.endedAt,
        messages: publicMessages(conversation),
      }
    },

    /** 兼容旧语义：最近 N 轮问答，新的在后。 */
    async list(deviceId, limit = 50) {
      const bounded = Number.isFinite(Number(limit))
        ? Math.max(1, Math.min(Math.trunc(Number(limit)), 500))
        : 50
      const records = await readRecords(deviceId)
      const entries = []
      let pending = null
      for (const record of records) {
        if (record.legacy) {
          entries.push({ at: record.at, user: record.user, assistant: record.assistant })
          pending = null
          continue
        }
        if (record.role === 'user') {
          if (pending) entries.push(pending)
          pending = { at: record.at, user: record.content, assistant: '' }
          continue
        }
        if (pending) {
          pending.assistant = record.content
          entries.push(pending)
          pending = null
        } else {
          entries.push({ at: record.at, user: '', assistant: record.content })
        }
      }
      if (pending) entries.push(pending)
      return entries.slice(-bounded)
    },

    // ------------------------------------------------------------------ 音频

    /**
     * 写一条 WAV（PCM16 单声道）。空 buffer 返回 null；超过 maxAudioSeconds 截断。
     * 失败只 warn 并返回 null（音频永远不影响文本落库）。
     * @param {string} deviceId
     * @param {Buffer|Uint8Array} pcm
     * @param {{sampleRate?:number}} [options]
     * @returns {Promise<string|null>} audioId
     */
    async saveAudio(deviceId, pcm, { sampleRate = 24_000 } = {}) {
      if (!pcm || !pcm.length) return null
      try {
        const raw = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm)
        const rate = Number.isFinite(Number(sampleRate)) && Number(sampleRate) > 0 ? Math.trunc(Number(sampleRate)) : 24_000
        const maxBytes = Math.floor(rate * 2 * audioSecondLimit)
        const clipped = raw.length > maxBytes ? raw.subarray(0, maxBytes) : raw
        const even = clipped.subarray(0, clipped.length - (clipped.length % 2))
        if (even.length === 0) return null
        const audioId = randomUUID().replace(/-/g, '')
        const targetDir = audioDirOf(deviceId)
        await mkdir(targetDir, { recursive: true })
        await writeFile(join(targetDir, `${audioId}.wav`), pcmToWav(even, rate), { mode: 0o600 })
        return audioId
      } catch (error) {
        logger.warn?.(`dsh-xiaozhi: history audio write failed for ${sanitizeId(deviceId)}: ${error.message}`)
        return null
      }
    },

    /**
     * 返回音频文件路径与大小（控制 API 用 createReadStream 流式返回），缺失/非法 id 返回 null。
     * audioId 只允许 [A-Za-z0-9]，并再做一次 resolved path 前缀校验防穿越。
     */
    async readAudio(deviceId, audioId) {
      if (!isAudioId(audioId)) return null
      const file = resolve(join(audioDirOf(deviceId), `${audioId}.wav`))
      if (!file.startsWith(`${audioRoot}${sep}`)) return null
      try {
        const info = await stat(file)
        if (!info.isFile()) return null
        return { file, size: info.size }
      } catch {
        return null
      }
    },

    // ---------------------------------------------------------------- 清理

    /**
     * 清一个会话（消息 + 它用到的音频），其它会话保留。
     * 顺带把旧格式行重写成新格式（迁移只发生一次）。
     */
    async clearConversation(deviceId, sessionId) {
      const wanted = String(sessionId ?? '').trim()
      if (!wanted) return this.clearDevice(deviceId)
      const records = await readRecords(deviceId)
      const messages = materializeMessages(records)
      const removed = messages.filter((message) => message.session === wanted)
      if (removed.length === 0) {
        return { sessionId: wanted, removedMessages: 0, removedAudio: 0 }
      }
      const kept = messages.filter((message) => message.session !== wanted)
      await writeMessages(deviceId, kept)
      const removedAudio = await removeAudioFiles(deviceId, removed.map((message) => message.audioId))
      return { sessionId: wanted, removedMessages: removed.length, removedAudio }
    },

    /** 清整台设备（消息 + 音频目录）。 */
    async clearDevice(deviceId) {
      const target = messageFile(deviceId)
      let removedMessages = 0
      try {
        const text = await readFile(target, 'utf8')
        removedMessages = text.split('\n').filter(Boolean).length
      } catch {
        removedMessages = 0
      }
      await rm(target, { force: true })
      await rm(audioDirOf(deviceId), { recursive: true, force: true })
      lineCounts.delete(target)
      return { removedMessages }
    },

    /** 兼容旧语义：清空该设备的历史。 */
    async clear(deviceId) {
      return this.clearDevice(deviceId)
    },

    /**
     * 保留策略：过期音频 + 超容量音频 + 超长消息文件。启动与每日各一次。
     * 任何失败只 warn，返回已完成的统计。
     */
    async cleanup() {
      const result = { removedAudio: 0, removedBytes: 0, trimmedMessages: 0 }
      try {
        const cutoff = clock() - retentionMs
        const files = []
        const deviceDirs = []
        try {
          for (const entry of await readdir(audioRoot, { withFileTypes: true })) {
            if (entry.isDirectory()) deviceDirs.push(entry.name)
          }
        } catch {
          // 还没有音频目录。
        }
        for (const name of deviceDirs) {
          const dirPath = join(audioRoot, name)
          let entries = []
          try {
            entries = await readdir(dirPath, { withFileTypes: true })
          } catch {
            continue
          }
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.wav')) continue
            const file = join(dirPath, entry.name)
            try {
              const info = await stat(file)
              files.push({ file, size: info.size, mtimeMs: info.mtimeMs })
            } catch {
              // 文件刚好被删掉。
            }
          }
        }
        // 1) 过期的最旧优先。
        const fresh = []
        for (const file of files) {
          if (file.mtimeMs < cutoff) {
            try {
              await rm(file.file, { force: true })
              result.removedAudio += 1
              result.removedBytes += file.size
            } catch {
              // 删不掉就留着，下次再试。
            }
          } else {
            fresh.push(file)
          }
        }
        // 2) 容量上限：仍按最旧优先清理。
        fresh.sort((a, b) => a.mtimeMs - b.mtimeMs)
        let total = fresh.reduce((sum, file) => sum + file.size, 0)
        for (const file of fresh) {
          if (total <= audioBytesLimit) break
          try {
            await rm(file.file, { force: true })
            total -= file.size
            result.removedAudio += 1
            result.removedBytes += file.size
          } catch {
            // 同上。
          }
        }
        // 3) 清空后的设备音频目录一并回收。
        for (const name of deviceDirs) {
          const dirPath = join(audioRoot, name)
          try {
            if ((await readdir(dirPath)).length === 0) await rm(dirPath, { force: true })
          } catch {
            // 目录可能已经不在。
          }
        }
        // 4) 文本按 maxMessages 裁剪（历史遗留的超大文件）。
        try {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
            result.trimmedMessages += await trimMessageFile(join(dir, entry.name))
          }
        } catch {
          // 还没有历史目录。
        }
      } catch (error) {
        logger.warn?.(`dsh-xiaozhi: history cleanup failed: ${error.message}`)
      }
      return result
    },
  }
}
