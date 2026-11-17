/**
 * Runtime settings.
 *
 * Provider credentials and endpoints change without a plugin restart. The
 * overrides live in `settings.json` (0600) and are layered over the Loader
 * config, so the console can edit them while devices stay connected.
 *
 * There is no login here on purpose: whoever can open the panel already holds
 * the machine (the console is served by the loopback-only Harness web server),
 * so a second password would only be ceremony.
 *
 * Secrets are stored, never echoed: `snapshot()` returns presence + a masked
 * tail, and an update with an empty secret means "keep the stored one".
 *
 * Version 3 adds per-stage "backup providers" (`docs/backup-providers.md`): the
 * blank-means-keep rule applies per entry too, matched by a server-issued `id`,
 * and a stage whose list is empty behaves exactly like the pre-v3 pipeline. The
 * list has **no count cap**: order is priority, the user decides how many.
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { allProvidersForStage } from './providers.js'

const STATE_VERSION = 3
// 备用服务商条数**不设上限**（2026-11-08 去掉原来的 5 条上限）：顺序即优先级，用户想加
// 几条就加几条。这里没有业务条数检查，唯一的现实边界是控制 API 的 JSON 体积上限
// （`control.js` 的 MAX_JSON_BODY，64 KB）——那是防滥用的基础设施闸门，不是业务规则。

export class SettingsError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SettingsError'
    this.code = code
  }
}

function mask(value) {
  const text = String(value ?? '')
  if (!text) return ''
  if (text.length <= 4) return '••••'
  return `${text.slice(0, Math.min(3, text.length - 4))}••••${text.slice(-2)}`
}

/**
 * 备用服务商条目（`docs/backup-providers.md` 第 1/2 节）。
 *
 * 每个环节能填的字段和 provider 白名单都不同，集中放一张表：保存时按表校验裁剪，
 * 读取时按表出掩码，两处不会各写一套。`mock` 故意不在白名单里（备用必须是真实服务商）；
 * LLM 的 `host` **在**白名单里（2026-11-10）：它表示「复用 DSH 已配置的厂商」，
 * 是用户显式选择，不算偷偷消耗 Harness 额度。
 */
export const BACKUP_SPEC = {
  llm: {
    label: 'LLM',
    // 与 `src/providers.js` 的描述符同源（含 hidden 的 funasr）：加厂商只改描述符，
    // 这里自动跟上，不会出现「控制台能选、保存被拒」。
    providers: allProvidersForStage('llm'),
    fields: [
      ['hostProvider', 64],
      ['model', 80],
      ['baseUrl', 300],
      ['appId', 64],
    ],
    secrets: ['apiKey'],
  },
  tts: {
    label: 'TTS',
    providers: allProvidersForStage('tts'),
    fields: [
      ['voice', 64],
      ['rate', 12],
      ['speed', 6],
      ['model', 64],
      ['resourceId', 64],
      ['url', 200],
      ['appId', 64],
    ],
    secrets: ['apiKey', 'apiSecret'],
  },
  asr: {
    label: 'ASR',
    providers: allProvidersForStage('asr'),
    fields: [
      ['url', 200],
      ['language', 16],
      ['accent', 16],
      ['resourceId', 64],
      ['appId', 64],
    ],
    secrets: ['apiKey', 'apiSecret'],
  },
}

/** 掩码里固定带 `•`，前端把它原样回传；真实密钥里不会有这个字符。 */
function isMasked(value) {
  return String(value ?? '').includes('•')
}

