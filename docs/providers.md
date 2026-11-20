# 多服务商冗余：实现与 UI 细节

> 本文来自原 `AGENTS.md` §9。存储/API/failover 契约以 `backup-providers.md` 与 `provider-descriptors.md` 为准；本文保留 TTS 服务商池、控制台交互与逐厂商细节。

控制台「全局设置 → 服务商」是 ASR / LLM / TTS **三张概览卡**，点「管理」进入该环节的弹窗；
弹窗里是一块**统一的服务商管理区**：最上面一张
「主用」卡（淡蓝描边 + 主用徽标），下面按优先级排列「备用 1、备用 2…」卡片，末尾「+ 添加
备用服务商」。主用与备用走**同一个编辑弹窗**（先选厂商，再只显示该厂商需要的字段）——不再有
「provider 下拉 + 添加服务商」两套入口。数据存在 `settings.json` 的 `voice.{stage}.backups`
（版本 3），**备用条数不设上限**（2026-11-08 去掉原来的 5 条），同一家可以重复填
（多账号/多把 Key），顺序即优先级。契约与验收细节在
`docs/backup-providers.md`；选择器组件规范在 `docs/pill-popover.md`。

实现位置：

| 环节 | 位置 |
|---|---|
| 数据与掩码 | `src/settings.js`：`BACKUP_SPEC` / `normalizeBackups` / `publicBackups`，逐条「留空=保留」按 id + provider |
| 控制 API | `src/control.js`：`POST /test/provider`（`{kind, source, index}`，只测已保存配置）、`POST /settings/provider/promote`（`{kind, index}`，主用 ⇄ 备用互换，2026-11-14）、`POST /settings/provider/remove`（`{kind, index}`，扁平列表下标；删第一行时下一条连同凭据顶上，TTS 池用，2026-11-14） |
| 运行时装配 | `index.js`：`applyRuntimeSettings()` 下发 `backups`，`createVoiceAdapters(...)` 建候选链，缓存 key 覆盖三段全量配置 |
| 候选链 | `src/voice/adapters/failover.js` + `adapters/index.js`：构建失败跳过、主用坏时备用顶上、全部失败才抛主用原始错误 |
| 控制台 | `src/client/settings/ConfigWizard.js`（三张概览卡 + `xz-stage-modal`）、`ProviderSection.js`（主用卡 + 备用纵向列表 + 添加行）、`ProviderDialog.js`（主用/备用共用的编辑弹窗）、`src/client/ui/PillSelect.js`（分组/禁用行/徽标） |

必须记住的语义：

0. **服务商目录由描述符驱动（2026-11-08）**：唯一数据源是 `src/providers.js` 的 `PROVIDERS`
   （`id/name/group/stages`，每段声明 `fields/summary/secretFields/probe` 等）。控制台通过
   `GET /providers` 拿这份数据（client.js 里也打包一份首屏兜底），`settings.js` 的
   `BACKUP_SPEC.providers` 由 `allProvidersForStage()` 自动派生——**加厂商不再需要改前端、
   也不需要改 `BACKUP_SPEC`**。当前控制台列出：LLM = **DSH 已配置**（`host`，复用 DSH profile 里已配置的厂商+凭据，
   免密钥）/ DeepSeek / 小米 MiMo（2026-11-09 移除 OpenAI / 火山 / 星火；火山与讯飞仍保留 TTS/ASR）；TTS = 火山引擎豆包 / 讯飞语音合成 / 百智云语音合成 / DeepSeek 语音合成 / 微软 Edge（免密钥）；
   ASR = 火山引擎豆包 / 讯飞语音听写 / 百智云语音识别 / DeepSeek 语音识别 / 本地 SenseVoice（免密钥，Harness 内置识别）。
   `mock` 不列出（`host` **列出**，它是 LLM 段的可选来源）；`funasr` 标 `hidden`（存储白名单保留、控制台不展示）。
   **小米 MiMo 的认证头是 `api-key`，不是 Bearer**；语音场景默认
   `thinking:{type:'disabled'}`；**模型清单从厂商 `GET /v1/models` 实时拉取，代码不内置任何模型 id**（控制台选不到时手填）。
   加厂商的完整步骤与字段类型见 `docs/provider-descriptors.md`。
   **厂商端点一律内置在适配器里，描述符不暴露 `url` 字段（2026-11-09，用户要求）**：地址几乎不改，
   露在表单里只会让人以为"必须填"。手写 `settings.json` 的 `voice.asr.url` 仍然生效（自建/代理端点），
   且主用保存**不会**把它覆盖成空串——`STAGE_META.asr.editFields` 故意不含 `url`（存储白名单保留）。
   回归断言在 `test/providers.test.mjs`（任何 stage/provider 组合出现 `url` 字段即红）。
   LLM 的 `baseUrl` 不在此列（自定义中转/自建网关常用），仍保留在表单里。
   **复用 DSH 的 LLM（2026-11-10）**：`provider: 'host'` + `hostProvider` + `model`，运行时走 `host-llm.js`
   （`ctx.llm.stream`），插件**不存 Key**；厂商清单来自 `GET /llm/providers`（`ctx.llm.listProviders()`），
   模型仍单独选（语音要短回复/低延迟，DSH 默认模型未必合适）。**主用与每条备用都在保存边界校验
   `hostProvider` 是否在当前 profile 注册**（`hostProviderIssue`），坏值直接 400——否则会先落盘、等用户说完
   第一句话才以 `no adapter registered` 失败，表现为「设备一直聆听中」。直连（deepseek/mimo + 自带 Key）
   保留，用于额度分流或 DSH 厂商不可用时回退；`STAGE_META.llm.storageFields` 因此多了 `hostProvider`。
