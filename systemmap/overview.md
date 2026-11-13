---
scope: dsh-xiaozhi
covered_paths:
  - dsh-xiaozhi/index.js
  - dsh-xiaozhi/client.js
  - dsh-xiaozhi/src/
  - dsh-xiaozhi/src/client/
  - dsh-xiaozhi/test/
last_verified_commit: dc179b320f204192746276da2312aaa40692a56e
verified_at: 2026-11-08
status: current
note: 2026-11-06 删除「行为档案/播放器」页：ProfileStore、/profiles/* 与 device.profileId 一并移除，人设与静音收口迁进 settings（全局设置）。2026-11-06 新增「主用 + 备用服务商」：settings v3 的 voice.{llm,tts,asr}.backups、adapters/failover.js、控制台卡片 + 弹窗表单、POST /test/provider；契约 docs/backup-providers.md、选择器规范 docs/pill-popover.md。2026-11-07：LLM 主路径改回插件直连并新增小米 MiMo（模型清单走 /v1/models）、联网工具回传正文并新增 web_fetch、对话历史（会话/消息/音频）、配置 UI 重构（全局设置单页分区：服务商为主 + 语音默认参数 + 接入与网关；人设只在设备级；设备配置与历史都是弹窗；PillSelect 改 fixed 浮层不撑布局）。2026-11-08：TTS 归属分离——全局设置只配「厂商 + 凭据」（保存时显式清空 voice/model/resourceId），音色（= TTS 模型族）改由设备 overrides.voice 选择（留空 = 厂商默认），src/voice/voices.js 新增 DEFAULT_TTS_VOICES / defaultTtsVoice / resolveTtsVoice（空→默认、跨厂商回落、自定义保留），TTS 备用条目用各自厂商默认音色；test/tts-defaults.test.mjs 新增，全量 233 项。2026-11-08 去掉备用服务商 5 条上限：settings.js 的 normalizeBackups/loadBackups 不再校验/截断条数，client.js 的「添加」按钮永不禁用、标题只显示「备用 N 个」，test/settings.test.mjs 新增「12 条可存可读」，全量 233 项。2026-11-08 智能体/设备拆分：agents.json + devices.agentId、旧设备启动迁移（配置与记忆搬家）、控制台「设备」改名「智能体」（卡片/绑定弹窗/级联删除）、记忆改按智能体、历史合并展示，全量 233 项。2026-11-08 删除全局「输出语种」：`voice.tts.language` 不再由 settings 提供，只在智能体 `overrides.language`（全局 UI 与 settings 字段一并移除），避免与智能体页重复。2026-11-08 设备侧 MCP/IoT：`src/voice/device-mcp.js`（hello features.mcp → initialize/tools/list/tools/call）与 `src/voice/device-iot.js`（descriptors/states/commands）接入 `VoiceSession`，动态工具与内置工具合并；外部 MCP server（stdio/SSE/streamable-http）、MCP 接入点、入站 `/mcp` 均已接（`src/mcp/*`；入站配置 `mcpToken`）。2026-11-09 入网默认改为待审核：`autoProvision: false` 时陌生 OTA/WS 进 `PendingStore`（`pending.json`，`403 device-pending`），控制台「智能体」页选智能体批准后建档；`autoProvision: true` 恢复零接触登记。2026-11-09 字体：中文统一走 `--xz-font`（sans，实测命中 Noto Sans SC），等宽 `--xz-font-mono` 带 CJK sans 兜底，`.xz-devcard-mac` 改 `.xz-devcard-devices`（原来「还没有绑定设备」在 `ui-monospace` 里被渲染成 NSimSun/新宋体）；新增 `npm run check:fonts`（`scripts/check-fonts.mjs`，真浏览器 + CDP 断言中文不落宋体）。2026-11-09 新增百智云语音服务商（`id=baizhi`，覆盖 ASR + TTS）：`adapters/baizhi-asr.js`（WSS `/realtime` + `AudioPacer` 实时节奏 + `input.commit`）、`adapters/baizhi-tts.js`（`POST /audio` WAV→PCM，不依赖 ffmpeg）、描述符与音色目录、`test/baizhi.test.mjs` 13 项（全量 247 项）。2026-11-09 控制台不再暴露厂商端点地址：描述符不提供 `url` 字段（火山 / 百智云 ASR 的 wss 地址内置在适配器里），`STAGE_META.asr.editFields` 也不含 `url`，所以手写的 `voice.asr.url` 继续生效、且不会被主用保存清成空串；回归断言在 `test/providers.test.mjs`。2026-11-09 再收一次 LLM 范围：**LLM 只保留 DeepSeek / 小米 MiMo**（用户要求），OpenAI / 火山豆包 / 讯飞星火从 LLM 段移除（`src/providers.js` 删 `openai`、`spark` 两个 provider 与 `volc.stages.llm`，`adapters/index.js` 的 `OPENAI_COMPATIBLE` 只剩 deepseek / mimo）——火山与讯飞的 TTS/ASR 不受影响；旧 settings 里的这些 LLM 条目加载时丢弃，手写主用建连时报 `unknown LLM provider`。2026-11-10 LLM 增加「复用 DSH」来源：`provider: 'host'` + `hostProvider` + `model`（免密钥，走 `host-llm.js` 的 `ctx.llm.stream`），控制台厂商清单来自 `GET /llm/providers`（`ctx.llm.listProviders()`）、模型清单来自 `?provider=`，`STAGE_META.llm.storageFields` 增加 `hostProvider`（备用条目也能是 host）；保存边界与构建期都用 `hostProviderIssue` 校验，坏值 400 或明确报错，不会等到用户说第一句话才失败。直连 deepseek/mimo 保留作回退与额度分流；全量 251 项。2026-11-10 角色模板换文案：控制台 `rolePresets.js` 的五段改为**原服务端** `xiaozhi-esp32-server` 的 `ai_agent_template` 种子（湾湾小何 / 星际游子 / 英语老师 / 好奇男孩 / 汪汪队长）逐字抄录，基准 `test/fixtures/role-presets.json`（从 SQL 导出），`check:role` 与 `test/role-presets.test.mjs` 双向比对；旧的官方 change_role.py 三套已整批替换；全量 254 项。
---

# dsh-xiaozhi 认知地图

## 一句话

ESP32 小智设备（固件 v2.5.3 分支）接进 Harness 的三件事：**局域网自入网**（OTA 指过来就登记）、**设备侧网关**（手表调 `/exec` 改服务器）、**实时语音管道**（VAD→ASR→LLM→TTS→Opus 定速下发，代际打断）。

## 入口点

| 入口 | 位置 | 说明 |
|---|---|---|
| Host 插件 apply | `index.js:apply` | 解析配置、装配 store/hub/gateway/ingress/control、两条生命周期 |
| 设备 HTTP | `src/ingress.js:handleRequest` | `/xiaozhi/ota/`、`/xiaozhi/v1/` 升级、`/healthz`，并先行转交网关 |
| 设备网关 | `src/gateway.js:handle` | `/health`（免鉴权）、`/commands`、`/exec`（Bearer） |
| 操作台 HTTP | `src/control.js` | Harness webServer 前缀 `/dsh-xiaozhi-7c3a`：全部路由开放（回环即管理员），写接口查 CSRF 头 |
| 控制台 UI | `src/client/**`（构建产物 `client.js`） | 概览 / 智能体 / 全局设置三个平级视图，内部路由；`npm run build` 用 esbuild 打包 |
| 服务商描述符 | `src/providers.js` | 控制台元数据唯一来源：`GET /providers` 下发；`settings.js` 的备用白名单由它派生；加厂商只改这里 + 适配器 |
| 运行时设置 | `src/settings.js` | `settings.json`（0600）：端点、固件、网关、语音 provider、**静音收口与语音默认参数**；全局人设字段仍在（API 保留），控制台不再编辑、改为按智能体配置；TTS 段只存「厂商 + 凭据」，音色归智能体级（2026-11-08）；无任何登录凭据 |
| 待审核存储 | `src/pending.js` | `pending.json`（0600，版本 1）：陌生设备身份/最近 IP/固件/尝试次数；批准后转 `devices.json`，拒绝即移除 |
| 地址发现 | `src/network.js` | 枚举本机 IPv4 私网地址，虚拟网卡（WSL/Hyper-V/VMware）排最后；`/state` 用它算 OTA/WS/网关的真实 URL |
| 浏览器面板 | `src/client/console/*.js` | `main` key `xiaozhi` + `sidebar.panellist` id `xiaozhi`：概览 / 智能体（卡片 + 配置弹窗 + 设备绑定弹窗 + 历史对话）/ 全局设置（服务商三张概览卡 + 二级弹窗，表单由 `src/providers.js` 描述符驱动；语音默认参数；接入与网关；TTS 只配厂商 + 凭据，音色在智能体「角色」页选，2026-11-08）/ 能力 |

## 核心数据模型

`PendingStore`（`src/pending.js`），单文件 `~/.dsh-xiaozhi/pending.json`（0600，版本 1）：**待审核队列**，不参与智能体/历史/工具装配。

| 字段 | 含义 | 不变量 |
|---|---|---|
| `deviceId` | 主键，OTA/WS 里的 `Device-Id` 归一化值 | 同一设备重复请求只累加 `attempts` |
| `clientId` / `lastIp` / `firmwareVersion` | 最近一次请求的上下文 | 批准时回填给 `DeviceStore.ensureDevice` |
| `firstSeenAt` / `lastSeenAt` / `attempts` | 审计 | 批准或拒绝后从队列移除 |

`DeviceStore`（`src/store.js`），单文件 `~/.dsh-xiaozhi/devices.json`：

| 字段 | 含义 | 不变量 |
|---|---|---|
| `deviceId` | 主键，MAC 归一化为 `AA:BB:CC:DD:EE:FF` | 同一物理设备只有一行 |
| `notes` | 备注 | 控制台设备弹窗可编辑 |
| `agentId` | 绑定的智能体 | 空串 = 未绑定（启动迁移给旧设备补建）；绑定是移动，不复制配置 |
| `overrides` | **已废弃**（迁移到智能体）：保留只为回滚，运行时只在没有绑定关系时才回落 | 新代码不要再读写它 |
| `nickName` / `notes` | 操作者标注 | 仅本机操作台可改 |
| `lastIp` / `lastSeenAt` / `lastConnectedAt` / `connectionCount` | 审计 | 只前进，不倒流 |

`AgentStore`（`src/agents.js`），单文件 `~/.dsh-xiaozhi/agents.json`（0600，版本 1）：**配置单位**。

| 字段 | 含义 | 不变量 |
|---|---|---|
| `id` | randomUUID，服务端生成 | 一台智能体可绑定 0..N 台设备 |
| `name` | 卡片标题 | 空串显示「未命名」 |
| `overrides` | 智能体级配置：`systemPrompt` / `voice` / `language` / `model` / `hostProvider` / `speed` / `silenceMs` | 空值即删除该覆盖，回落到全局默认；`language` 只收白名单；同一智能体的设备共用 |
| `memoryEnabled` / `toolDisabled` | 记忆开关 / 工具开关 | 记忆按智能体存（`memory/<agentId>.json`），历史仍按设备 |
| `createdAt` / `updatedAt` | 审计 | 改名/改配置只动 updatedAt |

启动迁移（`adoptLegacyDevices`，幂等）：每台没有 `agentId` 的设备各建一个智能体，把旧
`overrides` / `toolDisabled` / `memoryEnabled` 搬过去，并把 `memory/<deviceId>.json` 复制到
`memory/<agentId>.json`。`autoProvision: true` 时新设备由 `store.onCreated` 自动建智能体；
默认 `false` 时先入 `PendingStore`，控制台批准后再建档（可指定已有智能体，`provisionAgent=false` 避免多建一个）。
删智能体级联删绑定设备、历史与记忆（对齐参考 `deleteAgent`）。契约 `docs/agent-device.md`。

`SettingsStore`（`src/settings.js`），单文件 `~/.dsh-xiaozhi/settings.json`（0600，版本 3）：叠在 Loader 配置之上，保存后立即生效。`voice` 块里除三段 provider 外，还有**全局人设**（`systemPrompt`）与**静音收口**（`silenceMs`）——两者用 `null` 表示「控制台没设过」，此时沿用 Loader 配置；清空即回到 `null`。原「行为档案」页的其余字段（LLM/音色/ASR）本来就在这个向导里，没有第二份。2026-11-08 起 TTS 全局条目只存「厂商 + 凭据」：`voice` / `model` / `resourceId` 控制台保存时显式清空（服务端仍接受手工配置），音色由智能体 `overrides.voice` 决定，空值在运行时经 `resolveTtsVoice` 落到厂商默认。三段各带 `backups: Entry[]`（主用 + 备用，**条数不设上限**、同厂商可重复、顺序即优先级），条目密钥只以掩码出快照，写入按 `id` + 同 provider 才「留空=保留」；非法条目让整次保存失败（`update()` 先在副本上改、全过才替换）。

## 状态机

```
(不存在) --OTA/WS 首次出现--> 待审核 --approve(agentId)--> 已登记
      |                         |--reject--> (移出队列，下次请求重新申请)
      |--autoProvision=true--> 已登记
                                 |--remove--> (不存在，下次上电重新登记)
```

`PendingStore` 只保存设备身份与最近请求，不建会话、不建智能体；批准时 `ensureDevice` + `setAgentId`
（未指定 `agentId` 则走 `onCreated` 自动建一个）。设备在待审核期间收到 `403 device-pending`，批准后
下一次 OTA/WS 才通过；控制台「智能体」页顶部展示待审核列表。

长连接：同 `deviceId` 新连接把旧连接以 4001 关闭；map 先交换再驱逐，`unregister` 按实例身份比对。

语音会话（`src/voice/session.js`）：`idle → listening（VAD 收口）→ thinking（LLM）→ speaking（TTS/定速下发）→ listening`；打断（`abort` / barge-in）走 `cancel → generation++ → 清队列 → tts_stop`，发送循环按代际丢弃旧帧。

## 关键决策与原因

1. **不做登录**：控制台由只监听回环的 Harness Web 服务提供，能打开面板就等于拥有本机。写接口只保留 `x-dsh-xiaozhi` CSRF 头；口令、会话、角色守卫、越权告警全部删除，少一层长期维护成本。
2. **密钥只进不出**：`GET /settings` 返回 `••••` 掩码 + `hasToken/hasApiKey`；写接口"留空=不改"，`clearToken/clearApiKey` 才清空。表单回填掩码而不会把掩码写回。
3. **运行时覆盖，不重启**：settings 叠加在 Loader 配置之上，保存后重建 gateway、改写 endpoints/firmware、更新 voice 默认 provider；`gatewayRef` 让 ingress 每次请求取当前实例。
4. **管理端而非单纯网关**：家里会有多台设备，所以配置的单位是"这台设备"（`overrides` 叠在全局默认之上），全局默认只有「全局设置」一份；旧的「行为档案」层已删除，不再有"改档案影响一批设备"这种间接路径。
5. **不做激活码，默认待审核**：激活码/HMAC 是云控制台的多租户产品流程；局域网单管理员没有账号可绑，所以 `activation` 恒为 `null`，`/activate` 只留 200 兼容占位。但“指过来即登记”不再是默认：`autoProvision: false`（默认）时陌生设备进 `pending.json`，控制台选择智能体并批准后才建档（`POST /pending/approve`）；`autoProvision: true` 才恢复零接触自动登记。待审核解决的是“谁可以入网”，不是官方六位绑定码的“设备归哪个账号”。
6. **设备网关按固件契约实现**：`/health`、`/commands`、`/exec` + `Bearer`，与 `main/server_gateway.cc` 的 `self.server.exec`/`self.server.commands` 对齐；`/exec` 回 200 + `[exit N]`，因为手表把正文念给模型。
3. **网关默认关闭**：`gateway.token` 为空时 `/exec` 直接 404；白名单 argv、参数逐项白名单、限流、失败锁定、超时与截断都在 `src/gateway.js` 内强制。
4. **两个监听面**：设备入口必须 LAN 可达且无浏览器凭据；操作台是 loopback，改名这类动作不暴露到 LAN。
5. **端点回显 Host 兜底**：`endpoints.lanWsUrl`/`wanWsUrl` 为空时，把设备自己请求用的 Host 回给它，按定义可达。
6. **自实现 WebSocket 服务端/客户端**：插件零依赖安装，`ws` 不可用；Edge 侧客户端还要自定义头（Node 内置 WebSocket 不支持）。
7. **主用 + 备用服务商（2026-11-06）**：一段能力的凭据经常不止一把（多账号/多厂商），所以每段是「主用 + 有序备份」候选链，运行期失败自动切、成功后粘 5 分钟再回主用。切换粒度按环节定：LLM 只在未出字前、TTS 整句重缓冲、ASR 回放 PCM（≤60s）；一条备用配错只跳过不打死链路。**备用条数不设上限**（2026-11-08 去掉原来的 5 条上限：服务端 `normalizeBackups`/`loadBackups` 不再校验/截断条数，控制台「添加」按钮永不禁用、标题只显示 `备用 N 个`）。契约 `docs/backup-providers.md`。
8. **LLM 主路径 = 插件直连厂商（2026-11-07）**：不再走 Harness 宿主 `llm` 服务。智能体级覆盖只改模型名，`src/device-config.js` 不再把设备 `hostProvider` 强切成 `provider:'host'`（线上曾因此持续 `no adapter registered for provider "…"`，设备只有聆听中）。新增小米 MiMo（`mimo`）：OpenAI 兼容但认证头是 `api-key`，**模型清单从 `GET /v1/models` 实时拉取（代码不内置模型 id）**，语音场景 `thinking:{type:'disabled'}`；`host` 仅保留为全局显式选项。
9. **联网工具要能读正文（2026-11-07）**：`web_search` 固定 `need_content:true` 并回传正文摘录（单条 ≤900、整批 ≤3800 字），新增 `web_fetch`（DeepSeek Fetch，Markdown ≤3500 字）让模型能读具体页面；两个工具共用 DeepSeek Key（主用非 DeepSeek 时从备用链找），Key 用运行时 getter，控制台保存即生效。
10. **对话历史 = 会话 + 消息 + 音频（2026-11-07）**：控制台「设备 → 历史」按 WS 连接分段的会话浏览（对齐官方 ai_agent_chat_history / ai_agent_chat_audio 的本地实现）。`history/<device>.jsonl` 每条消息一行（`session`=连接 session_id，role，content，audioId），音频 WAV 存 `history/audio/<device>/`；旧 `{at,user,assistant}` 行读取时按 10 分钟间隔聚合迁移。文本 5000 条/设备、音频 30 天 + 500MB、单条 120s 截断；写盘 fire-and-forget，失败只 warn。契约 `docs/history.md`，入口 `src/history.js` + `src/control.js`（`/history/*`）。
11. **配置 UI：三张概览卡 + 二级弹窗（2026-11-08 改版）**：全局设置 = 三个环节概览卡（ASR/LLM/TTS，每张 = 主用厂商 + 摘要 + 密钥/备用数/降级链 + 状态点），点「管理」进 `xz-stage-modal`——弹窗里主用卡一整行（`[编辑][测试]` 与状态点在标题行右侧）、备用纵向列表（单行三段式：`序号+厂商+状态` / 摘要 / 右侧 `[编辑][⋯]`；`⋯` 是 `position:fixed` 浮层菜单，**不在行内展开**——行内展开会把行撑高、列表跳动，2026-11-09 收敛）、底部整行添加；② 语音默认参数（静音收口/回复长度/回复速度）③ 接入与网关（默认折叠）④ **没有保存按钮**：改动防抖 700ms 自动 `POST /settings`（保存期间又有改动就等下一轮，回写不覆盖新输入），底部只显示保存状态。**未落盘时测试按钮变「保存并测试」**（先 `POST /settings` 再按服务端顺序测）。**人设从全局设置移除**，只在「智能体 → 配置 → 角色」按智能体设置（`save()` 仍原样透传 `systemPrompt`）。设备「配置」也是弹窗（`AgentConfigDialog`，根层渲染，避开卡片 backdrop-filter 包含块）。下拉统一为 `PillSelect` 胶囊浮层：`position:fixed` + 视口 clamp/翻转，打开不改变 `document.scrollHeight`；`fixedContainingBlock()` 处理 `backdrop-filter` 祖先；`.xz-app`/`.xz-content` 加 `scrollbar-gutter:stable` 兜底。规范 `docs/pill-popover.md`。
12. **TTS 归属：全局 = 厂商 + 凭据，智能体 = 音色/模型（2026-11-08）**：全局设置 → TTS 合成只配厂商与凭据（volc = API Key；xunfei = APPID/APIKey/APISecret；edge 免密钥），主用/备用编辑弹窗都只留这些字段；保存时把全局 `voice` / `model` / `resourceId` 显式清空。音色（= TTS 模型族）改在「智能体 → 配置 → 角色」按智能体选，首项「默认音色」= 不覆盖，留空 = 厂商默认（`DEFAULT_TTS_VOICES`：火山 `zh_female_vv_uranus_bigtts` / Edge `zh-CN-XiaoxiaoNeural` / 讯飞 `xiaoyan`）。`src/voice/adapters/index.js` 的 `buildTtsAdapter` 统一走 `resolveTtsVoice`，所以主用/备用条目只存凭据也能构建；设备级音色只覆盖主用，备用用各自厂商默认音色；`session.build` trace 与 `/test/provider` 回显实际生效音色。**音色列表**：火山主用可另配 AK/SK（复用 `appId`/`apiSecret` 槽位），`GET /voices` 调官方 `ListSpeakers` 返回真实可用音色（`src/voice/volc-sign.js` + `volc-speakers.js`，缓存 10 分钟）；没配则回内置清单并标 `source:'catalog'`。

13. **智能体 = 配置单位，设备 = 物理单位（2026-11-08）**：对齐参考服务端 `ai_agent` / `ai_device.agent_id`——人设/模型/音色/语种/记忆/工具在智能体上，一台智能体可绑定多台设备；控制台页面从「设备」改名「智能体」，卡片 = 智能体，设备操作收进「设备(N)」弹窗。删智能体级联删绑定设备（与 `deleteAgent` 一致），所以做二次确认。旧数据启动时各建一个智能体并复制记忆，行为不变。契约 `docs/agent-device.md`。

14. **控制台客户端：React + esbuild 多文件（2026-11-08）**：宿主用 `window.__ModuleLoader__.load({ factory(require) })` 加载单文件产物，React 来自页面模块表（`require('react')`），slot 只收 React 组件——**Vue 不能直接用**（`require('vue')` 不存在；`dsh.client.external` 只能声明页面已提供的模块）。要换只能把 Vue 打进产物再用 React 桥挂载，双框架不划算。源码拆到 `src/client/**`（core/i18n/styles/ui/views/agents/settings/console），`npm run build`（esbuild，React external）生成 `client.js`，`npm run smoke` 用真实 React SSR 渲染主要页面。契约 `docs/client-architecture.md`。

15. **服务商描述符：元数据与前端解耦（2026-11-08）**：`src/providers.js` 是唯一元数据来源（`id/name/group/stages`，每段声明 `fields/summary/secretFields/probe` 等），`GET /providers` 下发；client.js 打包一份首屏兜底，启动后 `setProviders()` 覆盖。`settings.js` 的备用白名单由 `allProvidersForStage()` 派生（含 `hidden` 的 funasr）。前端 `core.js` 的 provider 辅助与 `ProviderDialog`/`SchemaForm` 全部读描述符，没有 `stage ===`/`provider ===` 分支；加厂商 = 描述符 + 适配器/preset，**前端 0 改动**。契约 `docs/provider-descriptors.md`。

16. **待审核设备（2026-11-09）**：陌生设备不再直接写 `devices.json`，而是进 `PendingStore`（`pending.json`）；控制台「智能体」页顶部展示，管理员为每台设备选择已有智能体或“自动创建”，`POST /pending/approve` 后 `ensureDevice` + `setAgentId`，拒绝走 `POST /pending/reject`。`autoProvision: false` 是默认值；`true` 恢复旧的自动登记。这样既不需要官方六位绑定码，也不会让同网段任意设备自动占用智能体。

17. **中文只用一条字体栈，等宽只给 ASCII（2026-11-09）**：控制台正文 `--xz-font` = `-apple-system…"Segoe UI","Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif`（本机实测中文命中 Noto Sans SC、西文 Segoe UI）；等宽 `--xz-font-mono` 额外带 CJK sans 兜底，MAC/IP/URL/JSON 之外不许用。两次实测的坑：① `.xz-devcard-mac{font-family:ui-monospace,monospace}` 曾把「还没有绑定设备」「1. 手表 ●」渲染成 **NSimSun（新宋体）**，已拆成 `.xz-devcard-devices`（sans）；② **这台机器的浏览器把 `sans-serif` 映射成 SimSun**，`.xz-hint`（「没有其他设备」）因无自己的字体声明而继承裸 `sans-serif`，变成宋体——已加 `.xz-hint{font-family:var(--xz-font)}` + 弹窗内 12px/`--xz-text-2`。回归守卫 `npm run check:fonts`（`scripts/check-fonts.mjs`，真浏览器 + CDP）**把 sans-serif 预设强制改成 SimSun** 再断言中文不落宋体、各提示与正文同字体、MAC 仍等宽，改回旧写法即 exit 1。细节见 `AGENTS.md` § 八「字体」。

18. **角色只在控制台配，语音不再切角色（2026-11-09）**：`change_role` 工具按用户要求下掉（`src/tools.js` 的注册与 `ROLE_PROMPTS` 已删，`test/tools-extra.test.mjs` 改反向断言防回归）；角色 = 智能体的 `systemPrompt`，只在「智能体 → 配置 → 角色 → 人设」改，保存后该智能体的设备**下次连接**生效。三套官方提示词没丢，挪到 `src/client/agents/rolePresets.js`，在「人设」右侧做成 **角色模板** `PillSelect`（默认「自定义（不改动）」，选中整段替换、`{{assistant_name}}` 换成智能体名，手改后回落「自定义」）——纯前端，不注册工具、不动语音链路。交互回归 `npm run check:role`（`scripts/check-role-preset.mjs`，jsdom）。`src/voice/session.js` 的 `change_prompt` 处理保留为协议位（当前无工具产出）。

## 语音管道（src/voice/）

| 模块 | 不变量 |
|---|---|
| `segmenter.js` | 首句出得早；`3:30`/`1.` 不误切；`<think>` 跨 delta 也不漏；emoji/代码块不进 TTS |
| `elements.js` | 队列入队有界；代际不匹配的帧物理丢弃；120ms 前瞻信用的定速发送 |
| `session.js` | 每个 turn 一个 AbortController；ASR 流按 utterance 生命周期；TTS 串行保序；判停默认 `vadMode: device`（等固件 `listen stop`），`energy` 只给不发 stop 的老固件兜底 |
| `codec.js` / `ogg.js` | 上行 opus 逐包封 Ogg 喂 ffmpeg；下行 PCM 编码后拆包；一 session 一解码进程 |
| `ws-client.js` | Edge 需要自定义头，故不依赖 Node 内置 WebSocket |
| `adapters/failover.js` | 主用 + 备用候选链：LLM 未出字前切换、TTS 整句缓冲重试、ASR 60s PCM 回放且回放不推 partial；abort 不算失败；粘性 5 分钟回落；切换记 `*.failover` trace |
| `language.js` | 输出语种白名单（普通话/英语/日语/粤语/韩语）+ `<output_language_directive>`；非白名单值一律退化为空，因为该文本会拼进系统提示词 |
| `voices.js` | 音色目录；`languages` 取自官方 `ai_tts_voice.languages`，未标注的音色省略该字段（未知 ≠ 不支持）；每条 volc 音色带 `tier`（2.0 / 1.x），`seed-tts-2.0` 只接受 uranus / saturn，选错会回 55000000「有字没声」；2026-11-08 新增 `DEFAULT_TTS_VOICES`（每厂商默认音色）、`defaultTtsVoice(provider)`、`resolveTtsVoice(provider, voice)`——空 → 厂商默认、跨厂商残留 → 回落本厂商默认、自定义 ID 原样保留；2026-11-09 新增百智云音色（`vivi` / `xiaohe`，带 `speed: true`）与 `voiceSupportsSpeed()` |
| `adapters/baizhi-asr.js` | 百智云实时识别：`AudioPacer` 把「会话喂多快」压成「100ms 一帧的真实节奏」，排空后才 `input.commit`；上行固定 16kHz（构建期校验）；`transcript.delta` 累加、`transcript.final` 覆盖，按 `segment_index` 拼接；永不 reject（错误帧走 `{text, error}`，避免 unhandled rejection 打死进程） |
| `adapters/baizhi-tts.js` | 百智云合成：`POST /openapi/v1/audio` 返回 24k 单声道 WAV 整段，WAV 头在 JS 里剥掉（**不需要 ffmpeg**）；请求 16k 时线性插值重采样（只用于 ASR 探针）；`speed` 只在音色声明支持时下发 |

历史/记忆（`src/history.js` / `src/memory.js`）：`HistoryStore` 管「说过什么」的只读流水（会话/消息/WAV 音频，30 天音频保留）；`MemoryStore` 管「要记住的信息」（facts + 最近 8 轮，注入 prompt）。两者都按 deviceId 隔离，`VoiceSession` 在每轮收尾时分别写入，互不阻塞语音。

实测（`node --test "test/*.test.mjs"`，233 项全绿）：真 Opus 整轮 277ms；mock 供应商首帧 40–100ms；打断 <100ms 且无幽灵帧；20 轮无泄漏；真实 Edge 首包 1.3–1.5s（整句合成后才吐包），是端到端预算的主要项。

## 验证

- 单测/集成：`test/unit.test.mjs`、`test/http.test.mjs`（含网关 8 项、设备级语种白名单）、`test/settings.test.mjs`（人设/静音收口持久化与空值回落、备用服务商持久化/掩码/留空保留/整次失败/`/test/provider`、「全局 TTS 只存凭据、可清空 voice/model/resourceId」）、`test/failover.test.mjs`（三段候选链 26 项）、`test/tts-defaults.test.mjs`（4 项：凭证-only 主用/备用构建、空音色→厂商默认、跨厂商回落与自定义保留）、`test/voice*.test.mjs`、`test/voice-language.test.mjs`（白名单/指令/音色语种/豆包 additions）、`test/history.test.mjs`（13 项：会话聚合/标题/旧格式迁移/裁剪/音频 WAV 与路径安全/保留期清理）、`test/history-http.test.mjs`（5 项：4 条路由 + CSRF/404/400）、`test/agents.test.mjs`（5 项：旧设备迁移与记忆复制 / 多设备绑定与移动 / 配置共享 / 级联删除 / 历史合并）。
- 已安装实例：`/healthz` 报 devices/connections/gateway/voice；操作台 `/state` 面板可改名/删除。
- 字体：`npm run check:fonts`（`scripts/check-fonts.mjs`，需 Edge/Chrome，真浏览器 + CDP `CSS.getPlatformFontsForNode`）断言「中文不落宋体族 + 空态/设备行与正文同字体 + MAC 仍等宽」，故意改回 `ui-monospace` 会 exit 1。
