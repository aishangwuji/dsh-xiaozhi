# dsh-xiaozhi 现状笔记

这份文件记录 dsh-xiaozhi 当前的样子：插件和手表各自怎么跑、怎么单独验证、两边怎么接上、以及实际踩到过的现象和对应关系。写的是"现在是这样"，不是规范，也不是计划。

## 零、改动纪律（每次改代码都要遵守）

**改代码 = 改这份文件。** 任何一次改动（新增/修改功能、接口、配置项、数据字段、UI 结构、修 bug、踩坑处置），都必须在**同一次改动里**更新本文件对应的小节；只改代码不更新这里，视为改动未完成，交接和评审按此判定。

具体约定：

- 新增能力必须写清四件事：**是什么、入口在哪（文件 + 符号名）、生效条件（要不要重连/重启）、怎么验收**。
- 删掉或改名的东西，同步删掉本文里的旧描述；有历史价值的（为什么删）挪进 § 七 排障表或对应 `docs/` 的变更段。
- **未实测的结论必须标「未实测」**，推断与实测分开写；不要把推断写成既成事实。
- 结论变化时主动撤回旧结论，不要留两句互相矛盾的话。
- 与下面三处一起维护，可以互相引用，但**不许互相矛盾**：
  - `README.md`：使用者视角（怎么接设备、端点、控制台、内置工具、限制）。
  - `systemmap/overview.md`：认知地图（入口点、数据模型、状态机、关键决策与原因）。
  - `docs/*.md`：单能力契约（智能体/设备、备用服务商、历史、PillSelect、语种对照、与官方差异审计）。
- 改完至少跑一遍 § 五 的命令（全量单测 + 构建 + 冒烟 + 交互检查 + 语法检查），结果写进交付说明。

## 一、两端分别是什么

**服务端**：DSH 插件，就是本目录。跑在 DSH 主进程里，**有两个面，不要混**：

| 面 | 地址 | 谁在用 | 路由 |
|---|---|---|---|
| 设备面 | `0.0.0.0:8989`（插件自己 `net.createServer`，配置项 `host` / `port`，也接受 `iot_gateway.*` 包裹） | 手表固件 | `GET/POST /xiaozhi/ota/`、`POST /xiaozhi/ota/activate`（占位）、`Upgrade /xiaozhi/v1/`（语音 WS）、`GET /healthz`、网关 `/health` `/commands` `/exec` |
| 操作台面 | **宿主 Harness 的 webServer**，前缀 `/dsh-xiaozhi-7c3a`（`control.prefix`） | 控制台页面（浏览器） | 主要路由：`GET /state`、`/agents*`、`/devices*`、`/memory*`、`/tools*`、`/history*`、`/settings`、`/models`、`/voices`、`/providers`、`/llm/providers`、`/asr/local`、`/test/*`、`/probe/ota`、`/crashes*`、`/events`（完整清单见 `src/control.js`） |

- **控制 API 不占 8989**：靠 `ctx.webServer.register({ kind: 'prefix', path: control.prefix })` 挂在 Harness 自己的 Web 服务上，所以端口跟着 GUI 走（DSH 每次重启都会变），设备入口始终是 8989。
- 写接口（POST）必须带 `x-dsh-xiaozhi: 1` 头（CSRF），缺了回 403；读接口不校验——控制台由只监听回环的 Harness Web 服务提供，能打开面板就等于本机管理员。
- 配置优先级：插件自带 `cordis.patch.yml` 的默认值 → profile 的 `cordis.patch.yml`（当前**没有** dsh-xiaozhi 覆盖行）→ 控制台保存的 `settings.json`（运行时叠在上面，保存即生效）。
- 数据目录 `~/.dsh-xiaozhi/`（`dataRoot` 可配）：
  - 现役：`devices.json`（硬件名册）、`agents.json`（配置单位，0600、版本 1）、`settings.json`（0600、版本 3）、`memory/<agentId>.json`、`history/<deviceId>.jsonl` + `history/audio/<deviceId>/*.wav`、`voice.log`（JSONL trace）、`crash.log`。
  - **遗留、代码已不读写**：`profiles.json`、`tools.json`（旧「行为档案」页与旧全局工具开关留下的），可手工删，删了不影响任何链路。

**端侧**：`D:\Demo\esp-xiaozhi\xiaozhi-esp32`，板子是 waveshare ESP32-S3-Touch-AMOLED-2.06，target `esp32s3`，分区表 `partitions/v2/32m.csv`（32MB flash，NVS 在 `0x3B000`，840K）。

两边只通过 WebSocket 说话：OTA 拿地址 → 唤醒时建连 → hello 交换 → 音频上下行。

## 二、一次完整对话在两端各是什么样子

1. 手表开机 → `Ota` 按顺序试地址（NVS `ota_url` → mDNS 发现 → 编译期 LAN → 云端），拿到 `websocket.url` 和 `token`。
2. 唤醒词/点屏幕 → `WS: Connecting to websocket server: ws://<host>:8989/xiaozhi/v1/`。
3. 设备发 `hello`（version/transport/audio_params），服务端回 `hello`（含 `session_id` 和音频参数）。
4. 设备发 `listen start`，持续上行 Opus（16k/60ms）；服务端 `VoiceSession` 解码成 PCM、喂 ASR。
5. 判到句尾 → 服务端回 `stt` 文本 → LLM 流式 → 分句 → TTS → 下行 Opus（24k/20ms），状态消息是 `tts start` / `sentence_start` / `sentence_end` / `stop`。
6. 设备状态只在收到 `tts start` / `tts stop` 时变（固件里没有客户端判停逻辑）。