/** 普通字段：只收字符串，按主用同名字段的上限裁剪；`speed` 主用允许数字。 */
function readEntryField(field, value, limit) {
  if (field === 'speed' && (typeof value === 'string' || typeof value === 'number')) {
    return String(value).trim().slice(0, limit)
  }
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

/**
 * 把请求里的一条备用配置整理成落盘形状。
 *
 * 密钥规则（契约第 2 节）：非空且不含 `•` = 新值；空或掩码 = 只有「同 id 且同
 * provider」的旧条目才保留旧 secret；换 provider 或新条目一律置空（不能让旧密钥
 * 跟着条目漂到另一家服务商）。`clearApiKey` / `clearApiSecret` 优先于一切。
 */
function normalizeBackupEntry(stage, raw, index, previous) {
  const spec = BACKUP_SPEC[stage]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SettingsError('invalid', `${spec.label} 第 ${index + 1} 条备用服务商必须是对象`)
  }
  const provider = typeof raw.provider === 'string' ? raw.provider.trim().slice(0, 20) : ''
  if (!spec.providers.includes(provider)) {
    throw new SettingsError(
      'invalid',
      `${spec.label} 第 ${index + 1} 条备用服务商的 provider 不受支持：${provider || '（空）'}`,
    )
  }
  // 只认服务端此前发出去的 id；未知 id 当新条目，避免借用别的条目的 id 把密钥搬走。
  const prior = typeof raw.id === 'string' ? previous.get(raw.id) : undefined
  const sameProvider = Boolean(prior) && prior.provider === provider
  const entry = { id: prior ? prior.id : randomUUID(), provider }
  for (const [field, limit] of spec.fields) entry[field] = readEntryField(field, raw[field], limit)
  for (const secret of spec.secrets) {
    const flag = secret === 'apiKey' ? 'clearApiKey' : 'clearApiSecret'
    const given = typeof raw[secret] === 'string' ? raw[secret].trim() : ''
    if (raw[flag] === true) {
      entry[secret] = ''
    } else if (given && !isMasked(given)) {
      entry[secret] = given.slice(0, 200)
    } else if (sameProvider && typeof prior[secret] === 'string') {
      entry[secret] = prior[secret]
    } else {
      entry[secret] = ''
    }
  }
  return entry
}

/** 保存时整段校验：任何一条不合法都抛错，由 update() 丢弃整个副本（不做半保存）。 */
function normalizeBackups(stage, input, current) {
  const spec = BACKUP_SPEC[stage]
  if (!Array.isArray(input)) throw new SettingsError('invalid', `${spec.label} 的备用服务商必须是数组`)
  // 不检查条数：备用列表没有上限，顺序即优先级（2026-11-08）。
  const previous = new Map()
  for (const item of current ?? []) {
    if (item && typeof item === 'object' && typeof item.id === 'string') previous.set(item.id, item)
  }
  const seen = new Set()
  return input.map((raw, index) => {
    const entry = normalizeBackupEntry(stage, raw, index, previous)
    // 同一个 id 出现两次时，「留空保留」指向哪条是不确定的；后一条退化为新条目。
    if (seen.has(entry.id)) entry.id = randomUUID()
    seen.add(entry.id)
    return entry
  })
}

/**
 * 从磁盘上的历史数据恢复备用列表。这里**不抛错**：一个坏条目不该把整份设置变成
 * 不可读，未知 provider 的条目直接丢弃（运行时本来也构建不出适配器）。
 */
function loadBackups(stage, input) {
  const spec = BACKUP_SPEC[stage]
  if (!Array.isArray(input)) return []
  const entries = []
  const seen = new Set()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const provider = typeof raw.provider === 'string' ? raw.provider.trim().slice(0, 20) : ''
    if (!spec.providers.includes(provider)) continue
    let id = typeof raw.id === 'string' && raw.id ? raw.id : randomUUID()
    if (seen.has(id)) id = randomUUID()
    seen.add(id)
    const entry = { id, provider }
    for (const [field, limit] of spec.fields) entry[field] = readEntryField(field, raw[field], limit)
    for (const secret of spec.secrets) {
      entry[secret] = typeof raw[secret] === 'string' ? raw[secret].slice(0, 200) : ''
    }
    entries.push(entry)
  }
  return entries
}