1. **切换粒度不同**：LLM 只在未出字前切；TTS 只在首包前切（出过音频后不换家，避免重念半句）；ASR 在整段结束时回放 PCM
   重试（缓存上限 60s，回放不推 partial）。主动打断不算失败。
2. **粘性**：切到备用并成功后先继续用它，`cooldownMs`（默认 5 分钟）后才重新先试主用；
   每个会话的 adapter 实例各有一份，配置改动仍是下一次连接生效。
3. **备用也是全局默认**：智能体级 `overrides` 只改主用（人设/模型/音色/语种/语速/静音），不会改这个智能体的备用链。TTS 备用条目同样只存「厂商 + 凭据」，运行时用各自厂商的默认音色（2026-11-08）；全局 TTS 主用也只存凭据，音色只由智能体 `overrides.voice` 决定，空值走厂商默认。**LLM 备用条目的模型**：DeepSeek 有默认（`deepseek-chat`）时添加/编辑表单**不显示模型字段**，自动填默认；MiMo 没有默认模型（清单从 `/v1/models` 拉），仍保留字段。主用模型仍是全局默认，智能体「模型」可覆盖。**LLM 现在是 host / deepseek / mimo 三种来源（2026-11-10）**：host = 复用 DSH 已配置的厂商（免密钥、`hostProvider`+`model`），deepseek/mimo = 插件直连（自带 Key）；OpenAI / 火山 / 星火在 2026-11-09 已从 llm 段删除（火山与讯飞仍保留 TTS/ASR），手写 settings 里残留这些会以 `unknown LLM provider` 明确报错（不静默换厂商），`loadBackups` 直接丢弃。
4. **构建容错**：一条备用配错（缺 Key/未知 provider/缺 ffmpeg）只跳过并 warn，不打死整条语音；
   主用坏、备用好时用 `logger.error` 说明主用为什么没起来。
5. **观测**：`session.build` 带 `llmCandidates` / `ttsCandidates` / `asrCandidates`（1 = 只有主用）
   与 `maxTokens`；切换记 `voice.log` 的 `llm.failover` / `tts.failover` / `asr.failover`
   （`from`/`to`/`provider`/`error`/`ms`）。
6. **测试只测已保存配置**：`/test/provider` 的 `index` 是服务端顺序。改动通常已被自动保存落盘；
   仍有未落盘改动时按钮变「保存并测试」，先保存再测。新填 Key 等自动保存完成（或点「保存并测试」）才能测。
   **ASR 也有在线测试**：`probe.kind='asr'`，服务端先用全局 TTS 合成一句固定话、再把 PCM 喂给被测
   ASR（`src/voice/asr-probe.js`），返回识别文本；TTS 未配置/是 mock 时明确报「需要先配置可用的 TTS」。
7. **adapter 缓存 key 必须覆盖三段全量配置**（`index.js` 的 `adaptersFor`）：provider / model /
   baseUrl / url / resourceId / apiKey / backups + 智能体 overrides + 人设。漏掉任何一项都会出现
   「控制台改了配置、设备重连后仍用旧 adapter」；2026-11-06 就是漏了 ASR resourceId 导致修正后
   ASR 仍恒为空。改完这些代码本身仍需重启 DSH，但只改设置里的配置项重连即生效。
