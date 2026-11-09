window.__ModuleLoader__.load({
  id: '@local/dsh-xiaozhi',
  factory(require) {
var DshXiaozhi = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/index.js
  var index_exports = {};
  __export(index_exports, {
    apply: () => apply,
    inject: () => inject
  });

  // src/providers.js
  var STAGE_META = {
    llm: {
      labelKey: "step4",
      storageFields: ["model", "baseUrl", "appId", "apiKey"],
      editFields: ["model", "baseUrl", "appId", "apiKey"]
    },
    tts: {
      labelKey: "step5",
      storageFields: ["voice", "rate", "speed", "model", "resourceId", "url", "appId", "apiKey", "apiSecret"],
      editFields: ["appId", "apiKey", "apiSecret"]
    },
    asr: {
      labelKey: "step3",
      storageFields: ["url", "language", "accent", "resourceId", "appId", "apiKey", "apiSecret"],
      editFields: ["url", "language", "accent", "resourceId", "appId", "apiKey", "apiSecret"]
    }
  };
  var secret = (key, label = key) => ({ key, type: "secret", label, required: true });
  function llmStage(baseUrlHint, modelHint = "") {
    return {
      baseUrlHint,
      modelHint,
      fields: [
        // 模型清单从厂商 /v1/models 拉；placeholder 用 i18n key，避免写死具体模型 id。
        { key: "model", type: "model", modelKind: "llm", label: "model", placeholderKey: "modelFromApi" },
        { key: "baseUrl", type: "url", label: "baseUrl", placeholder: baseUrlHint },
        secret("apiKey")
      ],
      summary: ["model", "baseUrl"],
      secretFields: ["apiKey"],
      probe: { kind: "chat" }
    };
  }
  var PROVIDERS = [
    {
      id: "deepseek",
      name: "DeepSeek",
      group: "cloud",
      stages: { llm: llmStage("https://api.deepseek.com/v1", "deepseek-chat") }
    },
    {
      // 小米 MiMo：OpenAI Chat Completions 兼容，但鉴权是 `api-key` 头而不是 Bearer。
      // 模型 id 不写死：控制台通过后端 POST /models 实时拉 GET /v1/models。
      id: "mimo",
      name: "\u5C0F\u7C73 MiMo",
      group: "cloud",
      stages: { llm: llmStage("https://api.xiaomimimo.com/v1") }
    },
    {
      id: "openai",
      name: "OpenAI",
      group: "cloud",
      stages: { llm: llmStage("https://api.openai.com/v1", "gpt-4o-mini") }
    },
    {
      id: "volc",
      name: "\u706B\u5C71\u5F15\u64CE\u8C46\u5305",
      group: "cloud",
      stages: {
        llm: llmStage("https://ark.cn-beijing.volces.com/api/v3", "doubao-1.5-pro-32k"),
        tts: {
          fields: [
            { ...secret("apiKey"), note: "volcTtsKeyNote" },
            // 火山 OpenAPI 的 AK/SK：只用于拉官方音色列表（ListSpeakers），不参与合成。
            // 复用 appId/apiSecret 两个通用槽位，避免再动 settings 的字段/掩码契约。
            {
              key: "appId",
              type: "text",
              label: "volcAccessKey",
              placeholder: "AKLT\u2026",
              primaryOnly: true,
              note: "volcAkSkNote"
            },
            {
              key: "apiSecret",
              type: "secret",
              label: "volcSecretKey",
              primaryOnly: true,
              note: "volcAkSkNote"
            }
          ],
          summary: [],
          secretFields: ["apiKey"],
          probe: { kind: "tts" }
        },
        asr: {
          fields: [
            { ...secret("apiKey"), note: "volcAsrKeyNote" },
            {
              key: "resourceId",
              type: "model",
              modelKind: "asrResource",
              label: "resourceId",
              placeholder: "volc.seedasr.sauc.duration",
              note: "volcAsrResourceNote"
            },
            {
              key: "url",
              type: "url",
              label: "asrUrl",
              placeholder: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
              note: "asrUrlNote"
            }
          ],
          summary: ["url", "resourceId"],
          secretFields: ["apiKey"],
          probe: { kind: "asr", labelKey: "backupTestAsr" }
        }
      }
    },
    {
      id: "spark",
      name: "\u8BAF\u98DE\u661F\u706B",
      group: "cloud",
      stages: { llm: llmStage("https://spark-api-open.xf-yun.com/v1", "generalv3.5") }
    },
    {
      id: "xunfei",
      name: "\u8BAF\u98DE",
      group: "cloud",
      stages: {
        tts: {
          name: "\u8BAF\u98DE\u8BED\u97F3\u5408\u6210",
          fields: [
            { key: "appId", type: "text", label: "appId", placeholder: "5f1b\u2026", required: true, note: "xunfeiAuthNote" },
            secret("apiKey"),
            secret("apiSecret")
          ],
          summary: [],
          secretFields: ["apiKey", "apiSecret"],
          probe: { kind: "tts" }
        },
        asr: {
          name: "\u8BAF\u98DE\u8BED\u97F3\u542C\u5199",
          fields: [
            { key: "appId", type: "text", label: "appId", placeholder: "5f1b\u2026", required: true, note: "xunfeiAuthNote" },
            secret("apiKey"),
            secret("apiSecret"),
            { key: "language", type: "text", label: "asrLanguage", placeholder: "zh_cn", note: "asrLanguageNote" }
          ],
          summary: ["language"],
          secretFields: ["apiKey", "apiSecret"],
          probe: { kind: "asr", labelKey: "backupTestAsr" }
        }
      }
    },
    {
      id: "edge",
      name: "\u5FAE\u8F6F Edge",
      group: "local",
      stages: {
        tts: {
          // Edge 免密钥：没有要填的凭据（MP3→PCM 由服务端 ffmpeg 处理）。
          keyless: true,
          note: "ttsEdgeKeyless",
          fields: [],
          summary: [],
          secretFields: [],
          probe: { kind: "tts" }
        }
      }
    },
    {
      id: "local",
      name: "\u672C\u5730 SenseVoice",
      group: "local",
      stages: {
        asr: {
          // 本地 SenseVoice：使用 Harness 内置识别服务，不需要地址与密钥。
          keyless: true,
          note: "localAsrNote",
          fields: [{ key: "language", type: "text", label: "asrLanguage", placeholder: "zh_cn", note: "asrLanguageNote" }],
          summary: ["language"],
          secretFields: [],
          probe: { kind: "asr", labelKey: "backupTestAsr" }
        }
      }
    },
    {
      // funasr 需要本机自部署 FunASR 服务，控制台**不展示**（hidden），但存储白名单保留：
      // 手写过 funasr 配置的用户保存时不会被清掉。适配器仍在服务端。
      id: "funasr",
      name: "FunASR\uFF08\u672C\u5730\uFF09",
      group: "local",
      hidden: true,
      stages: {
        asr: {
          keyless: true,
          fields: [],
          summary: [],
          secretFields: [],
          probe: { kind: "asr", labelKey: "backupTestAsr" }
        }
      }
    }
  ];

  // src/client/core.js
  var NS = "dsh.xiaozhi";
  var API = "/dsh-xiaozhi-7c3a";
  var POLL_MS = 5e3;
  var VOICES = {};
  var PROVIDERS2 = PROVIDERS;
  var STAGE_META2 = STAGE_META;
  var PROVIDER_INDEX = new Map(PROVIDERS2.map((provider) => [provider.id, provider]));
  var setProviders = (payload) => {
    if (Array.isArray(payload?.providers) && payload.providers.length > 0) {
      PROVIDERS2 = payload.providers;
      PROVIDER_INDEX = new Map(PROVIDERS2.map((provider) => [provider.id, provider]));
    }
    if (payload?.stages && typeof payload.stages === "object") STAGE_META2 = payload.stages;
  };
  var providerById = (id) => PROVIDER_INDEX.get(String(id ?? "")) || null;
  var stageDescriptor = (id, stage) => providerById(id)?.stages?.[stage] || null;
  var stageProviders = (stage) => PROVIDERS2.filter((provider) => provider.stages?.[stage]).map((provider) => provider.id);
  var stageProviderLabel = (stage, id) => stageDescriptor(id, stage)?.name || providerById(id)?.name || String(id ?? "");
  var providerOptionsFor = (stage) => stageProviders(stage).map((id) => {
    const meta = stageDescriptor(id, stage) || {};
    const group = meta.group || providerById(id)?.group || "cloud";
    return {
      value: id,
      label: meta.name || providerById(id)?.name || id,
      group: group === "local" ? t("backupGroupLocal") : t("backupGroupCloud")
    };
  });
  var primaryEditFields = (stage) => STAGE_META2[stage]?.editFields || [];
  var voiceLabel = (value, provider) => {
    if (!value) return "\u2014";
    const pools = [VOICES[provider], VOICES.volc, VOICES.xunfei, VOICES.edge].filter(Array.isArray);
    for (const pool of pools) {
      const hit = pool.find((voice) => voice.value === value);
      if (hit) return hit.label;
    }
    return value;
  };
  var resourceTier = (resourceId) => {
    const id = String(resourceId || "").trim() || "seed-tts-2.0";
    if (/^seed-(tts|icl)-2/.test(id)) return "2.0";
    if (/^seed-(tts|icl)-1/.test(id)) return "1.x";
    return "";
  };
  var voicesForResource = (list, resourceId) => {
    const tier = resourceTier(resourceId);
    if (!tier) return list;
    const kept = list.filter((voice) => !voice.tier || voice.tier === tier);
    return kept.length > 0 ? kept : list;
  };
  var blankBackup = (stage, provider) => {
    const entry = { provider };
    for (const key of STAGE_META2[stage]?.storageFields || []) entry[key] = "";
    return entry;
  };
  var withBackups = (settings) => {
    if (!settings || typeof settings !== "object" || !settings.voice) return settings;
    const voice = { ...settings.voice };
    for (const stage of ["llm", "tts", "asr"]) {
      const stageSettings = voice[stage];
      if (!stageSettings || typeof stageSettings !== "object") continue;
      voice[stage] = {
        ...stageSettings,
        backups: Array.isArray(stageSettings.backups) ? stageSettings.backups : []
      };
    }
    return { ...settings, voice };
  };
  var backupKeyState = (stage, entry) => {
    const desc = stageDescriptor(entry?.provider, stage) || {};
    const secrets = Array.isArray(desc.secretFields) && desc.secretFields.length > 0 ? desc.secretFields : ["apiKey", "apiSecret"];
    for (const key of secrets) {
      const value = typeof entry?.[key] === "string" ? entry[key] : "";
      if (value.includes("\u2022")) return { ok: true, text: value };
    }
    if (entry?.hasApiKey === true || entry?.hasApiSecret === true) return { ok: true, text: t("backupKeySet") };
    if (desc.keyless === true) return { ok: true, text: t("backupKeyFree") };
    if (secrets.some((key) => typeof entry?.[key] === "string" && entry[key])) {
      return { ok: false, text: t("backupKeyPending") };
    }
    return { ok: false, text: t("backupKeyNone") };
  };
  var backupSummaryText = (stage, entry) => {
    const desc = stageDescriptor(entry?.provider, stage) || {};
    for (const key of Array.isArray(desc.summary) ? desc.summary : []) {
      const value = entry?.[key];
      if (value) return String(value);
    }
    return "\u2014";
  };
  var backupTestText = (stage, result) => {
    if (!result) return "";
    if (result.ok === false) return String(result.error || t("backupTestFail"));
    const total = result.totalMs ?? result.ms ?? 0;
    if (stage === "llm") {
      const first = result.firstTokenMs == null ? "\u2014" : result.firstTokenMs;
      return `${total} ms \xB7 ${t("firstToken")} ${first} ms`;
    }
    if (stage === "asr") {
      const text = typeof result.text === "string" ? result.text.trim() : "";
      const sample = text ? `\u201C${text.length > 40 ? `${text.slice(0, 40)}\u2026` : text}\u201D` : t("asrNoText");
      return `${total} ms \xB7 ${sample}`;
    }
    return `${total} ms \xB7 ${result.bytes ?? 0} ${t("bytes")}`;
  };
  var stageLabel = (stage) => t(STAGE_META2[stage]?.labelKey || "step5");
  var t = (key) => key;
  function formatAgo(value, now = Date.now()) {
    if (!value) return t("never");
    const diff = Math.max(0, now - value);
    if (diff < 6e4) return t("justNow");
    if (diff < 36e5) return t("minutesAgo").replace("{n}", String(Math.floor(diff / 6e4)));
    if (diff < 864e5) return t("hoursAgo").replace("{n}", String(Math.floor(diff / 36e5)));
    return t("daysAgo").replace("{n}", String(Math.floor(diff / 864e5)));
  }
  function historyTime(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value < 1e12 ? value * 1e3 : value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
  function formatClock(value) {
    const ms = historyTime(value);
    if (!ms) return "";
    const date = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function historyAudioUrl(deviceId, audioId) {
    return `dsh-xiaozhi-7c3a/history/audio?deviceId=${encodeURIComponent(deviceId)}&audioId=${encodeURIComponent(audioId)}`;
  }
  async function callApi(path, { method = "GET", body } = {}) {
    const headers = { "content-type": "application/json", "x-dsh-xiaozhi": "1" };
    const response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === void 0 ? void 0 : JSON.stringify(body)
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
      error.code = parsed?.error?.code ?? "";
      throw error;
    }
    return parsed;
  }
  var OUTPUT_LANGUAGE_VALUES = ["\u666E\u901A\u8BDD", "\u82F1\u8BED", "\u65E5\u8BED", "\u7CA4\u8BED", "\u97E9\u8BED"];
  var toolLabel = (name) => {
    const map = {
      get_current_time: t("toolGetCurrentTime"),
      web_search: t("toolWebSearch"),
      web_fetch: t("toolWebFetch"),
      get_news_from_chinanews: t("toolNews"),
      get_news_from_newsnow: t("toolNewsnow"),
      get_weather: t("toolWeather"),
      get_lunar: t("toolLunar"),
      handle_exit_intent: t("toolExit"),
      hass_get_state: t("toolHassGet"),
      hass_set_state: t("toolHassSet"),
      hass_play_music: t("toolHassMusic"),
      search_from_ragflow: t("toolRagflow"),
      change_role: t("toolChangeRole"),
      call_device: t("toolCallDevice"),
      play_music: t("toolPlayMusic")
    };
    return map[name] || name;
  };
  function setVoices(next) {
    VOICES = next;
  }
  function setT(fn) {
    t = fn;
  }

  // src/client/i18n/zh.js
  var zh = {
    brand: "\u5C0F\u667A\u63A7\u5236\u53F0",
    navOverview: "\u6982\u89C8",
    navDevices: "\u667A\u80FD\u4F53",
    navCapabilities: "\u80FD\u529B",
    capabilitiesTitle: "\u6269\u5C55\u80FD\u529B",
    navGlobal: "\u5168\u5C40\u8BBE\u7F6E",
    unnamed: "\u672A\u547D\u540D",
    configure: "\u914D\u7F6E",
    close: "\u5173\u95ED",
    memory: "\u8BB0\u5FC6",
    memoryPlaceholder: "\u8F93\u5165\u8981\u8BB0\u4F4F\u7684\u5185\u5BB9\uFF0C\u4F8B\u5982\uFF1A\u559C\u6B22\u559D\u51B0\u7F8E\u5F0F",
    add: "\u6DFB\u52A0",
    otaUpgrade: "OTA \u5347\u7EA7",
    tabRole: "\u89D2\u8272",
    tabModel: "\u6A21\u578B\u4E0E\u8BB0\u5FC6",
    tabExt: "\u6269\u5C55\u80FD\u529B",
    voiceSettings: "\u8BED\u97F3\u8BBE\u7F6E",
    recognizeSpeed: "\u8BC6\u522B\u901F\u5EA6",
    replySpeed: "\u56DE\u590D\u901F\u5EA6",
    fast: "\u5FEB",
    slow: "\u6162",
    standard: "\u6807\u51C6",
    personaPlaceholder: "\u63CF\u8FF0\u8FD9\u4E2A\u89D2\u8272\u600E\u4E48\u8BF4\u8BDD\u3001\u4EC0\u4E48\u6027\u683C\u2026\u2026",
    replyMaxTokens: "\u56DE\u590D\u957F\u5EA6\u4E0A\u9650\uFF08tokens\uFF09",
    replyMaxTokensHint: "\u7559\u7A7A = 120\uFF08\u7EA6 60 \u5B57\uFF09",
    memoryHint: "\u8FD9\u4E2A\u667A\u80FD\u4F53\u7ED1\u5B9A\u7684\u8BBE\u5907\u804A\u8FC7\u7684\u5185\u5BB9\u4F1A\u81EA\u52A8\u8BB0\u8FDB\u8BB0\u5FC6\uFF0C\u5E76\u5728\u4E0B\u4E00\u8F6E\u5BF9\u8BDD\u6CE8\u5165\u4EBA\u8BBE\u4E4B\u540E\u3002",
    officialServices: "\u5B98\u65B9\u670D\u52A1",
    capSearch: "\u8054\u7F51\u641C\u7D22",
    capTime: "\u65F6\u95F4\u65E5\u671F",
    capabilityHint: "\u5DF2\u63A5\u5165\u7684\u80FD\u529B\u7531\u6A21\u578B\u6309\u9700\u8C03\u7528\uFF1B\u6807\u300C\u672A\u63A5\u5165\u300D\u7684\u8FD8\u6CA1\u6709\u5BF9\u5E94\u6570\u636E\u6E90\uFF0C\u63A5\u4E0A MCP \u540E\u4F1A\u9010\u9879\u70B9\u4EAE\u3002",
    capabilityEmpty: "\u670D\u52A1\u7AEF\u8FD8\u6CA1\u6709\u6CE8\u518C\u4EFB\u4F55\u5DE5\u5177",
    capTool: "\u5DE5\u5177",
    capSystem: "\u7CFB\u7EDF\u63A7\u5236",
    toolGetCurrentTime: "\u65F6\u95F4\u65E5\u671F",
    toolWebSearch: "\u8054\u7F51\u641C\u7D22",
    toolWebFetch: "\u7F51\u9875\u6293\u53D6",
    toolNewsnow: "\u70ED\u699C\u65B0\u95FB",
    toolWeather: "\u5929\u6C14",
    toolLunar: "\u519C\u5386",
    toolExit: "\u7ED3\u675F\u5BF9\u8BDD",
    toolHassGet: "\u5BB6\u7535\u72B6\u6001",
    toolHassSet: "\u63A7\u5236\u5BB6\u7535",
    toolHassMusic: "\u97F3\u7BB1\u64AD\u653E",
    toolRagflow: "\u77E5\u8BC6\u5E93",
    toolChangeRole: "\u5207\u6362\u89D2\u8272",
    toolCallDevice: "\u547C\u53EB\u8BBE\u5907",
    toolPlayMusic: "\u64AD\u653E\u97F3\u4E50",
    toolNews: "\u65B0\u95FB\u64AD\u62A5",
    cancel: "\u53D6\u6D88",
    overview: "\u6982\u89C8",
    devicesTotal: "\u8BBE\u5907\u603B\u6570",
    devicesOnline: "\u5728\u7EBF\u8BBE\u5907",
    voiceState: "\u8BED\u97F3\u7BA1\u9053",
    voiceOn: "\u5DF2\u542F\u7528",
    voiceOff: "\u672A\u542F\u7528",
    gatewayState: "\u8BBE\u5907\u7F51\u5173",
    gatewayOn: "{n} \u6761\u547D\u4EE4",
    gatewayOff: "\u672A\u542F\u7528",
    endpointsTitle: "\u670D\u52A1\u7AEF\u70B9",
    otaUrl: "OTA \u5730\u5740",
    wsUrl: "WebSocket \u5730\u5740",
    gatewayUrl: "\u7F51\u5173\u5730\u5740",
    addressPick: "\u7F51\u5361",
    virtualNic: "\u865A\u62DF\u7F51\u5361",
    copy: "\u590D\u5236",
    copied: "\u5DF2\u590D\u5236",
    probe: "OTA \u8FDE\u901A\u6027\u6D4B\u8BD5",
    probing: "\u63A2\u6D4B\u4E2D\u2026",
    probeOk: "OTA \u5E94\u7B54\u6B63\u5E38",
    probeFail: "OTA \u63A2\u6D4B\u672A\u901A\u8FC7",
    lastEvents: "\u6700\u8FD1\u4E8B\u4EF6",
    noEvents: "\u6682\u65E0\u4E8B\u4EF6",
    devicesTitle: "\u667A\u80FD\u4F53",
    empty: "\u8FD8\u6CA1\u6709\u667A\u80FD\u4F53\u3002\u624B\u8868\u5728\u914D\u7F51\u9875\u9762\u586B\u597D OTA \u5730\u5740\u540E\uFF0C\u4E0A\u7535\u5C31\u4F1A\u81EA\u52A8\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
    agentsNew: "\u65B0\u5EFA\u667A\u80FD\u4F53",
    agentDevices: "\u8BBE\u5907",
    agentDeviceCount: "{n} \u53F0\u8BBE\u5907",
    agentNoDevices: "\u8FD8\u6CA1\u6709\u7ED1\u5B9A\u8BBE\u5907",
    pendingTitle: "\u5F85\u5BA1\u6838\u8BBE\u5907",
    pendingHint: "\u65B0\u8BBE\u5907\u8FDE\u63A5\u540E\u5148\u505C\u5728\u8FD9\u91CC\uFF1B\u6279\u51C6\u540E\u4F1A\u521B\u5EFA/\u7ED1\u5B9A\u667A\u80FD\u4F53\u5E76\u5141\u8BB8\u8FDE\u63A5\u3002",
    pendingFirstSeen: "\u9996\u6B21\u8BF7\u6C42",
    pendingAttempts: "\u8BF7\u6C42\u6B21\u6570",
    pendingAgent: "\u5206\u914D\u7ED9\u667A\u80FD\u4F53",
    pendingAutoAgent: "\u81EA\u52A8\u521B\u5EFA\u667A\u80FD\u4F53",
    pendingApprove: "\u6279\u51C6",
    pendingReject: "\u62D2\u7EDD",
    pendingApproved: "\u8BBE\u5907\u5DF2\u6279\u51C6",
    pendingRejected: "\u5DF2\u62D2\u7EDD\u8BE5\u8BBE\u5907",
    agentDeleteConfirm: "\u518D\u6B21\u70B9\u51FB\u5220\u9664",
    agentDeleteHint: "\u5220\u9664\u667A\u80FD\u4F53\u4F1A\u540C\u65F6\u5220\u9664\u5B83\u7ED1\u5B9A\u7684\u8BBE\u5907\u4E0E\u5386\u53F2",
    agentBindTitle: "\u7BA1\u7406\u8BBE\u5907",
    agentBindHint: "\u4E00\u53F0\u667A\u80FD\u4F53\u53EF\u4EE5\u7ED1\u5B9A\u591A\u53F0\u8BBE\u5907\uFF08\u4E0D\u540C\u533A\u57DF\u7684\u9EA6\u514B\u98CE/\u626C\u58F0\u5668\uFF09\uFF1B\u4E00\u53F0\u8BBE\u5907\u540C\u4E00\u65F6\u523B\u53EA\u5C5E\u4E8E\u4E00\u4E2A\u667A\u80FD\u4F53\uFF0C\u4ECE\u522B\u7684\u667A\u80FD\u4F53\u79FB\u5165\u4F1A\u6539\u53D8\u5F52\u5C5E\u3002",
    agentOtherTitle: "\u5176\u4ED6\u8BBE\u5907\uFF08\u53EF\u79FB\u5165\u672C\u667A\u80FD\u4F53\uFF09",
    agentCurrentOwner: "\u5F53\u524D\uFF1A",
    agentMoveHere: "\u79FB\u5165\u672C\u667A\u80FD\u4F53",
    agentUnbound: "\u672A\u7ED1\u5B9A",
    agentBoundTitle: "\u5DF2\u7ED1\u5B9A\u5230\u672C\u667A\u80FD\u4F53",
    agentNoUnbound: "\u6CA1\u6709\u5176\u4ED6\u8BBE\u5907",
    agentUnbind: "\u89E3\u7ED1",
    agentRemoveDevice: "\u5220\u9664\u8BBE\u5907",
    agentOffline: "\u8FD9\u4E2A\u667A\u80FD\u4F53\u6CA1\u6709\u5728\u7EBF\u8BBE\u5907",
    agentNamePlaceholder: "\u667A\u80FD\u4F53\u540D\u79F0",
    agentDefaultName: "\u667A\u80FD\u4F53 {n}",
    agentNameDuplicate: "\u667A\u80FD\u4F53\u540D\u79F0\u5DF2\u5B58\u5728\uFF0C\u8BF7\u6362\u4E00\u4E2A",
    loading: "\u52A0\u8F7D\u4E2D\u2026",
    name: "\u540D\u79F0",
    mac: "\u8BBE\u5907 ID",
    status: "\u72B6\u6001",
    lastSeen: "\u6700\u8FD1\u5728\u7EBF",
    actions: "\u64CD\u4F5C",
    online: "\u5728\u7EBF",
    offline: "\u79BB\u7EBF",
    blocked: "\u5DF2\u5C01\u7981",
    rename: "\u6539\u540D",
    block: "\u5C01\u7981",
    unblock: "\u89E3\u5C01",
    disconnect: "\u65AD\u5F00",
    remove: "\u5220\u9664",
    inject: "\u64AD\u62A5",
    injectTitle: "\u5411\u8BBE\u5907\u4E0B\u53D1\u64AD\u62A5",
    injectText: "\u64AD\u62A5\u5185\u5BB9",
    send: "\u53D1\u9001",
    sending: "\u53D1\u9001\u4E2D\u2026",
    injectOk: "\u5DF2\u4E0B\u53D1",
    never: "\u4ECE\u672A",
    justNow: "\u521A\u521A",
    minutesAgo: "{n} \u5206\u949F\u524D",
    hoursAgo: "{n} \u5C0F\u65F6\u524D",
    daysAgo: "{n} \u5929\u524D",
    persona: "\u4EBA\u8BBE",
    llmProvider: "LLM",
    model: "\u6A21\u578B",
    agentModelLabel: "\u5BF9\u8BDD\u6A21\u578B\uFF08LLM\uFF09",
    agentModelDefault: "\u9ED8\u8BA4\uFF08\u7528\u5168\u5C40\u6A21\u578B\uFF09",
    agentModelPlaceholder: "\u7559\u7A7A = \u7528\u5168\u5C40\u9ED8\u8BA4",
    agentModelHint: "\u53EA\u8986\u76D6\u6A21\u578B\u540D\uFF1B\u5382\u5546 / Key / \u7AEF\u70B9\u4ECD\u7528\u5168\u5C40\u8BBE\u7F6E",
    agentModelManual: "\u672A\u62C9\u5230\u6A21\u578B\u6E05\u5355\uFF0C\u53EF\u76F4\u63A5\u624B\u586B\u6A21\u578B\u540D",
    deviceConfigHint: "\u4FDD\u5B58\u540E\u5728\u8BE5\u667A\u80FD\u4F53\u7684\u8BBE\u5907\u4E0B\u6B21\u8FDE\u63A5\u751F\u6548",
    modelFromApi: "\u4ECE\u5382\u5546\u63A5\u53E3\u62C9\u53D6\uFF08\u5148\u586B Key\uFF09",
    volcAccessKey: "AccessKey ID\uFF08\u62C9\u97F3\u8272\u7528\uFF09",
    volcSecretKey: "SecretAccessKey\uFF08\u62C9\u97F3\u8272\u7528\uFF09",
    volcAkSkNote: "\u53EF\u9009\uFF1A\u53EA\u7528\u4E8E\u62C9\u53D6\u706B\u5C71\u5B98\u65B9\u97F3\u8272\u5217\u8868\uFF0C\u5408\u6210\u4ECD\u7528\u4E0A\u9762\u7684 API Key",
    voiceCatalogApi: "\u97F3\u8272\u6765\u81EA\u706B\u5C71\u5B98\u65B9\u63A5\u53E3\uFF08\u6309\u5F53\u524D\u8D44\u6E90\u65CF\uFF09",
    voiceCatalogFallback: "\u672A\u914D\u7F6E\u706B\u5C71 AccessKey/SecretKey\uFF0C\u5F53\u524D\u4E3A\u5185\u7F6E\u6E05\u5355\uFF0C\u53EF\u80FD\u542B\u672A\u5F00\u901A\u97F3\u8272",
    voice: "\u97F3\u8272",
    voiceDefault: "\u9ED8\u8BA4\u97F3\u8272",
    outputLanguage: "\u8F93\u51FA\u8BED\u79CD",
    languageFollow: "\u8DDF\u968F\u97F3\u8272",
    asrProvider: "ASR",
    asrUrl: "ASR \u5730\u5740",
    silence: "\u9759\u97F3\u6536\u53E3 (ms)",
    inheritHint: "\u7559\u7A7A = \u6CBF\u7528\u63D2\u4EF6\u914D\u7F6E",
    save: "\u4FDD\u5B58",
    // 三个服务商区块的标题复用 step3/4/5（step1/2/6 随旧步骤 UI 一起删除）。
    step3: "ASR \u8BC6\u522B",
    step4: "LLM \u6A21\u578B",
    step5: "TTS \u5408\u6210",
    lanWsUrl: "\u5C40\u57DF\u7F51 WebSocket \u5730\u5740",
    wanWsUrl: "\u516C\u7F51 WebSocket \u5730\u5740",
    otaToken: "WS token",
    firmwareVersion: "\u56FA\u4EF6\u7248\u672C",
    firmwareUrl: "\u56FA\u4EF6\u5730\u5740",
    forceUpdate: "\u5F3A\u5236\u5347\u7EA7",
    tokenKeep: "\u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539",
    provider: "\u63D0\u4F9B\u5546",
    selectPlaceholder: "\u672A\u9009\u62E9",
    appId: "APPID",
    apiSecret: "APISecret",
    asrLanguage: "\u8BC6\u522B\u8BED\u79CD",
    baseUrl: "Base URL",
    apiKey: "API Key",
    requiredHint: "\u5E26 * \u4E3A\u5FC5\u586B\uFF1B\u5176\u4F59\u53EF\u7559\u7A7A\uFF0C\u4F7F\u7528\u5382\u5546\u9ED8\u8BA4\u503C",
    requiredFields: "\u8BF7\u586B\u5199\u5FC5\u586B\u9879",
    volcTtsKeyNote: "\u706B\u5C71\u65B0\u7248\u63A7\u5236\u53F0 API Key\uFF08X-Api-Key\uFF09\uFF1B\u5408\u6210\u53EA\u9700\u5B83 + \u667A\u80FD\u4F53\u97F3\u8272",
    volcAsrKeyNote: "\u706B\u5C71\u65B0\u7248\u63A7\u5236\u53F0 API Key\uFF08X-Api-Key\uFF09",
    volcAsrResourceNote: "\u7559\u7A7A = volc.seedasr.sauc.duration\uFF082.0 \u5C0F\u65F6\u7248\uFF09",
    asrUrlNote: "\u7559\u7A7A = \u5B98\u65B9 bigmodel_async \u7AEF\u70B9",
    asrLanguageNote: "\u7559\u7A7A = zh_cn",
    xunfeiAuthNote: "\u8BAF\u98DE\u63A7\u5236\u53F0 \u2192 \u5E94\u7528\u4FE1\u606F\uFF1AAPPID / APIKey / APISecret",
    apiKeyKeep: "\u5DF2\u914D\u7F6E\uFF0C\u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539",
    gatewayToken: "\u7F51\u5173 Token",
    // 服务商配置（docs/backup-providers.md 第 5 节）：主用卡 + 备用卡 + 统一编辑弹窗。
    backupAdd: "\u6DFB\u52A0\u5907\u7528\u670D\u52A1\u5546",
    backupAddTitle: "\u6DFB\u52A0\u5907\u7528\u670D\u52A1\u5546",
    backupEditTitle: "\u7F16\u8F91\u5907\u7528\u670D\u52A1\u5546",
    backupSeq: "\u5907\u7528 {n}",
    backupSecret: "\u5BC6\u94A5",
    backupEdit: "\u7F16\u8F91",
    backupMoveUp: "\u4E0A\u79FB",
    backupMoveDown: "\u4E0B\u79FB",
    backupTest: "\u6D4B\u8BD5",
    backupTestAsr: "\u6D4B\u8BD5\u8BC6\u522B",
    backupTesting: "\u6D4B\u8BD5\u4E2D\u2026",
    asrNoText: "\u672A\u8BC6\u522B\u51FA\u6587\u5B57",
    backupSaveFirst: "\u8BF7\u5148\u4FDD\u5B58\u914D\u7F6E",
    backupDeleteConfirm: "\u518D\u6B21\u70B9\u51FB\u5220\u9664",
    backupTestOk: "\u6D4B\u8BD5\u901A\u8FC7",
    backupTestFail: "\u6D4B\u8BD5\u5931\u8D25",
    backupKeySet: "\u5DF2\u914D\u7F6E",
    backupKeyNone: "\u672A\u914D\u7F6E",
    backupKeyFree: "\u65E0\u9700\u5BC6\u94A5",
    backupKeyPending: "\u5F85\u4FDD\u5B58",
    backupKeyHint: "\u5BC6\u94A5\u4EE5\u63A9\u7801\u663E\u793A\uFF0C\u7559\u7A7A\u8868\u793A\u4E0D\u4FEE\u6539",
    backupDraft: "\u672A\u4FDD\u5B58",
    backupGroupLocal: "\u672C\u5730\u670D\u52A1",
    backupGroupCloud: "\u4E91\u7AEF\u670D\u52A1",
    providerSectionTitle: "\u670D\u52A1\u5546\u914D\u7F6E",
    providerPrimary: "\u4E3B\u7528",
    providerEditPrimary: "\u7F16\u8F91\u4E3B\u7528\u670D\u52A1\u5546",
    localAsrNote: "\u4F7F\u7528 Harness \u5185\u7F6E\u8BED\u97F3\u8BC6\u522B\u670D\u52A1\uFF0C\u65E0\u9700\u586B\u5199\u5730\u5740\u6216\u5BC6\u94A5\u3002",
    ttsEdgeKeyless: "\u514D\u5BC6\u94A5\uFF0C\u65E0\u9700\u914D\u7F6E",
    firstToken: "\u9996 token",
    bytes: "\u5B57\u8282",
    saved: "\u5DF2\u4FDD\u5B58",
    autoSaving: "\u4FDD\u5B58\u4E2D\u2026",
    autoSaved: "\u5DF2\u81EA\u52A8\u4FDD\u5B58",
    autoSavePending: "\u6709\u4FEE\u6539\uFF0C\u6B63\u5728\u81EA\u52A8\u4FDD\u5B58\u2026",
    autoSaveFailed: "\u81EA\u52A8\u4FDD\u5B58\u5931\u8D25",
    retry: "\u91CD\u8BD5",
    loadFailed: "\u52A0\u8F7D\u5931\u8D25",
    actionFailed: "\u64CD\u4F5C\u5931\u8D25\uFF1A",
    // 全局设置单页 IA（2026-11-07）：服务商为主体，语音默认参数/接入与网关次之；人设只在智能体级。
    configProvidersTitle: "\u670D\u52A1\u5546",
    configVoiceTitle: "\u8BED\u97F3\u9ED8\u8BA4\u53C2\u6570",
    configAccessTitle: "\u63A5\u5165\u4E0E\u7F51\u5173",
    configSaveHint: "\u4FEE\u6539\u4F1A\u81EA\u52A8\u4FDD\u5B58\uFF0C\u8BBE\u5907\u4E0B\u6B21\u8FDE\u63A5\u751F\u6548",
    configBackupCount: "\u5907\u7528 {n} \u4E2A",
    // 全局设置（2026-11-08）：三个环节概览卡 + 点进去管理；弹窗里的返回/保存并测试。
    back: "\u8FD4\u56DE",
    configStageAsrDesc: "\u8BED\u97F3\u8BC6\u522B\uFF1A\u628A\u8BBE\u5907\u4E0A\u4F20\u7684\u8BED\u97F3\u8F6C\u6210\u6587\u5B57",
    configStageLlmDesc: "\u5927\u6A21\u578B\uFF1A\u7406\u89E3\u5BF9\u8BDD\u5E76\u751F\u6210\u56DE\u590D",
    configStageTtsDesc: "\u8BED\u97F3\u5408\u6210\uFF1A\u628A\u56DE\u590D\u6587\u672C\u8F6C\u6210\u8BED\u97F3",
    stageManage: "\u7BA1\u7406",
    stageHealthOk: "\u5DF2\u5C31\u7EEA",
    stageHealthWarn: "\u5BC6\u94A5\u672A\u914D\u7F6E",
    stageHealthDirty: "\u6709\u672A\u4FDD\u5B58\u4FEE\u6539",
    backupEmpty: "\u6CA1\u6709\u5907\u7528\u670D\u52A1\u5546\uFF1B\u4E3B\u7528\u4E0D\u53EF\u7528\u65F6\u4E0D\u4F1A\u81EA\u52A8\u5207\u6362",
    backupActions: "\u66F4\u591A\u64CD\u4F5C",
    backupChain: "\u964D\u7EA7\u94FE",
    saveAndTest: "\u4FDD\u5B58\u5E76\u6D4B\u8BD5",
    providerUnsupported: "\u8FD9\u4E2A\u670D\u52A1\u5546\u8FD8\u4E0D\u652F\u6301\u5F53\u524D\u73AF\u8282",
    probeUnsupported: "\u8FD9\u4E2A\u73AF\u8282\u4E0D\u652F\u6301\u5728\u7EBF\u6D4B\u8BD5",
    ttsVoicePerDevice: "\u97F3\u8272\u5728\u300C\u667A\u80FD\u4F53 \u2192 \u914D\u7F6E\u300D\u91CC\u6309\u667A\u80FD\u4F53\u9009\u62E9",
    // 历史对话弹窗（设备卡片「历史」）：左会话列表 + 右消息气泡。
    history: "\u5386\u53F2",
    historyTitleSuffix: " \xB7 \u5386\u53F2\u5BF9\u8BDD",
    historyEmpty: "\u8FD8\u6CA1\u6709\u5BF9\u8BDD\u8BB0\u5F55",
    historyLoading: "\u52A0\u8F7D\u4E2D\u2026",
    historyRefresh: "\u5237\u65B0",
    historyClear: "\u6E05\u7A7A\u5386\u53F2",
    historyClearConfirm: "\u6E05\u7A7A\u8FD9\u4E2A\u667A\u80FD\u4F53\u6240\u6709\u8BBE\u5907\u7684\u5168\u90E8\u5386\u53F2\u5BF9\u8BDD\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002",
    historyClearFailed: "\u6E05\u7A7A\u5931\u8D25\uFF1A",
    historyAudioRetention: "\u97F3\u9891\u6570\u636E\u4EC5\u4FDD\u7559 30 \u5929",
    historyPickConversation: "\u9009\u62E9\u5DE6\u4FA7\u7684\u4F1A\u8BDD\u67E5\u770B\u6D88\u606F",
    historyPlay: "\u64AD\u653E",
    historyPause: "\u6682\u505C",
    historyDownload: "\u4E0B\u8F7D\u97F3\u9891",
    historyAudioFailed: "\u97F3\u9891\u64AD\u653E\u5931\u8D25",
    historyUntitled: "\u672A\u547D\u540D\u4F1A\u8BDD",
    aiGenerated: "\u4EE5\u4E0A\u5185\u5BB9\u7531 AI \u751F\u6210",
    messageCount: "{n} \u6761"
  };

  // src/client/i18n/en.js
  var en = {
    brand: "Xiaozhi Console",
    navOverview: "Overview",
    navDevices: "Agents",
    navCapabilities: "Capabilities",
    capabilitiesTitle: "Capabilities",
    navGlobal: "Global",
    unnamed: "Unnamed",
    configure: "Configure",
    close: "Close",
    memory: "Memory",
    memoryPlaceholder: "Something to remember, e.g. prefers iced americano",
    add: "Add",
    otaUpgrade: "OTA updates",
    tabRole: "Persona",
    tabModel: "Model & memory",
    tabExt: "Capabilities",
    voiceSettings: "Voice",
    recognizeSpeed: "Recognition",
    replySpeed: "Reply speed",
    fast: "Fast",
    slow: "Slow",
    standard: "Normal",
    personaPlaceholder: "Describe how this persona talks and behaves\u2026",
    replyMaxTokens: "Reply length limit (tokens)",
    replyMaxTokensHint: "Empty = 120 (about 60 chars)",
    memoryHint: "Conversations from this agent\u2019s devices are remembered and injected after the persona.",
    officialServices: "Built-in services",
    capSearch: "Web search",
    capTime: "Date & time",
    capabilityHint: "Enabled capabilities are called by the model on demand. Items marked \u201Cnot wired\u201D have no data source yet.",
    capabilityEmpty: "No tools registered yet",
    capTool: "tool",
    capSystem: "system",
    toolGetCurrentTime: "Date & time",
    toolWebSearch: "Web search",
    toolWebFetch: "Web fetch",
    toolNewsnow: "Trending news",
    toolWeather: "Weather",
    toolLunar: "Lunar calendar",
    toolExit: "End conversation",
    toolHassGet: "Device state",
    toolHassSet: "Control device",
    toolHassMusic: "Play on speaker",
    toolRagflow: "Knowledge base",
    toolChangeRole: "Change role",
    toolCallDevice: "Call device",
    toolPlayMusic: "Play music",
    toolNews: "News",
    cancel: "Cancel",
    overview: "Overview",
    devicesTotal: "Devices",
    devicesOnline: "Online",
    voiceState: "Voice pipeline",
    voiceOn: "enabled",
    voiceOff: "disabled",
    gatewayState: "Device gateway",
    gatewayOn: "{n} commands",
    gatewayOff: "off",
    endpointsTitle: "Service endpoints",
    otaUrl: "OTA URL",
    wsUrl: "WebSocket URL",
    gatewayUrl: "Gateway URL",
    addressPick: "Interface",
    virtualNic: "virtual",
    copy: "Copy",
    copied: "Copied",
    probe: "Test OTA",
    probing: "Probing\u2026",
    probeOk: "OTA answered",
    probeFail: "OTA probe failed",
    lastEvents: "Recent events",
    noEvents: "No events yet",
    devicesTitle: "Agents",
    empty: "No agents yet. Fill in the OTA URL in the watch portal; it appears here on boot.",
    agentsNew: "New agent",
    agentDevices: "Devices",
    agentDeviceCount: "{n} devices",
    agentNoDevices: "No devices bound",
    pendingTitle: "Pending devices",
    pendingHint: "New devices wait here. Approve one to create/bind an agent and allow it to connect.",
    pendingFirstSeen: "First seen",
    pendingAttempts: "Attempts",
    pendingAgent: "Assign to agent",
    pendingAutoAgent: "Create a new agent",
    pendingApprove: "Approve",
    pendingReject: "Reject",
    pendingApproved: "Device approved",
    pendingRejected: "Device rejected",
    agentDeleteConfirm: "Click again to delete",
    agentDeleteHint: "Deleting an agent also deletes its bound devices and history",
    agentBindTitle: "Manage devices",
    agentBindHint: "One agent can bind several devices (mics/speakers in different areas). A device belongs to exactly one agent at a time; moving it here changes ownership.",
    agentOtherTitle: "Other devices (can move here)",
    agentCurrentOwner: "Owner:",
    agentMoveHere: "Move here",
    agentUnbound: "Unbound",
    agentBoundTitle: "Bound to this agent",
    agentNoUnbound: "No other devices",
    agentUnbind: "Unbind",
    agentRemoveDevice: "Delete device",
    agentOffline: "No device of this agent is online",
    agentNamePlaceholder: "Agent name",
    agentDefaultName: "Agent {n}",
    agentNameDuplicate: "That agent name is already in use",
    loading: "Loading\u2026",
    name: "Name",
    mac: "Device ID",
    status: "Status",
    lastSeen: "Last seen",
    actions: "Actions",
    online: "Online",
    offline: "Offline",
    blocked: "Blocked",
    rename: "Rename",
    block: "Block",
    unblock: "Unblock",
    disconnect: "Disconnect",
    remove: "Remove",
    inject: "Speak",
    injectTitle: "Speak on a device",
    injectText: "Message",
    send: "Send",
    sending: "Sending\u2026",
    injectOk: "Delivered",
    never: "never",
    justNow: "just now",
    minutesAgo: "{n} min ago",
    hoursAgo: "{n} h ago",
    daysAgo: "{n} d ago",
    persona: "Persona",
    llmProvider: "LLM",
    model: "Model",
    agentModelLabel: "Chat model (LLM)",
    agentModelDefault: "Default (global model)",
    agentModelPlaceholder: "Empty = global default",
    agentModelHint: "Only overrides the model name; provider / key / endpoint stay global",
    agentModelManual: "No model list available; type the model id",
    deviceConfigHint: "Applies when this agent\u2019s devices next connect",
    modelFromApi: "Fetched from the vendor API (set the key first)",
    volcAccessKey: "AccessKey ID (voice list)",
    volcSecretKey: "SecretAccessKey (voice list)",
    volcAkSkNote: "Optional: only used to fetch the official voice list; synthesis still uses the API Key above",
    voiceCatalogApi: "Voices come from the official Volcengine API (current resource tier)",
    voiceCatalogFallback: "Volcengine AccessKey/SecretKey not set; showing the built-in catalog, which may include unprovisioned voices",
    voice: "Voice",
    voiceDefault: "Default voice",
    outputLanguage: "Output language",
    languageFollow: "Follow the voice",
    asrProvider: "ASR",
    asrUrl: "ASR URL",
    silence: "Silence cutoff (ms)",
    inheritHint: "empty = keep the plugin config",
    save: "Save",
    // Provider stage titles reuse step3/4/5 (step1/2/6 went away with the old step UI).
    step3: "ASR",
    step4: "LLM",
    step5: "TTS",
    lanWsUrl: "LAN WebSocket URL",
    wanWsUrl: "WAN WebSocket URL",
    otaToken: "WS token",
    firmwareVersion: "Firmware version",
    firmwareUrl: "Firmware URL",
    forceUpdate: "Force update",
    tokenKeep: "blank keeps current",
    provider: "Provider",
    selectPlaceholder: "Not set",
    appId: "APPID",
    apiSecret: "APISecret",
    asrLanguage: "Language",
    baseUrl: "Base URL",
    apiKey: "API Key",
    requiredHint: "Fields marked * are required; leave the rest empty to use vendor defaults",
    requiredFields: "Please fill in the required fields",
    volcTtsKeyNote: "Volcengine new-console API Key (X-Api-Key); synthesis only needs this plus the agent voice",
    volcAsrKeyNote: "Volcengine new-console API Key (X-Api-Key)",
    volcAsrResourceNote: "Empty = volc.seedasr.sauc.duration (2.0 hourly)",
    asrUrlNote: "Empty = the official bigmodel_async endpoint",
    asrLanguageNote: "Empty = zh_cn",
    xunfeiAuthNote: "iFlytek console \u2192 App info: APPID / APIKey / APISecret",
    apiKeyKeep: "configured \u2014 blank keeps it",
    gatewayToken: "Gateway token",
    // Provider configuration (docs/backup-providers.md §5): primary card + backup cards + one shared dialog.
    backupAdd: "Add backup provider",
    backupAddTitle: "Add backup provider",
    backupEditTitle: "Edit backup provider",
    backupSeq: "Backup {n}",
    backupSecret: "Secret",
    backupEdit: "Edit",
    backupMoveUp: "Move up",
    backupMoveDown: "Move down",
    backupTest: "Test",
    backupTestAsr: "Test ASR",
    backupTesting: "Testing\u2026",
    asrNoText: "No text recognised",
    backupSaveFirst: "Save the configuration first",
    backupDeleteConfirm: "Click again to delete",
    backupTestOk: "Test passed",
    backupTestFail: "Test failed",
    backupKeySet: "Configured",
    backupKeyNone: "Not configured",
    backupKeyFree: "No key required",
    backupKeyPending: "Unsaved",
    backupKeyHint: "Secrets are masked; leave blank to keep the stored value",
    backupDraft: "Unsaved",
    backupGroupLocal: "Local service",
    backupGroupCloud: "Cloud service",
    providerSectionTitle: "Provider configuration",
    providerPrimary: "Primary",
    providerEditPrimary: "Edit primary provider",
    localAsrNote: "Uses the built-in speech recognition service; no URL or key required.",
    ttsEdgeKeyless: "No key required",
    firstToken: "first token",
    bytes: "bytes",
    saved: "Saved",
    autoSaving: "Saving\u2026",
    autoSaved: "Saved automatically",
    autoSavePending: "Saving changes\u2026",
    autoSaveFailed: "Auto-save failed",
    retry: "Retry",
    loadFailed: "Load failed",
    actionFailed: "Action failed: ",
    // Global settings single-page IA (2026-11-07): providers first; voice defaults and access below; persona is device-level only.
    configProvidersTitle: "Providers",
    configVoiceTitle: "Voice defaults",
    configAccessTitle: "Access & gateway",
    configSaveHint: "Changes save automatically and apply on the device\u2019s next connection",
    configBackupCount: "{n} backups",
    // Global settings (2026-11-08): three stage overview cards, manage in a modal.
    back: "Back",
    configStageAsrDesc: "Speech recognition: turn device audio into text",
    configStageLlmDesc: "LLM: understand the conversation and write replies",
    configStageTtsDesc: "Speech synthesis: turn replies into audio",
    stageManage: "Manage",
    stageHealthOk: "Ready",
    stageHealthWarn: "API key missing",
    stageHealthDirty: "Unsaved changes",
    backupEmpty: "No backup provider; nothing switches over if the primary fails",
    backupActions: "More actions",
    backupChain: "Failover chain",
    saveAndTest: "Save and test",
    providerUnsupported: "This provider does not support this stage yet",
    probeUnsupported: "Online test is not supported for this stage",
    ttsVoicePerDevice: "Voice is chosen per device in \u201CDevices \u2192 Configure\u201D.",
    // Conversation history dialog (device card "History"): session list + message bubbles.
    history: "History",
    historyTitleSuffix: " \xB7 History",
    historyEmpty: "No conversations yet",
    historyLoading: "Loading\u2026",
    historyRefresh: "Refresh",
    historyClear: "Clear history",
    historyClearConfirm: "Clear all conversation history for this agent\u2019s devices? This cannot be undone.",
    historyClearFailed: "Clear failed: ",
    historyAudioRetention: "Audio data is retained for 30 days",
    historyPickConversation: "Select a conversation to view messages",
    historyPlay: "Play",
    historyPause: "Pause",
    historyDownload: "Download audio",
    historyAudioFailed: "Audio playback failed",
    historyUntitled: "Untitled conversation",
    aiGenerated: "AI-generated content",
    messageCount: "{n} messages"
  };

  // src/client/styles.js
  var CSS = `
.xz-app{scrollbar-gutter:stable;--xz-bg:#f5f7fa;--xz-bg-soft:#fbfcfe;--xz-surface:rgba(255,255,255,.82);--xz-surface-strong:#fff;--xz-surface-muted:#f8fafc;--xz-primary:#007aff;--xz-primary-pressed:#0062cc;--xz-primary-soft:rgba(0,122,255,.1);--xz-success:#34c759;--xz-warning:#ff9f0a;--xz-danger:#ff3b30;--xz-text:#1d1d1f;--xz-text-2:#6e6e73;--xz-text-3:#8e8e93;--xz-line:#e5e5ea;--xz-radius-xl:28px;--xz-radius-lg:22px;--xz-radius-md:18px;--xz-radius-sm:14px;--xz-shadow-sm:0 10px 28px rgba(15,23,42,.05);--xz-shadow-md:0 16px 36px rgba(15,23,42,.07);--xz-shadow-lg:0 24px 56px rgba(15,23,42,.1);--xz-font:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Segoe UI",sans-serif;height:100vh;max-height:100vh;overflow:hidden;display:flex;background:linear-gradient(180deg,#f7f9fc 0%,#f2f5f9 100%);color:var(--xz-text);font-family:var(--xz-font);box-sizing:border-box}
.xz-side{width:264px;flex:none;overflow-y:auto;margin:18px 0 18px 18px;padding:20px 16px;border-radius:var(--xz-radius-xl);background:var(--xz-surface);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.88);box-shadow:var(--xz-shadow-md);display:flex;flex-direction:column;gap:18px;box-sizing:border-box}
.xz-brand{display:flex;align-items:center;gap:10px;padding:0 6px}
.xz-brand-mark{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#0a84ff,#5ac8fa);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 18px rgba(10,132,255,.35)}
.xz-brand-title{font-size:15px;font-weight:650;letter-spacing:.2px}
.xz-brand-sub{font-size:11px;color:var(--xz-text-3);margin-top:2px}
.xz-nav{display:flex;flex-direction:column;gap:4px}
.xz-nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--xz-radius-sm);border:none;background:transparent;color:var(--xz-text-2);font-size:13px;font-family:inherit;cursor:pointer;text-align:left;transition:background .18s ease,color .18s ease,transform .18s ease}
.xz-nav-item:hover{background:rgba(0,0,0,.035);color:var(--xz-text)}
.xz-nav-item.active{background:var(--xz-surface-strong);color:var(--xz-primary);box-shadow:var(--xz-shadow-sm);font-weight:600}
.xz-nav-item.locked{opacity:.55;cursor:not-allowed}
.xz-nav-group{width:100%}
.xz-nav-group .xz-caret{margin-left:auto;transition:transform .18s ease;font-size:11px;color:var(--xz-text-3, #9a9a9a)}
.xz-nav-group .xz-caret.open{transform:rotate(0deg)}
.xz-nav-group .xz-caret:not(.open){transform:rotate(-90deg)}
.xz-nav-sub{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 14px;padding-left:10px;border-left:1px solid rgba(0,0,0,.07)}
.xz-nav-child{font-size:12.5px;padding:8px 10px}

.xz-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:18px 22px 0}
.xz-header{display:flex;align-items:flex-end;gap:14px;margin-bottom:16px}
.xz-h1{font-size:22px;font-weight:680;letter-spacing:-.2px;margin:0}
.xz-sub{font-size:12px;color:var(--xz-text-2);margin:4px 0 0}
.xz-spacer{flex:1}
.xz-content{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;padding-bottom:26px}
.xz-card{background:var(--xz-surface);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.88);border-radius:var(--xz-radius-lg);box-shadow:var(--xz-shadow-sm);padding:18px 20px;margin-bottom:14px}
/* \u5F85\u5BA1\u6838\u5361\u7247\u91CC\u6709 PillSelect\uFF1Abackdrop-filter \u4F1A\u5EFA\u7ACB fixed \u5305\u542B\u5757\u5E76\u628A\u83DC\u5355\u88C1\u5728\u5361\u7247\u5E95\u8FB9\uFF0C
   \u6240\u4EE5\u8FD9\u5F20\u5361\u7247\u4E0D\u7528\u6BDB\u73BB\u7483\uFF0C\u83DC\u5355\u6309\u89C6\u53E3\u5B9A\u4F4D\uFF0C\u624D\u80FD\u5B8C\u6574\u5217\u51FA\u6240\u6709\u667A\u80FD\u4F53\u3002 */
.xz-pending-card{backdrop-filter:none;background:var(--xz-surface-strong)}
.xz-card h3{margin:0 0 4px;font-size:14px;font-weight:650}
.xz-card p.xz-hint{margin:0 0 14px;font-size:12px;color:var(--xz-text-2);line-height:1.5}
.xz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.xz-metric{padding:16px 18px;border-radius:var(--xz-radius-md);background:var(--xz-surface-strong);box-shadow:var(--xz-shadow-sm);border:1px solid rgba(0,0,0,.03)}
.xz-metric .k{font-size:12px;color:var(--xz-text-2)}
.xz-metric .v{font-size:26px;font-weight:700;letter-spacing:-.5px;margin-top:6px}
.xz-metric .v small{font-size:12px;font-weight:500;color:var(--xz-text-3);margin-left:4px}
.xz-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 9px;border-radius:999px;background:rgba(52,199,89,.12);color:#1f9d45;font-weight:600}
.xz-chip.warn{background:rgba(255,159,10,.14);color:#b26a00}
.xz-chip.bad{background:rgba(255,59,48,.12);color:#c9271f}
.xz-chip.mute{background:rgba(142,142,147,.14);color:var(--xz-text-2)}
.xz-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.xz-endpoint{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--xz-radius-sm);background:var(--xz-surface-muted);border:1px solid var(--xz-line);margin-bottom:8px}
.xz-endpoint .label{font-size:11px;color:var(--xz-text-3);width:96px;flex:none}
.xz-endpoint code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.xz-btn{appearance:none;border:1px solid rgba(0,0,0,.08);background:var(--xz-surface-strong);color:var(--xz-text);border-radius:12px;padding:7px 13px;font-size:12px;font-family:inherit;cursor:pointer;transition:transform .12s ease,box-shadow .18s ease,background .18s ease}
.xz-btn:hover:not(:disabled){box-shadow:var(--xz-shadow-sm);transform:translateY(-1px)}
.xz-btn:disabled{opacity:.45;cursor:default}
.xz-btn.primary{background:var(--xz-primary);border-color:transparent;color:#fff;box-shadow:0 8px 20px rgba(0,122,255,.28)}
.xz-btn.primary:hover:not(:disabled){background:var(--xz-primary-pressed)}
.xz-btn.danger{color:var(--xz-danger)}
.xz-btn.ghost{background:transparent;border-color:transparent;color:var(--xz-primary)}
.xz-editor{border:1px solid var(--xz-line);border-radius:var(--xz-radius-md);padding:16px;margin-bottom:16px;background:var(--xz-surface)}
.xz-editor-head{display:flex;gap:12px;margin-bottom:12px}
.xz-tabs{display:flex;gap:6px;padding:4px;background:rgba(0,0,0,.04);border-radius:12px;margin-bottom:14px;width:fit-content}
.xz-tab{border:none;background:transparent;font-family:inherit;font-size:12.5px;color:var(--xz-text-2);padding:6px 14px;border-radius:9px;cursor:pointer;transition:background .16s ease,color .16s ease}
.xz-tab:hover{color:var(--xz-text)}
.xz-tab.active{background:var(--xz-surface-strong);color:var(--xz-text);font-weight:600;box-shadow:var(--xz-shadow-sm)}
.xz-pane{display:flex;flex-direction:column;gap:12px}
.xz-inset{background:rgba(0,0,0,.02);border:1px solid var(--xz-line);box-shadow:none;padding:14px;margin:0}
.xz-card-title{font-size:12px;font-weight:600;color:var(--xz-text-2);margin-bottom:10px}
.xz-slider{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.xz-slider-head{display:flex;justify-content:space-between;font-size:12px;color:var(--xz-text-2)}
.xz-slider-value{color:var(--xz-text-3);font-variant-numeric:tabular-nums}
.xz-slider input[type=range]{width:100%;height:4px;border-radius:999px;appearance:none;background:linear-gradient(90deg,#0a84ff,rgba(10,132,255,.25));outline:none}
.xz-slider input[type=range]::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #0a84ff;box-shadow:0 1px 4px rgba(0,0,0,.18);cursor:pointer}
.xz-slider-scale{display:flex;justify-content:space-between;font-size:10.5px;color:var(--xz-text-3)}
.xz-capability-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
.xz-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;align-items:start}
.xz-devcard{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--xz-line);border-radius:14px;background:var(--xz-surface-strong)}
.xz-devcard-head{display:flex;align-items:center;gap:10px}
.xz-devcard-mark{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:var(--xz-primary-soft);color:var(--xz-primary);flex:none}
.xz-devcard-title{display:flex;align-items:center;font-size:13.5px;flex:1;min-width:0}
.xz-devcard-state{font-size:11.5px;color:var(--xz-text-3)}
.xz-devcard-mac{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--xz-text-3)}
.xz-devcard-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--xz-line);border-bottom:1px solid var(--xz-line)}
.xz-devcard-label{display:block;font-size:10.5px;color:var(--xz-text-3);margin-bottom:4px}
.xz-devcard-value{font-size:12.5px}
.xz-memory-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.xz-memory-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid var(--xz-line);border-radius:9px;font-size:12px}
.xz-devcard-config{border-top:1px solid var(--xz-line);padding-top:10px}
.xz-devcard-config .xz-capability{padding:6px 8px;font-size:12px}
.xz-devcard-foot{display:flex;gap:6px;flex-wrap:wrap}
.xz-switch{position:relative;width:38px;height:22px;border-radius:999px;border:none;background:rgba(0,0,0,.16);cursor:pointer;padding:0;transition:background .18s ease}
.xz-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .18s ease}
.xz-switch.on{background:#0a84ff}
.xz-switch.on span{transform:translateX(16px)}
.xz-switch:disabled{opacity:.5;cursor:default}
.xz-details{padding:0 14px 12px}
.xz-details>summary{cursor:pointer;list-style:none;padding:12px 0;font-size:12.5px;font-weight:600;color:var(--xz-text-2)}
.xz-details>summary::-webkit-details-marker{display:none}
.xz-details>summary::after{content:'\u25BE';float:right;color:var(--xz-text-3);font-size:11px;transition:transform .18s ease}
.xz-details[open]>summary::after{transform:rotate(180deg)}
.xz-capability{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--xz-line);border-radius:10px;font-size:12.5px;background:var(--xz-surface-strong)}
.xz-capability-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.xz-capability-name{font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xz-capability .xz-switch{margin-left:auto;flex:none}
.xz-capability-desc{font-size:11px;color:var(--xz-text-3);line-height:1.35}
.xz-capability-dot{width:8px;height:8px;border-radius:50%;background:rgba(0,0,0,.18);flex:none}
.xz-capability.is-on .xz-capability-dot{background:#30d158}
.xz-capability-tag.on{color:#0a7f3f;border-color:rgba(48,209,88,.45);background:rgba(48,209,88,.10)}
.xz-capability.is-off{opacity:.62}
.xz-details{padding:0 14px 12px}
.xz-details>summary{cursor:pointer;list-style:none;padding:12px 0;font-size:12.5px;font-weight:600;color:var(--xz-text-2)}
.xz-details>summary::-webkit-details-marker{display:none}
.xz-details>summary::after{content:'\u25BE';float:right;color:var(--xz-text-3);font-size:11px;transition:transform .18s ease}
.xz-details[open]>summary::after{transform:rotate(180deg)}
.xz-capability{align-items:flex-start}
.xz-capability-tag{margin-left:auto;font-size:10px;color:var(--xz-text-3);border:1px solid var(--xz-line);border-radius:999px;padding:1px 6px}.xz-input,.xz-textarea{width:100%;box-sizing:border-box;background:var(--xz-surface-strong);border:1px solid var(--xz-line);border-radius:12px;padding:9px 12px;font-size:13px;font-family:inherit;color:var(--xz-text);outline:none;transition:border-color .16s ease,box-shadow .16s ease}
.xz-input:focus,.xz-textarea:focus{border-color:rgba(0,122,255,.55);box-shadow:0 0 0 4px var(--xz-primary-soft)}
.xz-textarea{resize:vertical;min-height:76px;line-height:1.5}
.xz-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.xz-field label{font-size:12px;color:var(--xz-text-2);font-weight:500}
.xz-field .note{font-size:11px;color:var(--xz-text-3)}
.xz-pillselect{position:relative;display:inline-flex;align-self:flex-start;min-width:0;max-width:100%}
.xz-pillselect-trigger{position:relative;display:inline-flex;align-items:center;gap:6px;height:26px;max-width:240px;min-width:0;padding:0 26px 0 11px;border:1px solid var(--xz-line);border-radius:999px;background:var(--xz-surface-strong);color:var(--xz-text);font:inherit;font-size:11.5px;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,border-color .12s ease}
.xz-pillselect-trigger:hover:not(:disabled){background:#f2f6fb;border-color:rgba(0,122,255,.28)}
.xz-pillselect-trigger[aria-expanded="true"]{background:var(--xz-primary-soft);border-color:rgba(0,122,255,.4);color:var(--xz-primary)}
.xz-pillselect-trigger:disabled{opacity:.5;cursor:default}
.xz-pillselect-chevron{position:absolute;right:9px;pointer-events:none;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--xz-text-3)}
.xz-field .xz-pillselect{width:100%;align-self:stretch;display:flex}
/* \u8868\u5355\u5B57\u6BB5\u91CC\u7684\u9009\u62E9\u5668\u4E5F\u662F\u80F6\u56CA\uFF1A\u4E4B\u524D\u8986\u5199\u6210 36px/12px \u7684\u65B9\u6846\uFF0C\u548C\u9875\u9762\u7EA7 999px \u80F6\u56CA\u4E0D\u4E00\u81F4\u3002 */
.xz-field .xz-pillselect-trigger{height:32px;max-width:none;width:100%;font-size:12.5px;padding:0 26px 0 11px;background:var(--xz-surface-strong);border-radius:999px}
.xz-field .xz-pillselect-chevron{right:12px;border-top-width:5px}

.xz-pill-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-pill-label.xz-pill-placeholder{color:var(--xz-text-3)}
.xz-required{color:var(--xz-danger);margin-left:2px}
/* \u60AC\u6D6E\u9762\u677F\u6539\u6210 position:fixed\uFF08left/top/width/maxHeight/z-index \u7531 PillSelect \u5185\u8054\u8BA1\u7B97\uFF09\u3002
   \u7EDD\u5BF9\u5B9A\u4F4D\u4F1A\u53C2\u4E0E\u9875\u9762\u53EF\u6EDA\u52A8\u9AD8\u5EA6\u7684\u8BA1\u7B97\uFF1A\u9875\u9762\u5E95\u90E8\u5C55\u5F00\u65F6\u51FA\u73B0\u6EDA\u52A8\u6761\u3001\u6574\u9875\u6A2A\u5411\u4F4D\u79FB\uFF0C
   \u8FD9\u6B63\u662F\u7528\u6237\u53CD\u9988\u7684\u300C\u70B9\u5F00\u4E0B\u62C9\u6846\u5176\u4ED6\u5185\u5BB9\u4E5F\u53D8\u4E86\u300D\u3002fixed \u4E0D\u5360\u5E03\u5C40\uFF0C\u83DC\u5355\u518D\u957F\u4E5F\u4E0D\u6539\u9875\u9762\u5C3A\u5BF8\u3002 */
.xz-menu{position:fixed;top:0;left:0;z-index:60;min-width:160px;max-height:340px;overflow:auto;padding:6px;border-radius:14px;border:1px solid var(--xz-line);background:var(--xz-surface-strong);box-shadow:var(--xz-shadow-md)}
.xz-menu-item{display:flex;align-items:center;gap:7px;width:100%;min-height:28px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;transition:background-color .1s ease}
.xz-menu-item:hover:not(:disabled),.xz-menu-item:focus-visible{background:rgba(0,0,0,.045);outline:none}
.xz-menu-item.active{background:var(--xz-primary-soft);font-weight:600;color:var(--xz-primary)}
.xz-menu-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-menu-hint{flex:0 0 auto;color:var(--xz-text-3);font-size:10px}
.xz-menu-check{flex:0 0 auto;color:var(--xz-primary)}
.xz-table{width:100%;border-collapse:separate;border-spacing:0 8px}
.xz-table th{text-align:left;font-size:11px;font-weight:600;color:var(--xz-text-3);padding:0 12px 4px}
.xz-table td{background:var(--xz-surface-strong);padding:12px;font-size:13px;border-top:1px solid rgba(0,0,0,.03);border-bottom:1px solid rgba(0,0,0,.03)}
.xz-table tr td:first-child{border-left:1px solid rgba(0,0,0,.03);border-radius:14px 0 0 14px}
.xz-table tr td:last-child{border-right:1px solid rgba(0,0,0,.03);border-radius:0 14px 14px 0}
.xz-dot{width:8px;height:8px;border-radius:50%;background:#c7c7cc;display:inline-block;margin-right:7px}
.xz-dot.on{background:var(--xz-success);box-shadow:0 0 0 4px rgba(52,199,89,.18);animation:xz-breathe 2.4s ease-in-out infinite}
@keyframes xz-breathe{0%,100%{box-shadow:0 0 0 3px rgba(52,199,89,.14)}50%{box-shadow:0 0 0 6px rgba(52,199,89,.06)}}
.xz-modal-mask{position:fixed;inset:0;background:rgba(15,23,42,.28);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:40}
.xz-devcard-name{cursor:pointer;border-bottom:1px dashed transparent}
.xz-devcard-name:hover{border-bottom-color:var(--xz-line)}

.xz-modal{width:min(520px,92vw);background:var(--xz-surface-strong);border-radius:var(--xz-radius-lg);box-shadow:var(--xz-shadow-lg);padding:22px;box-sizing:border-box}
.xz-modal h3{margin:0 0 6px;font-size:15px}
.xz-modal p{margin:0 0 14px;font-size:12px;color:var(--xz-text-2)}
.xz-toast{position:fixed;right:24px;bottom:24px;z-index:50;background:rgba(29,29,31,.92);color:#fff;padding:11px 16px;border-radius:14px;font-size:12px;box-shadow:var(--xz-shadow-md);max-width:360px}
.xz-toast.bad{background:rgba(201,39,31,.95)}
.xz-code{background:#0f172a;color:#e2e8f0;border-radius:var(--xz-radius-sm);padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.6;overflow:auto;max-height:280px;white-space:pre-wrap;word-break:break-all}
.xz-empty{padding:26px;text-align:center;color:var(--xz-text-2);font-size:13px;border:1px dashed var(--xz-line);border-radius:var(--xz-radius-md);background:var(--xz-surface-muted)}
.xz-auth{position:relative;height:100%;display:flex;align-items:center;justify-content:center;padding:32px;overflow:hidden;box-sizing:border-box;font-family:var(--xz-font);color:var(--xz-text);background:radial-gradient(1100px 680px at 18% -18%,#e6f0ff 0%,rgba(230,240,255,0) 62%),radial-gradient(880px 560px at 108% 6%,#f2e9ff 0%,rgba(242,233,255,0) 58%),linear-gradient(180deg,#f8fafd 0%,#eef3f9 100%)}
.xz-auth-card{position:relative;width:min(440px,100%);background:rgba(255,255,255,.9);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.92);border-radius:26px;box-shadow:0 30px 70px rgba(15,23,42,.13);padding:30px 30px 24px;box-sizing:border-box}
.xz-tabbar{display:none}
@media (max-width:900px){.xz-side{width:220px}.xz-brand-sub{display:none}}
@media (max-width:768px){
  .xz-app{flex-direction:column}
  .xz-side{width:auto;overflow:visible;margin:10px 10px 0;padding:12px 14px;flex-direction:row;align-items:center;gap:12px;border-radius:var(--xz-radius-lg)}
  .xz-brand{padding:0}
  .xz-brand-sub{display:none}
  .xz-nav{flex-direction:row;overflow:auto;gap:2px;flex:1}
  .xz-nav-item{padding:8px 10px;font-size:12px;white-space:nowrap}
  .xz-main{padding:10px 12px 76px}
  .xz-h1{font-size:19px}
  .xz-table{display:block;overflow-x:auto;white-space:nowrap}
  .xz-tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(255,255,255,.86);backdrop-filter:blur(20px);border-top:1px solid var(--xz-line);padding:8px 6px calc(8px + env(safe-area-inset-bottom))}
  .xz-tabbar button{flex:1;border:none;background:transparent;color:var(--xz-text-3);font-size:11px;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0;cursor:pointer}
  .xz-tabbar button.active{color:var(--xz-primary);font-weight:600}
  .xz-modal{width:94vw;padding:18px}
}
/* ---- PillSelect \u89C4\u8303\u8865\u5145\uFF08docs/pill-popover.md\uFF09\uFF1A\u5206\u7EC4\u6807\u9898 / \u7981\u7528\u884C / \u89E6\u53D1\u5668\u5FBD\u6807 ---- */
.xz-menu-group{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--xz-text-3);padding:6px 8px 3px}
.xz-menu-item:disabled,.xz-menu-item.is-disabled{opacity:.45;cursor:default}
.xz-menu-item:disabled:hover,.xz-menu-item.is-disabled:hover{background:transparent}
.xz-menu-badge{flex:0 0 auto;font-size:10px;color:var(--xz-text-3);font-variant-numeric:tabular-nums}
.xz-pillselect-badge{flex:0 0 auto;font-size:10px;font-weight:600;line-height:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--xz-primary-soft);color:var(--xz-primary)}

/* ---- \u5907\u7528\u670D\u52A1\u5546\u5361\u7247\uFF08\u5951\u7EA6 docs/backup-providers.md \u7B2C 5 \u8282\uFF09---- */
.xz-backup-section{margin-top:16px;padding-top:14px;border-top:1px solid var(--xz-line)}
.xz-backup-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;align-items:start}
.xz-backup-card{padding:12px;gap:8px;border-radius:14px}
.xz-backup-card.is-draft{border-style:dashed}
/* \u4E3B\u7528\u5361\uFF1A\u540C\u4E00\u5957\u5361\u7247\u8BED\u8A00\uFF0C\u7528\u6DE1\u84DD\u63CF\u8FB9 + \u300C\u4E3B\u7528\u300D\u5FBD\u6807\u533A\u5206\u7B2C\u4E00\u4F18\u5148\u7EA7 */
.xz-primary-card{border-color:rgba(0,122,255,.32);background:linear-gradient(180deg,rgba(0,122,255,.06),var(--xz-surface-strong) 55%)}
.xz-primary-card+.xz-backup-grid{margin-top:10px}
.xz-chip.primary{background:var(--xz-primary-soft);color:var(--xz-primary);font-weight:600}
.xz-devcard-ord{width:24px;height:24px;flex:none;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;background:var(--xz-primary-soft);color:var(--xz-primary)}
.xz-backup-facts{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--xz-text-2)}
.xz-backup-fact{display:flex;gap:8px;min-width:0}
.xz-backup-fact .k{flex:none;width:62px;color:var(--xz-text-3);font-size:10.5px;line-height:17px}
.xz-backup-fact .v{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-backup-test{font-size:10.5px;color:var(--xz-text-3);font-variant-numeric:tabular-nums}
.xz-backup-test{padding:4px 6px;border-radius:8px;background:var(--xz-surface-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-btn.danger.confirm{background:rgba(255,59,48,.12);border-color:rgba(255,59,48,.35);color:var(--xz-danger);font-weight:600}
.xz-backup-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}
.xz-backup-actions .xz-btn{padding:5px 9px;font-size:11.5px;border-radius:9px}
.xz-backup-add{display:flex;align-items:center;justify-content:center;gap:6px;min-height:96px;padding:12px;border:1px dashed var(--xz-line);border-radius:14px;background:transparent;color:var(--xz-primary);font:inherit;font-size:12.5px;cursor:pointer;transition:background .16s ease,border-color .16s ease}
.xz-backup-add:hover:not(:disabled){background:var(--xz-primary-soft);border-color:rgba(0,122,255,.4)}
.xz-backup-add:disabled{opacity:.45;cursor:default;color:var(--xz-text-3)}
/* \u670D\u52A1\u5546\u7F16\u8F91\u5F39\u7A97\uFF1A\u56FA\u5B9A\u5916\u6846\uFF08\u5934 + \u53EF\u6EDA\u52A8\u8868\u5355\u533A + \u9875\u811A\uFF09\u3002\u6362\u5382\u5546\u65F6\u5B57\u6BB5\u6570\u91CF\u4F1A\u53D8
   \uFF08TTS \u4E0B Edge 0 \u4E2A\u3001\u706B\u5C71 1 \u4E2A\u3001\u8BAF\u98DE 3 \u4E2A\uFF0CASR/LLM \u66F4\u591A\uFF09\uFF0C\u53EA\u7ED9 min-height \u6321\u4E0D\u4F4F
   \u300C\u53D8\u9AD8\u300D\uFF0C\u6240\u4EE5\u76F4\u63A5\u5199\u6B7B\u9AD8\u5EA6\uFF0C\u7531\u8868\u5355\u533A\u81EA\u5DF1\u6EDA\u52A8\u3002 */
.xz-modal-lg{width:min(560px,94vw);height:min(460px,86vh);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-modal-lg .xz-modal-head{padding:18px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-modal-lg .xz-modal-head h3{margin:0}
.xz-modal-lg .xz-modal-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px 20px;scrollbar-gutter:stable}
.xz-modal-lg .xz-modal-foot{padding:12px 20px;border-top:1px solid var(--xz-line);flex:none;margin-top:0}
.xz-dialog-grid{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
@media (max-width:640px){.xz-backup-grid{grid-template-columns:1fr}}

/* ---- \u5386\u53F2\u5BF9\u8BDD\u5F39\u7A97\uFF08\u8BBE\u5907\u5361\u7247\u300C\u5386\u53F2\u300D\uFF09\uFF1A\u53CC\u680F = \u4F1A\u8BDD\u5217\u8868 + \u6D88\u606F\u6C14\u6CE1\uFF1B<720px \u4E0A\u4E0B\u5E03\u5C40 ---- */
.xz-history-modal{width:min(920px,94vw);height:min(720px,88vh);max-height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden}
.xz-history-head{display:flex;align-items:flex-start;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--xz-line);flex-wrap:wrap;flex:none}
.xz-history-head h3{margin:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.xz-history-head-titles{min-width:0;flex:1 1 220px}
.xz-history-sub{margin:2px 0 0;font-size:11.5px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.xz-modal .xz-history-sub{margin:2px 0 0}
.xz-history-head-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;flex:none}
.xz-history-body{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:0;flex:1 1 auto}
.xz-history-list{border-right:1px solid var(--xz-line);overflow:auto;padding:8px;display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0}
.xz-history-item{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;border:1px solid transparent;background:transparent;border-radius:12px;padding:9px 10px;font:inherit;color:inherit;cursor:pointer;min-width:0;width:100%;box-sizing:border-box}
.xz-history-item:hover{background:rgba(0,0,0,.035)}
.xz-history-item.active{background:var(--xz-primary-soft);border-color:rgba(0,122,255,.28)}
.xz-history-item-title{font-size:12.5px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-history-item-meta{font-size:10.5px;color:var(--xz-text-3)}
.xz-history-thread{display:flex;flex-direction:column;gap:10px;padding:14px 16px;overflow:auto;min-width:0;min-height:0;background:var(--xz-surface-muted)}
.xz-history-msg{display:flex;flex-direction:column;gap:4px;max-width:82%;min-width:0}
.xz-history-msg.user{align-self:flex-end;align-items:flex-end}
.xz-history-msg.assistant{align-self:flex-start;align-items:flex-start}
.xz-history-bubble{font-size:12.5px;line-height:1.55;padding:9px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-width:100%;box-sizing:border-box}
.xz-history-msg.user .xz-history-bubble{background:var(--xz-primary);color:#fff;border-bottom-right-radius:4px}
.xz-history-msg.assistant .xz-history-bubble{background:var(--xz-surface-strong);border:1px solid var(--xz-line);border-bottom-left-radius:4px}
.xz-history-msg-meta{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--xz-text-3);flex-wrap:wrap}
.xz-history-audio{border:1px solid var(--xz-line);background:var(--xz-surface-strong);border-radius:999px;font:inherit;font-size:10.5px;line-height:1;padding:3px 8px;cursor:pointer;color:var(--xz-text-2);text-decoration:none;display:inline-flex;align-items:center}
.xz-history-audio:hover{background:var(--xz-primary-soft);color:var(--xz-primary)}
.xz-history-ai{font-size:10px;color:var(--xz-text-3)}
.xz-history-hint{padding:18px 10px;text-align:center;font-size:12px;color:var(--xz-text-2);line-height:1.5}
.xz-history-error{color:var(--xz-danger)}
.xz-history-foot{padding:10px 18px;border-top:1px solid var(--xz-line);font-size:10.5px;color:var(--xz-text-3);text-align:center;background:var(--xz-surface-strong);flex:none}
@media (max-width:720px){
  .xz-history-modal{width:96vw;height:min(620px,92vh);max-height:92vh}
  .xz-history-head{padding:12px 12px 10px}
  .xz-history-head-actions{margin-left:0;width:100%}
  .xz-history-body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .xz-history-list{max-height:170px;border-right:none;border-bottom:1px solid var(--xz-line)}
  .xz-history-thread{max-height:none;padding:10px}
  .xz-history-msg{max-width:92%}
}

/* ---- TTS \u64AD\u62A5\u6D4B\u8BD5\u5F39\u7A97\uFF1A\u56FA\u5B9A\u9AD8\u5EA6\uFF0Ctextarea \u5403\u6389\u5269\u4F59\u7A7A\u95F4\uFF0C\u4E0D\u518D\u88AB\u5185\u5BB9/\u62D6\u52A8\u6491\u5927 ---- */
.xz-inject-modal{height:min(320px,86vh);display:flex;flex-direction:column}
.xz-inject-modal>.xz-field{flex:1 1 auto;min-height:0;margin-bottom:12px}
.xz-inject-modal .xz-textarea{flex:1 1 auto;min-height:96px;resize:none}

/* ---- \u5168\u5C40\u8BBE\u7F6E\u5355\u9875 IA\uFF082026-11-07\uFF09\uFF1A\u4EE5\u670D\u52A1\u5546\u4E3A\u4E3B\u4F53\uFF0C\u8BED\u97F3\u9ED8\u8BA4\u53C2\u6570 / \u63A5\u5165\u4E0E\u7F51\u5173\u6B21\u4E4B ---- */
.xz-config-page{display:flex;flex-direction:column;gap:14px;padding-bottom:10px}
.xz-config-page>.xz-card{margin-bottom:0}
/* \u4E00\u7EA7\uFF1A\u4E09\u4E2A\u73AF\u8282\u6982\u89C8\u5361\uFF082026-11-08\uFF09\u3002\u684C\u9762 3 \u5217 / \u5E73\u677F 2 \u5217 / \u624B\u673A 1 \u5217\uFF0C\u4E00\u5C4F\u80FD\u626B\u5B8C\u3002 */
.xz-stage-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.xz-stage-card{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--xz-line);border-radius:16px;background:var(--xz-surface-strong);cursor:pointer;text-align:left;font:inherit;color:inherit;transition:border-color .16s ease,box-shadow .16s ease}
.xz-stage-card:hover{border-color:rgba(0,122,255,.35);box-shadow:var(--xz-shadow-sm)}
.xz-stage-card.is-warn{border-color:rgba(255,159,10,.3)}
.xz-stage-card-head{display:flex;align-items:center;gap:10px}
.xz-stage-icon{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--xz-primary-soft);color:var(--xz-primary);font-size:13px;font-weight:700;flex:none}
.xz-stage-card-heading{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.xz-stage-card-heading strong{font-size:13.5px}
.xz-stage-card-desc{font-size:10.5px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-stage-card-primary{display:flex;flex-direction:column;gap:2px;min-width:0}
.xz-stage-card-primary strong{font-size:15px}
.xz-stage-card-detail{font-size:11.5px;color:var(--xz-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-stage-card-facts{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--xz-text-2)}
.xz-stage-card-chain{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-stage-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:2px}
.xz-stage-card-health{font-size:11px;color:var(--xz-text-3)}
.xz-stage-card-health.ok{color:var(--xz-success)}
.xz-stage-card-health.warn{color:var(--xz-warning)}
.xz-stage-card-manage{font-size:12px;font-weight:600;color:var(--xz-primary)}
/* \u4E8C\u7EA7\uFF1A\u4E00\u4E2A\u73AF\u8282\u7684\u7BA1\u7406\u5F39\u7A97\uFF08\u590D\u7528 devices modal \u7684\u300C\u56FA\u5B9A\u5934 + \u53EF\u6EDA\u4F53 + \u56FA\u5B9A\u811A\u300D\u9AA8\u67B6\uFF09 */
.xz-stage-modal{width:min(680px,94vw);height:min(600px,88vh);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-stage-modal .xz-modal-head{padding:16px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-stage-modal .xz-modal-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px;scrollbar-gutter:stable}
.xz-stage-modal .xz-modal-foot{padding:12px 20px;border-top:1px solid var(--xz-line);flex:none;display:flex;justify-content:flex-end;gap:8px}
/* \u5907\u7528\uFF1A\u7EB5\u5411\u5217\u8868\uFF08\u4E0D\u662F grid\uFF09\uFF0C\u884C\u5185\u4FE1\u606F + \u53F3\u4FA7\u7F16\u8F91/\u22EF\uFF0C\u64CD\u4F5C\u533A\u5C55\u5F00\u5728\u884C\u4E0B\u65B9 */
.xz-provider-list{display:flex;flex-direction:column;margin-top:12px}
.xz-provider-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--xz-line);min-width:0}
.xz-provider-row:last-child{border-bottom:none}
.xz-provider-row.is-draft{border-bottom-style:dashed}
.xz-provider-row-main{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 260px}
.xz-provider-row-title{display:flex;align-items:center;gap:8px;min-width:0}
.xz-provider-row-title strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-provider-row-facts{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--xz-text-2)}
.xz-provider-row-facts span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-provider-row-actions{display:flex;gap:6px;flex:none;margin-left:auto}
.xz-provider-row-menu{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 6px 34px}
.xz-provider-empty{margin:10px 0 2px;padding:12px;border:1px dashed var(--xz-line);border-radius:12px;background:var(--xz-surface-muted)}
/* \u6DFB\u52A0\u5907\u7528\uFF1A\u5217\u8868\u5E95\u90E8\u4E00\u6574\u884C\uFF0C\u4E0D\u518D\u662F\u540C\u5C3A\u5BF8 dashed \u65B9\u5757 */
.xz-backup-add-row{display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;margin-top:8px;padding:10px 12px;border:1px dashed var(--xz-line);border-radius:12px;background:transparent;color:var(--xz-primary);font:inherit;font-size:12.5px;cursor:pointer}
.xz-backup-add-row:hover:not(:disabled){background:var(--xz-primary-soft);border-color:rgba(0,122,255,.4)}
/* \u63A5\u5165\u4E0E\u7F51\u5173\uFF1A\u53EF\u6298\u53E0\u3001\u9ED8\u8BA4\u6536\u8D77\uFF0C\u9875\u9762\u7684\u89C6\u89C9\u91CD\u70B9\u7559\u7ED9\u670D\u52A1\u5546 */
.xz-config-access>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:650}
.xz-config-access>summary::-webkit-details-marker{display:none}
.xz-config-access>summary::after{content:'\u25BE';margin-left:auto;font-size:11px;color:var(--xz-text-3);transition:transform .18s ease}
.xz-config-access[open]>summary::after{transform:rotate(180deg)}
.xz-config-access[open]>summary{margin-bottom:12px}
/* \u9875\u9762\u5E95\u90E8\uFF1Asticky \u4FDD\u5B58\u6761\uFF0C\u6EDA\u5230\u54EA\u90FD\u80FD\u70B9\uFF082026-11-08\uFF09 */
.xz-config-footer{position:sticky;bottom:0;z-index:5;display:flex;align-items:center;gap:12px;justify-content:flex-end;margin:2px 2px 10px;padding:10px 12px;border:1px solid var(--xz-line);border-radius:14px;background:var(--xz-surface-strong);box-shadow:var(--xz-shadow-sm)}
.xz-config-footer .xz-hint{margin-right:auto}
@media (max-width:768px){.xz-config-footer{flex-wrap:wrap;justify-content:flex-end}.xz-config-footer .xz-hint{flex:1 1 100%;margin-right:0}}
@media (max-width:640px){.xz-stage-cards{grid-template-columns:1fr}.xz-stage-modal{width:96vw;height:92vh;max-height:92vh}.xz-provider-row-menu{padding-left:0}}

/* \u5F39\u7A97\u9AA8\u67B6\u4ECD\u88AB\u300C\u667A\u80FD\u4F53 \u2192 \u914D\u7F6E\u300D\u7684 AgentConfigDialog \u590D\u7528\uFF1A\u56FA\u5B9A\u5934 + \u53EF\u6EDA\u52A8\u9875\u7B7E\u5185\u5BB9 + \u9875\u811A\u3002
   \u9AD8\u5EA6\u5FC5\u987B\u5199\u6B7B\uFF0C\u4E0D\u80FD\u53EA\u7ED9 max-height\uFF082026-11-08 \u4FEE\uFF09\uFF1A\u4E09\u4E2A\u9875\u7B7E\u5185\u5BB9\u9AD8\u5EA6\u5DEE\u5F88\u5927\uFF0C\u5F39\u7A97\u6309\u5185\u5BB9
   \u6536\u7F29\u65F6\u5782\u76F4\u5C45\u4E2D\u4F1A\u8BA9\u6807\u9898/\u9875\u7B7E\u8DDF\u7740\u4E0A\u4E0B\u8DF3\uFF1B\u56FA\u5B9A\u9AD8\u5EA6\u540E\u53EA\u6709\u9875\u7B7E\u5185\u90E8\u6EDA\u52A8\u3002 */
.xz-config-modal{width:min(720px,94vw);height:min(600px,86vh);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-config-modal-head{padding:18px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-config-modal-head h3{margin:0 0 4px;font-size:15px}
.xz-config-modal-head p{margin:0;font-size:11.5px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* \u9875\u7B7E\u6761\u56FA\u5B9A\uFF0C\u53EA\u6709\u9875\u7B7E\u5185\u5BB9\u6EDA\u52A8\uFF1B\u6EDA\u52A8\u6761\u69FD\u5E38\u9A7B\uFF0C\u5207\u6362\u9875\u7B7E\u65F6\u6B63\u6587\u5BBD\u5EA6\u4E0D\u53D8 */
.xz-config-modal-body{flex:1 1 auto;min-height:0;overflow:hidden;padding:16px 20px;display:flex;flex-direction:column}
.xz-config-modal-body>.xz-tabs{flex:none}
.xz-config-modal-body>.xz-pane{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable}
/* \u89D2\u8272\u9875\u7684\u4EBA\u8BBE\u8F93\u5165\u6846\u5403\u6389\u5269\u4F59\u9AD8\u5EA6\uFF1A\u56FA\u5B9A\u5F39\u7A97\u9AD8\u5EA6\u540E\u5728\u77ED\u9875\u7B7E\u91CC\u4E0D\u4F1A\u5269\u4E00\u5927\u7247\u7A7A\u767D */
.xz-config-modal-body>.xz-pane>.xz-field:last-child{flex:1 1 auto;min-height:0;margin-bottom:0}
.xz-config-modal-body>.xz-pane>.xz-field:last-child .xz-textarea{flex:1 1 auto;min-height:120px;resize:none}
.xz-config-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--xz-line);flex:none}
/* \u667A\u80FD\u4F53\u7684\u300C\u7BA1\u7406\u8BBE\u5907\u300D\u5F39\u7A97\uFF1A\u56FA\u5B9A\u5916\u6846\uFF0C\u5217\u8868\u5185\u90E8\u6EDA\u52A8\uFF082026-11-08\uFF09\u3002 */
.xz-devices-modal{width:min(680px,94vw);height:min(560px,86vh);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-devices-modal .xz-modal-head{padding:18px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-devices-modal .xz-modal-head h3{margin:0 0 4px;font-size:15px}
.xz-devices-modal .xz-modal-head p{margin:0;font-size:11.5px;color:var(--xz-text-3)}
.xz-devices-modal .xz-modal-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px;scrollbar-gutter:stable}
.xz-devices-modal .xz-modal-foot{padding:12px 20px;border-top:1px solid var(--xz-line);flex:none;display:flex;justify-content:flex-end;gap:8px}
.xz-device-section-title{font-size:11.5px;color:var(--xz-text-3);margin:6px 0 2px}
.xz-device-row{display:flex;flex-direction:column;gap:8px;padding:10px 0;border-bottom:1px solid var(--xz-line)}
.xz-device-row:last-child{border-bottom:none}
.xz-device-row-main{display:flex;align-items:center;gap:8px;min-width:0}
.xz-device-row-main .xz-input{max-width:180px}
/* \u5361\u7247\u5185\u8054\u6539\u540D\uFF1A\u548C\u6807\u9898\u540C\u9AD8\uFF0C\u522B\u7528\u8868\u5355\u8F93\u5165\u6846\u7684 36px \u9AD8\u5EA6\u628A\u5361\u7247\u6491\u53D8\u5F62\u3002 */
.xz-devcard-head .xz-devcard-rename{height:28px;padding:0 9px;font-size:13px;line-height:1.2;border-radius:9px;max-width:220px;box-sizing:border-box}
.xz-device-row-mac{font-family:ui-monospace,monospace;font-size:11px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-device-row-actions{display:flex;gap:6px;flex-wrap:wrap}
.xz-device-row-actions .xz-btn{padding:4px 9px;font-size:11.5px;border-radius:9px}
@media (max-width:768px){.xz-config-modal{width:94vw;height:min(620px,90vh)}.xz-config-modal-body{padding:12px 14px}.xz-config-modal-foot{flex-wrap:wrap}}
`;

  // src/client/react.js
  var React = __toESM(__require("react"), 1);
  var h = React.createElement;
  var useState2 = React.useState;
  var useEffect2 = React.useEffect;
  var useCallback2 = React.useCallback;
  var useRef2 = React.useRef;

  // src/client/ui/Icon.js
  var ICONS = {
    overview: "M3 10.5 12 3l9 7.5M5 10v10h14V10",
    devices: "M4 5h16v11H4zM9 20h6M12 16v4",
    profiles: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c0-4 3.6-6 8-6s8 2 8 6",
    config: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM4 12h2M18 12h2M12 4v2M12 18v2M6.5 6.5 8 8M16 16l1.5 1.5M17.5 6.5 16 8M8 16l-1.5 1.5"
  };
  function Icon({ name, size = 16 }) {
    return h("svg", {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    }, h("path", { d: ICONS[name] || ICONS.overview }));
  }
  function XiaozhiIcon({ size = 20, active, openPanel }) {
    const handleClick = openPanel ? () => {
      try {
        openPanel();
      } catch (error) {
        console.error("[dsh-xiaozhi] could not open panel from sidebar", error);
      }
    } : void 0;
    return h(
      "span",
      {
        style: {
          display: "inline-flex",
          color: active ? "var(--dsw-alias-label-primary, currentColor)" : "var(--dsw-alias-label-secondary, currentColor)",
          cursor: openPanel ? "pointer" : void 0
        },
        onClick: handleClick
      },
      h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.8,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true"
        },
        h("rect", { x: 5, y: 6, width: 14, height: 12, rx: 3 }),
        h("circle", { cx: 12, cy: 12, r: 2.6 }),
        h("path", { d: "M12 18v3" }),
        h("path", { d: "M8.5 3.5 12 6l3.5-2.5" })
      )
    );
  }

  // src/client/ui/primitives.js
  function Badge({ kind = "ok", children }) {
    return h("span", { className: `xz-chip ${kind === "ok" ? "" : kind === "mute" ? "mute" : kind}` }, children);
  }
  function Metric({ label, value, suffix, chip, chipKind }) {
    return h(
      "div",
      { className: "xz-metric" },
      h("div", { className: "k" }, label),
      h("div", { className: "v" }, String(value), suffix ? h("small", null, suffix) : null),
      chip ? h("div", { style: { marginTop: 8 } }, h(Badge, { kind: chipKind }, chip)) : null
    );
  }
  function EndpointRow({ label, value, onCopied }) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(value);
        onCopied?.();
      } catch {
      }
    };
    return h(
      "div",
      { className: "xz-endpoint" },
      h("span", { className: "label" }, label),
      h("code", { title: value }, value || "\u2014"),
      h("button", { className: "xz-btn ghost", onClick: copy }, t("copy"))
    );
  }

  // src/client/ui/menu.js
  function IconCheck({ size = 13 }) {
    return h("svg", {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true"
    }, h("path", { d: "m5 12.5 4.5 4.5L19 7" }));
  }
  function MenuItem({ active, onClick, children, hint, badge, disabled }) {
    return h(
      "button",
      {
        type: "button",
        role: "option",
        "aria-selected": active ? "true" : "false",
        "aria-disabled": disabled ? "true" : void 0,
        disabled: disabled ? true : void 0,
        className: `xz-menu-item${active ? " active" : ""}${disabled ? " is-disabled" : ""}`,
        onClick: disabled ? void 0 : onClick
      },
      h("span", { className: "xz-menu-label" }, children),
      badge ? h("span", { className: "xz-menu-badge" }, String(badge)) : null,
      hint ? h("span", { className: "xz-menu-hint" }, hint) : null,
      active ? h(IconCheck) : null
    );
  }

  // src/client/ui/PillSelect.js
  var MENU_GAP = 6;
  var MENU_EDGE = 8;
  var MENU_MAX_HEIGHT = 340;
  function fixedContainingBlock(el) {
    let node = el ? el.parentElement : null;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      const transform = style.transform && style.transform !== "none";
      const filter = style.filter && style.filter !== "none";
      const backdrop = style.backdropFilter && style.backdropFilter !== "none" || style.webkitBackdropFilter && style.webkitBackdropFilter !== "none";
      const perspective = style.perspective && style.perspective !== "none";
      const containPaint = typeof style.contain === "string" && style.contain.includes("paint");
      const willChange = typeof style.willChange === "string" && /transform|filter|perspective/.test(style.willChange);
      if (transform || filter || backdrop || perspective || containPaint || willChange) return node;
      node = node.parentElement;
    }
    return null;
  }
  function PillSelect({ value, options, onChange, disabled, alignEnd, label, ariaLabel, width, badge, placeholder }) {
    const [open, setOpen] = useState2(false);
    const [pos, setPos] = useState2(null);
    const rootRef = useRef2(null);
    const menuRef = useRef2(null);
    const computeRef = useRef2(() => null);
    const estimateHeight = () => {
      let groups = 0;
      let lastGroup2 = "";
      for (const option of options) {
        const group = option.group || "";
        if (group && group !== lastGroup2) groups += 1;
        lastGroup2 = group;
      }
      return Math.min(MENU_MAX_HEIGHT, 14 + options.length * 32 + groups * 20);
    };
    const computePosition = (heightHint) => {
      const trigger = rootRef.current;
      if (!trigger) return null;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      if (viewportWidth <= 0 || viewportHeight <= 0) return null;
      const block = fixedContainingBlock(trigger);
      const blockRect = block ? block.getBoundingClientRect() : { left: 0, top: 0 };
      const blockLeft = blockRect.left + (block ? block.clientLeft : 0);
      const blockTop = blockRect.top + (block ? block.clientTop : 0);
      const viewLeft = -blockLeft;
      const viewTop = -blockTop;
      const viewRight = viewportWidth - blockLeft;
      const viewBottom = viewportHeight - blockTop;
      const triggerLeft = rect.left - blockLeft;
      const triggerTop = rect.top - blockTop;
      const triggerRight = rect.right - blockLeft;
      const triggerBottom = rect.bottom - blockTop;
      const widthCap = Math.min(420, viewportWidth * 0.82, typeof width === "number" ? width : Infinity);
      const menuWidth = Math.max(160, Math.min(Math.max(rect.width, 240), widthCap, viewportWidth - MENU_EDGE * 2));
      const spaceBelow = viewBottom - triggerBottom - MENU_GAP - MENU_EDGE;
      const spaceAbove = triggerTop - viewTop - MENU_GAP - MENU_EDGE;
      const wanted = Math.min(MENU_MAX_HEIGHT, Math.max(120, heightHint || estimateHeight()));
      const flipUp = wanted > spaceBelow && spaceAbove > spaceBelow;
      const available = Math.max(80, flipUp ? spaceAbove : spaceBelow);
      const maxHeight = Math.min(MENU_MAX_HEIGHT, available);
      const rendered = Math.min(wanted, maxHeight);
      const preferredLeft = alignEnd ? triggerRight - menuWidth : triggerLeft;
      const left = Math.max(
        viewLeft + MENU_EDGE,
        Math.min(preferredLeft, viewRight - menuWidth - MENU_EDGE)
      );
      const preferredTop = flipUp ? triggerTop - MENU_GAP - rendered : triggerBottom + MENU_GAP;
      const top = Math.max(
        viewTop + MENU_EDGE,
        Math.min(preferredTop, viewBottom - MENU_EDGE - rendered)
      );
      return {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(menuWidth),
        maxHeight: Math.round(maxHeight)
      };
    };
    computeRef.current = computePosition;
    useEffect2(() => {
      if (!open) {
        setPos(null);
        return void 0;
      }
      const sync = () => {
        const measured = menuRef.current ? menuRef.current.getBoundingClientRect().height : 0;
        const next = computeRef.current(measured || void 0);
        if (!next) return;
        setPos((previous) => {
          if (previous && previous.left === next.left && previous.top === next.top && previous.width === next.width && previous.maxHeight === next.maxHeight) return previous;
          return next;
        });
      };
      sync();
      const frame = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(sync) : window.setTimeout(sync, 0);
      const onPointerDown = (event) => {
        const target = event.target;
        if (rootRef.current && rootRef.current.contains(target)) return;
        if (menuRef.current && menuRef.current.contains(target)) return;
        setOpen(false);
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") setOpen(false);
      };
      const onViewportChange = () => sync();
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onViewportChange, true);
      window.addEventListener("resize", onViewportChange);
      return () => {
        if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(frame);
        else window.clearTimeout(frame);
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onViewportChange, true);
        window.removeEventListener("resize", onViewportChange);
      };
    }, [open]);
    const openMenu = () => {
      setPos(computePosition());
      setOpen(true);
    };
    const current = options.find((option) => option.value === value);
    let lastGroup = "";
    const rows = [];
    options.forEach((option, index) => {
      const group = option.group || "";
      if (group && group !== lastGroup) {
        rows.push(h("div", { key: `group-${index}`, className: "xz-menu-group", role: "presentation" }, group));
      }
      lastGroup = group;
      rows.push(h(MenuItem, {
        key: `${option.value ?? "option"}-${index}`,
        active: option.value === value,
        hint: option.hint,
        badge: option.badge,
        disabled: option.disabled === true,
        onClick: () => {
          if (option.disabled) return;
          setOpen(false);
          if (option.value !== value) onChange(option.value);
        }
      }, option.label));
    });
    return h(
      "span",
      {
        className: "xz-pillselect",
        ref: rootRef,
        style: width ? { maxWidth: `${width}px` } : void 0
      },
      h(
        "button",
        {
          type: "button",
          className: "xz-pillselect-trigger",
          disabled,
          onClick: () => open ? setOpen(false) : openMenu(),
          "aria-haspopup": "listbox",
          "aria-expanded": open ? "true" : "false",
          "aria-label": ariaLabel || label,
          title: current ? current.label : placeholder || label
        },
        h("span", { className: `xz-pill-label${current ? "" : " xz-pill-placeholder"}` }, current ? current.label : placeholder || t("selectPlaceholder")),
        badge ? h("span", { className: "xz-pillselect-badge" }, String(badge)) : null,
        h("span", { className: "xz-pillselect-chevron", "aria-hidden": "true" })
      ),
      open && pos ? h("div", {
        ref: menuRef,
        className: `xz-menu${alignEnd ? " xz-menu-end" : ""}`,
        role: "listbox",
        "aria-label": ariaLabel || label,
        // position:fixed 由 CSS 给；left/top/width/maxHeight 用内联坐标，菜单不参与页面布局。
        style: {
          left: `${pos.left}px`,
          top: `${pos.top}px`,
          width: `${pos.width}px`,
          maxHeight: `${pos.maxHeight}px`
        }
      }, rows) : null
    );
  }

  // src/client/views/Dashboard.js
  function Dashboard({ state, notify }) {
    const [probe, setProbe] = useState2(null);
    const [probing, setProbing] = useState2(false);
    const addresses = state.addresses || [];
    const [ip, setIp] = useState2(addresses[0]?.ip || "");
    useEffect2(() => {
      if (!ip && addresses.length > 0) setIp(addresses[0].ip);
    }, [addresses.length]);
    const online = (state.devices || []).filter((device) => device.online).length;
    const gateway = state.gateway || {};
    const port = state.listener?.port;
    const host = ip || state.endpoints?.lanIp || (state.listener?.host === "0.0.0.0" ? "127.0.0.1" : state.listener?.host);
    const ota = `http://${host}:${port}${state.endpoints?.otaPath || "/xiaozhi/ota/"}`;
    const ws = state.endpoints?.lanWsUrl || `ws://${host}:${port}/xiaozhi/v1/`;
    const gatewayUrl = `http://${host}:${port}`;
    const runProbe = async () => {
      setProbing(true);
      try {
        const result = await callApi("/probe/ota", { method: "POST" });
        setProbe(result);
        notify(result.ok ? t("probeOk") : t("probeFail"), result.ok ? "ok" : "bad");
      } catch (error) {
        setProbe({ ok: false, error: error.message });
        notify(`${t("probeFail")}: ${error.message}`, "bad");
      } finally {
        setProbing(false);
      }
    };
    return h(
      "div",
      null,
      h(
        "div",
        { className: "xz-grid", style: { marginBottom: 16 } },
        h(Metric, { label: t("devicesTotal"), value: (state.devices || []).length, chip: t("devicesOnline") + " " + online }),
        h(Metric, { label: t("devicesOnline"), value: online, suffix: `/ ${(state.devices || []).length}` }),
        h(Metric, {
          label: t("voiceState"),
          value: state.voice?.enabled ? t("voiceOn") : t("voiceOff")
        }),
        h(Metric, {
          label: t("gatewayState"),
          value: gateway.enabled ? gateway.commands || 0 : 0,
          suffix: gateway.enabled ? "" : t("gatewayOff"),
          chip: gateway.enabled ? t("gatewayOn").replace("{n}", String(gateway.commands || 0)) : t("gatewayOff"),
          chipKind: gateway.enabled ? "ok" : "mute"
        })
      ),
      h(
        "div",
        { className: "xz-card" },
        h("h3", null, t("endpointsTitle")),
        addresses.length > 1 ? h(
          "div",
          { className: "xz-row", style: { marginBottom: 10 } },
          h("span", { className: "xz-chip mute" }, t("addressPick")),
          h(PillSelect, {
            value: host,
            width: 320,
            ariaLabel: t("addressPick"),
            options: addresses.map((entry) => ({
              value: entry.ip,
              label: `${entry.ip} \xB7 ${entry.iface}${entry.virtual ? ` (${t("virtualNic")})` : ""}`,
              hint: entry.virtual ? t("virtualNic") : ""
            })),
            onChange: (value) => setIp(value)
          })
        ) : null,
        h(EndpointRow, { label: t("otaUrl"), value: ota, onCopied: () => notify(t("copied")) }),
        h(EndpointRow, { label: t("wsUrl"), value: ws, onCopied: () => notify(t("copied")) }),
        h(EndpointRow, { label: t("gatewayUrl"), value: gatewayUrl, onCopied: () => notify(t("copied")) }),
        h(
          "div",
          { className: "xz-row", style: { marginTop: 10 } },
          h(
            "button",
            { className: "xz-btn primary", disabled: probing, onClick: runProbe },
            probing ? t("probing") : t("probe")
          )
        ),
        probe ? h("pre", { className: "xz-code", style: { marginTop: 12 } }, JSON.stringify(probe, null, 2)) : null
      ),
      h(
        "div",
        { className: "xz-card" },
        h("h3", null, t("lastEvents")),
        h(
          "div",
          { className: "xz-row", style: { gap: 8 } },
          (state.devices || []).length === 0 ? h("span", { className: "xz-chip mute" }, t("noEvents")) : (state.devices || []).slice(0, 6).map(
            (device) => h(
              "span",
              { key: device.deviceId, className: "xz-chip mute" },
              `${device.nickName || device.deviceId} \xB7 ${device.online ? t("online") : t("offline")}`
            )
          )
        )
      )
    );
  }

  // src/client/agents/AgentConfigDialog.js
  function AgentConfigDialog({
    agent,
    tools,
    memory,
    memoryDraft,
    onMemoryDraft,
    onAddMemory,
    onRemoveMemory,
    onToggleTool,
    onToggleMemory,
    onSaved,
    onClose
  }) {
    const [tab, setTab] = useState2("role");
    const tabs = [
      { id: "role", label: t("tabRole") },
      { id: "model", label: t("tabModel") },
      { id: "ext", label: t("tabExt") }
    ];
    const [draftPrompt, setDraftPrompt] = useState2(agent.overrides?.systemPrompt ?? "");
    const [draftVoice, setDraftVoice] = useState2(agent.overrides?.voice ?? "");
    const [draftLanguage, setDraftLanguage] = useState2(agent.overrides?.language ?? "");
    const [saving, setSaving] = useState2(false);
    const [draftModel, setDraftModel] = useState2(agent.overrides?.model ?? "");
    const [ttsGlobal, setTtsGlobal] = useState2({ provider: "volc", resourceId: "" });
    const [voiceCatalog, setVoiceCatalog] = useState2(null);
    const [voiceSource, setVoiceSource] = useState2("");
    const [voiceError, setVoiceError] = useState2("");
    const [llmGlobal, setLlmGlobal] = useState2({ provider: "", model: "" });
    const [modelOptions, setModelOptions] = useState2(null);
    useEffect2(() => {
      let alive = true;
      callApi("/settings").then((data) => {
        if (!alive) return;
        const globalTts = data?.settings?.voice?.tts || {};
        const globalLlm = data?.settings?.voice?.llm || {};
        const provider = globalTts.provider || "volc";
        const resourceId = globalTts.resourceId || "";
        setTtsGlobal({ provider, resourceId });
        setLlmGlobal({ provider: globalLlm.provider || "", model: globalLlm.model || "" });
        callApi("/models?kind=llm&source=primary").then((models) => {
          if (alive) setModelOptions(Array.isArray(models?.options) ? models.options : []);
        }).catch(() => {
        });
        return callApi(
          `/voices?provider=${encodeURIComponent(provider)}&resourceId=${encodeURIComponent(resourceId)}`
        ).then((voices2) => {
          if (!alive) return;
          const list = voices2?.options?.[provider];
          setVoiceCatalog(Array.isArray(list) ? list : null);
          setVoiceSource(voices2?.source || "");
          setVoiceError(voices2?.error || "");
        }).catch(() => {
        });
      }).catch(() => {
      });
      return () => {
        alive = false;
      };
    }, []);
    const saveAll = async () => {
      setSaving(true);
      try {
        await callApi("/agents/update", {
          method: "POST",
          body: {
            agentId: agent.id,
            systemPrompt: draftPrompt,
            voice: draftVoice,
            language: draftLanguage,
            model: draftModel
          }
        });
        await onSaved();
      } finally {
        setSaving(false);
      }
    };
    const catalog = voiceCatalog ?? (VOICES[ttsGlobal.provider] || []);
    const voices = voiceCatalog ? catalog : voicesForResource(catalog, ttsGlobal.resourceId);
    const voiceOptions = [{ value: "", label: t("voiceDefault") }].concat(
      voices.map((voice) => ({ value: voice.value, label: voice.label }))
    );
    if (draftVoice && !voiceOptions.some((option) => option.value === draftVoice)) {
      const known = voices.find((voice) => voice.value === draftVoice);
      voiceOptions.push({ value: draftVoice, label: known?.label || voiceLabel(draftVoice, ttsGlobal.provider) });
    }
    const voiceHint = !voiceSource ? "" : voiceSource === "api" ? t("voiceCatalogApi") : ttsGlobal.provider === "volc" ? voiceError ? `${t("voiceCatalogFallback")}\uFF1A${voiceError}` : t("voiceCatalogFallback") : "";
    const languageSelect = h(PillSelect, {
      value: draftLanguage,
      ariaLabel: t("outputLanguage"),
      options: [{ value: "", label: t("languageFollow") }].concat(
        OUTPUT_LANGUAGE_VALUES.map((value) => ({ value, label: value }))
      ),
      onChange: setDraftLanguage
    });
    const rolePane = h(
      "div",
      { key: "role", className: "xz-pane" },
      h(
        "div",
        { className: "xz-grid" },
        h(
          "div",
          { className: "xz-field" },
          h("label", null, t("voice")),
          h(PillSelect, { value: draftVoice, ariaLabel: t("voice"), options: voiceOptions, onChange: setDraftVoice }),
          voiceHint ? h("span", { className: "note" }, voiceHint) : null
        ),
        h(
          "div",
          { className: "xz-field" },
          h("label", null, t("outputLanguage")),
          languageSelect
        )
      ),
      h(
        "div",
        { className: "xz-field" },
        h("label", null, t("persona")),
        h("textarea", {
          className: "xz-textarea",
          rows: 8,
          value: draftPrompt,
          placeholder: t("personaPlaceholder"),
          onChange: (e) => setDraftPrompt(e.target.value)
        })
      )
    );
    const globalModel = llmGlobal.model || "";
    const modelOptionList = Array.isArray(modelOptions) ? modelOptions : null;
    const modelSelectOptions = [{
      value: "",
      label: globalModel ? `${t("agentModelDefault")}\uFF08${globalModel}\uFF09` : t("agentModelDefault")
    }].concat((modelOptionList || []).map((option) => ({ value: option.value, label: option.label })));
    if (draftModel && !modelSelectOptions.some((option) => option.value === draftModel)) {
      modelSelectOptions.push({ value: draftModel, label: draftModel });
    }
    const modelPane = h(
      "div",
      { key: "model", className: "xz-pane" },
      // 直连语义：provider / Base URL / API Key 都在「全局设置 → LLM」里，
      // 这里只覆盖模型名；留空 = 用全局默认模型。模型清单来自全局 LLM 的 /models，
      // 拉不到时退回手填（各厂商模型 id 命名差异大，不硬编码）。
      h(
        "div",
        { className: "xz-field" },
        h("label", null, t("agentModelLabel")),
        modelOptionList && modelOptionList.length ? h(PillSelect, {
          value: draftModel,
          ariaLabel: t("agentModelLabel"),
          options: modelSelectOptions,
          onChange: setDraftModel
        }) : h("input", {
          className: "xz-input",
          value: draftModel,
          placeholder: t("agentModelPlaceholder"),
          onChange: (e) => setDraftModel(e.target.value)
        }),
        h(
          "span",
          { className: "note" },
          `${t("agentModelHint")}${globalModel ? `\uFF08${globalModel}\uFF09` : ""}` + (modelOptionList && modelOptionList.length === 0 ? `\uFF1B${t("agentModelManual")}` : "")
        )
      ),
      h(
        "div",
        { className: "xz-row", style: { justifyContent: "space-between", marginTop: 6 } },
        h("span", { className: "xz-devcard-label" }, t("memory")),
        h("button", {
          type: "button",
          className: `xz-switch ${agent.memoryEnabled === false ? "" : "on"}`,
          role: "switch",
          "aria-checked": agent.memoryEnabled === false ? "false" : "true",
          "aria-label": t("memory"),
          onClick: onToggleMemory
        }, h("span", null))
      ),
      memory.length === 0 ? null : h(
        "div",
        { className: "xz-memory-list" },
        memory.map(
          (item, index) => h(
            "div",
            { key: index, className: "xz-memory-item" },
            h("span", null, item.key ? `${item.key}: ${item.value}` : item.value),
            h("button", { type: "button", className: "xz-btn danger", onClick: () => onRemoveMemory(index) }, t("remove"))
          )
        )
      ),
      h(
        "div",
        { className: "xz-row", style: { gap: 6 } },
        h("input", { className: "xz-input", value: memoryDraft, placeholder: t("memoryPlaceholder"), onChange: (e) => onMemoryDraft(e.target.value) }),
        h("button", { className: "xz-btn", onClick: onAddMemory }, t("add"))
      )
    );
    const extPane = h(
      "div",
      { key: "ext", className: "xz-pane" },
      tools.length === 0 ? h("div", { className: "xz-hint" }, t("loading")) : h(
        "div",
        { className: "xz-capability-grid" },
        tools.map(
          (tool) => h(
            "div",
            { key: tool.name, className: `xz-capability ${tool.enabled === false ? "is-off" : "is-on"}` },
            h("span", { className: "xz-capability-name" }, toolLabel(tool.name)),
            h("button", {
              type: "button",
              className: `xz-switch ${tool.enabled === false ? "" : "on"}`,
              role: "switch",
              "aria-checked": tool.enabled === false ? "false" : "true",
              "aria-label": toolLabel(tool.name),
              onClick: () => onToggleTool(tool)
            }, h("span", null))
          )
        )
      )
    );
    return h(
      "div",
      { className: "xz-modal-mask", onClick: onClose },
      h(
        "div",
        {
          className: "xz-modal xz-config-modal",
          role: "dialog",
          "aria-modal": "true",
          onClick: (event) => event.stopPropagation()
        },
        h(
          "div",
          { className: "xz-config-modal-head" },
          h(
            "div",
            { className: "xz-row", style: { justifyContent: "space-between", alignItems: "flex-start" } },
            h(
              "div",
              null,
              h("h3", null, `${agent.name || t("unnamed")} \xB7 ${t("configure")}`),
              h("p", null, t("deviceConfigHint"))
            ),
            h("button", { type: "button", className: "xz-btn", "aria-label": t("close"), onClick: onClose }, "\xD7")
          )
        ),
        h(
          "div",
          { className: "xz-config-modal-body" },
          h(
            "div",
            { className: "xz-tabs" },
            tabs.map(
              (item) => h("button", { key: item.id, type: "button", className: `xz-tab ${tab === item.id ? "active" : ""}`, onClick: () => setTab(item.id) }, item.label)
            )
          ),
          tab === "role" ? rolePane : tab === "model" ? modelPane : extPane
        ),
        h(
          "div",
          { className: "xz-config-modal-foot" },
          h("button", { className: "xz-btn", onClick: onClose }, t("close")),
          h("button", { className: "xz-btn primary", disabled: saving, onClick: saveAll }, saving ? "\u2026" : t("save"))
        )
      )
    );
  }

  // src/client/agents/AgentDevicesDialog.js
  function AgentDevicesDialog({ agent, agents = [], devices, busyId, onBind, onUnbind, onDeviceAction, onClose }) {
    const bound = agent.devices || [];
    const boundIds = new Set(bound.map((device) => device.deviceId));
    const unbound = devices.filter((device) => !boundIds.has(device.deviceId));
    const agentName = (id) => agents.find((item) => item.id === id)?.name || t("unnamed");
    return h(
      "div",
      { className: "xz-modal-mask", onClick: onClose },
      h(
        "div",
        {
          className: "xz-modal xz-devices-modal",
          role: "dialog",
          "aria-modal": "true",
          onClick: (event) => event.stopPropagation()
        },
        h(
          "div",
          { className: "xz-modal-head" },
          h(
            "div",
            { className: "xz-row", style: { justifyContent: "space-between", alignItems: "flex-start" } },
            h(
              "div",
              null,
              h("h3", null, `${t("agentBindTitle")} \xB7 ${agent.name || t("unnamed")}`),
              h("p", null, t("agentBindHint"))
            ),
            h("button", { type: "button", className: "xz-btn", "aria-label": t("close"), onClick: onClose }, "\xD7")
          )
        ),
        h(
          "div",
          { className: "xz-modal-body" },
          h("div", { className: "xz-device-section-title" }, `${t("agentBoundTitle")}\uFF08${bound.length}\uFF09`),
          bound.length === 0 ? h("div", { className: "xz-hint" }, t("agentNoDevices")) : bound.map(
            (device) => h(
              "div",
              { key: device.deviceId, className: "xz-device-row" },
              h(
                "div",
                { className: "xz-device-row-main" },
                h("input", {
                  className: "xz-input",
                  defaultValue: device.nickName || "",
                  placeholder: t("name"),
                  "aria-label": t("name"),
                  maxLength: 40,
                  onBlur: (event) => onDeviceAction("rename", device, event.target.value)
                }),
                h("span", { className: "xz-device-row-mac" }, device.deviceId),
                h("span", { className: `xz-dot ${device.online ? "on" : ""}` }),
                h("span", { className: "xz-devcard-state" }, device.online ? t("online") : t("offline")),
                device.blocked ? h("span", { className: "xz-chip mute" }, t("blocked")) : null
              ),
              h(
                "div",
                { className: "xz-device-row-actions" },
                h("button", {
                  type: "button",
                  className: "xz-btn",
                  disabled: busyId === device.deviceId,
                  onClick: () => onDeviceAction("ota", device, device.otaEnabled === false)
                }, `${t("otaUpgrade")} ${device.otaEnabled === false ? "\u2715" : "\u2713"}`),
                device.online ? h("button", {
                  type: "button",
                  className: "xz-btn",
                  onClick: () => onDeviceAction("disconnect", device)
                }, t("disconnect")) : null,
                h("button", {
                  type: "button",
                  className: "xz-btn",
                  onClick: () => onDeviceAction("block", device)
                }, device.blocked ? t("unblock") : t("block")),
                h("button", {
                  type: "button",
                  className: "xz-btn",
                  onClick: () => onUnbind(device)
                }, t("agentUnbind")),
                h("button", {
                  type: "button",
                  className: "xz-btn danger",
                  onClick: () => onDeviceAction("remove", device)
                }, t("agentRemoveDevice"))
              )
            )
          ),
          h("div", { className: "xz-device-section-title", style: { marginTop: 16 } }, t("agentOtherTitle")),
          unbound.length === 0 ? h("div", { className: "xz-hint" }, t("agentNoUnbound")) : unbound.map(
            (device) => h(
              "div",
              { key: device.deviceId, className: "xz-device-row" },
              h(
                "div",
                { className: "xz-device-row-main" },
                h("span", { className: "xz-devcard-value" }, device.nickName || t("unnamed")),
                h("span", { className: "xz-device-row-mac" }, device.deviceId),
                h(
                  "span",
                  { className: "xz-chip" },
                  device.agentId ? `${t("agentCurrentOwner")} ${agentName(device.agentId)}` : t("agentUnbound")
                )
              ),
              h(
                "div",
                { className: "xz-device-row-actions" },
                h("button", {
                  type: "button",
                  className: "xz-btn primary",
                  onClick: () => onBind(device)
                }, t("agentMoveHere"))
              )
            )
          )
        ),
        h(
          "div",
          { className: "xz-modal-foot" },
          h("button", { type: "button", className: "xz-btn", onClick: onClose }, t("close"))
        )
      )
    );
  }

  // src/client/agents/HistoryDialog.js
  function HistoryDialog({ agent, onClose }) {
    const agentId = agent.id;
    const [conversations, setConversations] = useState2([]);
    const [loading, setLoading] = useState2(true);
    const [listError, setListError] = useState2("");
    const [selectedId, setSelectedId] = useState2("");
    const [detail, setDetail] = useState2(null);
    const [detailLoading, setDetailLoading] = useState2(false);
    const [detailError, setDetailError] = useState2("");
    const [playingId, setPlayingId] = useState2("");
    const [audioError, setAudioError] = useState2("");
    const [clearing, setClearing] = useState2(false);
    const [reloadTick, setReloadTick] = useState2(0);
    const audioRef = useRef2(null);
    const audioGenRef = useRef2(0);
    const listReqRef = useRef2(0);
    const selectedDeviceId = (conversations.find((item) => item.sessionId === selectedId) || {}).deviceId || "";
    const stopAudio = useCallback2(() => {
      audioGenRef.current += 1;
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch {
        }
      }
      setPlayingId("");
      setAudioError("");
    }, []);
    const loadList = useCallback2(async (preferSessionId) => {
      const gen = listReqRef.current + 1;
      listReqRef.current = gen;
      setLoading(true);
      setListError("");
      try {
        const data = await callApi(
          `/history/agent-conversations?agentId=${encodeURIComponent(agentId)}&limit=50`
        );
        if (listReqRef.current !== gen) return;
        const list = Array.isArray(data?.conversations) ? data.conversations : [];
        setConversations(list);
        setSelectedId((current) => {
          const wanted = preferSessionId || current;
          if (wanted && list.some((item) => item.sessionId === wanted)) return wanted;
          return list[0]?.sessionId || "";
        });
      } catch (error) {
        if (listReqRef.current !== gen) return;
        setConversations([]);
        setSelectedId("");
        setListError(error?.message || t("loadFailed"));
      } finally {
        if (listReqRef.current === gen) setLoading(false);
      }
    }, [agentId]);
    useEffect2(() => {
      loadList();
      return () => {
        listReqRef.current += 1;
      };
    }, [loadList]);
    useEffect2(() => {
      stopAudio();
      if (!selectedId || !selectedDeviceId) {
        setDetail(null);
        setDetailError("");
        setDetailLoading(false);
        return void 0;
      }
      let alive = true;
      setDetailLoading(true);
      setDetailError("");
      callApi(
        `/history/conversation?deviceId=${encodeURIComponent(selectedDeviceId)}&sessionId=${encodeURIComponent(selectedId)}`
      ).then((data) => {
        if (!alive) return;
        setDetail(data || null);
      }).catch((error) => {
        if (!alive) return;
        setDetail(null);
        setDetailError(error?.message || t("loadFailed"));
      }).finally(() => {
        if (alive) setDetailLoading(false);
      });
      return () => {
        alive = false;
      };
    }, [selectedDeviceId, selectedId, reloadTick, stopAudio]);
    useEffect2(() => () => {
      audioGenRef.current += 1;
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch {
        }
      }
    }, []);
    const toggleAudio = (audioId) => {
      const key = String(audioId);
      if (playingId === key) {
        stopAudio();
        return;
      }
      stopAudio();
      setAudioError("");
      const gen = audioGenRef.current;
      const audio = new Audio(historyAudioUrl(selectedDeviceId, audioId));
      audioRef.current = audio;
      const release = () => {
        if (audioGenRef.current !== gen) return;
        audioRef.current = null;
        setPlayingId("");
      };
      audio.onended = release;
      audio.onerror = () => {
        if (audioGenRef.current !== gen) return;
        release();
        setAudioError(t("historyAudioFailed"));
      };
      setPlayingId(key);
      const result = audio.play();
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          if (audioGenRef.current !== gen) return;
          release();
          setAudioError(t("historyAudioFailed"));
        });
      }
    };
    const clearHistory = async () => {
      if (!window.confirm(t("historyClearConfirm"))) return;
      setClearing(true);
      setListError("");
      try {
        for (const device of agent.devices || []) {
          await callApi("/history/clear", { method: "POST", body: { deviceId: device.deviceId } });
        }
        stopAudio();
        setDetail(null);
        setSelectedId("");
        await loadList("");
      } catch (error) {
        setListError(`${t("historyClearFailed")}${error?.message || ""}`);
      } finally {
        setClearing(false);
      }
    };
    const messages = Array.isArray(detail?.messages) ? detail.messages : [];
    const selected = conversations.find((item) => item.sessionId === selectedId) || null;
    const subtitle = detail?.title || selected?.title || "";
    return h(
      "div",
      { className: "xz-modal-mask", onClick: onClose },
      h(
        "div",
        {
          className: "xz-modal xz-history-modal",
          role: "dialog",
          "aria-modal": "true",
          onClick: (event) => event.stopPropagation()
        },
        h(
          "div",
          { className: "xz-history-head" },
          h(
            "div",
            { className: "xz-history-head-titles" },
            h("h3", null, `${agent.name || t("unnamed")}${t("historyTitleSuffix")}`),
            subtitle ? h("p", { className: "xz-history-sub" }, subtitle) : null
          ),
          h(
            "div",
            { className: "xz-history-head-actions" },
            h("button", {
              type: "button",
              className: "xz-btn",
              disabled: loading || clearing,
              onClick: () => {
                setReloadTick((n) => n + 1);
                loadList(selectedId);
              }
            }, t("historyRefresh")),
            h("button", {
              type: "button",
              className: "xz-btn danger",
              disabled: loading || clearing,
              onClick: clearHistory
            }, clearing ? "\u2026" : t("historyClear")),
            h("button", {
              type: "button",
              className: "xz-btn",
              "aria-label": t("close"),
              onClick: onClose
            }, "\xD7")
          )
        ),
        h(
          "div",
          { className: "xz-history-body" },
          h(
            "div",
            { className: "xz-history-list" },
            loading ? h("div", { className: "xz-history-hint" }, t("historyLoading")) : listError ? h("div", { className: "xz-history-hint xz-history-error" }, listError) : conversations.length === 0 ? h("div", { className: "xz-history-hint" }, t("historyEmpty")) : conversations.map((item) => {
              const started = historyTime(item.startedAt || item.endedAt);
              const count = Array.isArray(item.messages) ? item.messages.length : Number(item.messages) || 0;
              return h(
                "button",
                {
                  key: `${item.deviceId || ""}:${item.sessionId}`,
                  type: "button",
                  className: `xz-history-item ${item.sessionId === selectedId ? "active" : ""}`,
                  onClick: () => setSelectedId(item.sessionId)
                },
                h(
                  "span",
                  { className: "xz-history-item-title" },
                  item.title || item.preview || t("historyUntitled")
                ),
                h(
                  "span",
                  { className: "xz-history-item-meta" },
                  [
                    item.deviceName || "",
                    started ? formatAgo(started) : "",
                    t("messageCount").replace("{n}", String(count))
                  ].filter(Boolean).join(" \xB7 ")
                )
              );
            })
          ),
          h(
            "div",
            { className: "xz-history-thread" },
            detailLoading || loading && !selectedId ? h("div", { className: "xz-history-hint" }, t("historyLoading")) : detailError && messages.length === 0 ? h("div", { className: "xz-history-hint xz-history-error" }, detailError) : !selectedId ? h("div", { className: "xz-history-hint" }, t("historyPickConversation")) : messages.length === 0 ? h("div", { className: "xz-history-hint" }, t("historyEmpty")) : messages.map((message, index) => {
              const role = message.role === "user" ? "user" : "assistant";
              const audioId = message.audioId;
              const playing = audioId != null && String(audioId) === playingId;
              const clock = formatClock(message.at);
              return h(
                "div",
                { key: `${selectedId}-${index}`, className: `xz-history-msg ${role}` },
                h("div", { className: "xz-history-bubble" }, message.content ?? ""),
                h(
                  "div",
                  { className: "xz-history-msg-meta" },
                  clock ? h("span", null, clock) : null,
                  audioId != null ? h("button", {
                    type: "button",
                    className: "xz-history-audio",
                    title: playing ? t("historyPause") : t("historyPlay"),
                    "aria-label": playing ? t("historyPause") : t("historyPlay"),
                    onClick: () => toggleAudio(audioId)
                  }, playing ? "\u23F8" : "\u25B6") : null,
                  audioId != null ? h("a", {
                    className: "xz-history-audio",
                    href: historyAudioUrl(selectedDeviceId, audioId),
                    download: `${String(audioId)}.wav`,
                    title: t("historyDownload"),
                    "aria-label": t("historyDownload")
                  }, "\u2B07") : null
                ),
                role === "assistant" ? h("div", { className: "xz-history-ai" }, t("aiGenerated")) : null
              );
            })
          )
        ),
        h(
          "div",
          { className: "xz-history-foot" },
          audioError ? h("span", { className: "xz-history-error" }, audioError) : t("historyAudioRetention")
        )
      )
    );
  }

  // src/client/agents/AgentsView.js
  function AgentsView({ state, notify, onChanged }) {
    const [injecting, setInjecting] = useState2(null);
    const [text, setText] = useState2("");
    const [busyId, setBusyId] = useState2("");
    const [configuring, setConfiguring] = useState2("");
    const [managing, setManaging] = useState2("");
    const [confirmDelete, setConfirmDelete] = useState2("");
    const renameCancelled = useRef2(false);
    const renameBusy = useRef2(false);
    const [memory, setMemory] = useState2([]);
    const [memoryDraft, setMemoryDraft] = useState2("");
    const [toolCatalog, setToolCatalog] = useState2([]);
    const [editing, setEditing] = useState2("");
    const [editName, setEditName] = useState2("");
    const [historyAgent, setHistoryAgent] = useState2(null);
    const [pendingAgent, setPendingAgent] = useState2({});
    const [pendingBusy, setPendingBusy] = useState2("");
    const agents = state.agents || [];
    const devices = state.devices || [];
    const pending = state.pending || [];
    const errorText = (error) => error?.code === "duplicate-name" ? t("agentNameDuplicate") : error.message;
    const nextDefaultName = () => {
      const used = new Set(agents.map((agent) => agent.name).filter(Boolean));
      let n = 1;
      while (used.has(t("agentDefaultName").replace("{n}", String(n)))) n += 1;
      return t("agentDefaultName").replace("{n}", String(n));
    };
    const configAgent = configuring ? agents.find((item) => item.id === configuring) || null : null;
    const manageAgent = managing ? agents.find((item) => item.id === managing) || null : null;
    const createAgent = async () => {
      setBusyId("new");
      try {
        const data = await callApi("/agents", {
          method: "POST",
          body: { name: nextDefaultName() }
        });
        await onChanged();
        if (data?.agent?.id) await openConfig(data.agent.id);
      } catch (error) {
        notify(`${t("actionFailed")}${errorText(error)}`, "bad");
      } finally {
        setBusyId("");
      }
    };
    const removeAgent = async (agent) => {
      if (confirmDelete !== agent.id) {
        setConfirmDelete(agent.id);
        notify(t("agentDeleteHint"), "bad");
        return;
      }
      setConfirmDelete("");
      setBusyId(agent.id);
      try {
        await callApi("/agents/remove", { method: "POST", body: { agentId: agent.id } });
        await onChanged();
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      } finally {
        setBusyId("");
      }
    };
    const openConfig = async (agentId) => {
      setConfiguring(agentId);
      setMemory([]);
      setMemoryDraft("");
      try {
        const [toolsData, memoryData] = await Promise.all([
          callApi("/tools?agentId=" + encodeURIComponent(agentId)),
          callApi("/memory?agentId=" + encodeURIComponent(agentId))
        ]);
        setToolCatalog(Array.isArray(toolsData?.tools) ? toolsData.tools : []);
        setMemory(Array.isArray(memoryData?.facts) ? memoryData.facts : []);
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      }
    };
    const toggleToolFor = async (agentId, tool) => {
      try {
        const data = await callApi("/tools/toggle", {
          method: "POST",
          admin: true,
          body: { agentId, name: tool.name, enabled: tool.enabled === false }
        });
        if (Array.isArray(data?.tools)) setToolCatalog(data.tools);
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      }
    };
    const addMemory = async (agentId) => {
      const value = memoryDraft.trim();
      if (!value) return;
      try {
        const data = await callApi("/memory/add", { method: "POST", admin: true, body: { agentId, value } });
        setMemory(Array.isArray(data?.facts) ? data.facts : []);
        setMemoryDraft("");
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      }
    };
    const removeMemory = async (agentId, index) => {
      try {
        const data = await callApi("/memory/remove", { method: "POST", admin: true, body: { agentId, index } });
        setMemory(Array.isArray(data?.facts) ? data.facts : []);
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      }
    };
    const toggleMemory = async (agent) => {
      try {
        await callApi("/memory/enabled", {
          method: "POST",
          body: { agentId: agent.id, enabled: agent.memoryEnabled === false }
        });
        await onChanged();
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      }
    };
    const commitRename = async (agent) => {
      if ((agent.name || "") === editName) {
        setEditing("");
        return;
      }
      if (renameBusy.current) return;
      renameBusy.current = true;
      try {
        await callApi("/agents/update", { method: "POST", body: { agentId: agent.id, name: editName } });
        setEditing("");
        await onChanged();
      } catch (error) {
        notify(`${t("actionFailed")}${errorText(error)}`, "bad");
      } finally {
        renameBusy.current = false;
      }
    };
    const bindDevice = async (agent, device) => {
      setBusyId(device.deviceId);
      try {
        await callApi("/agents/bind", { method: "POST", body: { agentId: agent.id, deviceId: device.deviceId } });
        await onChanged();
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      } finally {
        setBusyId("");
      }
    };
    const unbindDevice = async (agent, device) => {
      setBusyId(device.deviceId);
      try {
        await callApi("/agents/unbind", { method: "POST", body: { agentId: agent.id, deviceId: device.deviceId } });
        await onChanged();
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      } finally {
        setBusyId("");
      }
    };
    const deviceAction = async (action, device, value) => {
      if (action === "remove" && !window.confirm(t("remove") + "?")) return;
      if (action === "rename" && (device.nickName || "") === String(value ?? "")) return;
      setBusyId(device.deviceId);
      try {
        if (action === "rename") {
          await callApi("/devices/rename", { method: "POST", body: { deviceId: device.deviceId, nickName: value } });
        } else if (action === "ota") {
          await callApi("/devices/ota", { method: "POST", body: { deviceId: device.deviceId, enabled: value === true } });
        } else if (action === "block") {
          await callApi("/devices/block", { method: "POST", body: { deviceId: device.deviceId, blocked: !device.blocked } });
        } else if (action === "disconnect") {
          await callApi("/devices/disconnect", { method: "POST", body: { deviceId: device.deviceId } });
        } else if (action === "remove") {
          await callApi("/devices/remove", { method: "POST", body: { deviceId: device.deviceId } });
        }
        await onChanged();
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      } finally {
        setBusyId("");
      }
    };
    const sendInject = async () => {
      if (!injecting || !text.trim()) return;
      const online = (injecting.devices || []).filter((device) => device.online);
      if (online.length === 0) {
        notify(t("agentOffline"), "bad");
        return;
      }
      try {
        for (const device of online) {
          await callApi("/devices/inject", {
            method: "POST",
            admin: true,
            body: { deviceId: device.deviceId, text: text.trim() }
          });
        }
        notify(t("injectOk"));
        setInjecting(null);
        setText("");
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      }
    };
    const approvePending = async (device) => {
      const agentId = pendingAgent[device.deviceId] ?? agents[0]?.id ?? "";
      setPendingBusy(device.deviceId);
      try {
        await callApi("/pending/approve", {
          method: "POST",
          body: { deviceId: device.deviceId, ...agentId ? { agentId } : {} }
        });
        await onChanged();
        notify(t("pendingApproved"), "ok");
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      } finally {
        setPendingBusy("");
      }
    };
    const rejectPending = async (device) => {
      setPendingBusy(device.deviceId);
      try {
        await callApi("/pending/reject", {
          method: "POST",
          body: { deviceId: device.deviceId }
        });
        await onChanged();
        notify(t("pendingRejected"), "ok");
      } catch (error) {
        notify(`${t("actionFailed")}${error.message}`, "bad");
      } finally {
        setPendingBusy("");
      }
    };
    const pendingCard = pending.length === 0 ? null : h(
      "div",
      { className: "xz-card xz-pending-card", style: { marginBottom: 14 } },
      h(
        "div",
        { className: "xz-row", style: { justifyContent: "space-between", marginBottom: 6 } },
        h("h3", { style: { margin: 0 } }, `${t("pendingTitle")}\uFF08${pending.length}\uFF09`)
      ),
      h("p", { className: "xz-hint", style: { marginTop: 0 } }, t("pendingHint")),
      pending.map((device) => {
        const agentOptions = agents.length === 0 ? [{ value: "", label: t("pendingAutoAgent") }] : agents.map((agent) => ({ value: agent.id, label: agent.name || t("unnamed") }));
        const chosen = pendingAgent[device.deviceId] ?? agents[0]?.id ?? "";
        return h(
          "div",
          { key: device.deviceId, className: "xz-device-row" },
          h(
            "div",
            { className: "xz-device-row-main" },
            h("span", { className: "xz-devcard-value" }, device.deviceId),
            h("span", { className: "xz-device-row-mac" }, device.lastIp || ""),
            h(
              "span",
              { className: "xz-devcard-state" },
              `${t("pendingFirstSeen")} ${formatAgo(device.firstSeenAt)} \xB7 ${t("pendingAttempts")} ${device.attempts}`
            )
          ),
          h(
            "div",
            { className: "xz-device-row-actions" },
            h(PillSelect, {
              value: chosen,
              options: agentOptions,
              onChange: (value) => setPendingAgent((current) => ({ ...current, [device.deviceId]: value })),
              ariaLabel: t("pendingAgent"),
              width: 160
            }),
            h("button", {
              type: "button",
              className: "xz-btn primary",
              disabled: pendingBusy === device.deviceId,
              onClick: () => approvePending(device)
            }, t("pendingApprove")),
            h("button", {
              type: "button",
              className: "xz-btn",
              disabled: pendingBusy === device.deviceId,
              onClick: () => rejectPending(device)
            }, t("pendingReject"))
          )
        );
      })
    );
    return h(
      "div",
      null,
      pendingCard,
      h(
        "div",
        { className: "xz-card" },
        h(
          "div",
          { className: "xz-row", style: { justifyContent: "space-between", marginBottom: 10 } },
          h("h3", { style: { margin: 0 } }, t("devicesTitle")),
          h("button", {
            type: "button",
            className: "xz-btn",
            disabled: busyId === "new",
            onClick: createAgent
          }, `+ ${t("agentsNew")}`)
        ),
        agents.length === 0 ? h("div", { className: "xz-empty" }, t("empty")) : h(
          "div",
          { className: "xz-card-grid" },
          agents.map(
            (agent) => h(
              "div",
              { key: agent.id, className: "xz-devcard" },
              h(
                "div",
                { className: "xz-devcard-head" },
                h("div", { className: "xz-devcard-mark" }, h(Icon, { name: "devices", size: 16 })),
                editing === agent.id ? h(
                  "div",
                  { className: "xz-row", style: { flex: 1 } },
                  h("input", {
                    className: "xz-input xz-devcard-rename",
                    autoFocus: true,
                    value: editName,
                    maxLength: 40,
                    placeholder: t("agentNamePlaceholder"),
                    "aria-label": t("rename"),
                    onChange: (e) => setEditName(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename(agent);
                      }
                      if (e.key === "Escape") {
                        renameCancelled.current = true;
                        setEditing("");
                      }
                    },
                    onBlur: () => {
                      if (renameCancelled.current) {
                        renameCancelled.current = false;
                        return;
                      }
                      commitRename(agent);
                    }
                  })
                ) : h(
                  "div",
                  { className: "xz-devcard-title" },
                  h("strong", {
                    className: "xz-devcard-name",
                    title: t("rename"),
                    onClick: () => {
                      setEditing(agent.id);
                      setEditName(agent.name || "");
                    }
                  }, agent.name || t("unnamed")),
                  h("span", { className: `xz-dot ${agent.online ? "on" : ""}`, style: { marginLeft: 6 } }),
                  h("span", { className: "xz-devcard-state" }, agent.online ? t("online") : t("offline"))
                ),
                editing === agent.id ? null : h("button", {
                  className: "xz-btn",
                  disabled: busyId === agent.id,
                  onClick: () => {
                    setInjecting(agent);
                    setText("");
                  }
                }, t("inject"))
              ),
              h(
                "div",
                { className: "xz-devcard-mac", style: { lineHeight: 1.8 } },
                (agent.devices || []).length === 0 ? t("agentNoDevices") : (agent.devices || []).map(
                  (device, index) => h(
                    "span",
                    { key: device.deviceId, style: { marginRight: 10, whiteSpace: "nowrap" } },
                    `${index + 1}. ${device.nickName || device.deviceId}${device.online ? " \u25CF" : ""}`
                  )
                )
              ),
              h(
                "div",
                { className: "xz-devcard-facts" },
                h(
                  "div",
                  null,
                  h("span", { className: "xz-devcard-label" }, t("voice")),
                  h("span", {
                    className: "xz-devcard-value",
                    title: agent.overrides?.voice || ""
                  }, agent.overrides?.voice ? voiceLabel(agent.overrides?.voice, state.voice?.tts?.provider) : t("voiceDefault"))
                ),
                h(
                  "div",
                  null,
                  h("span", { className: "xz-devcard-label" }, t("agentDevices")),
                  h("span", { className: "xz-devcard-value" }, t("agentDeviceCount").replace("{n}", String(agent.deviceCount ?? 0)))
                ),
                h(
                  "div",
                  null,
                  h("span", { className: "xz-devcard-label" }, t("lastSeen")),
                  h("span", { className: "xz-devcard-value" }, formatAgo(agent.lastSeenAt))
                )
              ),
              h(
                "div",
                { className: "xz-devcard-foot" },
                h("button", { className: "xz-btn", onClick: () => openConfig(agent.id) }, t("configure")),
                h(
                  "button",
                  { className: "xz-btn", onClick: () => setManaging(agent.id) },
                  `${t("agentDevices")}(${agent.deviceCount ?? 0})`
                ),
                h("button", {
                  className: "xz-btn",
                  onClick: () => {
                    setConfiguring("");
                    setHistoryAgent(agent);
                  }
                }, t("history")),
                h("button", {
                  className: "xz-btn danger",
                  disabled: busyId === agent.id,
                  title: t("agentDeleteHint"),
                  onClick: () => removeAgent(agent)
                }, confirmDelete === agent.id ? t("agentDeleteConfirm") : t("remove"))
              )
            )
          )
        )
      ),
      injecting ? h(
        "div",
        { className: "xz-modal-mask", onClick: () => setInjecting(null) },
        h(
          "div",
          { className: "xz-modal xz-inject-modal", onClick: (event) => event.stopPropagation() },
          h("h3", null, `${t("injectTitle")} \xB7 ${injecting.name || t("unnamed")}`),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("injectText")),
            h("textarea", {
              className: "xz-textarea",
              value: text,
              maxLength: 500,
              autoFocus: true,
              onChange: (event) => setText(event.target.value)
            })
          ),
          h(
            "div",
            { className: "xz-row", style: { justifyContent: "flex-end" } },
            h("button", { className: "xz-btn", onClick: () => setInjecting(null) }, t("cancel")),
            h("button", { className: "xz-btn primary", disabled: !text.trim(), onClick: sendInject }, t("send"))
          )
        )
      ) : null,
      historyAgent ? h(HistoryDialog, { agent: historyAgent, onClose: () => setHistoryAgent(null) }) : null,
      configAgent ? h(AgentConfigDialog, {
        agent: configAgent,
        tools: toolCatalog,
        memory,
        memoryDraft,
        onMemoryDraft: setMemoryDraft,
        onAddMemory: () => addMemory(configAgent.id),
        onRemoveMemory: (index) => removeMemory(configAgent.id, index),
        onToggleTool: (tool) => toggleToolFor(configAgent.id, tool),
        onToggleMemory: () => toggleMemory(configAgent),
        onSaved: async () => {
          await onChanged();
        },
        onClose: () => setConfiguring("")
      }) : null,
      manageAgent ? h(AgentDevicesDialog, {
        agent: manageAgent,
        agents,
        devices,
        busyId,
        onBind: (device) => bindDevice(manageAgent, device),
        onUnbind: (device) => unbindDevice(manageAgent, device),
        onDeviceAction: (action, device, value) => deviceAction(action, device, value),
        onClose: () => setManaging("")
      }) : null
    );
  }

  // src/client/settings/ProviderSection.js
  function ProviderSection({
    stage,
    primary,
    entries,
    providersDirty,
    primaryTest,
    testingPrimary,
    testResults,
    testingId,
    confirmDelete,
    onEditPrimary,
    onAdd,
    onEdit,
    onMove,
    onDelete,
    onTest,
    onTestPrimary
  }) {
    const [openRow, setOpenRow] = useState2(null);
    const primaryKey = backupKeyState(stage, primary);
    const primaryTesting = testingPrimary === stage;
    const primaryProbe = stageDescriptor(primary.provider, stage)?.probe || { kind: "none" };
    const primaryTestDisabled = primaryProbe.kind === "none" || primaryTesting;
    const testLabel = providersDirty ? t("saveAndTest") : primaryProbe.labelKey ? t(primaryProbe.labelKey) : t("backupTest");
    const summaryKey = stage === "llm" ? t("model") : stage === "asr" ? t("asrUrl") : "";
    const fact = (key, value) => h(
      "div",
      { className: "xz-backup-fact" },
      h("span", { className: "k" }, key),
      h("span", { className: "v", title: value }, value)
    );
    return h(
      "div",
      { className: "xz-backup-section" },
      // ---------------------------------------------------------------- 主用：独占一行
      h(
        "div",
        { className: `xz-devcard xz-backup-card xz-primary-card${providersDirty ? " is-draft" : ""}` },
        h(
          "div",
          { className: "xz-devcard-head" },
          h("span", { className: "xz-chip primary" }, t("providerPrimary")),
          h(
            "div",
            { className: "xz-devcard-title" },
            h("strong", null, stageProviderLabel(stage, primary.provider)),
            providersDirty ? h("span", { className: "xz-chip mute", style: { marginLeft: 8 } }, t("backupDraft")) : null
          ),
          h("span", { className: `xz-dot ${primaryKey.ok ? "on" : ""}` })
        ),
        h(
          "div",
          { className: "xz-backup-facts" },
          summaryKey ? fact(summaryKey, backupSummaryText(stage, primary)) : null,
          fact(t("backupSecret"), primaryKey.text)
        ),
        primaryTest ? h("div", { className: "xz-backup-test" }, backupTestText(stage, primaryTest)) : null,
        h(
          "div",
          { className: "xz-backup-actions" },
          h("button", { type: "button", className: "xz-btn", onClick: onEditPrimary }, t("backupEdit")),
          primaryProbe.kind === "none" ? null : h("button", {
            type: "button",
            className: "xz-btn",
            disabled: primaryTestDisabled,
            title: testLabel,
            onClick: onTestPrimary
          }, primaryTesting ? t("backupTesting") : testLabel)
        )
      ),
      // ---------------------------------------------------------------- 备用：纵向列表
      h(
        "div",
        { className: "xz-provider-list" },
        entries.length === 0 ? h("p", { className: "xz-hint xz-provider-empty" }, t("backupEmpty")) : entries.map((entry, index) => {
          const cardKey = entry.id || `draft-${index}`;
          const keyState = backupKeyState(stage, entry);
          const result = entry.id ? testResults[entry.id] : null;
          const isTesting = Boolean(entry.id) && testingId === entry.id;
          const expanded = openRow === index;
          const probe = stageDescriptor(entry.provider, stage)?.probe || { kind: "none" };
          const testDisabled = probe.kind === "none" || isTesting;
          const rowTestLabel = providersDirty ? t("saveAndTest") : probe.labelKey ? t(probe.labelKey) : t("backupTest");
          const testTitle = probe.kind === "none" ? t("probeUnsupported") : rowTestLabel;
          const rowFacts = [
            summaryKey ? `${summaryKey}: ${backupSummaryText(stage, entry)}` : null,
            `${t("backupSecret")}: ${keyState.text}`,
            result ? backupTestText(stage, result) : null
          ].filter(Boolean);
          return h(
            "div",
            {
              key: cardKey,
              className: `xz-provider-row${entry.id ? "" : " is-draft"}${expanded ? " is-open" : ""}`
            },
            h(
              "div",
              { className: "xz-provider-row-main" },
              h(
                "div",
                { className: "xz-provider-row-title" },
                h("span", { className: "xz-devcard-ord" }, String(index + 1)),
                h("strong", null, stageProviderLabel(stage, entry.provider)),
                entry.id ? null : h("span", { className: "xz-chip mute" }, t("backupDraft")),
                h("span", { className: `xz-dot ${keyState.ok ? "on" : ""}` })
              ),
              h(
                "div",
                { className: "xz-provider-row-facts" },
                rowFacts.map((text, position) => h("span", { key: position }, text))
              )
            ),
            h(
              "div",
              { className: "xz-provider-row-actions" },
              h("button", { type: "button", className: "xz-btn", onClick: () => onEdit(index) }, t("backupEdit")),
              h("button", {
                type: "button",
                className: "xz-btn ghost xz-provider-more",
                "aria-expanded": expanded ? "true" : "false",
                "aria-label": t("backupActions"),
                title: t("backupActions"),
                onClick: () => setOpenRow(expanded ? null : index)
              }, "\u22EF")
            ),
            expanded ? h(
              "div",
              { className: "xz-provider-row-menu" },
              h("button", {
                type: "button",
                className: "xz-btn",
                disabled: index === 0,
                onClick: () => {
                  setOpenRow(null);
                  onMove(index, -1);
                }
              }, t("backupMoveUp")),
              h("button", {
                type: "button",
                className: "xz-btn",
                disabled: index === entries.length - 1,
                onClick: () => {
                  setOpenRow(null);
                  onMove(index, 1);
                }
              }, t("backupMoveDown")),
              h("button", {
                type: "button",
                className: "xz-btn",
                disabled: testDisabled,
                title: testTitle,
                onClick: () => {
                  setOpenRow(null);
                  onTest(index);
                }
              }, isTesting ? t("backupTesting") : rowTestLabel),
              h("button", {
                type: "button",
                className: `xz-btn danger${confirmDelete === cardKey ? " confirm" : ""}`,
                onClick: () => {
                  if (confirmDelete === cardKey) setOpenRow(null);
                  onDelete(index, cardKey);
                }
              }, confirmDelete === cardKey ? t("backupDeleteConfirm") : t("remove"))
            ) : null
          );
        })
      ),
      // ---------------------------------------------------------------- 添加：列表底部一整行
      h(
        "button",
        { type: "button", className: "xz-backup-add-row", onClick: onAdd },
        h("span", { "aria-hidden": "true", style: { fontSize: 16, lineHeight: 1 } }, "+"),
        t("backupAdd")
      )
    );
  }

  // src/client/settings/ModelField.js
  function ModelField({
    kind,
    provider,
    source = "primary",
    index,
    value,
    onChange,
    placeholder,
    baseUrl,
    probeKey
  }) {
    const [options, setOptions] = useState2([]);
    useEffect2(() => {
      let alive = true;
      setOptions([]);
      const rawKey = typeof probeKey === "string" ? probeKey.trim() : "";
      const unsavedKey = rawKey && !rawKey.includes("\u2022") && rawKey.length >= 8 ? rawKey : "";
      const timer = setTimeout(() => {
        const request = unsavedKey ? fetch("dsh-xiaozhi-7c3a/models", {
          method: "POST",
          headers: { "content-type": "application/json", "x-dsh-xiaozhi": "1" },
          body: JSON.stringify({ kind, provider, baseUrl: baseUrl || "", apiKey: unsavedKey })
        }) : fetch(
          `dsh-xiaozhi-7c3a/models?kind=${encodeURIComponent(kind)}&provider=${encodeURIComponent(provider || "")}&source=${encodeURIComponent(source)}${Number.isInteger(index) ? `&index=${index}` : ""}`
        );
        request.then((response) => response.ok ? response.json() : null).then((data) => {
          if (alive && Array.isArray(data?.options)) setOptions(data.options);
        }).catch(() => {
        });
      }, unsavedKey ? 600 : 0);
      return () => {
        alive = false;
        clearTimeout(timer);
      };
    }, [kind, provider, source, index, baseUrl, probeKey]);
    if (options.length === 0) {
      return h("input", { className: "xz-input", value, placeholder, onChange: (e) => onChange(e.target.value) });
    }
    const text = typeof value === "string" ? value : "";
    const merged = text.trim() && !options.some((option) => option.value === value) ? [{ value, label: text }, ...options] : options;
    return h(PillSelect, {
      value,
      options: merged,
      ariaLabel: placeholder,
      placeholder,
      onChange
    });
  }

  // src/client/settings/SchemaForm.js
  var isMasked = (value) => typeof value === "string" && value.includes("\u2022");
  var FIELD_RENDERERS = {
    text: (field, value, onChange) => h("input", {
      className: "xz-input",
      value: value ?? "",
      placeholder: field.placeholder || "",
      onChange: (event) => onChange(event.target.value)
    }),
    url: (field, value, onChange) => h("input", {
      className: "xz-input",
      type: "url",
      value: value ?? "",
      placeholder: field.placeholder || "",
      onChange: (event) => onChange(event.target.value)
    }),
    number: (field, value, onChange) => h("input", {
      className: "xz-input",
      type: "number",
      min: field.min,
      max: field.max,
      step: field.step,
      value: value ?? "",
      onChange: (event) => onChange(event.target.value)
    }),
    checkbox: (field, value, onChange) => h("input", {
      type: "checkbox",
      checked: Boolean(value),
      onChange: (event) => onChange(event.target.checked)
    }),
    secret: (field, value, onChange) => h("input", {
      className: "xz-input",
      type: "password",
      autoComplete: "new-password",
      value: value || "",
      // 掩码是占位符不是密钥：回显时清空输入框，提示「留空 = 保留」。
      placeholder: isMasked(value) ? "" : t("tokenKeep"),
      onChange: (event) => onChange(event.target.value)
    }),
    select: (field, value, onChange) => h(PillSelect, {
      value: value ?? "",
      options: field.options || [],
      ariaLabel: t(field.label),
      onChange
    }),
    model: (field, value, onChange, context) => h(ModelField, {
      kind: field.modelKind || "llm",
      provider: context.provider,
      source: context.mode === "primary" ? "primary" : "backup",
      index: context.mode === "primary" ? void 0 : Number.isInteger(context.index) ? context.index : void 0,
      value: value || "",
      // 空值时给一个厂商常见的模型名做占位（描述符的 modelHint），比「未选择」有信息量；
      // 真正选过/存过的值由 ModelField 自己回显，不靠占位。
      placeholder: field.placeholderKey ? context.modelHint || t(field.placeholderKey) : field.placeholder || "",
      baseUrl: context.draft.baseUrl || context.baseUrlHint || "",
      probeKey: context.draft.apiKey || "",
      onChange
    })
  };
  function secretNote(field, draft) {
    if (field.note) return t(field.note);
    if (isMasked(draft[field.key]) || draft.hasApiKey || draft.hasApiSecret) return t("apiKeyKeep");
    return t("backupKeyHint");
  }
  function SchemaForm({ stage, provider, mode, index, fields, value, onChange, baseUrlHint, modelHint }) {
    const context = { stage, provider, mode, index, draft: value, baseUrlHint, modelHint };
    return h(
      "div",
      { className: "xz-grid xz-dialog-grid" },
      (fields || []).map((field, position) => {
        if (field.showWhen && value[field.showWhen.key] !== field.showWhen.equals) return null;
        if (field.primaryOnly && context.mode !== "primary") return null;
        const render = FIELD_RENDERERS[field.type] || FIELD_RENDERERS.text;
        const note = field.type === "secret" ? secretNote(field, value) : field.note ? t(field.note) : "";
        return h(
          "div",
          { key: field.key || `field-${position}`, className: "xz-field" },
          h(
            "label",
            null,
            t(field.label),
            field.required ? h("span", { className: "xz-required", "aria-hidden": "true" }, " *") : null
          ),
          render(field, value[field.key], (next) => onChange({ ...value, [field.key]: next }), context),
          note ? h("span", { className: "note" }, note) : null
        );
      })
    );
  }

  // src/client/settings/ProviderDialog.js
  function ProviderDialog({ stage, mode = "backup", index = null, draft, isNew, onDraft, onConfirm, onCancel }) {
    useEffect2(() => {
      const onKeyDown = (event) => {
        if (event.key === "Escape") onCancel();
      };
      document.addEventListener("keydown", onKeyDown, true);
      return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [onCancel]);
    const provider = draft.provider || stageProviders(stage)[0];
    const desc = stageDescriptor(provider, stage);
    const fields = (desc?.fields || []).filter(
      (field) => !(mode === "backup" && stage === "llm" && field.key === "model" && desc?.modelHint)
    );
    const switchProvider = (nextProvider) => {
      if (nextProvider === provider) return;
      const next = { ...blankBackup(stage, nextProvider), providerChanged: true };
      if (mode === "backup" && stage === "llm") {
        next.model = stageDescriptor(nextProvider, stage)?.modelHint || "";
      }
      onDraft(next);
    };
    const title = isNew ? `${t("backupAddTitle")} \xB7 ${stageLabel(stage)}` : mode === "primary" ? `${t("providerEditPrimary")} \xB7 ${stageLabel(stage)}` : `${t("backupEditTitle")} \xB7 ${stageLabel(stage)}`;
    return h(
      "div",
      { className: "xz-modal-mask", onClick: onCancel },
      h(
        "div",
        { className: "xz-modal xz-modal-lg", onClick: (event) => event.stopPropagation() },
        h(
          "div",
          { className: "xz-modal-head" },
          h("h3", null, title)
        ),
        // 固定高度的表单区：换厂商时字段数量会变（Edge 0 个、火山 1 个、讯飞 3 个），
        // 这里用固定外框撑住，弹窗不会再跟着下拉选择忽长忽短。
        h(
          "div",
          { className: "xz-modal-body" },
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("provider")),
            h(PillSelect, {
              value: provider,
              ariaLabel: t("provider"),
              options: providerOptionsFor(stage),
              onChange: switchProvider
            })
          ),
          h("p", { className: "xz-hint", style: { margin: "0 0 10px" } }, t("requiredHint")),
          desc ? h(SchemaForm, {
            stage,
            provider,
            mode,
            index,
            fields,
            value: draft,
            onChange: onDraft,
            baseUrlHint: desc.baseUrlHint || "",
            modelHint: desc.modelHint || ""
          }) : h("div", { className: "xz-empty" }, t("providerUnsupported")),
          desc?.note ? h("div", { className: "note" }, t(desc.note)) : null
        ),
        h(
          "div",
          { className: "xz-row xz-modal-foot", style: { justifyContent: "flex-end" } },
          h("button", { type: "button", className: "xz-btn", onClick: onCancel }, t("cancel")),
          h("button", { type: "button", className: "xz-btn primary", onClick: onConfirm }, t("save"))
        )
      )
    );
  }

  // src/client/settings/ConfigWizard.js
  var STAGES = ["asr", "llm", "tts"];
  var STEP_KEY = { asr: "step3", llm: "step4", tts: "step5" };
  var DESC_KEY = { asr: "configStageAsrDesc", llm: "configStageLlmDesc", tts: "configStageTtsDesc" };
  var ICON_TEXT = { asr: "A", llm: "L", tts: "T" };
  function ConfigWizard({ state, notify }) {
    const [settings, setSettings] = useState2(null);
    const [defaults, setDefaults] = useState2({ systemPrompt: "", silenceMs: null });
    const [error, setError] = useState2("");
    const [saving, setSaving] = useState2(false);
    const [openStage, setOpenStage] = useState2(null);
    const [editor, setEditor] = useState2(null);
    const [testResults, setTestResults] = useState2({});
    const [testingId, setTestingId] = useState2("");
    const [confirmDelete, setConfirmDelete] = useState2("");
    const [providersDirty, setProvidersDirty] = useState2(false);
    const [primaryTests, setPrimaryTests] = useState2({});
    const [testingPrimary, setTestingPrimary] = useState2("");
    const [primaryClear, setPrimaryClear] = useState2({});
    const [autoSaveError, setAutoSaveError] = useState2("");
    const settingsRef = useRef2(null);
    const primaryClearRef = useRef2({});
    const applyingServerRef = useRef2(true);
    const revisionRef = useRef2(0);
    const saveTimerRef = useRef2(null);
    const saveRef = useRef2(null);
    const saveChainRef = useRef2(Promise.resolve());
    const mountedRef = useRef2(true);
    primaryClearRef.current = primaryClear;
    useEffect2(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);
    useEffect2(() => {
      callApi("/settings").then((data) => {
        applyingServerRef.current = true;
        setSettings(withBackups(data.settings));
        if (data.defaults) setDefaults(data.defaults);
      }).catch((err) => setError(err.message));
    }, []);
    useEffect2(() => {
      if (!settings) return;
      if (applyingServerRef.current) {
        applyingServerRef.current = false;
        return;
      }
      revisionRef.current += 1;
      setProvidersDirty(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveRef.current?.({ auto: true });
      }, 700);
      return () => {
        if (!saveTimerRef.current) return;
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (!mountedRef.current) void saveRef.current?.({ auto: true });
      };
    }, [settings]);
    if (!settings) return h("div", { className: "xz-empty" }, error || "\u2026");
    settingsRef.current = settings;
    const patch = (group, values) => setSettings({ ...settings, [group]: { ...settings[group], ...values } });
    const nested = (group, key, values) => setSettings({ ...settings, [group]: { ...settings[group], [key]: { ...settings[group][key], ...values } } });
    const backupsOf = (stage) => {
      const list = settings.voice?.[stage]?.backups || [];
      return Array.isArray(list) ? list : [];
    };
    const stageDetail = (stage) => {
      const primary = settings.voice?.[stage] || {};
      if (stage === "llm") return primary.model || "";
      if (stage === "tts") return "";
      return primary.url || primary.resourceId || "";
    };
    const stageChain = (stage) => {
      const list = [settings.voice?.[stage]?.provider, ...backupsOf(stage).map((entry) => entry.provider)].filter(Boolean);
      if (list.length <= 1) return "";
      return list.map((provider) => stageProviderLabel(stage, provider)).join(" \u2192 ");
    };
    const stageHealth = (stage) => {
      if (providersDirty) return { kind: "warn", text: t("stageHealthDirty") };
      const key = backupKeyState(stage, settings.voice?.[stage] || {});
      return key.ok ? { kind: "ok", text: t("stageHealthOk") } : { kind: "warn", text: t("stageHealthWarn") };
    };
    const providerSectionProps = (stage) => ({
      stage,
      primary: settings.voice?.[stage] || {},
      entries: backupsOf(stage),
      providersDirty,
      primaryTest: primaryTests[stage],
      testingPrimary,
      testResults,
      testingId,
      confirmDelete,
      onEditPrimary: () => openEditPrimary(stage),
      onAdd: () => openAddBackup(stage),
      onEdit: (index) => openEditBackup(stage, index),
      onMove: (index, delta) => moveBackup(stage, index, delta),
      onDelete: (index, key) => removeBackup(stage, index, key),
      onTest: (index) => runBackupTest(stage, index),
      onTestPrimary: () => runPrimaryTest(stage)
    });
    const setBackups = (stage, next) => {
      setProvidersDirty(true);
      setSettings((previous) => withBackups({
        ...previous,
        voice: {
          ...previous.voice,
          [stage]: { ...previous.voice?.[stage], backups: next }
        }
      }));
    };
    const openAddBackup = (stage) => {
      const provider = stageProviders(stage)[0];
      const draft = blankBackup(stage, provider);
      if (stage === "llm") draft.model = stageDescriptor(provider, stage)?.modelHint || "";
      setEditor({ stage, mode: "backup", index: null, draft });
    };
    const openEditBackup = (stage, index) => {
      const entry = backupsOf(stage)[index];
      if (!entry) return;
      const draft = { ...blankBackup(stage, entry.provider || ""), ...entry };
      if (stage === "llm" && !draft.model) {
        draft.model = stageDescriptor(entry.provider || "", stage)?.modelHint || "";
      }
      setEditor({ stage, mode: "backup", index, draft });
    };
    const openEditPrimary = (stage) => {
      const current = settings.voice?.[stage] || {};
      const provider = current.provider || stageProviders(stage)[0];
      setEditor({ stage, mode: "primary", index: null, draft: { ...blankBackup(stage, provider), ...current, providerChanged: false } });
    };
    const commitEditor = () => {
      if (!editor) return;
      const { stage, mode, index, draft } = editor;
      const next = { ...draft };
      if (!next.provider) next.provider = stageProviders(stage)[0];
      const missing = (stageDescriptor(next.provider, stage)?.fields || []).filter((field) => field.required).filter((field) => {
        const value = next[field.key];
        return !(typeof value === "string" ? value.trim() : value);
      });
      if (missing.length) {
        notify(`${t("requiredFields")}\uFF1A${missing.map((field) => t(field.label)).join("\u3001")}`, "bad");
        return;
      }
      setProvidersDirty(true);
      if (mode === "primary") {
        const stageSettings = { ...settings.voice?.[stage] || {} };
        for (const key of primaryEditFields(stage)) stageSettings[key] = next[key] ?? "";
        stageSettings.provider = next.provider;
        if (stage === "tts") {
          stageSettings.voice = "";
          stageSettings.model = "";
          stageSettings.resourceId = "";
        }
        stageSettings.hasApiKey = Boolean(next.apiKey);
        stageSettings.hasApiSecret = Boolean(next.apiSecret);
        setPrimaryClear((previous) => ({
          ...previous,
          [stage]: {
            apiKey: next.providerChanged === true && !next.apiKey,
            apiSecret: next.providerChanged === true && !next.apiSecret
          }
        }));
        setSettings((previous) => withBackups({
          ...previous,
          voice: { ...previous.voice, [stage]: stageSettings }
        }));
      } else {
        const list = [...backupsOf(stage)];
        if (index === null) list.push(next);
        else list[index] = { ...list[index], ...next };
        setBackups(stage, list);
      }
      setEditor(null);
    };
    const moveBackup = (stage, index, delta) => {
      const list = [...backupsOf(stage)];
      const target = index + delta;
      if (target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
      setBackups(stage, list);
    };
    const removeBackup = (stage, index, cardKey) => {
      if (confirmDelete !== cardKey) {
        setConfirmDelete(cardKey);
        window.setTimeout(() => {
          setConfirmDelete((current) => current === cardKey ? "" : current);
        }, 4e3);
        return;
      }
      setConfirmDelete("");
      setBackups(stage, backupsOf(stage).filter((_, position) => position !== index));
    };
    const runBackupTest = async (stage, index) => {
      const providerId = backupsOf(stage)[index]?.provider;
      if (stageDescriptor(providerId, stage)?.probe?.kind === "none") {
        notify(t("probeUnsupported"), "bad");
        return;
      }
      let current = settings;
      if (providersDirty) {
        current = await save();
        if (!current) return;
      }
      const entry = (current.voice?.[stage]?.backups || [])[index];
      if (!entry?.id) {
        notify(t("backupSaveFirst"), "bad");
        return;
      }
      setTestingId(entry.id);
      try {
        const result = await callApi("/test/provider", {
          method: "POST",
          body: { kind: stage, source: "backup", index }
        });
        setTestResults((previous) => ({ ...previous, [entry.id]: result }));
        notify(
          result.ok ? `${t("backupTestOk")} \xB7 ${backupTestText(stage, result)}` : String(result.error || t("backupTestFail")),
          result.ok ? "ok" : "bad"
        );
      } catch (err) {
        notify(`${t("actionFailed")}${err.message}`, "bad");
      } finally {
        setTestingId("");
      }
    };
    const runPrimaryTest = async (stage) => {
      if (stageDescriptor(settings.voice?.[stage]?.provider, stage)?.probe?.kind === "none") {
        notify(t("probeUnsupported"), "bad");
        return;
      }
      if (providersDirty) {
        const saved = await save();
        if (!saved) return;
      }
      setTestingPrimary(stage);
      try {
        const result = stage === "llm" ? await callApi("/test/llm", { method: "POST" }) : await callApi("/test/provider", { method: "POST", body: { kind: stage, source: "primary" } });
        setPrimaryTests((previous) => ({ ...previous, [stage]: result }));
        notify(
          result.ok ? `${t("backupTestOk")} \xB7 ${backupTestText(stage, result)}` : String(result.error || t("backupTestFail")),
          result.ok ? "ok" : "bad"
        );
      } catch (err) {
        notify(`${t("actionFailed")}${err.message}`, "bad");
      } finally {
        setTestingPrimary("");
      }
    };
    const buildSettingsBody = (snapshot) => {
      const secret2 = (value) => typeof value === "string" && value.includes("\u2022") ? "" : value || "";
      const backupsOfSnapshot = (stage) => {
        const list = snapshot.voice?.[stage]?.backups || [];
        return Array.isArray(list) ? list : [];
      };
      const backupBody = (stage) => backupsOfSnapshot(stage).map((entry) => {
        const base = { provider: entry.provider };
        if (entry.id) base.id = entry.id;
        if (stage === "llm") {
          return {
            ...base,
            model: entry.model || "",
            baseUrl: entry.baseUrl || "",
            appId: entry.appId || "",
            apiKey: secret2(entry.apiKey)
          };
        }
        if (stage === "tts") {
          return {
            ...base,
            appId: entry.appId || "",
            apiKey: secret2(entry.apiKey),
            apiSecret: secret2(entry.apiSecret)
          };
        }
        return {
          ...base,
          url: entry.url || "",
          language: entry.language || "",
          accent: entry.accent || "",
          resourceId: entry.resourceId || "",
          appId: entry.appId || "",
          apiKey: secret2(entry.apiKey),
          apiSecret: secret2(entry.apiSecret)
        };
      });
      const clearFlags = (stage) => {
        const flags = primaryClearRef.current[stage] || {};
        const apiKey = snapshot.voice[stage]?.apiKey;
        const apiSecret = snapshot.voice[stage]?.apiSecret;
        const out = {};
        if (flags.apiKey && !apiKey) out.clearApiKey = true;
        if (flags.apiSecret && !apiSecret) out.clearApiSecret = true;
        return out;
      };
      return {
        endpoints: {
          lanWsUrl: snapshot.endpoints.lanWsUrl,
          wanWsUrl: snapshot.endpoints.wanWsUrl,
          token: secret2(snapshot.endpoints.token)
        },
        firmware: snapshot.firmware,
        gateway: {
          token: secret2(snapshot.gateway.token)
        },
        voice: {
          // 全局人设编辑已删除（人设只在「智能体 → 配置 → 角色」按智能体配置）；
          // 这里把 GET 回来的原值原样传回，绝不能写成空串/undefined 把已存人设清掉。
          systemPrompt: snapshot.voice.systemPrompt,
          silenceMs: snapshot.voice.silenceMs,
          llm: {
            provider: snapshot.voice.llm.provider,
            model: snapshot.voice.llm.model,
            baseUrl: snapshot.voice.llm.baseUrl,
            appId: snapshot.voice.llm.appId,
            apiKey: secret2(snapshot.voice.llm.apiKey),
            maxTokens: snapshot.voice.llm.maxTokens,
            ...clearFlags("llm"),
            backups: backupBody("llm")
          },
          tts: {
            provider: snapshot.voice.tts.provider,
            // 音色/模型/资源下放到智能体级：全局显式清空（服务端按厂商默认音色兜底）。
            voice: "",
            model: "",
            resourceId: "",
            rate: snapshot.voice.tts.rate,
            speed: snapshot.voice.tts.speed,
            // url 不在界面展示，但原值要原样传回，避免把用户手填的自建端点清掉。
            url: snapshot.voice.tts.url,
            language: snapshot.voice.tts.language,
            appId: snapshot.voice.tts.appId,
            apiKey: secret2(snapshot.voice.tts.apiKey),
            apiSecret: secret2(snapshot.voice.tts.apiSecret),
            ...clearFlags("tts"),
            backups: backupBody("tts")
          },
          asr: {
            provider: snapshot.voice.asr.provider,
            url: snapshot.voice.asr.url,
            language: snapshot.voice.asr.language,
            accent: snapshot.voice.asr.accent,
            resourceId: snapshot.voice.asr.resourceId,
            appId: snapshot.voice.asr.appId,
            apiKey: secret2(snapshot.voice.asr.apiKey),
            apiSecret: secret2(snapshot.voice.asr.apiSecret),
            ...clearFlags("asr"),
            backups: backupBody("asr")
          }
        }
      };
    };
    const doSave = async ({ auto = false } = {}) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const snapshot = settingsRef.current;
      if (!snapshot) return null;
      const revision = revisionRef.current;
      setSaving(true);
      setAutoSaveError("");
      try {
        const result = await callApi("/settings", { method: "POST", body: buildSettingsBody(snapshot) });
        const changedDuringSave = revisionRef.current !== revision;
        if (!changedDuringSave) {
          applyingServerRef.current = true;
          setSettings(withBackups(result.settings));
          setProvidersDirty(false);
          setPrimaryClear({});
          setConfirmDelete("");
        }
        if (result.defaults) setDefaults(result.defaults);
        if (!auto && !changedDuringSave) notify(t("saved"));
        return withBackups(result.settings);
      } catch (err) {
        setAutoSaveError(err.message);
        setProvidersDirty(true);
        if (!auto) notify(`${t("actionFailed")}${err.message}`, "bad");
        return null;
      } finally {
        setSaving(false);
      }
    };
    const save = (options = {}) => {
      const run = () => doSave(options);
      const next = saveChainRef.current.then(run, run);
      saveChainRef.current = next.catch(() => {
      });
      return next;
    };
    saveRef.current = save;
    const stageCard = (stage) => {
      const primary = settings.voice?.[stage] || {};
      const health = stageHealth(stage);
      const backups = backupsOf(stage);
      const detail = stageDetail(stage);
      const chain = stageChain(stage);
      const key = backupKeyState(stage, primary);
      return h(
        "button",
        {
          key: stage,
          type: "button",
          className: `xz-stage-card${health.kind === "warn" ? " is-warn" : ""}`,
          onClick: () => setOpenStage(stage)
        },
        h(
          "div",
          { className: "xz-stage-card-head" },
          h("div", { className: "xz-stage-icon", "aria-hidden": "true" }, ICON_TEXT[stage]),
          h(
            "div",
            { className: "xz-stage-card-heading" },
            h("strong", null, t(STEP_KEY[stage])),
            h("span", { className: "xz-stage-card-desc" }, t(DESC_KEY[stage]))
          ),
          h("span", { className: `xz-dot ${health.kind === "ok" ? "on" : ""}` })
        ),
        h(
          "div",
          { className: "xz-stage-card-primary" },
          h("strong", null, stageProviderLabel(stage, primary.provider)),
          detail ? h("span", { className: "xz-stage-card-detail", title: detail }, detail) : null
        ),
        h(
          "div",
          { className: "xz-stage-card-facts" },
          h("span", null, `${t("backupSecret")}: ${key.text}`),
          h("span", null, t("configBackupCount").replace("{n}", String(backups.length))),
          chain ? h("span", { className: "xz-stage-card-chain", title: chain }, `${t("backupChain")}: ${chain}`) : null
        ),
        h(
          "div",
          { className: "xz-stage-card-foot" },
          h("span", { className: `xz-stage-card-health ${health.kind}` }, health.text),
          h("span", { className: "xz-stage-card-manage" }, `${t("stageManage")} \u203A`)
        )
      );
    };
    const stageModal = openStage ? h(
      "div",
      { className: "xz-modal-mask", onClick: () => setOpenStage(null) },
      h(
        "div",
        {
          className: "xz-modal xz-stage-modal",
          role: "dialog",
          "aria-modal": "true",
          onClick: (event) => event.stopPropagation()
        },
        h(
          "div",
          { className: "xz-modal-head" },
          h(
            "div",
            { className: "xz-row", style: { gap: 10, alignItems: "center" } },
            h("button", { type: "button", className: "xz-btn ghost", onClick: () => setOpenStage(null) }, "\u2039 " + t("back")),
            h("h3", { style: { margin: 0 } }, t(STEP_KEY[openStage])),
            h("span", { className: `xz-dot ${stageHealth(openStage).kind === "ok" ? "on" : ""}` }),
            h("span", { className: "xz-hint", style: { margin: 0 } }, stageHealth(openStage).text)
          ),
          h("p", { className: "xz-hint", style: { margin: "6px 0 0" } }, t(DESC_KEY[openStage]))
        ),
        h(
          "div",
          { className: "xz-modal-body" },
          h(ProviderSection, providerSectionProps(openStage)),
          openStage === "tts" ? h("p", { className: "xz-hint", style: { margin: "10px 0 0" } }, t("ttsVoicePerDevice")) : null
        ),
        h(
          "div",
          { className: "xz-modal-foot" },
          h(
            "span",
            { className: "xz-hint", style: { marginRight: "auto" } },
            saving ? t("autoSaving") : t("autoSaved")
          ),
          h("button", { type: "button", className: "xz-btn", onClick: () => setOpenStage(null) }, t("close"))
        )
      )
    ) : null;
    return h(
      "div",
      { className: "xz-config-page" },
      // ---------------------------------------------------------------- 服务商（概览卡）
      h(
        "div",
        { className: "xz-card" },
        h("h3", null, t("configProvidersTitle")),
        h("div", { className: "xz-stage-cards" }, STAGES.map(stageCard)),
        providersDirty ? h("p", { className: "xz-hint", style: { margin: "10px 0 0" } }, t("stageHealthDirty")) : null
      ),
      // ---------------------------------------------------------------- 语音默认参数
      h(
        "div",
        { className: "xz-card" },
        h("h3", null, t("configVoiceTitle")),
        h(
          "div",
          { className: "xz-grid" },
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("silence")),
            h("input", {
              className: "xz-input",
              type: "number",
              min: 100,
              max: 3e3,
              step: 50,
              value: settings.voice.silenceMs ?? "",
              placeholder: String(defaults.silenceMs ?? 400),
              onChange: (e) => patch("voice", { silenceMs: e.target.value === "" ? null : Number(e.target.value) })
            }),
            h(
              "span",
              { className: "note" },
              settings.voice.silenceMs == null ? `${t("inheritHint")}\uFF08${defaults.silenceMs ?? 400} ms\uFF09` : `${defaults.silenceMs ?? 400} ms`
            )
          ),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("replyMaxTokens")),
            h("input", {
              className: "xz-input",
              type: "number",
              min: 32,
              max: 2048,
              step: 8,
              value: settings.voice.llm.maxTokens ?? "",
              placeholder: "120",
              onChange: (e) => {
                const raw = e.target.value.trim();
                nested("voice", "llm", { maxTokens: raw === "" ? null : Number(raw) });
              }
            }),
            h("span", { className: "note" }, t("replyMaxTokensHint"))
          ),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("replySpeed")),
            h("input", {
              className: "xz-input",
              type: "number",
              min: 0.5,
              max: 2,
              step: 0.05,
              value: settings.voice.tts.speed,
              placeholder: "1",
              onChange: (e) => nested("voice", "tts", { speed: e.target.value })
            }),
            h("span", { className: "note" }, settings.voice.tts.speed ? "" : `${t("inheritHint")}\uFF081\uFF09`)
          )
        )
      ),
      // ---------------------------------------------------------------- 接入与网关（默认折叠）
      h(
        "details",
        { className: "xz-card xz-config-access" },
        h("summary", null, t("configAccessTitle")),
        h(
          "div",
          { className: "xz-grid" },
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("lanWsUrl")),
            h("input", { className: "xz-input", value: settings.endpoints.lanWsUrl, placeholder: "ws://192.168.1.10:8989/xiaozhi/v1/", onChange: (e) => patch("endpoints", { lanWsUrl: e.target.value }) })
          ),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("wanWsUrl")),
            h("input", { className: "xz-input", value: settings.endpoints.wanWsUrl, placeholder: "wss://example.com/xiaozhi/v1/", onChange: (e) => patch("endpoints", { wanWsUrl: e.target.value }) })
          ),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("otaToken")),
            h("input", { className: "xz-input", type: "password", value: settings.endpoints.token, placeholder: t("tokenKeep"), onChange: (e) => patch("endpoints", { token: e.target.value }) }),
            h("span", { className: "note" }, settings.endpoints.hasToken ? t("apiKeyKeep") : t("tokenKeep"))
          ),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("firmwareVersion")),
            h("input", { className: "xz-input", value: settings.firmware.version, onChange: (e) => patch("firmware", { version: e.target.value }) })
          ),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("firmwareUrl")),
            h("input", { className: "xz-input", value: settings.firmware.url, onChange: (e) => patch("firmware", { url: e.target.value }) })
          ),
          h(
            "div",
            { className: "xz-field" },
            h("label", null, t("gatewayToken")),
            h("input", { className: "xz-input", type: "password", value: settings.gateway.token, placeholder: t("tokenKeep"), onChange: (e) => patch("gateway", { token: e.target.value }) })
          )
        ),
        h(
          "label",
          { className: "xz-row", style: { fontSize: 12, color: "var(--xz-text-2)", marginTop: 4 } },
          h("input", { type: "checkbox", checked: settings.firmware.force, onChange: (e) => patch("firmware", { force: e.target.checked }) }),
          t("forceUpdate")
        )
      ),
      // ---------------------------------------------------------------- 底部：自动保存状态
      // 2026-11-08 起不再有「保存配置」按钮：改动防抖后自动落盘，这里只显示状态。
      h(
        "div",
        { className: "xz-config-footer" },
        h(
          "span",
          { className: "xz-hint" },
          autoSaveError ? `${t("autoSaveFailed")}\uFF1A${autoSaveError}` : saving ? t("autoSaving") : providersDirty ? t("autoSavePending") : t("autoSaved")
        ),
        h("span", { className: "xz-hint" }, t("configSaveHint")),
        autoSaveError ? h("button", { type: "button", className: "xz-btn", onClick: () => save() }, t("retry")) : null
      ),
      // 服务商编辑弹窗（主用/备用共用）：确定只改本地状态，关闭后由防抖自动保存落盘。
      // 放在 stageModal 之后渲染：两者都是 z-index 40 的 fixed 遮罩，后挂的在上面。
      stageModal,
      editor ? h(ProviderDialog, {
        stage: editor.stage,
        mode: editor.mode,
        index: editor.index,
        draft: editor.draft,
        isNew: editor.index === null,
        onDraft: (draft) => setEditor({ ...editor, draft }),
        onConfirm: commitEditor,
        onCancel: () => setEditor(null)
      }) : null
    );
  }

  // src/client/console/Console.js
  function Console({ state, refresh, notify }) {
    const [view, setView] = useState2("overview");
    const appRef = useRef2(null);
    useEffect2(() => {
      const node = appRef.current;
      if (!node) return void 0;
      const apply2 = () => {
        const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
        if (!viewport) return;
        const top = Math.max(0, Math.round(node.getBoundingClientRect().top || 0));
        node.style.height = `${Math.max(320, viewport - top)}px`;
      };
      apply2();
      const raf = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(apply2) : 0;
      const onScroll = () => apply2();
      window.addEventListener("resize", apply2);
      window.addEventListener("scroll", onScroll, true);
      return () => {
        window.removeEventListener("resize", apply2);
        window.removeEventListener("scroll", onScroll, true);
        if (raf) window.cancelAnimationFrame(raf);
      };
    }, [view]);
    const nav = [
      { id: "overview", label: t("navOverview"), icon: "overview" },
      { id: "agents", label: t("navDevices"), icon: "devices" },
      { id: "config", label: t("navGlobal"), icon: "config" }
    ];
    const content = view === "agents" ? h(AgentsView, { state, notify, onChanged: refresh }) : view === "config" ? h(ConfigWizard, { state, notify }) : h(Dashboard, { state, notify });
    const title = view === "agents" ? t("devicesTitle") : view === "config" ? t("navGlobal") : t("overview");
    return h(
      "div",
      { className: "xz-app", ref: appRef },
      h(
        "aside",
        { className: "xz-side" },
        h(
          "div",
          { className: "xz-brand" },
          h("div", { className: "xz-brand-mark" }, h(Icon, { name: "devices", size: 18 })),
          h(
            "div",
            null,
            h("div", { className: "xz-brand-title" }, t("brand")),
            h(
              "div",
              { className: "xz-brand-sub" },
              `${state.endpoints?.lanIp || state.listener?.host}:${state.listener?.port}`
            )
          )
        ),
        h(
          "nav",
          { className: "xz-nav" },
          nav.map(
            (item) => h("button", {
              key: item.id,
              className: `xz-nav-item ${view === item.id ? "active" : ""}`,
              onClick: () => setView(item.id)
            }, h(Icon, { name: item.icon }), item.label)
          )
        )
      ),
      h(
        "main",
        { className: "xz-main" },
        h(
          "div",
          { className: "xz-header" },
          h(
            "div",
            null,
            h("h1", { className: "xz-h1" }, title)
          ),
          h("div", { className: "xz-spacer" }),
          h("button", { className: "xz-btn", onClick: refresh }, "\u21BB")
        ),
        h("div", { className: "xz-content" }, content)
      ),
      h(
        "div",
        { className: "xz-tabbar" },
        nav.map(
          (item) => h("button", {
            key: item.id,
            className: view === item.id ? "active" : "",
            onClick: () => setView(item.id)
          }, h(Icon, { name: item.icon, size: 18 }), item.label)
        )
      )
    );
  }

  // src/client/console/XiaozhiPanel.js
  function XiaozhiPanel() {
    const [state, setState] = useState2({ status: "loading", data: null, error: "" });
    const [toast, setToast] = useState2(null);
    const mounted = useRef2(true);
    const notify = useCallback2((message, kind = "ok") => {
      setToast({ message, kind });
      window.setTimeout(() => setToast(null), 2600);
    }, []);
    const refresh = useCallback2(async () => {
      try {
        const data = await callApi("/state");
        if (!mounted.current) return;
        setState({ status: "ready", data, error: "" });
      } catch (error) {
        if (!mounted.current) return;
        setState((previous) => ({ ...previous, status: "ready", error: error.message }));
      }
    }, []);
    useEffect2(() => {
      mounted.current = true;
      void refresh();
      const timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, POLL_MS);
      return () => {
        mounted.current = false;
        window.clearInterval(timer);
      };
    }, [refresh]);
    if (state.status === "loading") {
      return h("div", {
        style: {
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--xz-text-3)",
          fontSize: 13
        }
      }, "\u2026");
    }
    return h(
      "div",
      { style: { width: "100%" } },
      h(Console, { state: state.data, refresh, notify }),
      toast ? h("div", { className: `xz-toast ${toast.kind === "bad" ? "bad" : ""}` }, toast.message) : null
    );
  }

  // src/client/index.js
  var inject = ["slots", "locale", "layout"];
  function apply(ctx) {
    ctx.effect(() => {
      let reported = 0;
      const report = (payload) => {
        if (reported >= 5) return;
        reported += 1;
        try {
          fetch("dsh-xiaozhi-7c3a/crashes/report", {
            method: "POST",
            headers: { "content-type": "application/json", "x-dsh-xiaozhi": "1" },
            body: JSON.stringify(payload),
            keepalive: true
          }).catch(() => {
          });
        } catch {
        }
      };
      const onError = (event) => {
        report({
          message: String(event?.message ?? "renderer error"),
          stack: String(event?.error?.stack ?? ""),
          source: String(event?.filename ?? ""),
          line: event?.lineno,
          column: event?.colno
        });
      };
      const onRejection = (event) => {
        const reason = event?.reason;
        report({
          message: String(reason?.message ?? reason ?? "unhandled rejection"),
          stack: String(reason?.stack ?? ""),
          source: "unhandledrejection"
        });
      };
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
      return () => {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
      };
    }, "dsh-xiaozhi: crash reporting");
    ctx.effect(() => {
      const style = document.createElement("style");
      style.dataset.dshXiaozhi = "styles";
      const host = document.head || document.documentElement;
      if (!host) return () => {
      };
      host.appendChild(style);
      style.textContent = CSS;
      return () => style.remove();
    }, "dsh-xiaozhi: styles");
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-xiaozhi: dictionaries");
    ctx.effect(() => {
      let alive = true;
      fetch("dsh-xiaozhi-7c3a/voices").then((response) => response.ok ? response.json() : null).then((data) => {
        if (alive && data?.options) setVoices(data.options);
      }).catch(() => {
      });
      return () => {
        alive = false;
      };
    }, "dsh-xiaozhi: voice catalog");
    ctx.effect(() => {
      let alive = true;
      fetch("dsh-xiaozhi-7c3a/providers").then((response) => response.ok ? response.json() : null).then((data) => {
        if (alive && data) setProviders(data);
      }).catch(() => {
      });
      return () => {
        alive = false;
      };
    }, "dsh-xiaozhi: provider descriptors");
    setT(ctx.locale.bind(NS));
    ctx.slots.inject(
      "main",
      () => ctx.slots.register({ name: "main", key: "xiaozhi", locale: NS }, XiaozhiPanel)
    );
    ctx.slots.inject(
      "sidebar.panellist",
      () => ctx.slots.register(
        {
          name: "sidebar.panellist",
          id: "xiaozhi",
          order: 6,
          locale: NS,
          label: () => t("brand"),
          inject: () => ({ openPanel: () => ctx.layout.selectPanel("xiaozhi") })
        },
        XiaozhiIcon
      )
    );
  }
  return __toCommonJS(index_exports);
})();
    return DshXiaozhi;
  }
});

