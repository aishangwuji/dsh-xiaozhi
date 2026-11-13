/**
 * Adapter selection.
 *
 * Providers are chosen independently per stage, because in practice they come
 * from different vendors (ASR from one account, LLM from another, TTS from a
 * third). An unknown provider is a configuration error, not a fallback: silently
 * substituting a mock would put a synthetic voice on a real speaker.
 *
 * 每个环节还可以按优先级填多家（`voice.{stage}.backups`，契约见
 * `docs/backup-providers.md`）：候选 = [主用, ...备用]。构建失败的候选只跳过
 * （一条配错的备用不能把整条语音链路打死），一个都构建不出来才抛主用的原始错误；
 * 候选 ≥2 时套 failover 包装，只有一家时原样返回，不引入无意义包装。
 */

import { createEdgeTts } from './edge-tts.js'
import { createFailoverAsr, createFailoverLlm, createFailoverTts } from './failover.js'
import { createFunasrAsr } from './funasr-asr.js'
import { createMockAsr, createMockLlm, createMockTts } from './mock.js'
import { createOpenAiLlm } from './openai-llm.js'
import { createHostLlm } from './host-llm.js'
import { createLocalAsr } from './local-asr.js'
import { createVolcAsr } from './volc-asr.js'
import { createVolcHttpTts } from './volc-http-tts.js'
import { createXunfeiAsr } from './xunfei-asr.js'
import { createXunfeiTts } from './xunfei-tts.js'
import { IFLYTEK_ENDPOINTS } from './xunfei-auth.js'
import { hostProviderIssue } from '../host-provider.js'
import { resolveTtsVoice } from '../voices.js'

export class AdapterConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AdapterConfigError'
    this.code = 'adapter-config'
  }
}

/**
 * OpenAI-compatible vendors only differ in base URL and default model, so they
 * share one client. Keys stay per provider: a 火山 key is not a 讯飞 key.
 *
 * 2026-11-09 起 LLM **只支持 DeepSeek 与小米 MiMo**（用户要求；OpenAI / 火山 / 星火已从
 * LLM 段移除，火山与讯飞仍保留 TTS/ASR）。往这里加厂商前先确认描述符里也有对应 llm 段，
 * 否则控制台选不到、手写 settings 反而会以 `unknown LLM provider` 失败。
 *
 * 除端点/默认模型外，个别厂商还差在认证头与思维链默认值上，一并放进 preset：
 * - `authStyle: 'api-key'`：小米 MiMo 只认 `api-key: <key>`，不认 Bearer；
 * - `thinking: 'disabled'`：MiMo 默认 thinking=enabled（先吐思维链），语音首字预算扛不住。
 */
const OPENAI_COMPATIBLE = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  // MiMo **故意不写默认 model**：模型清单要从厂商 `GET /v1/models` 拉（见 src/models.js），
  // 代码里不内置模型 id；没填 model 时构建期直接报错，而不是偷偷用一个写死的名字。
  mimo: {
    baseUrl: 'https://api.xiaomimimo.com/v1',
    authStyle: 'api-key',
    thinking: 'disabled',
  },
}

/**
 * 某家 OpenAI 兼容厂商的端点/认证预设（供 models.js 的模型清单与控制台复用）。
 * 未收录的返回 null。
 */
export function openAiCompatiblePreset(provider) {
  const preset = OPENAI_COMPATIBLE[provider]
  return preset ? { ...preset } : null
}

/** 备用列表只收真实服务商；mock 只用于桌面联调，不许被自动切到。 */
const MOCK_PROVIDER = 'mock'

/**
 * 构建一个 LLM 适配器（主用或某一条备用）。
 *
 * @param {object} spec 一条 LLM 配置（provider/model/baseUrl/appId/apiKey…）
 * @param {{ systemPrompt?: string, llm?: object, deviceId?: string }} [options]
 *   `llm` 是 Harness 的宿主 LLM 服务，仅 provider=host 时使用。
 */