服务端每台设备一个 `VoiceSession`，adapter 按「全局默认 + 智能体覆盖」缓存，**改了配置要重连才生效**；插件代码本身要重启 DSH 才生效（见 § 十一）。

## 三、判停：当前是设备说了算

- 固件里 AFE VAD 的参数来自 `main/audio/engines/afe_audio_engine.cc`：`vad_mode = VAD_MODE_2`、`vad_min_noise_ms = 300`（2026-11-06 为抗环境音误触发从 0/100 调高）。
- 固件在 `application.cc` 的 `MAIN_EVENT_VAD_CHANGE` 里记 `vad_speaking_`，从"说话"转到"静音"且处于 listening 时发 `listen stop`，串口打印 `VAD end of speech, sending listen stop`。
- 服务端 `voice.vadMode` 默认 `device`：收到 `listen stop` 才收口，音频持续喂 ASR，不再用自己的阈值判句尾。
- `vadMode: energy` 是给"不发 listen stop 的老固件"留的兜底：`silenceMs 400`（对齐 Go 服务端 `chat_max_silence_duration`），`minSpeechMs 120` / `vadThreshold 0.03` 是能量 VAD 自己的参数，和原厂神经 VAD 的 0.5/0.4 不是一个量纲。

## 四、地址：mDNS 优先，云端兜底

- 插件在 `src/mdns.js` 广播 `_xiaozhi._tcp`：SRV 端口 8989、TXT `path=/xiaozhi/ota/`、A 记录是本机 IPv4，主机名 `xiaozhi.local`。每 60 秒重新取一次地址再广播。
- 这台机器同时有 Clash TUN（`198.18.0.0`）、`2.0.1.9`、VMware 网段、`169.254.x` 这些地址，多播默认跟着路由表走会从 TUN 出去。当前的做法：只广播 RFC1918 + `100.64/10`（`isLanAddress`），公告按网卡逐个发（`setMulticastInterface`），回答查询时从查询方所在网段回。
- 固件 `ota.cc` 的 `ResolveOtaUrlFromMdns()` 查 `_xiaozhi._tcp`，用 SRV 的 host/port 和 TXT 的 path 拼出 `http://<ip>:8989/xiaozhi/ota/`，串口打印 `mDNS: found ...`；一条公告里有多个 A 记录时，挑与手表自己同网段的那个（`esp_netif_get_ip_info` 拿自身 IP/掩码）。
- 候选顺序：NVS 手工 `ota_url` → mDNS → 编译期 `CONFIG_OTA_URL_LAN`（当前为空）→ `CONFIG_OTA_URL`（云端 `https://api.tenclass.net/xiaozhi/ota/`）。
- mDNS 查不到（路由器隔离多播等）时自然落到云端，设备仍然能用，只是换成了小智官方服务。
- OTA 返回的 `websocket.url` 是按请求的 `Host` 拼的，设备走哪条 OTA 就拿到哪一侧的地址。

## 五、服务端怎么测

单测 + 语法检查（改完必跑）：

```powershell
cd D:\Demo\esp-xiaozhi\dsh-xiaozhi
node --test "test/*.test.mjs"          # 全量 221 项，必须全绿
npm run build                          # src/client/** → client.js（esbuild，React 保持 external）
npm run smoke                          # 真实 React SSR 渲染主要页面 + slot 注册校验
npm run check:ui                       # jsdom 交互检查：概览卡 → 弹窗 → 添加 → ⋯ → 模型回显 → 自动保存
node --check client.js                 # 构建产物语法检查
```

当前 221 项，覆盖分句、VAD、Ogg/Opus 往返、mock 整轮、打断、20 轮、语种、音色族、**TTS 默认音色**（全局只存凭据可清空、只带凭据的主用/备用条目可构建、空音色→厂商默认、跨厂商残留→本厂商默认、自定义 ID 原样保留）、设备级覆盖合并（含「设备 hostProvider 不再强切 host」）、全局设置（人设/静音收口、`applyRuntimeSettings` 的 hostProvider/backups 叠加回归）、备用服务商（持久化/掩码/留空保留/整次失败/**条数不设上限**/`/test/provider`）、**服务商描述符**（描述符与 `BACKUP_SPEC` 白名单一致、字段可存储、stage 级名字覆盖、`hidden` 只存不展示、`GET /providers` 路由，`test/providers.test.mjs` 6 项）、**ASR 在线测试**（TTS→ASR 编排：分块喂 PCM、TTS mock/无音频/ASR error 的报错，`test/asr-probe.test.mjs` 5 项）、**火山官方音色列表**（HMAC 签名按官方 GET/POST 向量验证、ListSpeakers 分页/缓存/错误、无 AK/SK 回退内置清单，`test/volc-sign.test.mjs` 4 项 + `test/volc-speakers.test.mjs` 4 项）、**设备侧 MCP/IoT**（MCP initialize/tools/list/tools/call 与工具名清洗、IoT descriptors/states/commands，`test/device-mcp.test.mjs` 5 项 + `test/device-iot.test.mjs` 2 项）、**外部 MCP（stdio）**（子进程 JSON-RPC initialize/tools/list/tools/call，`test/mcp-stdio.test.mjs` 1 项）、**外部 MCP（SSE / Streamable HTTP）**（本地 HTTP server 走通 initialize/tools/list/tools/call，`test/mcp-http.test.mjs` 1 项）、**MCP 接入点**（WebSocket JSON-RPC initialize/tools/list/tools/call，`test/mcp-endpoint.test.mjs` 1 项）、**服务端插件工具**（newsnow 热榜 / QWeather 天气 / Intl 农历，`test/tools-extra.test.mjs` 3 项）、三段 failover（LLM 未出字前切换、TTS 整句重试、ASR 回放不推 partial、abort 不切换、粘性回落）、mDNS 报文与地址过滤、小米 MiMo（api-key 认证头 / thinking / SSE / 工具调用 / 模型清单走 /v1/models 无内置兜底）、联网工具（Search 带正文与截断预算 / web_fetch 正文与 403·404 语义 / 动态 Key / 无 Key 回退）、对话历史（会话聚合与标题 / 旧格式 10 分钟迁移 / WAV 读写与路径安全 / 30 天保留与容量清理 / clear 粒度 / 4 条 HTTP 路由）、**智能体/设备绑定**（旧设备迁移与记忆复制 / 多设备绑定与移动 / 解绑 / 配置共享 / 级联删除 / 历史合并，`test/agents.test.mjs` 6 项）。

