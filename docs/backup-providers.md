# 多服务商自动冗余（主用 + 备用）

> 本文是「全局设置 → 主用服务商 + 备用服务商」这一功能的实现契约。改动前先读完，
> 它是 UI、设置存储、语音适配层三边的共同约定。
>
> **2026-11-08 归属调整**：TTS 段全局只配「厂商 + 凭据」，音色（= TTS 模型族）改由
> 「智能体 → 配置 → 角色」按智能体选择；本文 TTS 条目里的 `voice` / `model` / `resourceId`
> 视为历史兼容字段（服务端仍接受手工配置，控制台不再提交）。
>
> **2026-11-08 去掉条数上限**：原来每段最多 5 条备用，服务端超限直接 400、控制台「添加」
> 按钮到 5 条禁用。现在**不设条数上限**——服务端不再校验条数，控制台永远可以继续添加；
> 顺序即优先级。唯一的现实边界是控制 API 的 JSON 体积闸门（`control.js` 的
> `MAX_JSON_BODY = 64 KB`，防滥用，不是业务条数规则）。

## 1. 目标与范围

用户已经有了一把 DeepSeek Key、一把火山 Key、一把讯飞 Key，但控制台每种能力只能填一家。
要求：**同一个环节可以按优先级填多家服务商（同一家也可以重复填多把 Key），主用失败时自动
切到下一个，切过去的这一轮成功后就先继续用它，过一段时间再试探回主用。**

覆盖三段，语义一致：

| 环节 | 允许的 provider（备用列表） | 每条配置携带的字段 |
|---|---|---|
| LLM | `deepseek` / `mimo` / `openai` / `volc` / `spark` | `provider` `model` `baseUrl` `appId` `apiKey` |
| TTS | `edge` / `xunfei` / `volc` | `provider` `appId` `apiKey` `apiSecret`（2026-11-08：控制台只提交这些；`voice` `rate` `speed` `model` `resourceId` `url` 是历史兼容字段，服务端 `BACKUP_SPEC` 仍接受手工配置） |
| ASR | `local` / `funasr` / `xunfei` / `volc` | `provider` `url` `language` `accent` `resourceId` `appId` `apiKey` `apiSecret` |

> 服务端白名单（`src/settings.js` 的 `BACKUP_SPEC`）保留 `funasr` 以兼容手工配置；**控制台只列
> 当前环境真实可用的服务商**（`src/client/core.js` 的 `PROVIDER_CATALOG`）：LLM = DeepSeek / 小米 MiMo /
> OpenAI / 火山引擎豆包 / 讯飞星火；TTS = 火山引擎豆包 / 讯飞语音合成 / 微软 Edge；ASR = 火山引擎豆包 /
> 讯飞语音听写 / 本地 SenseVoice。`mock`、`host`、`funasr` 不出现在下拉里。

> **小米 MiMo（`mimo`）的特殊约定**：OpenAI chat/completions 兼容，但认证头是 `api-key: <key>`
> 而不是 `Authorization: Bearer`（`src/voice/adapters/openai-llm.js` 的 `authStyle: 'api-key'`）；
> 模型清单从厂商 `GET /v1/models` 实时拉取（控制台编辑弹窗里带当前 Key 预览），**插件不内置
> 任何模型 id**；语音场景默认
> 请求 `thinking: {type: 'disabled'}`，否则模型先吐思维链、首字延迟扛不住。`GET /v1/models` 的
> 认证头同样是 `api-key`。要加一家新厂商，必须同时改三处：`src/client/core.js` 的 `PROVIDER_CATALOG`、
> `src/voice/adapters/index.js` 的 `OPENAI_COMPATIBLE`、`src/settings.js` 的 `BACKUP_SPEC`。

约束：

- `mock` 不允许进备用列表（备用必须是真实服务商；mock 只用于桌面联调）。
- LLM 的 `host`（Harness 自带厂商）不进备用列表：它没有「服务商 Key」，也不该在设备链路里
  消耗 Harness 额度。**设备级也不再自动切 host**——2026-11-07 起 `host` 只能由全局
  `voice.llm.provider` 显式选择，设备 overrides 只覆盖模型名（`overrides.model`）。
- 每个环节的备用**条数不设上限**（2026-11-08 去掉原来的 5 条上限）；顺序即优先级。
  列表为空 = 只有主用，行为和现在完全一致。