8. **火山 ASR 资源只用 2.0**：`volc.seedasr.sauc.duration` / `.concurrent` 可以用；
   `volc.bigasr.*`（1.0）与当前 `bigmodel_async` 端点握手 403（实测），控制台已不再列出。
9. **空回合不回 tts，收到「无 utterance 的 listen stop」直接重开捕获**（2026-11-07 最终版）：
   普通空回合（有音频但没识别出内容）**不**补 `tts start/stop`——那会让环境音触发的假句尾
   把设备 speaking↔listening 弹一次，看起来像“自己触发了一轮对话”。但也不能忽略：设备还在
   Listening 时不会重发 `listen start`，服务端若停在 `capturing=false`，用户之后的话会被整段
   丢弃（实测出现过 50s/113s 的哑采集）。正确做法是收到这类 stop 时 `#beginCapture()` 重开
   捕获。环境音阈值：服务端能量 VAD 默认 0.05；固件 AFE VAD `VAD_MODE_2` + `vad_min_noise_ms=300`，
   且短于 400ms 的假片段不发 `listen stop`（固件日志 `VAD: short segment ... ignored`）。
10. **回答要短**：语音场景默认 `max_tokens = 120`（Loader: `voice.llm.maxTokens`，控制台
    「全局设置 → LLM → 回复长度上限」可覆盖 32–2048，留空 = 120）；同时 `index.js` 在系统提示词末尾
    追加 `<voice_reply_limits>` 硬规则（1 句 / 最多 2 句 / 不复述 / 不用 Markdown 表情），优先级高于人设。
    参考官方服务端 `xiaozhi-esp32-server/main/xiaozhi-server/agent-base-prompt.txt` 的
    `[Get to the point]` 与 TTS 格式约束（其 `config.yaml` 同类模型 `max_tokens: 500`，这里按语音场景调小）。
    为什么必须短：长回答会让 TTS 念十几秒，用户中途插话更容易触发打断/空回合；2026-11-06 实测
    一轮回复 6+ 句、持续约 20 秒。
11. **「只能聊一轮」的根因在固件，2026-11-06 已修**：旧固件进入 listening 时用
    `IsAudioProcessorRunning()` 做门，Speaking 里的 `EnableWakeWordDetection` 会把 processor 位
    重新置起来，于是每轮回来都走 `skip listen start` 分支——服务端永远收不到新一轮的
    `listen start`，`capturing` 停在 false，用户说话全被丢弃。固件改法：`state->listening`
    一律重发 `listen start`（`application.cc`），并加日志 `SendStartListening` /
    `state->listening` / `<< tts`；AFE VAD 同时调抗噪：`VAD_MODE_2` + `vad_min_noise_ms=300`。
    固件改动要 `idf.py -p COM8 flash` 才生效（见 `xiaozhi-esp32` 侧）。
12. **mDNS 绑 5353 可能失败**：Windows 上 Chrome/ChatGPT/adb 都会占 5353，绑定失败时旧实现
    直接降级为 disabled，手表就悄悄回落到云端 OTA。现在 `startMdns` 失败每 10s 重试，不再永久降级。
13. **排障要看两侧**：`voice.log` 的 `listen` / `capture.begin` / `asr.empty.bytes` / `asr.no_audio`
    与手表串口日志（`~/.dsh-xiaozhi` 之外，COM8 115200）对照；设备端日志用
    `pwsh -File "%TEMP%\xiaozhi-serial-capture.ps1" -Port COM8 -Seconds 180` 抓。
    两侧一起看才知道是「固件没发 listen start」还是「服务端没喂音频」。
