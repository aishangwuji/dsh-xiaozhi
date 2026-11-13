/**
 * 服务商描述符（Provider Descriptor）—— 控制台"快速接入"的唯一元数据来源。
 *
 * 目标：**加一个厂商 = 加一份描述符 + 一个适配器**，前端不需要为它写任何 `stage ===` /
 * `provider ===` 分支。控制台通过 `GET /providers` 拿这份数据；同一份数据也打包进
 * client.js 作为首屏兜底（服务端还没升级时页面不会空）。
 *
 * 描述符只描述**配置形态**（要填什么、怎么显示、摘要看哪些字段、要不要测试），
 * **不描述调用逻辑**——怎么调厂商永远在 `src/voice/adapters/*` 里。
 *
 * 结构：
 *   {
 *     id, name, group: 'cloud' | 'local',
 *     stages: {
 *       llm|tts|asr: {
 *         name?: 覆盖 stage 内的显示名（讯飞 TTS/ASR 名字不同）,
 *         group?: 覆盖分组,
 *         keyless?: true（免密钥）,
 *         note?: i18n key（整段提示，如 Edge 免密钥）,
 *         fields: [{ key, type, label, placeholder?, placeholderKey?, note?, required?, showWhen?, modelKind? }],
 *         summary: [key...]（卡片摘要按顺序取第一个非空）,
 *         secretFields: [key...]（掩码/留空保留/密钥状态只看这些）,
 *         probe: { kind: 'chat' | 'tts' | 'none' },
 *         baseUrlHint?, modelHint?
 *       }
 *     }
 *   }
 *
 * 字段 type 由前端 `SchemaForm` 的渲染器注册表消费；未知 type 降级为 text（向后兼容）。
 */
export const PROVIDER_SCHEMA_VERSION = 1

export const STAGES = ['llm', 'tts', 'asr']

/**
 * 每一段的存储/编辑元数据。
 *
 * - `storageFields`：一条备用条目在 settings.json 里允许出现的字段（保存时整条提交）；
 * - `editFields`：主用编辑弹窗会写回的扁平字段（换厂商时用于清掉上一家的残留值）。
 *
 * 这些是**段级**契约（同一段所有厂商共用一套存储形状），与厂商无关。
 */
export const STAGE_META = {
  llm: {
    labelKey: 'step4',
    storageFields: ['model', 'baseUrl', 'appId', 'apiKey'],
    editFields: ['model', 'baseUrl', 'appId', 'apiKey'],
  },
  tts: {
    labelKey: 'step5',
    storageFields: ['voice', 'rate', 'speed', 'model', 'resourceId', 'url', 'appId', 'apiKey', 'apiSecret'],
    editFields: ['appId', 'apiKey', 'apiSecret'],
  },
  asr: {
    labelKey: 'step3',
    // `url` 保留在**存储**白名单里（手写 settings 的端点覆盖仍然生效、不被清掉），
    // 但**不在 editFields**：控制台不再渲染地址框，保存主用时也就不该把已有 url 覆盖成空串
    // ——那等于静默删掉别人手配的自建/代理端点还不给提示。
    storageFields: ['url', 'language', 'accent', 'resourceId', 'appId', 'apiKey', 'apiSecret'],
    editFields: ['language', 'accent', 'resourceId', 'appId', 'apiKey', 'apiSecret'],
  },
}

const secret = (key, label = key) => ({ key, type: 'secret', label, required: true })

/** LLM 段：模型 / Base URL / Key，所有 OpenAI 兼容厂商共用。 */
function llmStage(baseUrlHint, modelHint = '') {
  return {
    baseUrlHint,
    modelHint,
    fields: [
      // 模型清单从厂商 /v1/models 拉；placeholder 用 i18n key，避免写死具体模型 id。
      { key: 'model', type: 'model', modelKind: 'llm', label: 'model', placeholderKey: 'modelFromApi' },
      { key: 'baseUrl', type: 'url', label: 'baseUrl', placeholder: baseUrlHint },
      secret('apiKey'),
    ],
    summary: ['model', 'baseUrl'],
    secretFields: ['apiKey'],
    probe: { kind: 'chat' },
  }
}