/** 控制台视图：只出掩码与 has 布尔，明文绝不经由 snapshot() 离开进程。 */
function publicBackups(stage, entries) {
  const spec = BACKUP_SPEC[stage]
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const view = { id: entry.id, provider: entry.provider }
    for (const [field] of spec.fields) view[field] = entry[field] ?? ''
    for (const secret of spec.secrets) {
      view[secret] = mask(entry[secret])
      view[secret === 'apiKey' ? 'hasApiKey' : 'hasApiSecret'] = Boolean(entry[secret])
    }
    return view
  })
}

function defaults() {
  return {
    version: STATE_VERSION,
    endpoints: { lanWsUrl: '', wanWsUrl: '', token: '', configured: false },
    firmware: { version: '', url: '', force: false, configured: false },
    gateway: { token: '', commands: null, configured: false },
    voice: {
      // 人设：全局默认的那一份。null = 控制台还没设过，沿用 Loader 配置的
      // `voice.systemPrompt`；设备级覆盖（overrides.systemPrompt）叠在它之上。
      systemPrompt: null,
      // 静音收口（ms）。null = 沿用 Loader 配置（默认 400）。
      silenceMs: null,
      // One independent block per stage. A 讯飞 ASR key, a 火山 TTS 令牌 and the
      // chat model's key are three different accounts; nothing is shared with the
      // host's own model, so the device pipeline can never spend the harness quota.
      llm: {
        provider: '',
        hostProvider: '',
        model: '',
        baseUrl: '',
        apiKey: '',
        appId: '',
        // 语音回答长度上限（tokens）。null = 沿用 Loader 配置（默认 120）。
        maxTokens: null,
        // 备用服务商（按优先级）。空数组 = 只有主用，行为与旧版完全一致。
        backups: [],
        configured: false,
      },
      tts: {
        provider: '',
        voice: '',
        rate: '',
        speed: '',
        model: '',
        resourceId: '',
        appId: '',
        apiKey: '',
        apiSecret: '',
        url: '',
        backups: [],
        configured: false,
      },
      asr: {
        provider: '',
        url: '',
        language: '',
        accent: '',
        resourceId: '',
        appId: '',
        apiKey: '',
        apiSecret: '',
        backups: [],
        configured: false,
      },
    },
    updatedAt: 0,
  }
}

export class SettingsStore {
  constructor({ file, clock = () => Date.now(), logger } = {}) {
    if (typeof file !== 'string' || !file) throw new Error('dsh-xiaozhi: settings needs a file path')
    this.file = file
    this.clock = clock
    this.logger = logger ?? {}
    this.state = defaults()
    this.loaded = false
    this.writeQueue = Promise.resolve()
  }