**不接手表也能做的三种探针**：

- **健康面**：`curl http://127.0.0.1:8989/healthz` 应返回 `ok:true` 与 devices/connections/gateway/voice；这是判断"设备面还活着、拿到的是哪版代码"最快的办法。
- **验证 WS hello**：手写 WebSocket 帧连 `ws://127.0.0.1:8989/xiaozhi/v1/`，带 `Device-Id` / `Client-Id` / `Authorization` 头，发一条 hello，看是否收到服务端 hello。不插手表就能判断"服务端建会话这一步通不通"。
- **验证 mDNS**：启动 responder 后往 `224.0.0.251:5353` 发一条 PTR 查询，看是否收到 PTR，以及附加段里的 SRV/TXT/A（esp32 的 mdns_query_ptr 就是靠附加段拿到端口和路径的）。

**离线验证下行链路**：用 mock LLM/ASR + 真实火山 TTS + 真 `encodePcmToOpus`，sink 只数帧。跑一次能看到 `volc.done` 的字节数、`tts.encoded` 的包数、二进制帧数和字节数。

**不经过 ASR/LLM 验证 TTS**：

```powershell
POST /dsh-xiaozhi-7c3a/devices/inject  {"deviceId":"...","text":"测试播报，一二三。"}
```

手表在线时直接用同一条 TTS 链路播出去，是最快区分"TTS 有问题"还是"识别/模型有问题"的办法（控制台的「播报」就是把它发给智能体名下所有在线设备）。

**看日志**：`~/.dsh-xiaozhi/voice.log`（JSONL，一行一个事件）。常用事件：`session.build`（这次用的音色/资源/模型/提示词长度/maxTokens）、`vad.start`/`vad.end`、`asr.result`/`asr.empty`/`asr.error`、`turn.empty_close`、`tts.begin`/`tts.pcm`/`tts.encoded`、`volc.request`/`volc.first`/`volc.done`、`ws.json`（每条下发的 JSON + 当时帧数/字节数）、`ota.request`、`session.close`。

## 六、端侧怎么测

编译（这台机器上的位置）：

```powershell
$env:IDF_TOOLS_PATH='D:\APP\espressif'
. 'D:\APP\esp-idf-6.0.1\export.ps1'
cd D:\Demo\esp-xiaozhi\xiaozhi-esp32
idf.py build
idf.py -p COM8 flash
```

手表插 USB 后是 `VID_303A&PID_1001`（USB Serial/JTAG），当前是 `COM8`，115200。拔掉时系统里只剩几个蓝牙虚拟串口，`GetPortNames()` 里没有 COM8 就是没插。

抓串口：用 `System.IO.Ports.SerialPort` 读 `ReadLine()`。注意 `StreamWriter` 有缓冲，脚本里要 `Close()` 之后文件才完整；另外打开端口期间 `idf.py monitor` 会冲突。

开机日志里值得盯的行：

- `Ota: Current version: ...` / `Ota: Current is the latest version`
- `Ota: mDNS: found <ip> -> http://<ip>:8989/xiaozhi/ota/`
- `Ota: Checking version at ...` / `Ota: OTA response from ...`
- `WS: Connecting to websocket server: ws://... with version: 1`
- `WebSocket: handshake done` 之后如果紧跟 `WS: Websocket disconnected` 再 `E ... Failed to receive server hello`，就是服务端握手后没发 hello
- `VAD end of speech, sending listen stop`
- `StateMachine: State: connecting -> idle` 表示连接没成，回空闲

读设备里存的地址（只读，不动分区）：

```powershell
python -m esptool --chip esp32s3 --port COM8 read-flash 0x3B000 0xD2000 "$env:TEMP\nvs.bin"
```

在 dump 里能直接看到 NVS 存的 `ota_url` / `websocket url` / `mqtt endpoint`。刷 app 分区不会改 NVS，这一点用 dump 前后对比验证过。

## 七、联动排障：现象 → 实际原因