export function buildLlmAdapter(spec = {}, { systemPrompt = '', llm, deviceId = '' } = {}) {
  // deviceId 预留给按设备区分的诊断；构建期不参与，保持签名与装配层一致。
  void deviceId
  const provider = spec.provider ?? MOCK_PROVIDER
  if (provider === 'host') {
    // hostProvider 是 DSH 的厂商 id，必须在当前 profile 注册过；否则要等用户说
    // 完第一句话才抛 NO_ADAPTER（设备停在「聆听中」），这里在构建期就说清楚。
    const issue = hostProviderIssue(spec.hostProvider, llm)
    if (issue) throw new AdapterConfigError(issue)
    return createHostLlm({
      llm,
      provider: spec.hostProvider,
      model: spec.model,
      systemPrompt,
      temperature: spec.temperature,
      maxTokens: spec.maxTokens,
    })
  }
  if (provider === 'mock') {
    return createMockLlm({ reply: spec.reply, deltaMs: spec.deltaMs ?? 4, chunkChars: spec.chunkChars ?? 4 })
  }
  const preset = OPENAI_COMPATIBLE[provider]
  if (preset) {
    if (!spec.apiKey) {
      throw new AdapterConfigError(`voice.llm.apiKey is required for the ${provider} provider`)
    }
    // 模型必须显式给：厂商的模型清单从 /v1/models 拉，代码里不内置任何模型 id。
    const model = spec.model || preset.model
    if (!model) {
      throw new AdapterConfigError(
        `voice.llm.model is required for the ${provider} provider（控制台会从厂商 /v1/models 接口拉取后选择）`,
      )
    }
    return createOpenAiLlm({
      baseUrl: spec.baseUrl || preset.baseUrl,
      apiKey: spec.apiKey,
      model,
      // 认证风格与思维链：spec 优先（显式覆盖），否则用 preset 的厂商默认。
      authStyle: spec.authStyle || preset.authStyle,
      thinking: spec.thinking || preset.thinking,
      systemPrompt,
      temperature: spec.temperature,
      maxTokens: spec.maxTokens,
    })
  }
  throw new AdapterConfigError(
    `unknown LLM provider "${provider}" (expected mock, deepseek or mimo)`,
  )
}

/**
 * 构建一个 TTS 适配器。
 *
 * @param {object} spec 一条 TTS 配置（provider/voice/rate/speed/model/resourceId/url/appId/apiKey/apiSecret…）
 * @param {{ ffmpegPath?: string, sampleRate?: number, deviceId?: string }} [options]
 */
export function buildTtsAdapter(spec = {}, { ffmpegPath = 'ffmpeg', sampleRate = 24_000, deviceId = '' } = {}) {
  void deviceId
  const provider = spec.provider ?? MOCK_PROVIDER
  if (provider === 'mock') {
    return createMockTts({ sampleRate, chunkDelayMs: spec.chunkDelayMs ?? 0 })
  }
  // 音色归设备级（全局条目只有厂商+凭据）：空音色用厂商默认，跨厂商残留音色回落默认，
  // 自定义 ID 原样保留。统一在这里整理，主用/备用/`/test/provider` 走同一条规则。
  const voice = resolveTtsVoice(provider, spec.voice)
  if (provider === 'edge') {
    // edge 的 MP3→PCM 全靠 ffmpeg；路径为空时在构建期就说清楚，别等第一次合成才炸。
    if (!ffmpegPath) {
      throw new AdapterConfigError('voice.tts.ffmpegPath is required for the edge provider')
    }
    return createEdgeTts({
      voice,
      rate: spec.rate || '+0%',
      volume: spec.volume || '+0%',
      pitch: spec.pitch || '+0Hz',
      ffmpegPath,
      sampleRate,
      timeoutMs: spec.timeoutMs ?? 15_000,
    })
  }
  if (provider === 'xunfei') {
    return createXunfeiTts({
      appId: spec.appId,
      apiKey: spec.apiKey,
      apiSecret: spec.apiSecret,
      url: spec.url || IFLYTEK_ENDPOINTS.tts,
      voice,
      speed: spec.speed ?? 50,
      volume: spec.volume ?? 50,
      pitch: spec.pitch ?? 50,
      sampleRate,
      timeoutMs: spec.timeoutMs ?? 15_000,
    })
  }
  if (provider === 'volc') {
    return createVolcHttpTts({
      apiKey: spec.apiKey,
      url: spec.url || undefined,
      resourceId: spec.resourceId || undefined,
      model: spec.model || undefined,
      voice,
      language: spec.language || '',
      sampleRate,
    })
  }
  throw new AdapterConfigError(`unknown TTS provider "${provider}" (expected mock, edge, xunfei or volc)`)
}

/**
 * 构建一个 ASR 适配器。
 *
 * @param {object} spec 一条 ASR 配置（provider/url/language/accent/resourceId/appId/apiKey/apiSecret…）
 * @param {{ sampleRate?: number, speechToText?: object, deviceId?: string }} [options]
 *   `speechToText` 是 Harness 的宿主识别服务，仅 provider=local 时使用。
 */