  async load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      const base = defaults()
      this.state = {
        ...base,
        ...parsed,
        // 旧文件（v1/v2）没有 backups，也带着旧版本号：统一升到当前版本，
        // 三段备用列表一律按「补空数组」处理。
        version: STATE_VERSION,
        endpoints: { ...base.endpoints, ...(parsed.endpoints ?? {}) },
        firmware: { ...base.firmware, ...(parsed.firmware ?? {}) },
        gateway: { ...base.gateway, ...(parsed.gateway ?? {}) },
        voice: {
          systemPrompt: parsed.voice?.systemPrompt ?? base.voice.systemPrompt,
          silenceMs: parsed.voice?.silenceMs ?? base.voice.silenceMs,
          llm: {
            ...base.voice.llm,
            ...(parsed.voice?.llm ?? {}),
            backups: loadBackups('llm', parsed.voice?.llm?.backups),
          },
          tts: {
            ...base.voice.tts,
            ...(parsed.voice?.tts ?? {}),
            backups: loadBackups('tts', parsed.voice?.tts?.backups),
          },
          asr: {
            ...base.voice.asr,
            ...(parsed.voice?.asr ?? {}),
            backups: loadBackups('asr', parsed.voice?.asr?.backups),
          },
        },
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error?.(`dsh-xiaozhi: settings unreadable (${error.message}); using boot config only`)
      }
    }
  }

  get(endpointPath) {
    return endpointPath.split('.').reduce((node, key) => node?.[key], this.state)
  }

  /** Masked, JSON-safe view for the console. Secrets never leave this function. */
  snapshot() {
    const state = this.state
    return {
      endpoints: {
        lanWsUrl: state.endpoints.lanWsUrl,
        wanWsUrl: state.endpoints.wanWsUrl,
        token: mask(state.endpoints.token),
        hasToken: Boolean(state.endpoints.token),
      },
      firmware: {
        version: state.firmware.version,
        url: state.firmware.url,
        force: state.firmware.force,
      },
      gateway: {
        token: mask(state.gateway.token),
        hasToken: Boolean(state.gateway.token),
        commands: state.gateway.commands,
      },
      voice: {
        // 空串 = 没设过（沿用 Loader 配置），控制台据此显示占位提示。
        systemPrompt: state.voice.systemPrompt ?? '',
        silenceMs: state.voice.silenceMs,
        llm: {
          provider: state.voice.llm.provider,
          hostProvider: state.voice.llm.hostProvider,
          model: state.voice.llm.model,
          baseUrl: state.voice.llm.baseUrl,
          appId: state.voice.llm.appId,
          apiKey: mask(state.voice.llm.apiKey),
          hasApiKey: Boolean(state.voice.llm.apiKey),
          maxTokens: Number.isInteger(state.voice.llm.maxTokens) ? state.voice.llm.maxTokens : null,
          backups: publicBackups('llm', state.voice.llm.backups),
        },
        tts: {
          provider: state.voice.tts.provider,
          voice: state.voice.tts.voice,
          rate: state.voice.tts.rate,
          speed: state.voice.tts.speed,
          model: state.voice.tts.model,
          resourceId: state.voice.tts.resourceId,
          url: state.voice.tts.url,
          appId: state.voice.tts.appId,
          apiKey: mask(state.voice.tts.apiKey),
          apiSecret: mask(state.voice.tts.apiSecret),
          hasApiKey: Boolean(state.voice.tts.apiKey),
          hasApiSecret: Boolean(state.voice.tts.apiSecret),
          backups: publicBackups('tts', state.voice.tts.backups),
        },
        asr: {
          provider: state.voice.asr.provider,
          url: state.voice.asr.url,
          language: state.voice.asr.language,
          accent: state.voice.asr.accent,
          resourceId: state.voice.asr.resourceId,
          appId: state.voice.asr.appId,
          apiKey: mask(state.voice.asr.apiKey),
          apiSecret: mask(state.voice.asr.apiSecret),
          hasApiKey: Boolean(state.voice.asr.apiKey),
          hasApiSecret: Boolean(state.voice.asr.apiSecret),
          backups: publicBackups('asr', state.voice.asr.backups),
        },
      },
      updatedAt: state.updatedAt,
    }
  }

  /**
   * Apply a patch. Secret fields follow "blank means keep": the console can render
   * a masked value and submit it untouched without wiping the stored key.
   */
  async update(patch = {}) {
    if (!patch || typeof patch !== 'object') throw new SettingsError('invalid', '配置必须是对象')
    // 先在副本上改再整体替换：备用列表校验失败时整次保存失败，内存里也不会留下
    // 半保存的状态（旧代码直接改 this.state，校验放在哪一步都会漏出半份配置）。
    const next = structuredClone(this.state)
    const now = this.clock()

    if (patch.endpoints) {
      const source = patch.endpoints
      if (typeof source.lanWsUrl === 'string') next.endpoints.lanWsUrl = source.lanWsUrl.trim().slice(0, 300)
      if (typeof source.wanWsUrl === 'string') next.endpoints.wanWsUrl = source.wanWsUrl.trim().slice(0, 300)
      if (typeof source.token === 'string' && source.token.trim()) next.endpoints.token = source.token.trim().slice(0, 300)
      if (source.clearToken === true) next.endpoints.token = ''
    }
    if (patch.firmware) {
      const source = patch.firmware
      if (typeof source.version === 'string') next.firmware.version = source.version.trim().slice(0, 40)
      if (typeof source.url === 'string') next.firmware.url = source.url.trim().slice(0, 500)
      if (typeof source.force === 'boolean') next.firmware.force = source.force
    }
    if (patch.gateway) {
      const source = patch.gateway
      if (typeof source.token === 'string' && source.token.trim()) next.gateway.token = source.token.trim().slice(0, 200)
      if (source.clearToken === true) next.gateway.token = ''
      if (source.commands && typeof source.commands === 'object') next.gateway.commands = source.commands
    }
    if (patch.voice) {
      const source = patch.voice
      // 人设与静音收口迁移自「行为档案」页：全局只有一份，设备可以单台覆盖。
      // 清空即回到 Loader 配置（null），所以面板里删掉文字就能恢复插件默认人设。
      if (typeof source.systemPrompt === 'string') {
        const trimmed = source.systemPrompt.trim().slice(0, 2000)
        next.voice.systemPrompt = trimmed || null
      }
      if (source.silenceMs !== undefined) {
        const ms = Number(source.silenceMs)
        next.voice.silenceMs = Number.isInteger(ms) && ms >= 100 && ms <= 3_000 ? ms : null
      }
      if (source.llm) {
        const llm = source.llm
        if (typeof llm.provider === 'string') next.voice.llm.provider = llm.provider.trim().slice(0, 20)
        if (typeof llm.hostProvider === 'string') next.voice.llm.hostProvider = llm.hostProvider.trim().slice(0, 64)
        if (typeof llm.model === 'string') next.voice.llm.model = llm.model.trim().slice(0, 80)
        if (typeof llm.baseUrl === 'string') next.voice.llm.baseUrl = llm.baseUrl.trim().slice(0, 300)
        if (typeof llm.appId === 'string') next.voice.llm.appId = llm.appId.trim().slice(0, 64)
        if (typeof llm.apiKey === 'string' && llm.apiKey.trim()) next.voice.llm.apiKey = llm.apiKey.trim().slice(0, 200)
        if (llm.clearApiKey === true) next.voice.llm.apiKey = ''
        // 回答长度上限：空 / null / 0 = 回到插件默认；只收 32..2048 的整数。
        if (llm.maxTokens !== undefined) {
          const tokens = Number(llm.maxTokens)
          next.voice.llm.maxTokens =
            llm.maxTokens === null || llm.maxTokens === '' || !Number.isFinite(tokens) || tokens <= 0
              ? null
              : Math.min(2_048, Math.max(32, Math.round(tokens)))
        }
        // 省略 backups = 不改；给了数组就整段替换（前端删掉的条目其密钥一并消失）。
        if (llm.backups !== undefined) {
          next.voice.llm.backups = normalizeBackups('llm', llm.backups, next.voice.llm.backups)
        }
      }
      if (source.tts) {
        const tts = source.tts
        if (typeof tts.provider === 'string') next.voice.tts.provider = tts.provider.trim().slice(0, 20)
        if (typeof tts.voice === 'string') next.voice.tts.voice = tts.voice.trim().slice(0, 64)
        if (typeof tts.rate === 'string') next.voice.tts.rate = tts.rate.trim().slice(0, 12)
        if (typeof tts.speed === 'string' || typeof tts.speed === 'number') {
          next.voice.tts.speed = String(tts.speed).trim().slice(0, 6)
        }
        if (typeof tts.url === 'string') next.voice.tts.url = tts.url.trim().slice(0, 200)
        if (typeof tts.model === 'string') next.voice.tts.model = tts.model.trim().slice(0, 64)
        if (typeof tts.resourceId === 'string') next.voice.tts.resourceId = tts.resourceId.trim().slice(0, 64)
        if (typeof tts.appId === 'string') next.voice.tts.appId = tts.appId.trim().slice(0, 64)
        if (typeof tts.apiKey === 'string' && tts.apiKey.trim()) next.voice.tts.apiKey = tts.apiKey.trim().slice(0, 200)
        if (typeof tts.apiSecret === 'string' && tts.apiSecret.trim()) {
          next.voice.tts.apiSecret = tts.apiSecret.trim().slice(0, 200)
        }
        if (tts.clearApiKey === true) next.voice.tts.apiKey = ''
        if (tts.clearApiSecret === true) next.voice.tts.apiSecret = ''
        if (tts.backups !== undefined) {
          next.voice.tts.backups = normalizeBackups('tts', tts.backups, next.voice.tts.backups)
        }
      }
      if (source.asr) {
        const asr = source.asr
        if (typeof asr.provider === 'string') next.voice.asr.provider = asr.provider.trim().slice(0, 20)
        if (typeof asr.url === 'string') next.voice.asr.url = asr.url.trim().slice(0, 200)
        if (typeof asr.language === 'string') next.voice.asr.language = asr.language.trim().slice(0, 16)
        if (typeof asr.accent === 'string') next.voice.asr.accent = asr.accent.trim().slice(0, 16)
        if (typeof asr.resourceId === 'string') next.voice.asr.resourceId = asr.resourceId.trim().slice(0, 64)
        if (typeof asr.appId === 'string') next.voice.asr.appId = asr.appId.trim().slice(0, 64)
        if (typeof asr.apiKey === 'string' && asr.apiKey.trim()) next.voice.asr.apiKey = asr.apiKey.trim().slice(0, 200)
        if (typeof asr.apiSecret === 'string' && asr.apiSecret.trim()) {
          next.voice.asr.apiSecret = asr.apiSecret.trim().slice(0, 200)
        }
        if (asr.clearApiKey === true) next.voice.asr.apiKey = ''
        if (asr.clearApiSecret === true) next.voice.asr.apiSecret = ''
        if (asr.backups !== undefined) {
          next.voice.asr.backups = normalizeBackups('asr', asr.backups, next.voice.asr.backups)
        }
      }
    }
    next.updatedAt = now
    // 校验全部通过后才替换状态：任何一处失败都不会留下半保存的内存状态或磁盘写。
    this.state = next
    await this.persist()
    return this.snapshot()
  }

  /**
   * 「随时替换」：把第 `index` 条备用提升为主用，旧主用落到该位置（顺序不变）。
   *
   * 为什么必须在服务端互换：备用条目在控制台里是**掩码**，浏览器把它当主用提交会把
   * `sk-••••12` 存成密钥；而主用的明文从不离开本进程。这里在内存里整段搬，密钥不经过 HTTP。
   *
   * 规则：
   * - 只搬该段声明的字段（`BACKUP_SPEC[stage]`），全局项（如 `llm.maxTokens`）留在主用；
   * - 旧主用从未配置过（provider 为空）时不生成空备用条目，直接摘掉被提升的那条；
   * - 校验全部通过才替换状态并落盘（失败不留半份配置）。
   */
  async promote(stage, index) {
    const spec = BACKUP_SPEC[stage]
    if (!spec) throw new SettingsError('invalid', `未知环节：${String(stage)}`)
    const next = structuredClone(this.state)
    const current = next.voice?.[stage]
    const list = Array.isArray(current?.backups) ? current.backups : []
    const position = Number(index)
    if (!Number.isInteger(position) || position < 0 || position >= list.length) {
      throw new SettingsError('invalid', `没有第 ${Number.isFinite(position) ? position + 1 : '?'} 条备用服务商`)
    }
    const promoted = list[position]
    if (!promoted || typeof promoted !== 'object' || !promoted.provider) {
      throw new SettingsError('invalid', '这条备用服务商缺少 provider，无法设为主用')
    }

    const rest = list.filter((_, at) => at !== position)
    // 旧主用降为备用（同一位置）；从未配置过主用时不留空壳。
    if (current.provider) {
      const demoted = { id: randomUUID(), provider: current.provider }
      for (const [key] of spec.fields) demoted[key] = current[key] ?? ''
      for (const key of spec.secrets) demoted[key] = current[key] ?? ''
      rest.splice(position, 0, demoted)
    }

    const primary = { ...current, provider: promoted.provider, configured: true }
    for (const [key] of spec.fields) primary[key] = promoted[key] ?? ''
    for (const key of spec.secrets) primary[key] = promoted[key] ?? ''
    primary.backups = rest

    next.voice[stage] = primary
    next.updatedAt = this.clock()
    this.state = next
    await this.persist()
    return this.snapshot()
  }

  /**
   * 删除一段能力里的某一条服务商（2026-11-14，TTS 改成「服务商池」后用）。
   *
   * `index` 是**扁平列表**的下标：0 = 主用位，1..n = 备用条目。删主用位时：
   * - 还有备用 → 第一条备用（连同它的凭据）顶上，其余顺延，**不生成空壳**；
   * - 没有备用 → 把这一段清空（provider 置空、该段字段清零），保留全局项（如 `llm.maxTokens`）。
   *
   * 与 `promote()` 一样在服务端做：浏览器里只有掩码，前端自己搬会把 `sk-••••12` 存成密钥。
   * 校验全部通过才替换状态并落盘（失败不留半份配置）。
   */
  async remove(stage, index) {
    const spec = BACKUP_SPEC[stage]
    if (!spec) throw new SettingsError('invalid', `未知环节：${String(stage)}`)
    const next = structuredClone(this.state)
    const current = next.voice?.[stage] ?? {}
    const list = Array.isArray(current.backups) ? current.backups : []
    const position = Number(index)
    const total = (current.provider ? 1 : 0) + list.length
    if (!Number.isInteger(position) || position < 0 || position >= total) {
      throw new SettingsError('invalid', `没有第 ${Number.isFinite(position) ? position + 1 : '?'} 条服务商`)
    }

    if (position === 0 && !current.provider) {
      // 主用从未配置过：扁平列表从第一条备用开始，下标 0 就是删它（不生成空壳、不“顶上”）。
      const rest = [...list]
      rest.splice(0, 1)
      next.voice[stage] = { ...current, backups: rest }
    } else if (position === 0 && list.length > 0) {
      const promoted = list[0]
      if (!promoted?.provider) throw new SettingsError('invalid', '这条服务商缺少 provider，无法顶上')
      const primary = { ...current, provider: promoted.provider, configured: true }
      for (const [key] of spec.fields) primary[key] = promoted[key] ?? ''
      for (const key of spec.secrets) primary[key] = promoted[key] ?? ''
      primary.backups = list.slice(1)
      next.voice[stage] = primary
    } else if (position === 0) {
      const cleared = { ...current, provider: '', configured: false }
      for (const [key] of spec.fields) cleared[key] = ''
      for (const key of spec.secrets) cleared[key] = ''
      cleared.backups = []
      next.voice[stage] = cleared
    } else {
      const rest = [...list]
      rest.splice(position - 1, 1)
      next.voice[stage] = { ...current, backups: rest }
    }

    next.updatedAt = this.clock()
    this.state = next
    await this.persist()
    return this.snapshot()
  }

  async persist() {
    this.writeQueue = this.writeQueue.then(() => this.#write()).catch((error) => {
      this.logger.error?.(`dsh-xiaozhi: failed to persist settings: ${error.message}`)
    })
    return this.writeQueue
  }
  async #write() {
    const body = `${JSON.stringify(this.state, null, 2)}\n`
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, body, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file)
    try {
      await chmod(this.file, 0o600)
    } catch {
      // Windows ignores POSIX modes.
    }
  }
}