| 现象 | 当时看到的东西 | 实际原因 |
|---|---|---|
| 屏幕"连接中"，约 10 秒后报错 | 串口 `handshake done` → `Websocket disconnected` → `Failed to receive server hello`；`voice.log` 里没有 `session.build` | 服务端 `voice.build` 抛异常（那次是 `index.js` 里把 `resolvedProfile` 写成了 `effective`，ReferenceError），WS 握手后直接断，hello 发不出去 |
| 有回复文字、没有声音 | `voice.log` 有 `llm` 输出但没有 `volc.done`；火山回 `55000000 resource ID is mismatched with speaker` | 音色属于 1.x（`moon`/`mars`），资源族是 `seed-tts-2.0`。2.0 只收 `*_uranus_bigtts` 和 `saturn_*_tob` |
| 换了音色还是没声 | 智能体「角色」页 / `session.build` 的 `voice` 还是旧值；智能体覆盖只在新连接时生效 | 运行中的会话用的还是建连时缓存的 adapter（2026-11-08 起音色只在智能体级改，全局设置里已没有音色可改） |
| 一直"聆听中"、不说话 | `voice.log` 里 `vad.start` 后紧跟 `llm.error: LLM HTTP 400 ... passed deepseek-v4.1-flash` | 智能体覆盖里存的是 Harness 厂商（opencode-go）的型号，但请求打到了直连 DeepSeek 端点；`provider` 没跟着切成 `host` |
| 唤醒后连不上、之前能连 | 串口 `Connecting to websocket server: ws://192.168.43.10:8989/...`；PC 的 WLAN 地址已经变成 `192.168.0.151` | 设备 NVS 里存的是上次 OTA 给的旧 IP，PC 换网段后失效（这也是加 mDNS 的直接原因） |
| 字幕被撑出屏幕、长语音像接不住 | `voice.log` 里每轮有一串 `ws.json stt` | 服务端按 ASR 中间结果逐条推 `stt`，固件对每条 `stt` 都新建气泡（`lcd_display.cc:539`）。现在默认只发整句 |
| 人设改了不生效 | `session.build` 的 `promptChars` 很小 | 会话每轮用 `config.systemPrompt` 重写 LLM 提示词，而 `config` 里当时没有这个字段，人设被覆盖成空串 + 记忆 |
| 主用 Key 挂了但没切到备用 | `session.build` 的 `llmCandidates` 是 1；`voice.log` 没有 `llm.failover` | 三种可能：备用还没自动保存完（或保存失败，看底部状态条）、设备还是上一轮连接（配置下次连接生效）、该轮 LLM 已经出了字（出字后按契约不切换） |
| 设备显示「聆听中」、说什么都没反应 | `voice.log` 每条 utterance 只有 `asr.empty`（没有 `asr.result`）；用 TTS 合成一句话再喂 ASR 的探针能正常识别 | 2026-11-06 实际踩到：① ASR Resource ID 选了 1.0 的 `volc.bigasr.*`，与 `bigmodel_async` 端点不匹配，握手直接 403；② 旧 failover 只看 `text`，把 `finish()` 返回的 `{text:'', error}` 当成“成功但为空”，本地备用永远不启用；③ adapter 缓存 key 没带 ASR 配置，改完 Resource ID 重连仍命中旧 adapter。已修：只列 2.0 资源、`result.error` 当候选失败、缓存 key 覆盖三段全量配置 |
| 只能聊一轮，之后一直「聆听中」 | 第一轮 `asr.result` 后，后续每句 `asr.empty`（甚至 `45000002 No audio was received`）；串口反复 `VAD end of speech, sending listen stop` | 固件只在 Speaking 收到 `tts stop` 才回 Listening；服务端对空 ASR 不回包，固件停在 Listening 反复发 stop，服务端 `capturing=false` 丢音频 → 死锁。长回答（TTS 念十几秒）时用户插话最容易触发。已修空回合收尾（`turn.empty_close`），并把默认回答长度压到 120 tokens |
| 控制台「扩展能力」里出现英文工具名 | 卡片显示 `web_fetch`，旁边几个都是中文 | `src/client/core.js` 的 `toolLabel()` 是白名单映射，新工具没登记就原样显示工具名。2026-11-08 补了 `web_fetch → 网页抓取`；新增工具时 § 十一 第 1 条那几处要一起改 |
| 智能体页点「+ 新建」后整页白屏 | 控制台没弹错误，页面直接空白；`crash.log` 无新记录（React 19 卸载根树不抛 window error） | `src/client/agents/AgentConfigDialog.js` 用了 `toolLabel` 却没从 `core.js` 导入。配置弹窗一打开就提前构造「扩展能力」页签，`toolLabel(tool.name)` 抛 ReferenceError → React 卸载整棵树。已修：补 import；`npm run smoke` 的 `AgentConfigDialog` 改成非空 `tools`（空数组会把 `map` 里的调用短路掉，正是这次漏检的原因） |
| 服务商编辑弹窗里「模型」下拉显示「未选择」，已保存的模型看起来丢了 | 编辑一条备用 LLM，模型触发器是「未选择」；直接保存后值其实还在（`draft.model` 没变） | `ModelField` 只在厂商 `/models` 返回的 `options` 里找当前值。厂商清单没包含该 id（模型下线 / 手填自定义 id / 接口只返回一部分）时，`PillSelect` 回退到 `selectPlaceholder`（未选择）。2026-11-08 修：`ModelField` 把当前值补进选项（同 `AgentConfigDialog` 音色的做法）；`PillSelect` 新增 `placeholder`，空值显示描述符 `modelHint`（DeepSeek = `deepseek-chat`）而不是「未选择」；`npm run check:ui` 用「清单故意不含 `gpt-4o-mini`」回归 |

## 八、当前的边界和未定项