- **智能体级覆盖仍然只影响主用**（`overrides.model` / 音色 / 人设）；备用列表是全局默认的一部分。
- **TTS 音色归设备级（2026-11-08）**：全局设置页的 TTS 只存「厂商 + 凭据」（volc = API Key；
  xunfei = APPID/APIKey/APISecret；edge 免密钥）。音色（= TTS 模型族）在「智能体 → 配置 → 角色」
  按智能体选，留空 = 厂商默认（火山 `zh_female_vv_uranus_bigtts` / Edge `zh-CN-XiaoxiaoNeural` /
  讯飞 `xiaoyan`，见 `src/voice/voices.js` 的 `DEFAULT_TTS_VOICES`）。主用与备用条目都可能不带
  音色，适配器统一用 `resolveTtsVoice(provider, voice)`：空 → 厂商默认、跨厂商残留 → 回落本厂商
  默认、自定义 ID 原样保留。因此备用 TTS 条目运行时用的就是**各自厂商的默认音色**；设备级音色
  只覆盖主用，不会改备用。

## 2. 存储模型（settings.json，版本 3）

`voice.{llm|tts|asr}` 在原有扁平字段（主用配置）之外，新增 `backups: Entry[]`：

```jsonc
{
  "version": 3,
  "voice": {
    "llm": {
      // 主用，字段与现在完全一致
      "provider": "deepseek", "model": "deepseek-chat", "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-…",
      // 备用，按优先级排列
      "backups": [
        {
          "id": "e0a1…",                  // 服务端生成，前端只回传；用于「留空 = 保留原密钥」
          "provider": "volc",
          "model": "doubao-1.5-pro-32k",
          "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
          "appId": "",
          "apiKey": "…"
        }
      ]
    },
    "tts": { "…": "主用字段不变", "backups": [] },
    "asr": { "…": "主用字段不变", "backups": [] }
  }
}
```

规则：

- `id` 由服务端生成（`randomUUID()`，只存串）；更新时按 `id` 匹配已有条目。
- 字段长度上限与主用一致（`model` 80、`baseUrl`/`url` 300/200、`apiKey`/`apiSecret` 200…）。
- 未知 provider、非法形状 → `SettingsError('invalid', …)`，整次保存失败（不做半保存）。
  条数不参与校验：想存多少条就存多少条（2026-11-08 起）。

### 冗余的典型填法（LLM）

同一家可以重复填，顺序即优先级；模型也可以混着填：

```jsonc
"llm": {
  "provider": "deepseek", "model": "deepseek-chat", "apiKey": "sk-…",   // 主用
  "backups": [
    { "provider": "mimo", "model": "mimo-v2.6-flash", "apiKey": "…" },  // 备用 1：小米 MiMo
    { "provider": "mimo", "model": "mimo-v2.6-pro",   "apiKey": "…" },  // 备用 2：MiMo 另一档
    { "provider": "volc", "model": "doubao-1.5-pro-32k", "apiKey": "…" }
  ]
}
```

### 密钥「留空 = 保留」语义（逐条）

前端拿到的是掩码（`mask(apiKey)`，含 `•`）。保存时：

1. 传入 secret 非空且不含 `•` → 写入新值。
2. 传入 secret 为空或含 `•` → **仅当**同 `id` 的旧条目存在**且 provider 相同**时保留旧 secret；
   否则置空。
3. 条目带 `clearApiKey: true` / `clearApiSecret: true` → 明文清空。
4. 前端删掉某条 → 该条的密钥一并从磁盘消失（不是「留空保留」）。

## 3. 控制 API

### GET `/settings`

`s settingsPayload()` 原样增加 `backups` 数组（永远存在，可能为空），每条只回掩码：

```jsonc
"llm": {
  "…": "主用原字段（apiKey 为掩码）",
  "backups": [
    { "id": "e0a1…", "provider": "volc", "model": "…", "baseUrl": "…", "appId": "",
      "apiKey": "sk-••••ab", "hasApiKey": true }
  ]
}
```

`tts`/`asr` 同理，带 `hasApiKey` / `hasApiSecret`。

### POST `/settings`

请求体在现有形状上增加 `voice.llm.backups` / `voice.tts.backups` / `voice.asr.backups`
（数组，可省略 = 不改）。条目 secret 可以是掩码或空串（按上节规则处理）。返回体同 GET。

### POST `/test/provider`

> 新增。只测**已保存**的配置（与现有 `/test/llm` 一致；新填的 Key 先保存再测）。

请求：`{ "kind": "llm" | "tts", "source": "primary" | "backup", "index": 0 }`
（`index` 仅 `source=backup` 时有效，0 起）。

响应（HTTP 200，业务结果在正文，与 `/test/llm` 一致）：

