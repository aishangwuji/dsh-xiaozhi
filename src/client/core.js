import { PROVIDERS as BUNDLED_PROVIDERS, STAGE_META as BUNDLED_STAGE_META } from '../providers.js'
    const NS = 'dsh.xiaozhi';
    const API = '/dsh-xiaozhi-7c3a';
    const POLL_MS = 5000;
    // 音色目录来自服务端（与 Go 的 voice_constants.go 同源），只拉一次。
    let VOICES = {};

    // 服务商描述符：打包一份兜底；`GET /providers` 回来后替换（服务端加厂商前端不用发版）。
    let PROVIDERS = BUNDLED_PROVIDERS;
    let STAGE_META = BUNDLED_STAGE_META;
    let PROVIDER_INDEX = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

    /** 用 `GET /providers` 的响应替换描述符（幂等；空响应保持兜底）。 */
    const setProviders = (payload) => {
      if (Array.isArray(payload?.providers) && payload.providers.length > 0) {
        PROVIDERS = payload.providers;
        PROVIDER_INDEX = new Map(PROVIDERS.map((provider) => [provider.id, provider]));
      }
      if (payload?.stages && typeof payload.stages === 'object') STAGE_META = payload.stages;
    };

    const providerById = (id) => PROVIDER_INDEX.get(String(id ?? '')) || null;
    const stageDescriptor = (id, stage) => providerById(id)?.stages?.[stage] || null;
    /**
     * 某一段可选的 provider id（顺序即下拉里的顺序）。
     *
     * `hidden: true` 的厂商（当前是 funasr：需本机自部署）**只存不展示**：`GET /providers`
     * 返回的是全量描述符（存储白名单要用它），控制台必须自己过滤，否则下拉里会冒出
     * FunASR 这类没装就用不了的选项（2026-11-09 修，截图实测出现过）。
     */
    const stageProviders = (stage) => PROVIDERS
      .filter((provider) => provider.stages?.[stage] && provider.hidden !== true)
      .map((provider) => provider.id);
    /** 某一段某一家 provider 在界面上的标准名称（允许 stage 级覆盖，如讯飞 TTS/ASR 名字不同）。 */
    const stageProviderLabel = (stage, id) => stageDescriptor(id, stage)?.name || providerById(id)?.name || String(id ?? '');
    const providerLabel = (id) => providerById(id)?.name || String(id ?? '');

    /** 编辑弹窗里 provider 胶囊的选项：按「云端服务 / 本地服务」分组。 */
    const providerOptionsFor = (stage) => stageProviders(stage).map((id) => {
      const meta = stageDescriptor(id, stage) || {};
      const group = meta.group || providerById(id)?.group || 'cloud';
      return {
        value: id,
        label: meta.name || providerById(id)?.name || id,
        group: group === 'local' ? t('backupGroupLocal') : t('backupGroupCloud')
      };
    });

    /** 该 provider 在该段是否免密钥（卡片上显示「无需密钥」而不是「未配置」）。 */
    const isKeylessProvider = (stage, id) => stageDescriptor(id, stage)?.keyless === true;

    /** 主用编辑弹窗会写回的字段（换厂商时用于清掉上一家的残留值）。 */
    const primaryEditFields = (stage) => STAGE_META[stage]?.editFields || [];

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

    /** 一条服务商配置的空骨架：只放该段存储契约里允许的字段（描述符只决定「显示什么」）。 */
    const blankBackup = (stage, provider) => {
      const entry = { provider };
      for (const key of STAGE_META[stage]?.storageFields || []) entry[key] = '';
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

    /** 卡片上的密钥状态：只看描述符声明的 secretFields，永远只显示掩码，绝不回显明文。 */
    const backupKeyState = (stage, entry) => {
      const desc = stageDescriptor(entry?.provider, stage) || {};
      const secrets = Array.isArray(desc.secretFields) && desc.secretFields.length > 0
        ? desc.secretFields
        : ['apiKey', 'apiSecret'];
      for (const key of secrets) {
        const value = typeof entry?.[key] === 'string' ? entry[key] : '';
        if (value.includes('•')) return { ok: true, text: value };
      }
      if (entry?.hasApiKey === true || entry?.hasApiSecret === true) return { ok: true, text: t('backupKeySet') };
      if (desc.keyless === true) return { ok: true, text: t('backupKeyFree') };
      if (secrets.some((key) => typeof entry?.[key] === 'string' && entry[key])) {
        return { ok: false, text: t('backupKeyPending') };
      }
      return { ok: false, text: t('backupKeyNone') };
    };

    /** 卡片上的关键摘要：按描述符 summary 顺序取第一个非空字段。 */
    const backupSummaryText = (stage, entry) => {
      const desc = stageDescriptor(entry?.provider, stage) || {};
      for (const key of Array.isArray(desc.summary) ? desc.summary : []) {
        const value = entry?.[key];
        if (value) return String(value);
      }
      return '—';
    };

    /** 测试结果的小字：LLM 给 ms + 首 token，TTS 给 ms + 字节数，ASR 给 ms + 识别文本。 */
    const backupTestText = (stage, result) => {
      if (!result) return '';
      if (result.ok === false) return String(result.error || t('backupTestFail'));
      const total = result.totalMs ?? result.ms ?? 0;
      if (stage === 'llm') {
        const first = result.firstTokenMs == null ? '—' : result.firstTokenMs;
        return `${total} ms · ${t('firstToken')} ${first} ms`;
      }
      if (stage === 'asr') {
        const text = typeof result.text === 'string' ? result.text.trim() : '';
        const sample = text
          ? `“${text.length > 40 ? `${text.slice(0, 40)}…` : text}”`
          : t('asrNoText');
        return `${total} ms · ${sample}`;
      }
      return `${total} ms · ${result.bytes ?? 0} ${t('bytes')}`;
    };

    /** 各步骤的中文名，编弹窗标题用（复用步骤条文案）。 */
    const stageLabel = (stage) => t(STAGE_META[stage]?.labelKey || 'step5');

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
        error.code = parsed?.error?.code ?? '';
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
        get_news_from_chinanews: t('toolNews'),
        get_news_from_newsnow: t('toolNewsnow'),
        get_weather: t('toolWeather'),
        get_lunar: t('toolLunar'),
        handle_exit_intent: t('toolExit'),
        hass_get_state: t('toolHassGet'),
        hass_set_state: t('toolHassSet'),
        hass_play_music: t('toolHassMusic'),
        search_from_ragflow: t('toolRagflow'),
        change_role: t('toolChangeRole'),
        call_device: t('toolCallDevice'),
        play_music: t('toolPlayMusic')
      };
      return map[name] || name;
    };
export function setVoices(next) { VOICES = next }
export function setT(fn) { t = fn }
export {
  NS, API, POLL_MS, VOICES, t,
  providerById, providerLabel, stageDescriptor, setProviders,
  stageProviders, stageProviderLabel, primaryEditFields,
  providerOptionsFor, isKeylessProvider, voiceLabel,
  resourceTier, voicesForResource, blankBackup, withBackups,
  backupKeyState, backupSummaryText, backupTestText, stageLabel,
  OUTPUT_LANGUAGE_VALUES, formatAgo, historyTime, formatClock,
  historyAudioUrl, callApi, toolLabel
}