14. **百智云语音（2026-11-09）**：`id=baizhi`，只覆盖 **ASR + TTS**（没有 LLM），两段共用一把 API Key。
    - **识别** `wss://asrmodel.app.baizhi.cloud/openapi/v1/realtime`，代码 `src/voice/adapters/baizhi-asr.js`：
      `session.start` → 二进制 PCM16 16k 帧 → `input.commit` → `transcript.delta/final` → `session.completed`。
      三条硬约束：① 上行必须 **16kHz**（构建期就报错，不会悄悄发错采样率）；② 必须**按真实节奏**发
      （100–200ms 一帧），`AudioPacer` 把「会话喂多快」压成「实际发多快」，`finish()` 先排空再 `input.commit`
      ——突发灌数秒音频会被服务端判脏；③ 只有 `session.completed` 表示识别完成，中途断连保留已收原文。
    - **合成** `POST /openapi/v1/audio`，代码 `src/voice/adapters/baizhi-tts.js`：返回 **24k 单声道 16-bit WAV
      整段**。WAV 头在 JS 里剥掉，**这条链路不需要 ffmpeg**；只有 ASR 在线测试要 16k 时走线性插值重采样
      （会话下行固定 24k，直接透传）。首帧延迟 = 整句合成时间（不是流式），这是选 HTTP 而不是 WSS 实时合成的代价。
    - **语速**只对音色目录里声明 `speed: true` 的音色下发（`voiceSupportsSpeed`）：服务端对不支持 speed 的音色
      回 `invalid_request` 且整句没声，所以未知/自定义音色一律不带 speed。
    - **音色**：`VOICE_OPTIONS.baizhi` = 官方 `GET /openapi/v1/voices?type=tts` 的 10 个（微澜/若禾/知夏/逸飞/
      清歌/苏晴/朗天/砚舟/景舟/梓辰，全部 `supports_speed_control`），默认 `vivi`（`DEFAULT_TTS_VOICES`）；控制台「智能体 →
      配置 → 角色」的音色下拉走 `GET /voices?provider=baizhi`（内置清单；官方接口只在人工核对时用）。
    - **未实测**：协议与节奏由 `test/baizhi.test.mjs`（本地假服务端）覆盖；**真实 Key 的合成/识别没有跑过**。
      文件转写（`POST /audio` 异步任务）、`/pricing` 计费查询、WSS 实时合成都没有接入。
15. **主用 ⇄ 备用随时互换（2026-11-14）**：用户要求「我可以随时替换」。备用行 `⋯` 的第一条是
    「设为主用」：这条上来当主用、原主用**按原位置**降为备用（顺序不变）。实现分两层：
    - `src/settings.js` 的 `SettingsStore.promote(stage, index)`：在内存里 `structuredClone` 后整段互换，
      只搬 `BACKUP_SPEC[stage]` 声明的字段（`llm.maxTokens` 这类全局项留在主用）；降级的主用拿**新 id**；
      主用从未配置过（`provider` 为空）时不生成空壳条目。校验通过才替换状态并落盘（失败不留半份配置）。
    - `src/control.js` 的 `POST /settings/provider/promote`（`{kind,index}`，CSRF）：**必须在服务端做**——
      备用条目在浏览器里只有掩码，前端把它当主用提交会把 `sk-••••ab` 存成密钥；服务端互换则明文不过 HTTP。
      `provider: 'host'` 的备用提升前走同一套 `hostProviderIssue` 校验（坏值 400 `invalid-host-provider`）。
    - 控制台：`ProviderSection` 菜单加「设为主用」，主用卡加一行灰字提示；`ConfigWizard.promoteBackup`
      在本地 dirty 时先 `save()` 再调用（否则换的是磁盘上的旧配置），成功后用响应快照覆盖本地并清掉该段的
      主用测试结果。回归：`test/settings.test.mjs` 3 项 + `npm run check:ui`（断言点击后 POST 到 promote）。
16. **官方音色目录 + 智能体级 TTS 服务商（2026-11-14）**：用户要求「所有服务商的音色都能在智能体页面直接下拉选」。
    音色目录**逐家按官方清单重建**（不靠记忆，见 `src/voice/voices.js` 顶部表格）：
    - 火山 2.0：官方音色列表（`docs.volcengine.com/docs/doubao-voice/tone-list-3`，2026.11.06 更新）的
      全部 zh/en `*_uranus_bigtts`（146 条，`languages`/方言逐字取官方「语种/方言」列）；1.x 的 95 条保留
      作 legacy（需 `seed-tts-1.0`）。**官方 2.0 表里没有的旧条目（saturn 系）已删除**——没有官方依据的
      id 选中就是 55000000（有字没声）。
    - Edge：官方 readaloud `voices/list` 实时抓取，中文 14 条（含东北话/陕西话/粤语/台湾国语）。
    - 百智云：官方 `GET /openapi/v1/voices?type=tts` 实时查询，10 条（全部支持语速）。
    - DeepSeek：官方文档固定 stella / tide（2 条，无语种/语速参数）；讯飞保持官方 vcn 11 条（官方无列表
      接口，账号需在控制台开通，否则 11200）。
    - `voiceTierOf()` 对目录外的自定义 id 保留命名规则兜底（uranus/saturn → 2.0，moon/mars/jupiter/multi → 1.x），
      只为资源族过滤，**不代表该 id 一定有效**。
    全局 TTS = **服务商池**：`ProviderSection` 的 `pool` 模式只渲染平铺列表（无主用卡、无序号、无上移/下移/
    设为主用），底部「添加服务商」；删第一行走 `POST /settings/provider/remove`（服务端把下一条连同凭据顶上），
    删其余行只改本地列表（防抖自动保存）。LLM / ASR 仍走原来的主用 + 备用 + promote。
    智能体级 TTS 服务商：`overrides.ttsProvider`（`/agents/update` 接受，空串删除），控制台「角色」页新增
    「TTS 服务商」下拉（只列全局已配条目）+ 音色下拉（随所选厂商切换、换厂商重置音色）；运行时
    `src/voice/adapters/index.js` 的 `prioritizeTtsProvider(ttsSpec, provider)` 在条目层重排候选链，
    `index.js` 的 `adaptersFor` 在合并后调用；adapter 缓存 key 已含 agent overrides，改完设备重连即生效。
    回归：`test/tts-provider-pin.test.mjs` 5 项 + `test/http.test.mjs`（未配置厂商 400 / 空串清除）+
    `test/settings.test.mjs` 2 项（删第一行顶上 / 删最后一家清空）+ `npm run check:voice`（4 家清单、换厂商重置、
    保存带 ttsProvider）+ `npm run check:ui`（TTS 池无主备、删除走服务端）。