- 判停有两套模式并存（`device` / `energy`），`energy` 只服务不发 `listen stop` 的老固件；两套语义在同一份配置里，读配置时容易混。
- 能量 VAD 的 `minSpeechMs` / `vadThreshold` 不是原厂值，原厂是神经 VAD，数值不可直接搬（技术债 TD-6）。
- mDNS 依赖局域网多播；有些路由器/访客网络会隔离，那种情况下设备会落到云端。
- 全局设置与智能体配置都是**下次连接**生效，没有热更新通道。
- 智能体级"选 Harness 厂商就用 Harness 模型"的自动切换已在 2026-11-07 删除：`src/device-config.js` 现在只让智能体覆盖模型名，provider / Key / 端点一律由全局设置决定；`host` 只能由全局 `voice.llm.provider` 显式选择。`/agents/update` 仍接受 `hostProvider`（只校验是不是当前 profile 已注册的厂商），但它**不参与运行时装配**，属于历史字段。
- 联网工具（2026-11-07 起）：`web_search` 固定 `need_content: true`，回传每条结果的正文摘录（单条 ≤900 字、整批 ≤3800 字）；`web_fetch`（DeepSeek Fetch，Markdown 正文 ≤3500 字）。两者都用 DeepSeek Key（LLM 主用不是 DeepSeek 时自动从备用链找），Key 用运行时 getter，保存即生效；没 Key 时 `web_search` 退回 Harness `ctx.web.search`，`web_fetch` 明确报不可用。
- 配置 UI（2026-11-08 改版）：全局设置 = **三个环节概览卡 + 二级弹窗**：
  ① **服务商**（页面主体：ASR/LLM/TTS 三张概览卡——主用厂商 + 摘要 + 密钥/备用数/降级链 + 状态点，
  点「管理」进 `xz-stage-modal`；弹窗里主用卡一整行、备用纵向列表（行内 `[编辑][⋯]`，上移/下移/测试/删除
  收进 ⋯ 展开区）、底部整行「+ 添加备用服务商」）；
  ② **语音默认参数**；③ **接入与网关**（折叠）。**没有「保存配置」按钮**：任何改动先落本地 state，
  防抖 700ms 自动 `POST /settings`；保存期间又有改动就等下一轮，服务端回写不覆盖刚输入的值。
  底部 sticky 只显示「保存中… / 已自动保存 / 自动保存失败 + 重试」。
  **人设不在全局设置**，只在「智能体 → 配置 → 角色」按智能体设置（`save()` 仍原样透传 systemPrompt，
  不会清掉已存值）；「配置」「设备(N)」「历史对话」都是弹窗（根层渲染，避开 card 的 backdrop-filter）；
  所有下拉是 `PillSelect` 胶囊浮层（`position:fixed`、不撑布局、可向上翻转），规范 `docs/pill-popover.md`。
  **自动保存 + 测试**：未落盘时测试按钮变「保存并测试」，先 `POST /settings` 再按服务端顺序测
  （契约仍是「只测已保存的配置」，只是把两步合成一次点击）；已自动保存时直接测。
- 弹窗尺寸（2026-11-08 修）：控制台 4 个弹窗**一律固定外框**、只有内部区域滚动，不要再退回「max-height + 内容撑开」（父层 `align-items:center`，高度一变标题与页签就上下跳）：智能体配置 `.xz-config-modal` 720×600（页签条固定，只有 `.xz-pane` 滚动）、历史对话 `.xz-history-modal` 920×720、服务商编辑 `.xz-modal-lg` 560×460（表单区滚动）、播报测试 `.xz-inject-modal` 520×320。高度统一写 `height:min(Xpx,86~88vh)` 兜底小视口；切页签 / 换厂商 / 消息增减都不得改变外框尺寸。
- **TTS 归属（2026-11-08）**：全局设置 → TTS 合成只配「厂商 + 凭据」（volc = API Key；xunfei = APPID/APIKey/APISecret；edge 免密钥），不配音色 / 模型 / Resource ID / API URL——全局保存时这三项显式清空。音色（= TTS 模型族）只在「智能体 → 配置 → 角色」按智能体选，首项「默认音色」= 不覆盖，留空 = 厂商默认（`src/voice/voices.js` 的 `DEFAULT_TTS_VOICES`：火山 `zh_female_vv_uranus_bigtts` / Edge `zh-CN-XiaoxiaoNeural` / 讯飞 `xiaoyan`）；`resolveTtsVoice` 负责空音色→厂商默认、跨厂商残留→回落本厂商默认、自定义 ID 原样保留。智能体级音色只覆盖主用，备用 TTS 条目只存凭据、运行时用各自厂商默认音色。**输出语种同样只在智能体「角色」页**（全局设置里的那一项已删除，2026-11-08），同一智能体的设备共用；`cordis.patch.yml` 的 `voice.tts.language` 仅作服务端兜底。
- **设备侧 MCP / IoT（2026-11-08 首阶段）**：`src/voice/device-mcp.js` 在 hello 的
  `features.mcp===true` 后发 `{type:'mcp',payload:{jsonrpc,id,method}}`（initialize id=1、
  tools/list id=2、tools/call 从 3 起），工具名按官方 `sanitize_tool_name` 清洗并映射回原名；
  `src/voice/device-iot.js` 处理设备 `{type:'iot',descriptors|states}`，把属性/方法注册成
  `get_<device>_<property>` / `<device>_<method>`，控制回 `{type:'iot',commands:[...]}`。
  `VoiceSession` 把这两类动态工具与内置工具合并（同名内置优先），`close()` 拒绝未完成 MCP 调用。
- **外部 MCP server / 接入点（2026-11-08）**：`src/mcp/stdio-client.js`（stdio）+ `src/mcp/http-client.js`
  （SSE / Streamable HTTP）+ `src/mcp/ws-endpoint-client.js`（MCP 接入点）+ `src/mcp/manager.js`；
  server 配置 `~/.dsh-xiaozhi/mcp_servers.json`，接入点配置 `mcpEndpoint`（顶层或 voice 下）；
  启动时异步连接、initialize/tools/list，工具并入 `toolRegistry`（控制台 `catalog` 也能看到）。
  **仍未接**：入站 `/mcp`、官方 15+ 服务端插件工具中的音乐/HASS/RAGFlow/exit/change_role/call_device。
- **服务端插件工具（2026-11-08 第二批）**：`src/tools.js` 新增
  `get_news_from_newsnow`（NewsNow 公共 API，`voice.tools.newsnow`）、
  `get_weather`（QWeather，`voice.tools.weather.key/host`，没 Key 只回“未配置”）、
  `get_lunar`（`Intl` 中国农历，只给农历/干支/生肖/星期）。
