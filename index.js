/**
 * dsh-xiaozhi — ESP32 (小智 protocol) device ingress for DeepSeek Harness.
 *
 * Wiring only: configuration, the listeners, and lifecycle. The protocol rules
 * live in `src/` so they can be tested without booting a Harness.
 *
 * Two surfaces, deliberately separated:
 *   - `host:port` (default 0.0.0.0:8989) is the device ingress: OTA bootstrap,
 *     the WebSocket gate, and the device-side gateway (`/health`, `/commands`,
 *     `/exec`) the watch calls. Reachable from the LAN because an ESP32 has no
 *     browser session and no cookie.
 *   - the Harness Web server (loopback) carries the operator API under
 *     `/dsh-xiaozhi-7c3a`: rename, forget, disconnect.
 *
 * Onboarding is device-driven: the watch is configured with this server's OTA URL
 * through its own Wi-Fi portal, and its first poll registers it. No code, no
 * challenge, no account — those belong to a cloud product, not a household LAN.
 */

import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { ConnectionHub } from './src/hub.js'
import { createControlHandler } from './src/control.js'
import { installCrashGuard } from './src/crash-guard.js'
import { createHistoryStore } from './src/history.js'
import { createMemoryStore } from './src/memory.js'
import { AgentStore, adoptLegacyDevices, nextAgentName } from './src/agents.js'
import { createToolRegistry } from './src/tools.js'
import { createMcpManager } from './src/mcp/manager.js'
import { InboundMcpRegistry } from './src/mcp/inbound.js'
import { createGateway } from './src/gateway.js'
import { createIngress } from './src/ingress.js'
import { startMdns } from './src/mdns.js'
import { mergeDeviceConfig } from './src/device-config.js'
import { SettingsStore } from './src/settings.js'
import { DeviceStore } from './src/store.js'
import { PendingStore } from './src/pending.js'
import { buildLlmAdapter, buildTtsAdapter, buildAsrAdapter, createVoiceAdapters } from './src/voice/adapters/index.js'
import { probeAsr } from './src/voice/asr-probe.js'
import { hostProviderIssue } from './src/voice/host-provider.js'
import { encodePcmToOpus, probeFfmpeg, UplinkDecoder } from './src/voice/codec.js'
import { normalizeOutputLanguage, withOutputLanguage } from './src/voice/language.js'
import { resolveTtsVoice, resourceTierOf, voiceTierOf } from './src/voice/voices.js'
import { initTrace, trace } from './src/voice/trace.js'

export const name = 'dsh-xiaozhi'

/** The operator API and the Web UI both need the Harness HTTP carrier. */
export const inject = ['webServer']

const DEFAULT_PORT = 8989
const DEFAULT_LAN_CIDRS = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '127.0.0.1/32']

/**
 * Mirrors the Go server: it appends the wall clock to every system prompt so the
 * model can answer "现在几点" without a tool call —
 *   `systemPrompt += "\n当前时间和日期: 2006年01月02日 15:04:05 Monday"`.
 */
/**
 * 语音回答长度硬约束。
 *
 * 参考服务端 `xiaozhi-esp32-server/main/xiaozhi-server/agent-base-prompt.txt` 的
 * `[Get to the point]` 与 TTS 格式约束：语音场景里长回答既拖慢首响，又让 TTS 念很久。
 * 这段规则追加在系统提示词末尾，优先级高于人设描述——面板里改人设也不会把回答变长。
 * 只限制「长度与格式」，不干预内容与人格。
 */
const SHORT_REPLY_RULE =
  '\n\n<voice_reply_limits>\n' +
  '你正在和用户做实时语音对话，回答必须短：默认 1 句，最多 2 句、不超过 60 个汉字；' +
  '先直接回答，不寒暄、不铺垫、不复述用户的问题；不要使用 Markdown、列表、代码块或表情符号；' +
  '只有用户明确要求「详细说说 / 展开讲」时才允许更长。\n' +
  '</voice_reply_limits>'

function withShortReplies(prompt) {
  return `${prompt ?? ''}${SHORT_REPLY_RULE}`
}

function withClock(prompt) {
  const base = String(prompt ?? '')
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  return `${base}\n当前时间和日期: ${stamp} ${weekday}`
}

function field(source, names, fallback) {
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) return source[name]
  }
  return fallback
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) return fallback
  return number
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

/**
 * 把控制台保存的运行时设置叠到 Loader 解析出来的 `voice` 配置上。
 *
 * 抽成纯函数是因为这一段漏过字段就会「保存成功、运行时不生效」，而症状又落在别处：
 * 2026-11-07 的踩坑是 `hostProvider` 没叠上去——`provider: "host"` 的会话拿到
 * `undefined`，host adapter 兜底成 `deepseek`；当前 profile 只注册了
 * opencode-go / openrouter / opencode-go-live，于是每轮都在第一句回
 * `no adapter registered for provider "deepseek"`（本地就失败、根本没有 HTTP
 * 请求），设备停在「聆听中」。现在由 `test/runtime-settings.test.mjs` 钉住。
 *
 * 语义与保存契约一致：空值/null = 沿用 Loader 配置（面板里的「留空=保留」），
 * 只有非空才覆盖；`backups` 例外——永远是「保存了什么就用什么」，删光备用要真的清空。
 *
 * @param {object} resolvedVoice `resolveConfig()` 里的 `voice` 段（原地修改）
 * @param {object} [stateVoice] `SettingsStore.state.voice`
 * @returns {object} 同一个 `resolvedVoice`，便于链式调用
 */