```jsonc
// LLM
{ "ok": true, "ms": 812, "kind": "llm", "provider": "volc", "model": "…",
  "firstTokenMs": 640, "totalMs": 812, "sample": "…" }
// TTS（真合成一小段，按字节计）；voice 回显实际生效音色
// （主用/备用条目可能只存凭据 → 厂商默认，跨厂商残留 → 回落，2026-11-08）
{ "ok": true, "ms": 1200, "kind": "tts", "provider": "volc", "voice": "…",
  "bytes": 34496, "firstChunkMs": 1180 }
// 失败
{ "ok": false, "ms": 300, "error": "…" }
```

`kind=asr` 会先用全局 TTS 合成一句固定话（「你好，小智，这是一次语音识别测试。」），再把 16k PCM
分块喂给被测 ASR，返回 `{ ok:true, kind:"asr", provider, text, bytes, totalMs }`；TTS 未配置 / 是 mock /
没返回音频时返回 `{ ok:false, error }`，不会伪造成功。写接口照旧要 `x-dsh-xiaozhi: 1` 头。
现有 `/test/llm` 保留（等价于 kind=llm/source=primary）。

## 4. 运行时装配（index.js + adapters/index.js）

- `resolveConfig` 不涉及备用列表；`applyRuntimeSettings()` 把
  `settings.state.voice.{stage}.backups` 写进 `resolved.voice.{stage}.backups`（覆盖式，
  空数组也要写，这样控制台删光备用后下一次连接就真的没有备用）。
- 设备级合并（`mergeDeviceConfig`）不碰 routes 之外的字段；`backups` 随 base 透传。
- `createVoiceAdapters(voice, options)` 内：
  1. 逐段构建候选列表 `[主用, ...备用]`。构建失败（缺 Key、未知 provider、缺 ffmpeg 等）的
     候选跳过并 `logger.warn`，**不要让一条配错的备用把整条语音链路打死**。
  2. 主用构建失败但有可用备用 → 备用顶上，`logger.error` 说明主用为什么没起来。
  3. 一个候选都构建不出来 → 抛主用的原始错误（保持现在「配置错误必须显性」的语义）。
  4. 有 ≥2 个候选时套 failover 包装；只有一个候选时原样返回（不引入无意义包装）。
- 适配器缓存 key（index.js）必须包含三段的 `backups` 摘要，否则改完备用后旧会话还在用旧集合。
- TTS 候选构建统一走 `resolveTtsVoice`（2026-11-08）：主用/备用条目只存凭据也能构建，空音色 /
  跨厂商残留落到本厂商默认音色；`voice.build` 的 `session.build` trace 与 `/test/provider` 回显
  的都是**实际生效音色**，排障时以它为准。

### 4.1 切换语义（failover 包装）

顺序：主用 → 备用 1 → …。每个包装实例维护 `preferred`（下一次先试谁）与 `stickyAt`。

| 环节 | 何时可重试 | 说明 |
|---|---|---|
| LLM | **只在还没有吐出任何事件之前** | 已经吐了 token 再重试会把同一句话念两遍、还错乱分句；此时直接抛错（会话层现有 `llm_failed` 路径） |
| TTS | 每个句子内部都可以 | 候选的音频先整句收进内存（会话本来就整句编码），失败换下一家重来，不产生半句幽灵音频 |
| ASR | 整段 utterance 结束时 | 写入的 PCM 记忆一份（上限 60s 上行音频），`finish()` 失败时回放给下一家，回放时**不推 partial**（避免重复气泡） |

- 成功的那一家若 `index > 0`，记为 `preferred`；`now - stickyAt > cooldownMs`（默认 5 分钟）
  后 `preferred` 回到 0（下次重新先试主用）。
- 主动中断（`AbortController` 已 abort / generation 变化）不是失败：**不许** failover，直接抛出/返回。
- 结构化日志（`voice.log`）：
  - `llm.failover` / `tts.failover` / `asr.failover`：`{ device, from, to, provider, error, ms }`
  - 失败链条只落到 `logger.warn`，不要 `logger.error`（配置错误另算）。

## 5. 控制台 UI

2026-11-08 改版：全局设置 → 服务商是 **ASR / LLM / TTS 三张概览卡**，点「管理」进入该环节的弹窗。

> 有哪些厂商、每家要填什么字段，**不在前端写死**：来自 `src/providers.js` 的描述符
> （控制台通过 `GET /providers` 拉取）。加厂商只改描述符 + 适配器，前端 0 改动，
> 详见 `docs/provider-descriptors.md`。

**一级：概览卡**（只读，不放编辑控件）