- **音色列表来源（2026-11-08）**：`GET /voices?provider=volc&resourceId=...` 在火山 TTS 主用配置了
  `appId`（AccessKey ID）/ `apiSecret`（SecretAccessKey）时调官方 **`ListSpeakers`**（AK/SK HMAC 签名，
  `src/voice/volc-sign.js` + `src/voice/volc-speakers.js`，分页 + 10 分钟缓存）；没配或调用失败时回
  `src/voice/voices.js` 的内置清单，响应带 `source:'catalog'`（失败还带 `error`），前端在音色下拉下标注。
  AK/SK 只用于拉列表，**合成仍用 `apiKey`**；签名按官方 GET/POST 向量单测，真实 AK/SK 线上调用未实测。
- **ASR/TTS 表单必填项（2026-11-08 核对官方鉴权）**：火山新版控制台 TTS/ASR 只需 **`X-Api-Key` +
  `X-Api-Resource-Id`**（TTS 默认 `seed-tts-2.0`、ASR 默认 `volc.seedasr.sauc.duration`），不需要
  APPID/AccessKey；讯飞 = **APPID + APIKey + APISecret**（三者都必填）；Edge / 本地 SenseVoice 免密钥。
  `SchemaForm` 用 `*` 标必填，`commitEditor` 拦空并提示；其余字段留空走厂商默认。
- 控制台滚动（2026-11-07 修）：宿主面板高度不固定，`.xz-app` 由 JS 按「视口高度 - 顶端偏移」量测并设 inline height（`Console` 里的 effect，resize/view 切换时重算），`.xz-main` 加 `min-height:0;overflow:hidden`，`.xz-content` 成为唯一滚动容器（`flex:1 1 auto;min-height:0;overflow-y:auto`）。**不要再依赖宿主页面滚动**：单页配置变长后宿主不会替我们滚，表现为整页滑不动。
- 对话历史（2026-11-07 起，2026-11-08 起按智能体合并展示）：控制台「智能体 → 历史」= 绑定设备的会话合并列表 + 消息气泡 + 音频播放/下载。存储 `history/<device>.jsonl`（每条消息一行，`session` = 一条 WS 连接的 session_id）+ `history/audio/<device>/<audioId>.wav`（用户 16k / 助手 24k）。文本每设备 5000 条、音频 30 天 + 500MB 上限、单条 120s 截断；旧 `{at,user,assistant}` 行按 10 分钟间隔迁移成 legacy 会话（无音频）。写盘是 fire-and-forget，失败只 warn，不影响语音。契约 `docs/history.md`。
- **死代码**：`src/client/views/CapabilitiesView.js`（原独立「能力」页）仍存在但**已无渲染点**，`navCapabilities` 文案同样未接（页签已并入「智能体 → 配置 → 扩展能力」）。按"未接入模块不默认删"处理：保留原状并登记为待评估，清理要单独确认。
- 手表固件当前的本地改动：设备端判停（`application.cc/h`）、OTA 候选顺序 + mDNS（`ota.cc/h`、`Kconfig.projbuild`、`idf_component.yml` 里的 `espressif/mdns` 依赖）、以及 `sdkconfig` 里的 `CONFIG_OTA_URL_LAN`（已置空）。
- DSH 自己每次重启会换 GUI 端口，但设备入口始终是 8989；控制 API 前缀跟着插件配置走，不跟着 GUI 端口走。

## 九、多服务商冗余（2026-11-06）

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
| 控制 API | `src/control.js`：`POST /test/provider`（`{kind, source, index}`，只测已保存配置） |
| 运行时装配 | `index.js`：`applyRuntimeSettings()` 下发 `backups`，`createVoiceAdapters(...)` 建候选链，缓存 key 覆盖三段全量配置 |
| 候选链 | `src/voice/adapters/failover.js` + `adapters/index.js`：构建失败跳过、主用坏时备用顶上、全部失败才抛主用原始错误 |
| 控制台 | `src/client/settings/ConfigWizard.js`（三张概览卡 + `xz-stage-modal`）、`ProviderSection.js`（主用卡 + 备用纵向列表 + 添加行）、`ProviderDialog.js`（主用/备用共用的编辑弹窗）、`src/client/ui/PillSelect.js`（分组/禁用行/徽标） |

必须记住的语义：

0. **服务商目录由描述符驱动（2026-11-08）**：唯一数据源是 `src/providers.js` 的 `PROVIDERS`
   （`id/name/group/stages`，每段声明 `fields/summary/secretFields/probe` 等）。控制台通过
   `GET /providers` 拿这份数据（client.js 里也打包一份首屏兜底），`settings.js` 的
   `BACKUP_SPEC.providers` 由 `allProvidersForStage()` 自动派生——**加厂商不再需要改前端、
   也不需要改 `BACKUP_SPEC`**。当前控制台列出：LLM = DeepSeek / 小米 MiMo / OpenAI /
   火山引擎豆包 / 讯飞星火；TTS = 火山引擎豆包 / 讯飞语音合成 / 微软 Edge（免密钥）；
   ASR = 火山引擎豆包 / 讯飞语音听写 / 本地 SenseVoice（免密钥，Harness 内置识别）。
   `mock`、`host` 不列出；`funasr` 标 `hidden`（存储白名单保留、控制台不展示）。
   **小米 MiMo 的认证头是 `api-key`，不是 Bearer**；语音场景默认
   `thinking:{type:'disabled'}`；**模型清单从厂商 `GET /v1/models` 实时拉取，代码不内置任何模型 id**（控制台选不到时手填）。
   加厂商的完整步骤与字段类型见 `docs/provider-descriptors.md`。