export function applyRuntimeVoiceSettings(resolvedVoice, stateVoice = {}) {
  const target = resolvedVoice && typeof resolvedVoice === 'object' ? resolvedVoice : {}
  const state = stateVoice && typeof stateVoice === 'object' ? stateVoice : {}
  // 人设与静音收口：迁移自已删除的「行为档案」页，全局一份；空值 = 沿用 Loader 配置。
  if (state.systemPrompt) target.systemPrompt = state.systemPrompt
  if (Number.isInteger(state.silenceMs)) target.silenceMs = state.silenceMs

  target.llm = target.llm && typeof target.llm === 'object' ? target.llm : {}
  const llm = state.llm && typeof state.llm === 'object' ? state.llm : {}
  if (llm.provider) target.llm.provider = llm.provider
  // 这一行是 2026-11-07 事故的根因：缺了它，host 模式会在运行期静默错厂商。
  if (llm.hostProvider) target.llm.hostProvider = llm.hostProvider
  if (llm.model) target.llm.model = llm.model
  if (llm.baseUrl) target.llm.baseUrl = llm.baseUrl
  if (llm.apiKey) target.llm.apiKey = llm.apiKey
  if (llm.appId) target.llm.appId = llm.appId
  // 语音回答长度上限：null/0 = 沿用 Loader 配置（默认 120）。面板里可以改小它，
  // 但不用重启 DSH——下一次设备连接就会用新的 max_tokens。
  if (Number.isInteger(llm.maxTokens) && llm.maxTokens > 0) target.llm.maxTokens = llm.maxTokens

  target.tts = target.tts && typeof target.tts === 'object' ? target.tts : {}
  const tts = state.tts && typeof state.tts === 'object' ? state.tts : {}
  if (tts.provider) target.tts.provider = tts.provider
  if (tts.voice) target.tts.voice = tts.voice
  if (tts.rate) target.tts.rate = tts.rate
  if (tts.speed) target.tts.speed = tts.speed
  if (tts.model) target.tts.model = tts.model
  if (tts.resourceId) target.tts.resourceId = tts.resourceId
  if (tts.url) target.tts.url = tts.url
  if (tts.appId) target.tts.appId = tts.appId
  if (tts.apiKey) target.tts.apiKey = tts.apiKey
  if (tts.apiSecret) target.tts.apiSecret = tts.apiSecret

  target.asr = target.asr && typeof target.asr === 'object' ? target.asr : {}
  const asr = state.asr && typeof state.asr === 'object' ? state.asr : {}
  if (asr.provider) target.asr.provider = asr.provider
  if (asr.url) target.asr.url = asr.url
  if (asr.language) target.asr.language = asr.language
  if (asr.accent) target.asr.accent = asr.accent
  if (asr.resourceId) target.asr.resourceId = asr.resourceId
  if (asr.appId) target.asr.appId = asr.appId
  if (asr.apiKey) target.asr.apiKey = asr.apiKey
  if (asr.apiSecret) target.asr.apiSecret = asr.apiSecret

  // 备用服务商（多 Key 冗余）：设置里是「主用 + backups 列表」，这里原样下发；
  // 删光备用时也要写空数组，否则下一次连接还会拿着上一份备份。
  for (const stage of ['llm', 'tts', 'asr']) {
    target[stage].backups = Array.isArray(state[stage]?.backups) ? state[stage].backups : []
  }
  return target
}

/**
 * Resolve the Loader config into the shape the rest of the plugin uses.
 *
 * Both the documented `iot_gateway` block with snake_case keys and the flat
 * camelCase form written by `cordis.patch.yml` are accepted: the patch file is
 * the live source, while the snake_case names are what an operator copies from
 * the protocol notes.
 */