- 头部：色块图标 + 环节名（`ASR 识别` / `LLM 模型` / `TTS 合成`）+ 状态点；
- 主行：主用厂商名（大字）+ 摘要（LLM=模型名、ASR=地址/资源、TTS 留空）；
- 事实行：`密钥：已配置` / `备用：N 个` / `降级链：火山 → 讯飞 → Edge`（有备用才显示）；
- 底部：`已就绪`（绿）/ `密钥未配置`（黄）/ `有未保存修改`（黄）+ `管理 ›`。
- 三列网格（`minmax(240px,1fr)`），手机单列；一屏能看全三个环节。

**二级：stage 弹窗**（`xz-stage-modal`，固定头 + 可滚体 + 固定脚）

- 头部：`‹ 返回` + 环节名 + 状态点 + 摘要；正文顶部一行说明；
- 主用卡（淡蓝描边 + 主用徽标，固定第一优先级、不可删除/移位）：厂商中文名、
  模型/地址摘要（**TTS 卡没有摘要行**：全局不配音色，只显示厂商 + 密钥状态，2026-11-08）、
  密钥状态（已配置 / 未配置 / 无需密钥，只显示掩码）、最近测试结果、`编辑` / `测试`。
- 备用：**纵向列表**（不是网格），每行 = 序号 + 厂商名 + 摘要/密钥状态/测试结果 + 右侧
  `[编辑] [⋯]`；上移 / 下移 / 测试 / 删除收进 `⋯` 展开区（删除二次确认）。
  没有备用时显示一行灰字：`没有备用服务商；主用不可用时不会自动切换`。
- 列表底部整行「+ 添加备用服务商」，**不设条数上限、永远可点**（2026-11-08 去掉 5 条禁用）。
- **主用与备用走同一个编辑弹窗**（`ProviderDialog`）：先用 PillSelect（见 `docs/pill-popover.md`）
  选 provider，再只显示该 provider 需要的字段；确定后只改本地状态，关闭弹窗后由页面防抖自动保存
  （2026-11-08 起没有「保存配置」按钮）。TTS 弹窗只有「厂商 + 凭据」（volc = API Key；xunfei = APPID/APIKey/APISecret；
  edge 免密钥），没有音色 / 模型 / Resource ID / API URL；主用保存时把 `voice` / `model` /
  `resourceId` 显式清空，音色改在「智能体 → 配置 → 角色」按智能体选（2026-11-08）。
  编辑已保存条目时密钥回填掩码；主用换厂商时弹窗会重置整张表，保存时显式清掉上一家的旧密钥。
- 测试：只有已保存的条目能测（`POST /test/provider`；主用 LLM 仍走 `/test/llm`）。
  **未落盘时按钮变「保存并测试」**：点击先 `POST /settings` 再按服务端顺序测
  （契约仍是「只测已保存的配置」，只是把两步合成一次点击）。
- 保存：页面没有保存按钮，任何改动防抖 700ms 自动 `POST /settings`；保存中又有改动会等下一轮，
  服务端回写 id/掩码但不覆盖期间的新输入。底部状态条显示「保存中… / 已自动保存 / 自动保存失败（重试）」。
- 移动端：概览卡单列；stage 弹窗 `96vw × 92vh`，备用行 `⋯` 展开区改为整行按钮组。

## 6. 验收

```powershell
cd D:\Demo\esp-xiaozhi\dsh-xiaozhi
node --test "test/*.test.mjs"      # 全量 218 项必须全绿（2026-11-08）
npm run build                      # src/client/** → client.js（esbuild，React external）
npm run smoke                      # 真实 React SSR 渲染主要页面 + slot 注册校验
node --check client.js             # UI 产物语法检查
```

必须覆盖的单测（新增 `test/failover.test.mjs`、`test/tts-defaults.test.mjs`，扩充 `test/settings.test.mjs`）：

- 设置：备用列表持久化 / 掩码不外泄 / 留空保留（同 id 同 provider）/ 换 provider 丢旧密钥 /
  **条数不设上限（12 条可存、可按序读回、重启后仍在）** / 未知 provider 报错 / 删条即丢密钥。
- TTS 音色归属（2026-11-08）：全局条目只存「厂商 + 凭据」，`voice` / `model` / `resourceId`
  可清空；只带凭据的主用/备用条目能构建；空音色 → 厂商默认、跨厂商残留 → 本厂商默认、
  自定义 ID 原样保留（`DEFAULT_TTS_VOICES` / `resolveTtsVoice`）。
- failover：LLM 未出字前切换、出字后不切换、sticky 与 5 分钟回落；TTS 整句重试；ASR 回放
  重试且不推 partial；abort 不触发切换；候选构建失败被跳过。
- 控制 API：`/test/provider` 的 primary / backup / 未保存条目错误分支（用注入的假 probe）。