1. **切换粒度不同**：LLM 只在未出字前切；TTS 每句话整句重缓冲重试；ASR 在整段结束时回放 PCM
   重试（缓存上限 60s，回放不推 partial）。主动打断不算失败。
2. **粘性**：切到备用并成功后先继续用它，`cooldownMs`（默认 5 分钟）后才重新先试主用；
   每个会话的 adapter 实例各有一份，配置改动仍是下一次连接生效。
3. **备用也是全局默认**：智能体级 `overrides` 只改主用（人设/模型/音色/语种/语速/静音），不会改这个智能体的备用链。TTS 备用条目同样只存「厂商 + 凭据」，运行时用各自厂商的默认音色（2026-11-08）；全局 TTS 主用也只存凭据，音色只由智能体 `overrides.voice` 决定，空值走厂商默认。**LLM 备用条目的模型**：厂商有默认（DeepSeek `deepseek-chat` / OpenAI `gpt-4o-mini` / 火山 `doubao-1.5-pro-32k` / 星火 `generalv3.5`）时，添加/编辑表单**不显示模型字段**，自动填默认；MiMo 没有默认模型（清单从 `/v1/models` 拉），仍保留字段。主用模型仍是全局默认，智能体「模型」可覆盖。
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

## 十、智能体（agent）与设备绑定（2026-11-08）

页面单位从「设备」改成 **智能体**：人设/模型/音色/语种/记忆/工具都属于智能体，一台智能体可以
绑定多台设备（同一人格在几块表上说话）。参考实现是 `xiaozhi-esp32-server` 的
`ai_agent` / `ai_device.agent_id`；本插件的契约在 `docs/agent-device.md`。

- 存储：`agents.json`（0600、版本 1；字段 `id` / `name` / `overrides` / `memoryEnabled` / `toolDisabled` /
  `createdAt` / `updatedAt`，`name` ≤64 字符、`toolDisabled` ≤50 项）；`devices.json` 只多一个 `agentId`。
  记忆按智能体（`memory/<agentId>.json`），历史仍按设备（`history/<deviceId>.jsonl`），
  工具开关按智能体，OTA / 封禁 / 断开 / 删除仍是设备级。
- 迁移：启动时 `adoptLegacyDevices`（`src/agents.js`）给每台没有 `agentId` 的设备各建一个智能体，把旧
  `overrides` / `toolDisabled` / `memoryEnabled` 搬过去，并把设备键的记忆文件复制到智能体键。
  旧字段留在 devices.json 里不删（回滚安全），运行时只在没有绑定关系时才回落到它们
  （`index.js` 的 `agentOf(device)`）。
- 新设备：`DeviceStore.ensureDevice` 建完记录回调 `store.onCreated`，index.js 在那里建智能体，
  保持「零接触入网」——手表第一次连上来就有卡片。
- API：`GET/POST /agents`、`/agents/update|bind|unbind|remove`；
  `/memory*` 与 `/tools*` 接受 `agentId`（兼容旧 `deviceId`，按绑定关系反查）；
  `/history/agent-conversations` 合并绑定设备的会话。`/devices/config` 保留为兼容入口。
  `GET /state` 现在同时返回 `devices` 与 `agents`（`version: 3`），控制台「智能体」页直接吃这份快照；
  `publicAgent` 每条带 `devices` / `deviceCount` / `online` / `lastSeenAt`。
- **名字模型**：智能体与设备各自命名、**不共用**（对齐参考 `ai_agent.agent_name` / `ai_device.alias`）。
  自动建/迁移的智能体默认「智能体 N」（`nextAgentName()`），设备保留自己的 `nickName`；
  控制台改智能体名只写 `agents.json`，改设备别名只写 `devices.json`。旧迁移把设备昵称抄成
  智能体名字的，启动时 `adoptLegacyDevices` 对「单设备 + 名字==设备昵称 + 从未编辑
  （`updatedAt === createdAt`）」做一次改名（返回 `renamed`，幂等），用户改过的不动。
- **智能体「模型」字段**：`overrides.model` 只是 **LLM 模型名**覆盖（如 `deepseek-chat`），
  provider / Key / 端点仍由全局设置决定；下拉选项来自全局 LLM 已保存配置的 `/models`，拉不到则手填，
  空 = 全局默认（`settings.voice.llm.model`）。不是 TTS 音色，也不是「智能体类型」。
- **删智能体是级联删除**：绑定设备、它们的历史与记忆一起删（对齐参考 `deleteAgent`），
  控制台做成二次确认（第一次点击变「再次点击删除」）。
- 控制台：三个平级视图 **概览 / 智能体 / 全局设置**。卡片 = 智能体（名字/在线/绑定设备列表/音色/设备数/最近在线 +
  配置/设备(N)/历史/播报/删除）；「设备(N)」弹窗里绑定/解绑、改设备别名、OTA/封禁/断开/删除设备；
  「播报」发给该智能体所有在线设备（一台都不在线时提示「这个智能体没有在线设备」）。
- 验证：`node --test "test/*.test.mjs"`（221 项，含 `test/agents.test.mjs` 6 项）。

## 十一、改代码时最容易漏的几处

1. **新增一个内置工具**要改五处：`src/tools.js` 注册（name/description/params/执行）、
   `src/client/i18n/zh.js` + `src/client/i18n/en.js` + `src/client/core.js` 的 `toolLabel()` 映射（漏了控制台就显示英文工具名）、
   `README.md` 的「内置工具」表、本文件、`test/tools.test.mjs`。
2. **新增一条控制 API**：`src/control.js` 加路由（写接口记得 `requireTrustedMutation`）、
   `src/client/` 对应页面加调用点（否则就是"有接口无入口"）、`docs/` 补契约、测试放 `test/http.test.mjs` 或对应域。