export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    group: 'cloud',
    stages: { llm: llmStage('https://api.deepseek.com/v1', 'deepseek-chat') },
  },
  {
    // 小米 MiMo：OpenAI Chat Completions 兼容，但鉴权是 `api-key` 头而不是 Bearer。
    // 模型 id 不写死：控制台通过后端 POST /models 实时拉 GET /v1/models。
    id: 'mimo',
    name: '小米 MiMo',
    group: 'cloud',
    stages: { llm: llmStage('https://api.xiaomimimo.com/v1') },
  },
  {
    // LLM 只保留 DeepSeek 与小米 MiMo（2026-11-09 用户要求）：OpenAI / 火山豆包 / 讯飞星火
    // 从 LLM 下拉移除。火山仍有 TTS + ASR、讯飞仍有 TTS + ASR，见下面各自的 stage。
    // 注意：这里删的是**描述符里的 llm 段**，不是厂商本身——删厂商会连带把语音段一起弄没。
    id: 'volc',
    name: '火山引擎豆包',
    group: 'cloud',
    stages: {
      tts: {
        fields: [
          { ...secret('apiKey'), note: 'volcTtsKeyNote' },
          // 火山 OpenAPI 的 AK/SK：只用于拉官方音色列表（ListSpeakers），不参与合成。
          // 复用 appId/apiSecret 两个通用槽位，避免再动 settings 的字段/掩码契约。
          {
            key: 'appId',
            type: 'text',
            label: 'volcAccessKey',
            placeholder: 'AKLT…',
            primaryOnly: true,
            note: 'volcAkSkNote',
          },
          {
            key: 'apiSecret',
            type: 'secret',
            label: 'volcSecretKey',
            primaryOnly: true,
            note: 'volcAkSkNote',
          },
        ],
        summary: [],
        secretFields: ['apiKey'],
        probe: { kind: 'tts' },
      },
      asr: {
        // 端点内置（`src/voice/adapters/volc-asr.js` 的默认 URL），控制台不再暴露地址框：
        // 端点几乎不变，露出来只会让人以为必须填。手写 settings 里的 url 仍生效。
        fields: [
          { ...secret('apiKey'), note: 'volcAsrKeyNote' },
          {
            key: 'resourceId',
            type: 'model',
            modelKind: 'asrResource',
            label: 'resourceId',
            placeholder: 'volc.seedasr.sauc.duration',
            note: 'volcAsrResourceNote',
          },
        ],
        summary: ['resourceId'],
        secretFields: ['apiKey'],
        probe: { kind: 'asr', labelKey: 'backupTestAsr' },
      },
    },
  },
  {
    id: 'xunfei',
    name: '讯飞',
    group: 'cloud',
    stages: {
      tts: {
        name: '讯飞语音合成',
        fields: [
          { key: 'appId', type: 'text', label: 'appId', placeholder: '5f1b…', required: true, note: 'xunfeiAuthNote' },
          secret('apiKey'),
          secret('apiSecret'),
        ],
        summary: [],
        secretFields: ['apiKey', 'apiSecret'],
        probe: { kind: 'tts' },
      },
      asr: {
        name: '讯飞语音听写',
        fields: [
          { key: 'appId', type: 'text', label: 'appId', placeholder: '5f1b…', required: true, note: 'xunfeiAuthNote' },
          secret('apiKey'),
          secret('apiSecret'),
          { key: 'language', type: 'text', label: 'asrLanguage', placeholder: 'zh_cn', note: 'asrLanguageNote' },
        ],
        summary: ['language'],
        secretFields: ['apiKey', 'apiSecret'],
        probe: { kind: 'asr', labelKey: 'backupTestAsr' },
      },
    },
  },
  {
    id: 'edge',
    name: '微软 Edge',
    group: 'local',
    stages: {
      tts: {
        // Edge 免密钥：没有要填的凭据（MP3→PCM 由服务端 ffmpeg 处理）。
        keyless: true,
        note: 'ttsEdgeKeyless',
        fields: [],
        summary: [],
        secretFields: [],
        probe: { kind: 'tts' },
      },
    },
  },
  {
    id: 'local',
    name: '本地 SenseVoice',
    group: 'local',
    stages: {
      asr: {
        // 本地 SenseVoice：使用 Harness 内置识别服务，不需要地址与密钥。
        keyless: true,
        note: 'localAsrNote',
        fields: [{ key: 'language', type: 'text', label: 'asrLanguage', placeholder: 'zh_cn', note: 'asrLanguageNote' }],
        summary: ['language'],
        secretFields: [],
        probe: { kind: 'asr', labelKey: 'backupTestAsr' },
      },
    },
  },
  {
    // funasr 需要本机自部署 FunASR 服务，控制台**不展示**（hidden），但存储白名单保留：
    // 手写过 funasr 配置的用户保存时不会被清掉。适配器仍在服务端。
    id: 'funasr',
    name: 'FunASR（本地）',
    group: 'local',
    hidden: true,
    stages: {
      asr: {
        keyless: true,
        fields: [],
        summary: [],
        secretFields: [],
        probe: { kind: 'asr', labelKey: 'backupTestAsr' },
      },
    },
  },
]

/** 按 id 找一家厂商（未知返回 null）。 */
export function providerById(id) {
  const key = String(id ?? '')
  return PROVIDERS.find((provider) => provider.id === key) || null
}

/** 某一段可选厂商的 id（顺序即下拉顺序；`hidden` 的不给控制台选）。 */
export function providersForStage(stage) {
  return PROVIDERS.filter((provider) => provider.stages?.[stage] && provider.hidden !== true).map((provider) => provider.id)
}

/** 某一段**全部**厂商（含 hidden）：给存储白名单用，保证手写配置不被清掉。 */
export function allProvidersForStage(stage) {
  return PROVIDERS.filter((provider) => provider.stages?.[stage]).map((provider) => provider.id)
}

/** 某家厂商在某一段的描述（不支持该段返回 null）。 */
export function stageDescriptor(id, stage) {
  return providerById(id)?.stages?.[stage] || null
}

/** 某家厂商在某一段的显示名（允许 stage 级覆盖，如讯飞 TTS/ASR 名字不同）。 */
export function stageProviderLabel(stage, id) {
  const provider = providerById(id)
  return stageDescriptor(id, stage)?.name || provider?.name || String(id ?? '')
}

/** 通用厂商显示名（不区分 stage）。 */
export function providerLabel(id) {
  return providerById(id)?.name || String(id ?? '')
}

/** `GET /providers` 的响应体。 */
export function providersPayload() {
  return {
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    providers: PROVIDERS,
    stages: STAGE_META,
  }
}