export function buildAsrAdapter(spec = {}, { sampleRate = 16_000, speechToText, deviceId = '' } = {}) {
  void deviceId
  const provider = spec.provider ?? MOCK_PROVIDER
  if (provider === 'mock') {
    return createMockAsr({ plan: spec.plan ?? ['你好'] })
  }
  if (provider === 'funasr') {
    return createFunasrAsr({
      url: spec.url || 'ws://127.0.0.1:10096/',
      sampleRate,
      mode: spec.mode || 'offline',
      chunkInterval: spec.chunkInterval ?? 10,
      timeoutMs: spec.timeoutMs ?? 15_000,
    })
  }
  if (provider === 'xunfei') {
    return createXunfeiAsr({
      appId: spec.appId,
      apiKey: spec.apiKey,
      apiSecret: spec.apiSecret,
      url: spec.url || IFLYTEK_ENDPOINTS.asr,
      language: spec.language || 'zh_cn',
      domain: 'iat',
      accent: spec.accent || 'mandarin',
      sampleRate,
      timeoutMs: spec.timeoutMs ?? 15_000,
    })
  }
  if (provider === 'local') {
    return createLocalAsr({
      speechToText,
      sampleRate,
      language: spec.language || 'zh',
      providerId: spec.localProviderId || undefined,
    })
  }
  if (provider === 'volc') {
    return createVolcAsr({
      apiKey: spec.apiKey,
      url: spec.url || undefined,
      resourceId: spec.resourceId || undefined,
      model: spec.model || undefined,
      sampleRate,
      endWindowSize: spec.endWindowSize ?? 800,
    })
  }
  throw new AdapterConfigError(`unknown ASR provider "${provider}" (expected mock, funasr, xunfei or volc)`)
}

/**
 * 一段的候选链：[主用, ...backups]，逐条构建。
 *
 * - 构建失败（缺 Key / 未知 provider / 缺 ffmpeg / 缺宿主服务）→ warn 后跳过；
 * - 主用失败但备用可用 → 备用顶上，error 说明主用为什么没起来；
 * - 一条都构建不出来 → 抛主用的原始错误（配置错误必须显性）；
 * - 候选 ≥2 → failover 包装；=1 → 原样返回。
 */
function buildStage(stage, primarySpec, { build, logger, deviceId, clock }) {
  const primary = primarySpec && typeof primarySpec === 'object' ? primarySpec : {}
  const backups = Array.isArray(primary.backups) ? primary.backups : []
  const specs = [primary, ...backups]
  const candidates = []
  const labels = []
  let primaryError = null

  specs.forEach((entry, index) => {
    const spec = entry && typeof entry === 'object' ? entry : {}
    const provider = spec.provider ?? MOCK_PROVIDER
    if (index > 0 && provider === MOCK_PROVIDER) {
      logger?.warn?.(
        `dsh-xiaozhi: voice.${stage}.backups[${index - 1}] 是 mock，备用列表只接受真实服务商，已跳过`,
      )
      return
    }
    try {
      candidates.push(build(spec))
      labels.push(provider)
    } catch (error) {
      if (index === 0) primaryError = error
      const where = index === 0 ? '主用' : `backups[${index - 1}]`
      logger?.warn?.(`dsh-xiaozhi: voice.${stage} ${where}（${provider}）不可用，已跳过: ${error.message}`)
    }
  })

  if (candidates.length === 0) {
    throw primaryError ?? new AdapterConfigError(`voice.${stage}: no usable provider`)
  }
  if (primaryError) {
    logger?.error?.(
      `dsh-xiaozhi: voice.${stage} 主用不可用（${primaryError.message}），已降级到备用 ${labels[0]}`,
    )
  }
  if (candidates.length === 1) return candidates[0]

  const failoverOptions = { labels, logger, deviceId, clock }
  if (stage === 'llm') return createFailoverLlm(candidates, failoverOptions)
  if (stage === 'tts') return createFailoverTts(candidates, failoverOptions)
  return createFailoverAsr(candidates, failoverOptions)
}

/**
 * @param {object} voice resolved voice config（含各段的 backups 列表）
 * @param {{systemPrompt?: string, ffmpegPath?: string, speechToText?: object, llm?: object,
 *   logger?: object, deviceId?: string, clock?: () => number}} options
 */
export function createVoiceAdapters(
  voice,
  { systemPrompt = '', ffmpegPath = 'ffmpeg', speechToText, llm, logger, deviceId = '', clock } = {},
) {
  const config = voice ?? {}
  const downlinkRate = config.sampleRate?.downlink ?? 24_000
  const uplinkRate = config.sampleRate?.uplink ?? 16_000
  const shared = { logger, deviceId, clock }
  return {
    llm: buildStage('llm', config.llm ?? {}, {
      ...shared,
      build: (spec) => buildLlmAdapter(spec, { systemPrompt, llm, deviceId }),
    }),
    // 本地识别需要宿主服务句柄，随适配器一起传入，避免适配层直接依赖 ctx。
    tts: buildStage('tts', config.tts ?? {}, {
      ...shared,
      build: (spec) => buildTtsAdapter(spec, { ffmpegPath, sampleRate: downlinkRate, deviceId }),
    }),
    asr: buildStage('asr', config.asr ?? {}, {
      ...shared,
      build: (spec) => buildAsrAdapter(spec, { sampleRate: uplinkRate, speechToText, deviceId }),
    }),
  }
}
