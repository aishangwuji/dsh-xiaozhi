    const NS = 'dsh.xiaozhi';
    const API = '/dsh-xiaozhi-7c3a';
    const POLL_MS = 5000;
    // 音色目录来自服务端（与 Go 的 voice_constants.go 同源），只拉一次。
    let VOICES = {};

    /** 厂商显示名（通用）：设备卡片等只读展示用；具体步骤里用 stageProviderLabel()。 */
    const PROVIDER_LABELS = {
      mock: '本地模拟',
      host: 'Harness 厂商',
      deepseek: 'DeepSeek',
      mimo: '小米 MiMo',
      openai: 'OpenAI',
      volc: '火山引擎豆包',
      spark: '讯飞星火',
      edge: '微软 Edge',
      xunfei: '讯飞',
      local: '本地 SenseVoice',
      funasr: 'FunASR（本地）'
    };
    const providerLabel = (id) => PROVIDER_LABELS[id] || id;

    /**
     * 可配置的服务商目录（三段共用同一结构）。
     *
     * 只收录**真实可用**的服务商：`mock` 只用于桌面联调、`host` 是 Harness 自带厂商
     * （没有服务商 Key）、`funasr` 依赖本机额外部署的 FunASR 服务（当前环境没有），
     * 都不出现在下拉里。要新增一家，只改这里：选项、分组、是否免密钥、字段提示都从目录派生。
     *
     * `group` 只影响选择器里的分组标题（云端服务 / 本地服务）。
     */
    const PROVIDER_CATALOG = {
      llm: {
        deepseek: { name: 'DeepSeek', group: 'cloud', baseUrlHint: 'https://api.deepseek.com/v1', modelHint: 'deepseek-chat' },
        // 小米 MiMo：OpenAI Chat Completions 兼容，但鉴权是 `api-key` 头而不是 Bearer。
        // 模型 id **不在这写死**：控制台通过后端 `POST /models`（带当前填写的 Key）实时拉
        // `GET https://api.xiaomimimo.com/v1/models`，拉不到就退回文本框手填。
        mimo: { name: '小米 MiMo', group: 'cloud', baseUrlHint: 'https://api.xiaomimimo.com/v1' },
        openai: { name: 'OpenAI', group: 'cloud', baseUrlHint: 'https://api.openai.com/v1', modelHint: 'gpt-4o-mini' },
        volc: { name: '火山引擎豆包', group: 'cloud', baseUrlHint: 'https://ark.cn-beijing.volces.com/api/v3', modelHint: 'doubao-1.5-pro-32k' },
        spark: { name: '讯飞星火', group: 'cloud', baseUrlHint: 'https://spark-api-open.xf-yun.com/v1', modelHint: 'generalv3.5' }
      },
      tts: {
        volc: { name: '火山引擎豆包', group: 'cloud' },
        xunfei: { name: '讯飞语音合成', group: 'cloud' },
        edge: { name: '微软 Edge', group: 'local', keyless: true }
      },
      asr: {
        volc: { name: '火山引擎豆包', group: 'cloud' },
        xunfei: { name: '讯飞语音听写', group: 'cloud' },
        local: { name: '本地 SenseVoice', group: 'local', keyless: true }
      }
    };

    /** 某一段可选的 provider id（顺序即下拉里的顺序）。 */
    const stageProviders = (stage) => Object.keys(PROVIDER_CATALOG[stage] || {});
    /** 某一段某一家 provider 在界面上的标准名称。 */
    const stageProviderLabel = (stage, id) => PROVIDER_CATALOG[stage]?.[id]?.name || providerLabel(id);

    // ---------------------------------------------------------------- 服务商（主用 + 备用）
    // 契约：docs/backup-providers.md。三段各一行 backups 数组，顺序即优先级。
    // 备用条数**不设上限**（2026-11-08 去掉 5 条上限）：服务端不再拒绝超长列表，
    // 这里也不禁用「添加」按钮。
    /**
     * 主用服务商卡编辑弹窗会写回设置的字段（备用条目走自己的整条合并）。
     * 注意 TTS 的 `rate` / `speed` 不在这里：回复速度是全局/智能体级设置，不属于某个服务商，
     * 编辑主用服务商不能把用户刚调好的语速顺手清掉。
     *
     * TTS 的 `voice` / `model` / `resourceId` 也不在这里：全局只配「厂商 + 凭据」，
     * 音色（= TTS 模型）只在「智能体 → 配置」里按智能体选；`url` 同理只保留原值、不在界面展示。
     */
    const PRIMARY_EDIT_FIELDS = {
      llm: ['model', 'baseUrl', 'appId', 'apiKey'],
      tts: ['appId', 'apiKey', 'apiSecret'],
      asr: ['url', 'language', 'accent', 'resourceId', 'appId', 'apiKey', 'apiSecret']
    };

    /** 编辑弹窗里 provider 胶囊的选项：按「云端服务 / 本地服务」分组。 */
    const providerOptionsFor = (stage) => stageProviders(stage).map((provider) => {
      const meta = PROVIDER_CATALOG[stage][provider];
      return {
        value: provider,
        label: meta.name,
        group: meta.group === 'local' ? t('backupGroupLocal') : t('backupGroupCloud')
      };
    });

    /** 该 provider 是否需要密钥（卡片上显示「无需密钥」而不是「未配置」）。 */
    const isKeylessProvider = (stage, provider) => PROVIDER_CATALOG[stage]?.[provider]?.keyless === true;

    /** 音色 ID → 下拉里那个中文名；目录还没拉到或确实没有这个 ID 时原样显示。 */
    const voiceLabel = (value, provider) => {
      if (!value) return '—';
      const pools = [VOICES[provider], VOICES.volc, VOICES.xunfei, VOICES.edge].filter(Array.isArray);
      for (const pool of pools) {
        const hit = pool.find((voice) => voice.value === value);
        if (hit) return hit.label;
      }
      return value;
    };

    /** 与 src/voice/voices.js 的 resourceTierOf 同源；空值按插件默认的 seed-tts-2.0 算。 */
    const resourceTier = (resourceId) => {
      const id = String(resourceId || '').trim() || 'seed-tts-2.0';
      if (/^seed-(tts|icl)-2/.test(id)) return '2.0';
      if (/^seed-(tts|icl)-1/.test(id)) return '1.x';
      return '';
    };

    /** 只留下与当前资源族同代的音色：混着选会得到 55000000（有字没声）。 */
    const voicesForResource = (list, resourceId) => {
      const tier = resourceTier(resourceId);
      if (!tier) return list;
      const kept = list.filter((voice) => !voice.tier || voice.tier === tier);
      return kept.length > 0 ? kept : list;
    };

    /** 一条服务商配置的空骨架：只放该段契约里允许的字段。 */
    const blankBackup = (stage, provider) => {
      const entry = { provider };
      if (stage === 'llm') Object.assign(entry, { model: '', baseUrl: '', appId: '', apiKey: '' });
      if (stage === 'tts') {
        Object.assign(entry, {
          voice: '', rate: '', speed: '', model: '', resourceId: '', url: '', appId: '', apiKey: '', apiSecret: ''
        });
      }
      if (stage === 'asr') {
        Object.assign(entry, { url: '', language: '', accent: '', resourceId: '', appId: '', apiKey: '', apiSecret: '' });
      }
      return entry;
    };

    /** 服务端可能还没升级（旧版 GET /settings 没有 backups）：一律兜底成空数组，别白屏。 */
    const withBackups = (settings) => {
      if (!settings || typeof settings !== 'object' || !settings.voice) return settings;
      const voice = { ...settings.voice };
      for (const stage of ['llm', 'tts', 'asr']) {
        const stageSettings = voice[stage];
        if (!stageSettings || typeof stageSettings !== 'object') continue;
        voice[stage] = {
          ...stageSettings,
          backups: Array.isArray(stageSettings.backups) ? stageSettings.backups : []
        };
      }
      return { ...settings, voice };
    };

    /** 卡片上的密钥状态：永远只显示掩码，绝不回显明文（新填未保存的显示待保存）。 */
    const backupKeyState = (stage, entry) => {
      const apiKey = typeof entry?.apiKey === 'string' ? entry.apiKey : '';
      const apiSecret = typeof entry?.apiSecret === 'string' ? entry.apiSecret : '';
      const masked = apiKey.includes('•') ? apiKey : apiSecret.includes('•') ? apiSecret : '';
      if (masked) return { ok: true, text: masked };
      if (entry?.hasApiKey === true || entry?.hasApiSecret === true) return { ok: true, text: t('backupKeySet') };
      if (isKeylessProvider(stage, entry?.provider)) return { ok: true, text: t('backupKeyFree') };
      if (apiKey || apiSecret) return { ok: false, text: t('backupKeyPending') };
      return { ok: false, text: t('backupKeyNone') };
    };

    /**
     * 卡片上的关键摘要：LLM 看模型、ASR 看地址 / 资源。
     * TTS 全局只剩「厂商 + 凭据」，没有可展示的摘要（音色在智能体级），调用方会跳过这一行。
     */
    const backupSummaryText = (stage, entry) => {
      if (stage === 'llm') return entry.model || entry.baseUrl || '—';
      if (stage === 'tts') return '—';
      return entry.url || entry.resourceId || entry.language || '—';
    };

    /** 测试结果的小字：LLM 给 ms + 首 token，TTS 给 ms + 字节数。 */
    const backupTestText = (stage, result) => {
      if (!result) return '';
      if (result.ok === false) return String(result.error || t('backupTestFail'));
      const total = result.totalMs ?? result.ms ?? 0;
      if (stage === 'llm') {
        const first = result.firstTokenMs == null ? '—' : result.firstTokenMs;
        return `${total} ms · ${t('firstToken')} ${first} ms`;
      }
      return `${total} ms · ${result.bytes ?? 0} ${t('bytes')}`;
    };

    /** 各步骤的中文名，编弹窗标题用（复用步骤条文案）。 */
    const stageLabel = (stage) => (stage === 'asr' ? t('step3') : stage === 'llm' ? t('step4') : t('step5'));

    let t = (key) => key;
    function formatAgo(value, now = Date.now()) {
      if (!value) return t('never');
      const diff = Math.max(0, now - value);
      if (diff < 60_000) return t('justNow');
      if (diff < 3_600_000) return t('minutesAgo').replace('{n}', String(Math.floor(diff / 60_000)));
      if (diff < 86_400_000) return t('hoursAgo').replace('{n}', String(Math.floor(diff / 3_600_000)));
      return t('daysAgo').replace('{n}', String(Math.floor(diff / 86_400_000)));
    }

    /** 历史时间字段兜底：兼容毫秒时间戳、秒时间戳与 ISO 字符串（后端契约未写死类型）。 */
    function historyTime(value) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value < 1e12 ? value * 1000 : value;
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
      }
      return 0;
    }

    /** 消息时间固定本地 HH:mm；无法解析时返回空串，不渲染时间。 */
    function formatClock(value) {
      const ms = historyTime(value);
      if (!ms) return '';
      const date = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /** 历史音频走相对路径：与 client.js 里其他 GET 用法一致，不能带前导 /。 */
    function historyAudioUrl(deviceId, audioId) {
      return `dsh-xiaozhi-7c3a/history/audio?deviceId=${encodeURIComponent(deviceId)}&audioId=${encodeURIComponent(audioId)}`;
    }

    async function callApi(path, { method = 'GET', body } = {}) {
      const headers = { 'content-type': 'application/json', 'x-dsh-xiaozhi': '1' };
      const response = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = {};
      }
      if (!response.ok) {
        const error = new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return parsed;
    }
    const OUTPUT_LANGUAGE_VALUES = ['普通话', '英语', '日语', '粤语', '韩语'];
    /** 工具名到中文名，未知的按原名显示。 */
    const toolLabel = (name) => {
      const map = {
        get_current_time: t('toolGetCurrentTime'),
        web_search: t('toolWebSearch'),
        web_fetch: t('toolWebFetch'),
        get_news_from_chinanews: t('toolNews')
      };
      return map[name] || name;
    };
export function setVoices(next) { VOICES = next }
export function setT(fn) { t = fn }
export {
  NS, API, POLL_MS, VOICES, t,
  PROVIDER_LABELS, providerLabel, PROVIDER_CATALOG,
  stageProviders, stageProviderLabel, PRIMARY_EDIT_FIELDS,
  providerOptionsFor, isKeylessProvider, voiceLabel,
  resourceTier, voicesForResource, blankBackup, withBackups,
  backupKeyState, backupSummaryText, backupTestText, stageLabel,
  OUTPUT_LANGUAGE_VALUES, formatAgo, historyTime, formatClock,
  historyAudioUrl, callApi, toolLabel
}