17. **DeepSeek 语音（2026-11-14）**：`id=deepseek`，在原有 LLM 段之外新增 **ASR + TTS** 两段，
    三段共用同一把 API Key（DeepSeek 控制台）。端点在适配器里内置，描述符只声明「要填 Key」。
    - **识别** `POST https://api.deepseek.com/v1/tools/asr`，代码 `src/voice/adapters/deepseek-asr.js`。
      官方是**整段批处理**（不支持流式、没有中间结果）：适配器缓存上行 PCM，`finish()` 时封 16-bit
      PCM WAV、以 `multipart/form-data` 的 `file` 字段一次上传，读回 `{request_id,text,duration_ms}`。
      四条硬约束：① 只收 16-bit PCM WAV / Ogg Opus，WAV 采样率必须是 8000/16000/22050/24000/32000/
      44100/48000——上行采样率不在其中时适配器先线性插值归一到 16k（否则整段 400）；② 单次 ≤120 秒、
      ≤8 MiB，超了**截断到上限再传**并记 `deepseek.asr.request` 的 `truncated`；③ **没有语种参数**，
      语种按音频自动识别（描述符不提供「识别语种」，智能体级 `language` 在这里被忽略）；④ 错误码
      400/408/413/429/503/504 直接映射成中文原因，失败返回 `{text:'', error}`（failover 会换下一家）。
    - **合成** `POST https://api.deepseek.com/v1/tools/tts`，代码 `src/voice/adapters/deepseek-tts.js`。
      请求 `{text, voice_id, format:'wav', filter_markdown:true}`，响应是整段 `audio/wav`；WAV 头在
      JS 里剥掉（`src/voice/wav.js` 的 `parseWav16`），**不需要 ffmpeg**。**音色只有 `stella`（海星，
      默认）/ `tide`（暗潮）**，在「智能体 → 配置 → 角色」选；**没有语种参数**（按文本自动识别）、
      **不支持调节语速**（`voice.speed` / `rate` 不下发）。上限：单次 10,000 个计费字符（汉字算 2，
      `billedChars()` 在发请求前判定）+ 请求体 64 KiB；400 通常是内容审核（`Content Exists Risk`）。
      官方明确「音频已开始返回后失败会中途断开」——`arrayBuffer()` 读不满即按失败处理，不拿半段音频当成功。
    - **为什么不边下边播**：会话侧本来就把一整句 PCM 收齐才做 Opus 编码（`session.js` 的
      `#speakSentence`），流式解析不会让首帧更早到设备，只会多一份失败面。首帧延迟 = 该句合成时间。
    - **生效时机与验收**：控制台保存配置 → 设备重连即生效；改代码 → 重启 DSH。回归
      `test/deepseek.test.mjs` 18 项（描述符/音色/WAV 编解码与下混/multipart 上传/采样率归一/
      120s 与 8 MiB 截断（含写入期缓存上限）/空音频不发请求/abort 丢弃在途请求/200 缺 text 判失败/TTS 请求体与重采样/截断 WAV 判失败/计费字符口径/缺 Key）。
      **未实测**：真实 Key 的识别与合成都没有跑过（协议由假 fetch 覆盖）。