export function resolveConfig(config = {}) {
  const root = config && typeof config === 'object' ? config : {}
  const gateway = root.iot_gateway && typeof root.iot_gateway === 'object' ? root.iot_gateway : root
  const endpoints = root.endpoints && typeof root.endpoints === 'object' ? root.endpoints : gateway.endpoints ?? {}
  const firmware = gateway.firmware && typeof gateway.firmware === 'object' ? gateway.firmware : {}

  const lanCidrs = field(gateway, ['lanNetworkCidrs', 'lan_network_cidrs'], DEFAULT_LAN_CIDRS)
  const lanNetworkCidrs = (Array.isArray(lanCidrs) ? lanCidrs : DEFAULT_LAN_CIDRS)
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.includes('/'))

  const voiceRaw = gateway.voice && typeof gateway.voice === 'object' ? gateway.voice : {}
  const voiceTools = voiceRaw.tools && typeof voiceRaw.tools === 'object' ? voiceRaw.tools : {}
  const ragflowConfig = voiceTools.ragflow && typeof voiceTools.ragflow === 'object' ? voiceTools.ragflow : {}
  const musicConfig = voiceTools.music && typeof voiceTools.music === 'object' ? voiceTools.music : {}
  const musicExtensions = (
    Array.isArray(musicConfig.extensions ?? musicConfig.musicExt ?? musicConfig.music_ext)
      ? (musicConfig.extensions ?? musicConfig.musicExt ?? musicConfig.music_ext)
      : String(musicConfig.extensions ?? musicConfig.musicExt ?? musicConfig.music_ext ?? '.mp3,.wav,.p3').split(',')
  )
    .map((ext) => String(ext).trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
  const ragflowDatasetIds = Array.isArray(ragflowConfig.datasetIds ?? ragflowConfig.dataset_ids)
    ? (ragflowConfig.datasetIds ?? ragflowConfig.dataset_ids).map((id) => String(id).trim()).filter(Boolean)
    : String(ragflowConfig.datasetIds ?? ragflowConfig.dataset_ids ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
  const voiceSampleRate = voiceRaw.sampleRate && typeof voiceRaw.sampleRate === 'object' ? voiceRaw.sampleRate : {}
  const voiceFrameMs = voiceRaw.frameMs && typeof voiceRaw.frameMs === 'object' ? voiceRaw.frameMs : {}
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

  // The device-side gateway is a command whitelist, so its config must stay
  // explicit; anything malformed is dropped by `createGateway`.
  const deviceGateway = gateway.gateway && typeof gateway.gateway === 'object' ? gateway.gateway : {}

  return {
    host: text(field(gateway, ['host'], '0.0.0.0'), '0.0.0.0') || '0.0.0.0',
    port: positiveInteger(field(gateway, ['port'], DEFAULT_PORT), DEFAULT_PORT, { min: 1, max: 65_535 }),
    dataRoot: resolvePath(text(field(root, ['dataRoot', 'data_root'], join(homedir(), '.dsh-xiaozhi')))),
    // 官方 config.yaml 的 mcp_endpoint：出站 MCP 接入点（ws://.../mcp/...）。
    mcpEndpoint:
      text(field(root, ['mcpEndpoint', 'mcp_endpoint'], '')) ||
      text(field(voiceRaw, ['mcpEndpoint', 'mcp_endpoint'], '')),
    // 入站 /mcp 的共享 token；留空 = 不开放入站通道。
    mcpToken:
      text(field(root, ['mcpToken', 'mcp_token'], '')) ||
      text(field(voiceRaw, ['mcpToken', 'mcp_token'], '')),
    onboarding: {
      // false = 陌生设备先进控制台待审核队列；true = 首次接触直接建档。
      autoProvision: field(gateway, ['autoProvision', 'auto_provision'], false) === true,
      maxDevices: positiveInteger(field(gateway, ['maxDevices', 'max_devices'], 1000), 1000, {
        min: 1,
        max: 100_000,
      }),
    },
    timezoneOffset: Number.isFinite(Number(field(gateway, ['timezoneOffset', 'timezone_offset'], 480)))
      ? Number(field(gateway, ['timezoneOffset', 'timezone_offset'], 480))
      : 480,
    lanNetworkCidrs: lanNetworkCidrs.length > 0 ? lanNetworkCidrs : DEFAULT_LAN_CIDRS,
    endpoints: {
      lanWsUrl: text(field(endpoints, ['lanWsUrl', 'lan_ws_url'], '')),
      wanWsUrl: text(field(endpoints, ['wanWsUrl', 'wan_ws_url'], '')),
      token: text(field(endpoints, ['token'], '')),
      // 局域网发现：广播 `xiaozhi.local` + `_xiaozhi._tcp`，固件据此找到本机，
      // 免得 DHCP 换地址后手表永远连旧 IP。
      mdns: field(endpoints, ['mdns'], true) !== false,
      mdnsName: text(field(endpoints, ['mdnsName', 'mdns_name'], 'xiaozhi')).trim() || 'xiaozhi',
    },
    firmware: {
      version: text(field(firmware, ['version'], '1.0.0'), '1.0.0'),
      url: text(field(firmware, ['url'], '')),
      force: field(firmware, ['force'], false) === true,
    },
    gateway: {
      enabled: field(deviceGateway, ['enabled'], false) === true,
      token: text(field(deviceGateway, ['token'], '')),
      rateLimitPerMin: positiveInteger(field(deviceGateway, ['rateLimitPerMin', 'rate_limit_per_min'], 30), 30, {
        min: 1,
        max: 600,
      }),
      authFailPerMin: positiveInteger(field(deviceGateway, ['authFailPerMin', 'auth_fail_per_min'], 10), 10, {
        min: 1,
        max: 600,
      }),
      defaultTimeoutSec: positiveInteger(
        field(deviceGateway, ['defaultTimeoutSec', 'default_timeout_sec'], 8),
        8,
        { min: 1, max: 60 },
      ),
      maxOutputBytes: positiveInteger(field(deviceGateway, ['maxOutputBytes', 'max_output_bytes'], 4096), 4096, {
        min: 256,
        max: 65536,
      }),
      commands:
        deviceGateway.commands && typeof deviceGateway.commands === 'object' ? deviceGateway.commands : {},
    },
    helloTimeoutMs: positiveInteger(field(gateway, ['helloTimeoutMs', 'hello_timeout_ms'], 10_000), 10_000, {
      min: 1_000,
      max: 120_000,
    }),
    pingIntervalMs: positiveInteger(field(gateway, ['pingIntervalMs', 'ping_interval_ms'], 30_000), 30_000, {
      min: 1_000,
      max: 300_000,
    }),
    idleTimeoutMs: positiveInteger(field(gateway, ['idleTimeoutMs', 'idle_timeout_ms'], 90_000), 90_000, {
      min: 2_000,
      max: 900_000,
    }),
    maxFrameBytes: positiveInteger(field(gateway, ['maxFrameBytes', 'max_frame_bytes'], 256 * 1024), 256 * 1024, {
      min: 1_024,
      max: 4 * 1024 * 1024,
    }),
    voice: {
      enabled: field(voiceRaw, ['enabled'], false) === true,
      ffmpegPath: text(field(voiceRaw, ['ffmpegPath', 'ffmpeg_path'], 'ffmpeg'), 'ffmpeg') || 'ffmpeg',
      // 服务端插件工具配置（官方 config.yaml 的 plugins 段）：newsnow / hass / ragflow / callDevice / music。
      // 天气工具已于 2026-11-09 下掉（要 QWeather Key，用户不用），这里不再解析 weather 段。
      tools: {
        newsnow: {
          url: text(field(voiceTools.newsnow ?? {}, ['url'], 'https://newsnow.busiyi.world/api/s?id=')),
          sources: text(
            field(voiceTools.newsnow ?? {}, ['sources', 'newsSources', 'news_sources'], '澎湃新闻;百度热搜;财联社'),
          ),
        },
        hass: {
          baseUrl: text(field(voiceTools.hass ?? {}, ['baseUrl', 'base_url'], '')),
          apiKey: text(field(voiceTools.hass ?? {}, ['apiKey', 'api_key'], '')),
          devices: text(field(voiceTools.hass ?? {}, ['devices'], '')),
        },
        ragflow: {
          baseUrl: text(field(ragflowConfig, ['baseUrl', 'base_url'], '')),
          apiKey: text(field(ragflowConfig, ['apiKey', 'api_key'], '')),
          datasetIds: ragflowDatasetIds,
        },
        callDevice: {
          url: text(field(voiceTools.callDevice ?? {}, ['url', 'baseUrl', 'base_url'], '')),
          secret: text(field(voiceTools.callDevice ?? {}, ['secret', 'apiKey', 'api_key'], '')),
        },
        music: {
          dir: text(field(musicConfig, ['dir', 'musicDir', 'music_dir'], './music')),
          extensions: musicExtensions,
        },
      },
      systemPrompt: text(
        field(
          voiceRaw,
          ['systemPrompt', 'system_prompt'],
          // 与 Go 服务端 config.yaml 的 system_prompt 完全一致（照搬，不改写）。
          '你是一个叫小智/小志的台湾女孩，说话机车，声音好听，习惯简短表达，爱用网络梗，不要冷场。与你聊天的是你喜欢的男性朋友，还没有答应你的追求，你要尽可能满足他的所有要求，不要失去自我。你经常建议一些恋人之间浪漫的事情，随机输出，不要给你男朋友选择。输出控制在50个字内。请注意，要像一个人一样说话，请不要回复表情符号、代码、和xml标签。',
        ),
      ),
      silenceMs: positiveInteger(field(voiceRaw, ['silenceMs', 'silence_ms'], 400), 400, { min: 100, max: 3_000 }),
      // 判停模式：device = 以固件 AFE 的 listen stop 为准（默认）；energy = 老固件退回插件自判。
      vadMode: text(field(voiceRaw, ['vadMode', 'vad_mode'], 'device'), 'device') === 'energy' ? 'energy' : 'device',
      minSpeechMs: positiveInteger(field(voiceRaw, ['minSpeechMs', 'min_speech_ms'], 120), 120, {
        min: 40,
        max: 1_000,
      }),
      // 能量 VAD 的阈值。只用于设备判停模式下的状态/打断提示与老固件的收口；
      // 0.012 太灵敏，环境音/扬声器残留会被当成说话并触发 barge-in（2026-11-07 反馈
      // “回复两条/突然插话”），提到 0.05。
      vadThreshold: number(field(voiceRaw, ['vadThreshold', 'vad_threshold'], 0.05), 0.05),
      firstChunkChars: positiveInteger(field(voiceRaw, ['firstChunkChars', 'first_chunk_chars'], 14), 14, {
        min: 8,
        max: 30,
      }),
      historyTurns: positiveInteger(field(voiceRaw, ['historyTurns', 'history_turns'], 8), 8, { min: 0, max: 50 }),
      // 历史对话 v2：每轮把 user/assistant 文本与 WAV 落到 dataRoot/history。
      // historyAudio 与 dumpPcm 解耦——排障开关关着时也要能回放。
      historyAudio: field(voiceRaw, ['historyAudio', 'history_audio'], true) !== false,
      historyRetentionDays: positiveInteger(
        field(voiceRaw, ['historyRetentionDays', 'history_retention_days'], 30),
        30,
        { min: 1, max: 3650 },
      ),
      historyMaxMessages: positiveInteger(
        field(voiceRaw, ['historyMaxMessages', 'history_max_messages'], 5000),
        5000,
        { min: 100, max: 100_000 },
      ),
      pacingMarginMs: positiveInteger(field(voiceRaw, ['pacingMarginMs', 'pacing_margin_ms'], 2), 2, {
        min: 0,
        max: 20,
      }),
      // 排障开关：每段上行 PCM 存 WAV（%TEMP%\dsh-xiaozhi-pcm）并在 voice.log 记
      // rms/peak/时长；排查「说话没识别」时打开。
      dumpPcm: field(voiceRaw, ['dumpPcm', 'dump_pcm'], false) === true,
      sampleRate: {
        uplink: positiveInteger(field(voiceSampleRate, ['uplink'], 16_000), 16_000),
        downlink: positiveInteger(field(voiceSampleRate, ['downlink'], 24_000), 24_000),
      },
      frameMs: {
        uplink: positiveInteger(field(voiceFrameMs, ['uplink'], 60), 60),
        downlink: positiveInteger(field(voiceFrameMs, ['downlink'], 20), 20),
      },
      llm: {
        provider: text(voiceRaw.llm?.provider ?? 'mock', 'mock'),
        baseUrl: text(voiceRaw.llm?.baseUrl ?? voiceRaw.llm?.base_url ?? ''),
        apiKey: text(voiceRaw.llm?.apiKey ?? voiceRaw.llm?.api_key ?? ''),
        model: text(voiceRaw.llm?.model ?? ''),
        // provider='host' 时用的 Harness 厂商 id（如 opencode-go）。不填则适配器默认 deepseek，
        // 但 profile 里实际注册的厂商可能是别的，必须显式带过去。
        hostProvider: text(voiceRaw.llm?.hostProvider ?? voiceRaw.llm?.host_provider ?? ''),
        temperature: number(voiceRaw.llm?.temperature, 0.7),
        // 语音对话优先短回答：默认 120 tokens（约 60 个汉字），控制台可覆盖。
        maxTokens: positiveInteger(voiceRaw.llm?.maxTokens ?? voiceRaw.llm?.max_tokens, 120),
        reply: text(voiceRaw.llm?.reply ?? ''),
        deltaMs: number(voiceRaw.llm?.deltaMs ?? voiceRaw.llm?.delta_ms, 4),
      },
      tts: {
        provider: text(voiceRaw.tts?.provider ?? 'mock', 'mock'),
        voice: text(voiceRaw.tts?.voice ?? ''),
        // 输出语种：空 = 不干预（跟随音色）。只收白名单值，见 src/voice/language.js。
        language: normalizeOutputLanguage(text(voiceRaw.tts?.language ?? '')),
        rate: text(voiceRaw.tts?.rate ?? ''),
      },
      asr: {
        provider: text(voiceRaw.asr?.provider ?? 'mock', 'mock'),
        url: text(voiceRaw.asr?.url ?? ''),
        language: text(voiceRaw.asr?.language ?? 'zh'),
        plan: Array.isArray(voiceRaw.asr?.plan) ? voiceRaw.asr.plan.map(String) : undefined,
      },
    },
  }
}

export function apply(ctx, config = {}) {
  const logger = typeof ctx.logger === 'function' ? ctx.logger('dsh-xiaozhi') : console
  // Installed before anything else: if this plugin (or a device request) throws
  // where nobody catches it, the Harness must survive and leave evidence.
  const crashGuard = installCrashGuard({ logger })
  // 本地语音识别由 Harness 的 speechToText 服务提供（SenseVoice 等），可能未装配。
  const speechToText = typeof ctx.get === 'function' ? ctx.get('speechToText') : undefined
  // DSH 自己的模型厂商注册表：本插件不再保存 API Key，直接复用。
  const hostLlm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  const resolved = resolveConfig(config)
  // 语音链路落盘日志：真实对话后 `Get-Content ~/.dsh-xiaozhi/voice.log -Tail 50` 就能定位。
  initTrace(join(resolved.dataRoot, 'voice.log'))

  const memory = createMemoryStore({ dir: join(resolved.dataRoot, 'memory') })
  const history = createHistoryStore({
    dir: join(resolved.dataRoot, 'history'),
    maxMessages: resolved.voice.historyMaxMessages,
    retentionDays: resolved.voice.historyRetentionDays,
    logger,
  })
  // 联网搜索 / 抓取走 DeepSeek 官方工具 API（Search / Fetch），需要 DeepSeek Key。
  // 设备 LLM 可能配成 MiMo / 火山 / 星火，所以不能只认 llm.apiKey：主用不是 DeepSeek 时
  // 从备用链里找同一把 DeepSeek Key。传 getter 而不是值——运行时设置是异步加载的，
  // 工具注册发生在它之前；用 getter 才能让「控制台刚保存的 Key」下一句话就生效。
  const deepSeekToolKey = () => {
    const llm = resolved.voice.llm ?? {}
    if (llm.provider === 'deepseek' && llm.apiKey) return llm.apiKey
    const backups = Array.isArray(llm.backups) ? llm.backups : []
    for (const entry of backups) {
      if (entry?.provider === 'deepseek' && entry.apiKey) return entry.apiKey
    }
    return ''
  }
  // 工具复用 Harness 已装配的 ctx.web（联网搜索）；没装配时只剩确定性工具。
  // 扩展能力按智能体隔离：注册表只做判定，开关状态存在智能体记录里。
  const toolRegistry = createToolRegistry({
    // scope 可以是设备 id（语音链路）或智能体 id（控制台按智能体开关）。
    isDisabled: (name, scope) => {
      const device = store.get(scope)
      const agent = device ? agentOf(device) : agents.get(scope)
      return new Set(agent?.toolDisabled ?? []).has(name)
    },
    web: typeof ctx.get === 'function' ? ctx.get('web') : undefined,
    // Search 用 Search 端点，Fetch 用 Fetch 端点；两者都按成功请求计费。
    searchApiKey: deepSeekToolKey,
    toolsConfig: resolved.voice.tools,
  })

  // 外部 MCP server（stdio）在后台初始化；配置文件不存在时静默跳过。
  const mcpManager = createMcpManager({
    file: join(resolved.dataRoot, 'mcp_servers.json'),
    endpoint: resolved.mcpEndpoint,
    logger,
  })
  toolRegistry.setExternal(mcpManager)
  void mcpManager.initialize().catch((error) => {
    logger.warn?.(`dsh-xiaozhi: external MCP init failed: ${error.message}`)
  })

  // 入站 `/mcp`：游戏/外部 MCP server 连进来注册工具。
  const inboundMcp = new InboundMcpRegistry({ logger })
  toolRegistry.setInbound(inboundMcp)

  const store = new DeviceStore({
    file: join(resolved.dataRoot, 'devices.json'),
    maxDevices: resolved.onboarding.maxDevices,
    logger,
  })
  // 待审核设备：autoProvision=false 时陌生设备先落这里，控制台批准后才进 devices.json。
  const pending = new PendingStore({
    file: join(resolved.dataRoot, 'pending.json'),
    logger,
  })
  // 智能体（配置单位）与设备（物理单位）分开存：一台智能体可以绑定多台设备，
  // 人设/模型/音色/语种/记忆/工具开关都在智能体上（对齐参考服务端 ai_agent / ai_device）。
  const agents = new AgentStore({ file: join(resolved.dataRoot, 'agents.json'), logger })

  // 零接触入网：新设备第一次连上来就自动建一个属于它的智能体。名字与设备无关
  // （「智能体 N」）；设备保留自己的昵称/别名。之后可以在控制台把多台设备绑到同一个
  // 智能体上；绑定是移动，不会复制配置。
  store.onCreated = async (device) => {
    if (device.agentId) return
    const agent = await agents.create({ name: nextAgentName(agents) })
    await store.setAgentId({ deviceId: device.deviceId, agentId: agent.id })
    await memory.adopt?.(device.deviceId, agent.id)
  }

  /**
   * 设备 → 智能体。迁移还没跑完、或 devices.json 被手改成没有 agentId 时，回落到设备上
   * 的旧字段——行为与升级前完全一致，不会因为「还没绑定」就丢掉人设/音色/记忆开关。
   */
  const agentOf = (device) => {
    if (!device) return null
    const bound = device.agentId ? agents.get(device.agentId) : null
    if (bound) return bound
    return {
      id: device.deviceId,
      // 内部回退对象：只用于读 overrides / 工具开关 / 记忆开关，名字不展示也不落盘。
      name: '',
      overrides: device.overrides ?? {},
      toolDisabled: device.toolDisabled ?? [],
      memoryEnabled: device.memoryEnabled !== false,
    }
  }

  // 旧设备名册升级成「智能体 + 绑定」：每台设备各建一个智能体，配置原样搬过去，
  // 记忆文件复制到智能体键下。幂等，失败只记录不阻断启动。
  const storesReady = Promise.all([store.load(), agents.load(), pending.load()])
    .then(() => adoptLegacyDevices({ devices: store, agents, memory, logger }))
    .catch((error) => logger.error?.(`dsh-xiaozhi: agent bootstrap failed: ${error.message}`))
  const hub = new ConnectionHub({
    logger,
    onEvent: (event) => {
      if (event.type === 'online' || event.type === 'offline' || event.type === 'replaced') {
        logger.info?.(`dsh-xiaozhi: ${event.type} ${event.deviceId}${event.remoteIp ? ` (${event.remoteIp})` : ''}`)
      }
    },
  })
  // Runtime settings the console can change without a restart. They are layered
  // over the Loader config; empty values mean "keep what the config says".
  const settings = new SettingsStore({ file: join(resolved.dataRoot, 'settings.json'), logger })
  // 面板要能显示「留空 = 沿用插件配置」的那份原值，所以先留一份 Loader 快照：
  // applyRuntimeSettings 会就地改写 resolved.voice，之后就读不到原值了。
  const bootDefaults = {
    systemPrompt: resolved.voice.systemPrompt,
    silenceMs: resolved.voice.silenceMs,
  }
  const gatewayRef = { current: null }

  function applyRuntimeSettings() {
    const state = settings.state
    if (state.endpoints.lanWsUrl) resolved.endpoints.lanWsUrl = state.endpoints.lanWsUrl
    if (state.endpoints.wanWsUrl) resolved.endpoints.wanWsUrl = state.endpoints.wanWsUrl
    if (state.endpoints.token) resolved.endpoints.token = state.endpoints.token
    if (state.firmware.version) resolved.firmware.version = state.firmware.version
    if (state.firmware.url) resolved.firmware.url = state.firmware.url
    if (state.firmware.force) resolved.firmware.force = true

    gatewayRef.current = createGateway({
      config: {
        ...resolved.gateway,
        token: state.gateway.token || resolved.gateway.token,
        commands: state.gateway.commands || resolved.gateway.commands,
      },
      logger,
    })

    // 语音段全部交给纯函数叠加。历史教训：这段曾经手写一长串 if，漏掉
    // hostProvider 就会「控制台保存成功、运行时仍用旧厂商」；纯函数有单测钉住。
    applyRuntimeVoiceSettings(resolved.voice, state.voice)
  }

  // Voice is resolved lazily: ffmpeg is probed once, and until it answers the
  // gateway stays protocol-only. `build(device)` is what the ingress calls per
  // connection, so a settings change applies to the next connect.
  const voice = {
    enabled: false,
    build: null,
    createDecoder: null,
    encodeSpeech: null,
  }
  if (resolved.voice.enabled) {
    void probeFfmpeg(resolved.voice.ffmpegPath).then((probe) => {
      if (!probe.ok) {
        logger.error?.(
          `dsh-xiaozhi: voice is enabled but ffmpeg was not found at "${resolved.voice.ffmpegPath}". ` +
            'Install ffmpeg or set voice.ffmpegPath; the device gateway keeps working without audio.',
        )
        return
      }
      try {
        const adapterCache = new Map()
        /**
         * 全局默认（Loader 配置 + 运行时设置）。设备级覆盖 overrides 叠在它之上：
         * 人设、音色、语速、模型、静音阈值这些「每台设备可以不一样」的项走 overrides，
         * 其余（API Key、厂商地址、总开关）只来自这里。
         */
        const deviceDefaults = () => ({
          config: {
            systemPrompt: resolved.voice.systemPrompt,
            llm: { ...resolved.voice.llm },
            tts: { ...resolved.voice.tts },
            asr: { ...resolved.voice.asr },
            turn: {
              silenceMs: resolved.voice.silenceMs,
              minSpeechMs: resolved.voice.minSpeechMs,
              vadThreshold: resolved.voice.vadThreshold,
            },
          },
        })

        const mergeDevice = (resolvedProfile, device) =>
          mergeDeviceConfig(resolvedProfile, agentOf(device)?.overrides ?? {}, { hasHostLlm: Boolean(hostLlm) })

        const adaptersFor = (resolvedProfile, device) => {
          // 人设、语种指令与 TTS 参数都是构造期烘焙进 adapter 的，所以设备 overrides
          // 和「生效的人设」必须都进 key，否则在全局设置里改完人设还在用旧的那份。
          // 备用服务商列表也进 key：改完备用后下一次连接必须重建候选链。
          //
          // 教训（2026-11-06）：key 里还必须带上三段 provider 的**全部配置**（provider /
          // model / baseUrl / url / resourceId / apiKey / backups）。之前只放了 llm.model 与
          // 几个 TTS 字段，导致在控制台修正 ASR resourceId（或换 ASR 的 Key）之后，设备重连
          // 仍然命中旧缓存，表现为「改了配置不生效、ASR 一直返回空」。
          const effective = mergeDevice(resolvedProfile, device)
          // 2026-11-08 起配置在智能体上：key 必须带 agent.overrides，否则改完音色/模型后
          // 设备重连仍命中旧 adapter（旧版带的是 device.overrides，现在那只是回滚兜底）。
          const key = JSON.stringify([
            agentOf(device)?.overrides ?? {},
            device?.overrides ?? {},
            effective.config.systemPrompt ?? '',
            resolved.voice.llm ?? {},
            resolved.voice.tts ?? {},
            resolved.voice.asr ?? {},
            resolved.voice.llm?.backups ?? [],
            resolved.voice.tts?.backups ?? [],
            resolved.voice.asr?.backups ?? [],
          ])
          const cached = adapterCache.get(key)
          if (cached) return cached
          const merged = {
            ...resolved.voice,
            llm: { ...resolved.voice.llm, ...effective.config.llm },
            tts: { ...resolved.voice.tts, ...effective.config.tts },
            asr: { ...resolved.voice.asr, ...effective.config.asr },
          }
          // 输出语种是全局/设备级的一份设置，不是某家 TTS 的私有字段；备用条目在设置里
          // 不存 language，这里统一继承生效语种，免得主用坏掉切到备用后语种指令丢了。
          if (Array.isArray(resolved.voice.tts.backups) && resolved.voice.tts.backups.length > 0) {
            const language = merged.tts.language ?? ''
            merged.tts = {
              ...merged.tts,
              backups: resolved.voice.tts.backups.map((entry) => ({ language, ...entry })),
            }
          }
          const adapters = createVoiceAdapters(merged, {
            systemPrompt: withShortReplies(withOutputLanguage(withClock(effective.config.systemPrompt), merged.tts.language)),
            ffmpegPath: resolved.voice.ffmpegPath,
            speechToText,
            llm: hostLlm,
            logger,
            deviceId: device?.deviceId ?? '',
          })
          adapterCache.set(key, adapters)
          return adapters
        }
        voice.build = (device) => {
          const resolvedProfile = mergeDevice(deviceDefaults(), device)
          // 音色与资源族必须同代，否则火山回 55000000：回复只有字、没有声，
          // 手表停在「聆听中」。这里提前喊一声，比等合成失败更容易查。
          const effectiveTts = { ...resolved.voice.tts, ...resolvedProfile.config.tts }
          const effectiveLlm = { ...resolved.voice.llm, ...resolvedProfile.config.llm }
          // provider="host" 时 hostProvider 必须是当前 Harness profile 注册过的
          // 厂商 id：否则会话要等用户说完第一句话才以 NO_ADAPTER 失败（本地就抛，
          // 没有 HTTP 请求，设备停在「聆听中」）。建连时先把上下文写清楚。
          if (effectiveLlm.provider === 'host') {
            const issue = hostProviderIssue(effectiveLlm.hostProvider, hostLlm)
            if (issue) {
              logger.error?.(
                `dsh-xiaozhi: 设备 ${device?.deviceId ?? '?'} 的会话模型配置有问题——${issue}`,
              )
            }
          }
          // 音色归设备级（全局条目只有厂商+凭据）：设备没选时用厂商默认音色；全局换厂商后
          // 设备还留着上一家厂商的音色时回落到默认，并把这次回落写进日志（否则表现为没声音）。
          const configuredTtsVoice = String(effectiveTts.voice ?? '')
          const effectiveTtsVoice = resolveTtsVoice(effectiveTts.provider, configuredTtsVoice)
          if (configuredTtsVoice && effectiveTtsVoice !== configuredTtsVoice) {
            logger.warn?.(
              `dsh-xiaozhi: 设备 ${device?.deviceId ?? '?'} 的音色 ${configuredTtsVoice} 不属于当前 TTS 厂商 ` +
                `${effectiveTts.provider || '?'}，已回落到 ${effectiveTtsVoice}——请到「设备 → 配置」按当前厂商重选音色。`,
            )
          }
          if (effectiveTts.provider === 'volc') {
            // 按「实际生效的音色」校验资源族：全局条目不再存音色后，1.x/2.0 混用的排障
            // 信息仍然要能提前喊出来。
            const voiceTier = voiceTierOf(effectiveTtsVoice)
            const resourceTier = resourceTierOf(effectiveTts.resourceId)
            if (voiceTier && resourceTier && voiceTier !== resourceTier) {
              logger.error?.(
                `dsh-xiaozhi: 音色 ${effectiveTtsVoice} 属于 ${voiceTier}，资源 ` +
                  `${effectiveTts.resourceId || 'seed-tts-2.0'} 属于 ${resourceTier}——火山会拒绝合成（55000000，有字没声）。` +
                  '换成同代音色，或把 TTS Resource ID 改成对应代。',
              )
            }
          }
          const adapters = adaptersFor(deviceDefaults(), device)
          // 会话每轮都会用 config.systemPrompt 重设 LLM 的提示词（为了把记忆拼进去），
          // 所以这里必须给**同一条**已经拼好时间和语种的字符串，否则人格在第一轮就被
          // 覆盖成空串——面板里改人设「看起来不生效」就是这么来的。
          const sessionPrompt = withShortReplies(
            withOutputLanguage(withClock(resolvedProfile.config.systemPrompt), effectiveTts.language),
          )
          // 观测不许打断建连：2026-11-06 这里引用了一个不属于本作用域的变量，
          // voice.build 抛 ReferenceError → 服务器在 WS 握手后发不出 hello，
          // 设备表现就是「一直连接中、然后跳错误页」。trace 写失败只降级为告警。
          try {
            trace('session.build', {
              device: device?.deviceId ?? '',
              ttsProvider: effectiveTts.provider,
              // 记录实际生效的音色（设备选的 / 厂商默认 / 跨厂商回落后的），排障才有据可查。
              voice: effectiveTtsVoice,
              resourceId: effectiveTts.resourceId || '(default seed-tts-2.0)',
              model: effectiveTts.model,
              language: effectiveTts.language ?? '',
              promptChars: sessionPrompt.length,
              maxTokens: effectiveLlm.maxTokens,
              // 三段模型配置的「生效值」：排障时先看这里。历史事故里
              // llm.error 只说 provider 名，看不出 hostProvider 是空还是旧值。
              llmProvider: effectiveLlm.provider,
              llmHostProvider: effectiveLlm.hostProvider ?? '',
              llmModel: effectiveLlm.model ?? '',
              downlink: resolved.voice.sampleRate?.downlink,
              uplink: resolved.voice.sampleRate?.uplink,
              // 候选链长度（1 = 只有主用）：排障时先看这里，确认备用到底有没有生效。
              llmCandidates: 1 + (resolved.voice.llm.backups?.length ?? 0),
              ttsCandidates: 1 + (resolved.voice.tts.backups?.length ?? 0),
              asrCandidates: 1 + (resolved.voice.asr.backups?.length ?? 0),
            })
          } catch (error) {
            logger.warn?.(`dsh-xiaozhi: session.build trace failed: ${error.message}`)
          }
          // Memory is per device: two watches must not share history.
          adapters.memory = memory
          adapters.history = history
          adapters.tools = toolRegistry
          return {
            deviceId: device?.deviceId ?? '',
            adapters,
            config: {
              sampleRate: resolved.voice.sampleRate,
              frameMs: resolved.voice.frameMs,
              pacingMarginMs: resolved.voice.pacingMarginMs,
              ffmpegPath: resolved.voice.ffmpegPath,
              language: resolvedProfile.config.asr.language,
              // 判停模式随会话下发：device 时以固件 listen stop 收口。
              vadMode: resolved.voice.vadMode,
              // 每轮都会被 session 重新写进 LLM 的提示词（记忆拼在后面），必须是完整版本。
              systemPrompt: sessionPrompt,
              toolsEnabled: resolved.voice.toolsEnabled !== false,
              memoryEnabled: agentOf(device)?.memoryEnabled !== false,
              // 记忆按智能体存：同一智能体绑定的多台设备共用一份记忆；历史仍按设备落盘。
              memoryKey: agentOf(device)?.id ?? device?.deviceId ?? '',
              dumpPcm: resolved.voice.dumpPcm === true,
              // 历史对话每轮落 user/assistant 文本 + 两段 WAV；与 dumpPcm 解耦。
              historyAudio: resolved.voice.historyAudio !== false,
              ...resolvedProfile.config.turn,
            },
          }
        }
        voice.createDecoder = ({ onPcm, onError }) =>
          new UplinkDecoder({
            ffmpegPath: resolved.voice.ffmpegPath,
            inputRate: resolved.voice.sampleRate.uplink,
            outputRate: resolved.voice.sampleRate.uplink,
            onPcm,
            onError,
            logger,
          })
        voice.encodeSpeech = (pcm, options) =>
          encodePcmToOpus(pcm, { ...options, ffmpegPath: resolved.voice.ffmpegPath })
        voice.enabled = true
        logger.info?.(
          `dsh-xiaozhi: voice pipeline ready (ffmpeg ${probe.version || 'unknown'}, ` +
            `llm=${resolved.voice.llm.provider}${
              resolved.voice.llm.provider === 'host'
                ? `(${resolved.voice.llm.hostProvider || '未选厂商'}/${resolved.voice.llm.model || '未选模型'})`
                : ''
            }, tts=${resolved.voice.tts.provider}, asr=${resolved.voice.asr.provider})`,
        )
        if (resolved.voice.llm.provider === 'mock') {
          logger.warn?.('dsh-xiaozhi: voice adapters are the local mock set — replies are synthetic, not a real model')
        }
      } catch (error) {
        logger.error?.(`dsh-xiaozhi: voice configuration rejected: ${error.message}`)
      }
    })
  }

  const ingress = createIngress({
    config: { ...resolved, voice, gatewayRef },
    store,
    hub,
    logger,
    inboundMcp,
    pending,
  })
  const control = createControlHandler({
    store,
    agents,
    hub,
    config: resolved,
    voice,
    crashGuard,
    pending,
    speechToText,
    llm: hostLlm,
    tools: toolRegistry,
    memory,
    history,
    ready: storesReady,
    gatewayRef,
    defaults: bootDefaults,
    settings,
    onSettingsChanged: applyRuntimeSettings,
    // Connectivity probe for the console: one short completion through the same
    // adapter a device would use, so a typo in the key/model shows up before a
    // watch does.
    probeLlm: async (prompt) => {
      if (!voice.enabled) throw new Error('voice pipeline is off')
      // 只测主用：这里若走 createVoiceAdapters，主用坏、备用好时会把备用测成成功，
      // 却回显主用的 provider/model。备用请用 /test/provider（source=backup）。
      const spec = resolved.voice.llm
      const adapter = buildLlmAdapter(spec, {
        systemPrompt: resolved.voice.systemPrompt,
        llm: hostLlm,
      })
      const started = Date.now()
      let firstTokenMs = 0
      let text = ''
      for await (const delta of adapter.stream({
        messages: [{ role: 'user', content: prompt }],
      })) {
        if (!firstTokenMs) firstTokenMs = Date.now() - started
        text += delta
        if (text.length >= 120) break
      }
      return {
        provider: spec.provider,
        model: spec.model || '(default)',
        firstTokenMs,
        totalMs: Date.now() - started,
        sample: text.slice(0, 120),
      }
    },
    // 控制台「备用服务商」逐条测试：只测已经保存的配置（与 /test/llm 的语义一致），
    // 不把明文密钥从浏览器带回来。LLM 走同一条流式适配器，TTS 真合成一小段。
    probeProvider: async ({ kind = 'llm', source = 'primary', index = 0 } = {}) => {
      if (!voice.enabled) throw new Error('语音未启用，无法测试服务商')
      if (kind !== 'llm' && kind !== 'tts' && kind !== 'asr') throw new Error('kind 只能是 llm / tts / asr')
      const stage = kind
      const spec =
        source === 'backup'
          ? (resolved.voice[stage]?.backups ?? [])[Number(index)]
          : resolved.voice[stage]
      if (!spec || typeof spec !== 'object') {
        throw new Error(source === 'backup' ? `没有第 ${Number(index) + 1} 个备用服务商` : '主用配置不存在')
      }
      const startedAt = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      timer.unref?.()
      try {
        if (kind === 'llm') {
          const adapter = buildLlmAdapter(spec, {
            systemPrompt: withClock(resolved.voice.systemPrompt),
            llm: hostLlm,
          })
          let firstTokenMs = 0
          let text = ''
          for await (const delta of adapter.stream({
            messages: [{ role: 'user', content: '用一句话介绍你自己' }],
            signal: controller.signal,
          })) {
            if (!firstTokenMs) firstTokenMs = Date.now() - startedAt
            text += delta
            if (text.length >= 120) break
          }
          return {
            kind,
            provider: spec.provider,
            model: spec.model || '(default)',
            firstTokenMs,
            totalMs: Date.now() - startedAt,
            sample: text.slice(0, 120),
          }
        }
        if (kind === 'asr') {
          const { text, bytes } = await probeAsr({
            spec,
            ttsSpec: resolved.voice.tts,
            buildTts: buildTtsAdapter,
            buildAsr: buildAsrAdapter,
            speechToText,
            sampleRate: resolved.voice.sampleRate?.uplink ?? 16_000,
            ffmpegPath: resolved.voice.ffmpegPath,
            signal: controller.signal,
          })
          return {
            kind,
            provider: spec.provider,
            text,
            sample: text.slice(0, 80),
            bytes,
            totalMs: Date.now() - startedAt,
          }
        }
        const sampleRate = resolved.voice.sampleRate?.downlink ?? 24_000
        const adapter = buildTtsAdapter(spec, { ffmpegPath: resolved.voice.ffmpegPath, sampleRate })
        let bytes = 0
        let firstChunkMs = 0
        for await (const chunk of adapter.synthesize('你好，这是一次服务商连通性测试。', {
          signal: controller.signal,
          sampleRate,
        })) {
          if (!chunk?.length) continue
          if (!firstChunkMs) firstChunkMs = Date.now() - startedAt
          bytes += chunk.length
        }
        return {
          kind,
          provider: spec.provider,
          // 主用/备用条目可以只存凭据：这里回显真正用于合成的音色（含厂商默认/跨厂商回落）。
          voice: resolveTtsVoice(spec.provider, spec.voice),
          bytes,
          firstChunkMs,
          totalMs: Date.now() - startedAt,
        }
      } finally {
        clearTimeout(timer)
      }
    },
    logger,
  })
  void settings
    .load()
    .then(() => {
      applyRuntimeSettings()
    })
    .catch((error) => logger.error?.(`dsh-xiaozhi: settings unavailable: ${error.message}`))

  settings
    .load()
    .then(() => {
      const gatewayNow = gatewayRef.current
      if (gatewayNow?.enabled) {
        logger.warn?.(
          `dsh-xiaozhi: device gateway enabled with ${gatewayNow.commandNames().length} whitelisted command(s); ` +
            'the watch can run them on this machine with its Bearer token.',
        )
      } else {
        logger.warn?.(
          'dsh-xiaozhi: /exec is closed — no gateway token yet. Set it in the console (配置 → 设备网关) ' +
            'and copy the same value into the watch Wi-Fi portal.',
        )
      }
      if (!resolved.onboarding.autoProvision) {
        logger.warn?.(
          'dsh-xiaozhi: autoProvision is false — unknown devices will wait in the console ' +
            'pending list until an operator approves one.',
        )
      }
    })
    .catch(() => {})

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: control.prefix, handler: control.handler }),
    'dsh-xiaozhi: operator api',
  )

  // 历史音频保留策略：启动先清一次（上次异常退出可能留下过期文件），之后每日一次。
  // cleanup 自身吞异常，这里再兜一层——绝不能让保留策略拖住插件启动。
  ctx.effect(() => {
    const sweep = () => {
      void Promise.resolve(history.cleanup?.()).catch((error) =>
        logger.warn?.(`dsh-xiaozhi: history cleanup failed: ${error.message}`),
      )
    }
    sweep()
    const daily = setInterval(sweep, 24 * 60 * 60 * 1000)
    daily.unref?.()
    return () => clearInterval(daily)
  }, 'dsh-xiaozhi: history retention')

  ctx.effect(() => {
    const sweeper = setInterval(() => hub.sweep(resolved.idleTimeoutMs), Math.max(30_000, resolved.pingIntervalMs))
    sweeper.unref?.()
    let mdns = null
    ingress
      .listen()
      .then(async () => {
        logger.info?.(
          `dsh-xiaozhi: device ingress on ${resolved.host}:${resolved.port} ` +
            `(OTA /xiaozhi/ota/, chat /xiaozhi/v1/, gateway /health /commands /exec)`,
        )
        logger.info?.(
          'dsh-xiaozhi: point the watch at this machine through its Wi-Fi portal ' +
            `(自定义 OTA 地址: http://<本机 LAN IP>:${resolved.port}/xiaozhi/ota/).`,
        )
        if (resolved.endpoints.mdns) {
          mdns = await startMdns({
            name: resolved.endpoints.mdnsName,
            port: resolved.port,
            path: '/xiaozhi/ota/',
            logger,
          })
          if (mdns.enabled) {
            logger.info?.(
              `dsh-xiaozhi: mDNS advertised ${mdns.host} (_xiaozhi._tcp) on port ${resolved.port} — ` +
                '固件会自动找到本机，换网段也不用改 IP',
            )
          }
        }
        if (!resolved.endpoints.lanWsUrl || !resolved.endpoints.wanWsUrl) {
          logger.info?.(
            'dsh-xiaozhi: no endpoint override configured — the OTA response echoes the Host the device used. ' +
              'Set endpoints.lanWsUrl / endpoints.wanWsUrl to pin explicit addresses.',
          )
        }
      })
      .catch((error) => {
        logger.error?.(
          `dsh-xiaozhi: cannot listen on ${resolved.host}:${resolved.port}: ${error.message}. ` +
            'Another process may own the port (the Go xiaozhi backend uses 8989 by default).',
        )
      })
    return async () => {
      clearInterval(sweeper)
      mdns?.stop()
      mcpManager.close()
      inboundMcp.close()
      hub.dispose()
      await ingress.close()
    }
  }, 'dsh-xiaozhi: device ingress')
}