3. **新增服务商**：只改 `src/providers.js` 加描述符（存储白名单自动派生）+ 适配器：
   OpenAI 兼容 LLM 只在 `src/voice/adapters/index.js` 的 `OPENAI_COMPATIBLE` 加一条 preset；
   TTS/ASR 加适配器文件与 `buildTtsAdapter`/`buildAsrAdapter` 的一个分支。**前端 0 改动**，
   旧 client.js 刷新后会从 `GET /providers` 拿到新厂商。模型 id 从厂商 `/v1/models` 拉，不要写死。
   完整步骤见 `docs/provider-descriptors.md`。
4. **改数据模型**：`agents.json` / `devices.json` / `settings.json` 都要能"手改坏也能启动"——
   `normalizeAgent` / `normalizeDevice` / settings 的规范化函数要容错，坏文件隔离而不是拒绝启动。
5. **改"谁来存"**：记忆按智能体、历史按设备、工具开关按智能体、OTA/封禁按设备。任何时候都不要再把
   配置写回 `devices.json`（旧字段只读，只做回滚兜底）。
6. **生效时机（别答错）**：
   - `settings.json` 里的配置项：控制台保存即生效；但 adapter 是**建连时**装配的，设备要重连。
   - 服务端代码（`index.js`、`src/**`）：**重启 DSH** 才加载。
   - `src/client/**`：改完先 `npm run build` 生成 `client.js`（构建产物，**不要手改**），再**刷新页面**；仍加载旧产物就重启 DSH（未实测 refresh 是否足够）。
   - `cordis.patch.yml` 里改默认配置：重启 DSH；想单机覆盖就写 profile 的 patch，不要改插件默认。
7. **当前运行态与源码可能不一致**：截至 2026-11-08 12:35 实测，`~/.dsh-xiaozhi/` 里**还没有 `agents.json`**，
   `devices.json` 的 `agentId` 全为空 → 说明迁移还没跑（推测：正在跑的 DSH 仍是智能体改造前的实例，
   未直接验证进程内代码版本）；重启后 `adoptLegacyDevices` 会给每台旧设备各建一个智能体并复制记忆
   （幂等，重复重启不会重复建）。
8. **改完的验收底线**：`node --test "test/*.test.mjs"` 221 项全绿 + `npm run build` 成功 + `npm run smoke` 通过 + `npm run check:ui` 通过 + `node --check client.js` 通过 +
   需要时 `curl http://127.0.0.1:8989/healthz` 看设备面是否还活着。

## 十二、文档地图

| 文件 | 写什么 |
|---|---|
| `README.md` | 使用者视角：怎么接设备、端点、控制台怎么用、内置工具、已知限制 |
| `docs/agent-device.md` | 智能体 / 设备两层模型的契约（存储、迁移、API、运行时装配、控制台、验收） |
| `docs/client-architecture.md` | 控制台客户端的运行模型（`__ModuleLoader__` / React 来源）、源码结构、esbuild 构建与冒烟、编码约定、Vue 评估结论 |
| `docs/provider-descriptors.md` | 服务商描述符（`src/providers.js` / `GET /providers` / `SchemaForm`）：结构、字段类型、加厂商步骤、探测与降级、边界 |
| `docs/backup-providers.md` | 主用 + 备用服务商的存储格式、`/test/provider`、failover 语义与验收 |
| `docs/history.md` | 历史会话 / 消息 / 音频的数据布局、保留策略、控制 API、失败降级 |
| `docs/pill-popover.md` | PillSelect 胶囊浮层规范（fixed 定位、视口 clamp、向上翻转、复用清单） |
| `docs/voice-role-language.md` | 官方「角色 ↔ 音色 ↔ 语种」查证、101 条 volc 音色对照、已落地的改动 |
| `docs/config-diff-vs-official.md` | 与官方 `xiaozhi-esp32-server` 的配置逐项审计（含未确认项清单） |
| `systemmap/overview.md` | 认知地图：入口点、数据模型、状态机、关键决策与原因（比本文更贴代码） |

## 十三、控制台客户端：源码结构与构建（2026-11-08）

- **是什么**：`client.js` 现在是 **esbuild 构建产物**，源码在 `src/client/`；React 由宿主提供
  （`require('react')`），构建时保持 external。
- **入口**：`src/client/index.js`（`window.__ModuleLoader__.load` + `apply(ctx)`，注册
  `main` / `sidebar.panellist` 两个 slot）。组件目录：`core.js`（常量/目录/`t`/`callApi`/格式化）、
  `i18n/`、`styles.js`、`ui/`、`views/`、`agents/`、`settings/`、`console/`。
- **构建/冒烟**：`npm run build`（`build.mjs`，banner/footer 把 IIFE 包进 factory）；
  `npm run smoke`（`scripts/smoke-client.mjs`，真实 React SSR 渲染主要页面 + slot 注册校验）；
  `npm run check:ui`（`scripts/check-config-wizard.mjs`，jsdom 里点一遍全局设置：概览卡 → 弹窗 →
  添加 → ⋯ 菜单 → 删除二次确认 → 模型回显 → 自动保存 → ASR 测试识别）。
- **生效**：build 后刷新控制台；仍加载旧产物就重启 DSH（未实测 refresh 是否足够）。
- **不要**：手改 `client.js`；组件里直接 `import react`（统一走 `src/client/react.js`）。
- **加组件**：放 `src/client/{views,agents,settings}/`，从 `core.js` 取 `t` / `callApi` / 常量，
  从 `ui/` 取现成组件；文案同时加到 `i18n/zh.js` 与 `i18n/en.js`（键必须对齐）。
