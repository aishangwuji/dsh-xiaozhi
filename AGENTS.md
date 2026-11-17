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
| 操作台面 | **宿主 Harness 的 webServer**，前缀 `/dsh-xiaozhi-7c3a`（`control.prefix`） | 控制台页面（浏览器） | 主要路由：`GET /state`、`/pending*`、`/agents*`、`/devices*`、`/memory*`、`/tools*`、`/history*`、`/settings`、`/models`、`/voices`、`/providers`、`/llm/providers`、`/asr/local`、`/test/*`、`/probe/ota`、`/crashes*`、`/events`（完整清单见 `src/control.js`） |

- **控制 API 不占 8989**：靠 `ctx.webServer.register({ kind: 'prefix', path: control.prefix })` 挂在 Harness 自己的 Web 服务上，所以端口跟着 GUI 走（DSH 每次重启都会变），设备入口始终是 8989。
- 写接口（POST）必须带 `x-dsh-xiaozhi: 1` 头（CSRF），缺了回 403；读接口不校验——控制台由只监听回环的 Harness Web 服务提供，能打开面板就等于本机管理员。
- 配置优先级：插件自带 `cordis.patch.yml` 的默认值 → profile 的 `cordis.patch.yml`（当前**没有** dsh-xiaozhi 覆盖行）→ 控制台保存的 `settings.json`（运行时叠在上面，保存即生效）。
- 数据目录 `~/.dsh-xiaozhi/`（`dataRoot` 可配）：
  - 现役：`devices.json`（已批准设备名册）、`pending.json`（待审核设备队列）、`agents.json`（配置单位，0600、版本 1）、`settings.json`（0600、版本 3）、`memory/<agentId>.json`、`history/<deviceId>.jsonl` + `history/audio/<deviceId>/*.wav`、`voice.log`（JSONL trace）、`crash.log`。
  - **遗留、代码已不读写**：`profiles.json`、`tools.json`（旧「行为档案」页与旧全局工具开关留下的），可手工删，删了不影响任何链路。

**端侧**：`D:\Demo\esp-xiaozhi\xiaozhi-esp32`，板子是 waveshare ESP32-S3-Touch-AMOLED-2.06，target `esp32s3`，分区表 `partitions/v2/32m.csv`（32MB flash，NVS 在 `0x3B000`，840K）。

两边只通过 WebSocket 说话：OTA 拿地址 → 唤醒时建连 → hello 交换 → 音频上下行。

### 1.1 分发（2026-11-17 起公开）

| 项 | 值 |
|---|---|
| GitHub | `aishangwuji/dsh-xiaozhi`（public，默认分支 `main`） |
| 包名 | `@aishangwuji/dsh-xiaozhi`（2026-11-17 定名；此前短暂用过 `@local/dsh-xiaozhi` 与 `dsh-xiaozhi-server`，均已弃用并从 npm 撤下）。用 scope 而不是裸 `dsh-xiaozhi`：npm 上那个名字已被一个无关项目（「旗驭小智 AI 网关」）占用，装错会得到别人的插件。目录仍叫 `dsh-xiaozhi`，数据目录仍是 `~/.dsh-xiaozhi/` |
| 别人怎么装 | `dsh plugin --profile <p> add @aishangwuji/dsh-xiaozhi`（走 npm，2026-11-17 已发布 0.2.0）；或 Plugins → Add plugin 填包名/仓库地址；或退回 Git：`add github:aishangwuji/dsh-xiaozhi`。装完刷新页面 |
| npm 发布 | `npm publish --registry https://registry.npmjs.org/ --access public`（本机默认 registry 是 npmmirror，**必须显式指 npmjs**）。发布必须用 **granular access token 并勾 Allow bypass 2FA**——普通 `npm_` token 会 403 `granular access token with bypass 2fa enabled is required`。首次发布时 npm 会自动建一条 `0.0.0-stage` 占位版本（`"Temporary package placeholder for staged publishing"`），正常，`latest` 仍指向真版本；npmmirror 同步初期解析 `latest` 可能报 `ERR_PNPM_TARBALL_IO_ERROR`，固定版本号或 `--registry=https://registry.npmjs.org/` 可绕过 |
| 本机 | profile `desktop` 里是 `link:D:/Demo/esp-xiaozhi/dsh-xiaozhi`（开发用）。改完 `npm run build` 再重启 DSH；**只改 cordis.patch.yml 的默认值不重装也生效，改 index.js/src 必须重启** |
| 发布注意 | push 前扫密钥；2026-11-17 首次推送被 GitHub 拦下——历史里 `test/volc-sign.test.mjs`（已删）带着 Volcengine **官方文档示例**的 AK/SK，被 push protection 当真实密钥。已用 `git filter-repo --replace-text` 把这几个历史 blob 换成 `EXAMPLE_*` 占位值；真机 MAC 也换成了 `02:DE:AD:BE:EF:xx` 例示值。**不要把任何「看起来像真 Key」的串写进测试文件**，哪怕是文档抄来的 |
| 推送网络 | 本机直连 `github.com:443` 会间歇 `Recv failure: Connection was reset` / 超时（`gh` API 不受影响）。重试通常能过；实在不行走 Clash SOCKS：`git -c http.proxy=socks5h://127.0.0.1:10808 push origin main`（端口随 Clash 变动，先 `Get-NetTCPConnection -State Listen` 确认） |

## 二、一次完整对话在两端各是什么样子

1. 手表开机 → `Ota` 按顺序试地址（NVS `ota_url` → mDNS 发现 → 编译期 LAN → 云端），拿到 `websocket.url` 和 `token`。
2. 唤醒词/点屏幕 → `WS: Connecting to websocket server: ws://<host>:8989/xiaozhi/v1/`。
3. 设备发 `hello`（version/transport/audio_params），服务端回 `hello`（含 `session_id` 和音频参数）。
4. 设备发 `listen start`，持续上行 Opus（16k/60ms）；服务端 `VoiceSession` 解码成 PCM、喂 ASR。
5. 判到句尾 → 服务端回 `stt` 文本 → LLM 流式 → 分句 → TTS → 下行 Opus（24k/20ms），状态消息是 `tts start` / `sentence_start` / `sentence_end` / `stop`。
6. 设备状态只在收到 `tts start` / `tts stop` 时变（固件里没有客户端判停逻辑）。

服务端每台设备一个 `VoiceSession`，adapter 按「全局默认 + 智能体覆盖」缓存，**改了配置要重连才生效**；插件代码本身要重启 DSH 才生效（见 § 十一）。

## 三、判停：当前是设备说了算

- 固件里 AFE VAD 的参数来自 `main/audio/engines/afe_audio_engine.cc`：`vad_mode = VAD_MODE_2`、`vad_min_noise_ms = 300`（2026-11-06 为抗环境音误触发从 0/100 调到 300；2026-11-15 试过 500 又还原——500ms 对用户太迟钝，句中停顿交给服务端续话窗口兜底，**不再改固件值**）。
- **续话窗口（2026-11-15）**：设备发 `listen stop` 后服务端不再立刻收口，先等 `continuationMs`（默认 300ms）；窗口内又出现说话能量（RMS > `continuationThreshold`，默认 0.02）就取消收口，同一段话继续喂 ASR。见 `session.js` 的 `#scheduleFinalize` / `#onPcm` / `#cancelPendingFinalize`，trace 记 `listen.grace` 与 `turn.continue`。
- 固件在 `application.cc` 的 `MAIN_EVENT_VAD_CHANGE` 里记 `vad_speaking_`，从"说话"转到"静音"且处于 listening 时发 `listen stop`，串口打印 `VAD end of speech, sending listen stop`。
- 服务端 `voice.vadMode` 默认 `device`：收到 `listen stop` 才收口，音频持续喂 ASR，不再用自己的阈值判句尾。
- `vadMode: energy` 是给"不发 listen stop 的老固件"留的兜底：`silenceMs 400`（对齐 Go 服务端 `chat_max_silence_duration`），`minSpeechMs 120` / `vadThreshold 0.03` 是能量 VAD 自己的参数，和原厂神经 VAD 的 0.5/0.4 不是一个量纲。

## 四、地址：mDNS 优先，云端兜底

- 插件在 `src/mdns.js` 广播 `_xiaozhi._tcp`：SRV 端口 8989、TXT `path=/xiaozhi/ota/`、A 记录是本机 IPv4，主机名 `xiaozhi.local`。每 60 秒重新取一次地址再广播。
- **应答必须单播（2026-11-14 实测修）**：esp-idf 的 `mdns_query_ptr` 发出的查询是 `QU=0`（手表串口抓到的
  `qu=false`），旧逻辑只在 `QU=1` 时才单播、其余只发 multicast；这台机器有 VMware / Clash TUN 等虚拟网卡，
  Windows 上 multicast 出口由路由表决定，回答会从 `192.168.10.1` 之类的虚拟网卡出去，手表永远收不到，
  于是每次开机都 `mDNS: no _xiaozhi._tcp service` → 回落官方云。现在**一律先单播回查询方**（`rinfo`），
  再按查询方所在网段补一包 multicast；没有来源时才按所有 LAN 网卡逐个发。
  实测证据：临时应答器改成单播后，手表立刻日志 `Ota: mDNS: found 192.168.43.10 -> http://192.168.43.10:8989/xiaozhi/ota/`
  并走本地 OTA（`No mqtt section found` → WebSocket），不再连 `api.tenclass.net`。
- 这台机器同时有 Clash TUN（`198.18.0.0`）、`2.0.1.9`、VMware 网段、`169.254.x` 这些地址，多播默认跟着路由表走会从 TUN 出去。当前的做法：只广播 RFC1918 + `100.64/10`（`isLanAddress`），公告按网卡逐个发（`setMulticastInterface`），回答查询时从查询方所在网段回。
- 固件 `ota.cc` 的 `ResolveOtaUrlFromMdns()` 查 `_xiaozhi._tcp`，用 SRV 的 host/port 和 TXT 的 path 拼出 `http://<ip>:8989/xiaozhi/ota/`，串口打印 `mDNS: found ...`；一条公告里有多个 A 记录时，挑与手表自己同网段的那个（`esp_netif_get_ip_info` 拿自身 IP/掩码）。
- 候选顺序：NVS 手工 `ota_url` → mDNS → 编译期 `CONFIG_OTA_URL_LAN`（当前为空）→ `CONFIG_OTA_URL`（云端 `https://api.tenclass.net/xiaozhi/ota/`）。
- mDNS 查不到（路由器隔离多播等）时自然落到云端，设备仍然能用，只是换成了小智官方服务。
- OTA 返回的 `websocket.url` 是按请求的 `Host` 拼的，设备走哪条 OTA 就拿到哪一侧的地址。

## 五、服务端怎么测

单测 + 语法检查（改完必跑）：

```powershell
cd D:\Demo\esp-xiaozhi\dsh-xiaozhi
node --test "test/*.test.mjs"          # 全量 307 项，必须全绿
npm run build                          # src/client/** → client.js（esbuild，React 保持 external）
npm run smoke                          # 真实 React SSR 渲染主要页面 + slot 注册校验
npm run check:ui                       # jsdom 交互检查：概览卡 → 弹窗 → 添加 → ⋯ → 模型回显 → 自动保存 → TTS 服务商池（无主备、删除走服务端）
npm run check:fonts                    # 真浏览器验字体：中文不许落宋体、空态与正文同字体、MAC 仍等宽（改样式必跑）
npm run check:role                     # jsdom 验「角色模板」下拉：选模板填充人设、与基准逐字一致、手改回落自定义（改角色页必跑）
npm run check:devices                  # jsdom 验「管理设备」弹窗：移入/绑定必须二次确认，取消不发请求（改设备弹窗必跑）
npm run check:card                     # jsdom 验智能体卡片 ⋯ 菜单：相对卡片定位、关闭、重命名入口 + 「不许回退 overflow/fixed」样式守卫（改智能体卡片必跑）
npm run check:voice                    # jsdom 验智能体「TTS 服务商 + 音色」下拉：4 家官方清单、换服务商重置音色、保存带 ttsProvider（改音色/服务商必跑）
node --check client.js                 # 构建产物语法检查
```

当前 307 项，覆盖分句、VAD、Ogg/Opus 往返、mock 整轮、打断、20 轮、语种、音色族、**TTS 默认音色**（全局只存凭据可清空、只带凭据的主用/备用条目可构建、空音色→厂商默认、跨厂商残留→本厂商默认、自定义 ID 原样保留）、设备级覆盖合并（含「设备 hostProvider 不再强切 host」）、全局设置（人设/静音收口、`applyRuntimeSettings` 的 hostProvider/backups 叠加回归）、备用服务商（持久化/掩码/留空保留/整次失败/**条数不设上限**/`/test/provider`）、**服务商描述符**（描述符与 `BACKUP_SPEC` 白名单一致、字段可存储、stage 级名字覆盖、`hidden` 只存不展示、`GET /providers` 路由，`test/providers.test.mjs` 8 项）、**ASR 在线测试**（TTS→ASR 编排：分块喂 PCM、TTS mock/无音频/ASR error 的报错，`test/asr-probe.test.mjs` 5 项）、**设备侧 MCP/IoT**（MCP initialize/tools/list/tools/call 与工具名清洗、IoT descriptors/states/commands，`test/device-mcp.test.mjs` 5 项 + `test/device-iot.test.mjs` 2 项）、**外部 MCP（stdio）**（子进程 JSON-RPC initialize/tools/list/tools/call，`test/mcp-stdio.test.mjs` 1 项）、**外部 MCP（SSE / Streamable HTTP）**（本地 HTTP server 走通 initialize/tools/list/tools/call，`test/mcp-http.test.mjs` 1 项）、**MCP 接入点**（WebSocket JSON-RPC initialize/tools/list/tools/call，`test/mcp-endpoint.test.mjs` 1 项）、**入站 `/mcp`**（token 鉴权 + 服务端驱动 initialize/tools/list/tools/call，`test/mcp-inbound.test.mjs` 2 项 + `test/http.test.mjs` 1 项）、**服务端插件工具**（newsnow 热榜 / Intl 农历 / exit 退出 / HASS / RAGFlow / call_device / play_music + 「change_role / get_weather 已下掉」反向断言，`test/tools-extra.test.mjs` 9 项；音乐解码 `test/music.test.mjs` 1 项）、**待审核设备**（`PendingStore` 持久化/尝试次数/重新加载、`autoProvision:false` 时 OTA/WS 返回 `device-pending`、控制台批准并绑定指定智能体、拒绝移除、批准后 OTA 放行，`test/pending.test.mjs` 1 项 + `test/http.test.mjs` 1 项）、三段 failover（LLM 未出字前切换、TTS 首包前切换/出音频后不换家、ASR 回放不推 partial、abort 不切换、粘性回落）、mDNS 报文与地址过滤、小米 MiMo（api-key 认证头 / thinking / SSE / 工具调用 / 模型清单走 /v1/models 无内置兜底）、联网工具（Search 带正文与截断预算 / web_fetch 正文与 403·404 语义 / 动态 Key / 无 Key 回退）、对话历史（会话聚合与标题 / 旧格式 10 分钟迁移 / WAV 读写与路径安全 / 30 天保留与容量清理 / clear 粒度 / 4 条 HTTP 路由）、**智能体/设备绑定**（旧设备迁移与记忆复制 / 多设备绑定与移动 / 解绑 / 配置共享 / 级联删除 / 历史合并 / **智能体重名拦截**，`test/agents.test.mjs` 7 项）、**百智云语音**（描述符覆盖 ASR/TTS、语种归一化、语速能力门控、WAV 解析/重采样、TTS 请求体与 401 报错、ASR 真实节奏发送 + commit + delta/final 拼接 + 服务端错误帧，`test/baizhi.test.mjs` 13 项）、**DeepSeek 语音**（描述符覆盖 ASR/TTS、WAV 编解码与立体声下混、multipart `file` 上传、采样率归一、120s 截断、空音频不发请求、TTS 请求体与重采样、400 与计费字符上限，`test/deepseek.test.mjs` 18 项）、**主用/备用互换**（服务端整段互换且密钥不出进程、空主用不留空壳、CSRF / 非法 index / 坏 hostProvider 被拒，`test/settings.test.mjs` 3 项）、**表情跟随**（21 个表情名与固件 `chibi-maid_240` 资源一一对应、emoji 被 SSE 拆成两半仍能识别、无 emoji 不发 emotion、TTS 文本与历史里都不含 emoji，`test/emotion.test.mjs` 6 项）、**回合守卫**（listen stop 后的续话窗口：窗口内继续说不收口、窗口内没声音正常收口、工具调用前发 `% 工具名` 提示、工具报错回灌给模型、模型只回表情时用兜底话术收尾，`test/turn-guard.test.mjs` 8 项，含「空回合后不重发 listen start 也能接住下一句」）。**TTS 流式下发**（首包早于合成结束、流式 Ogg 解复用跨页/跨字节边界、abort 停流且不产生幽灵帧、空音频不发 sentence_start，`test/tts-stream.test.mjs` 4 项）。**固件升级通道**（固件仓库保存/替换/删除与非法名拒绝、OTA 请求体解析设备版本、上传后 OTA 下发绝对 URL、force 以数字下发、移除后回落到设备版本，`test/firmware.test.mjs` 4 项 + `test/http.test.mjs` 5 项）。**错误气泡与 session_id**（ASR 失败 alert、LLM 失败 alert + 兜底语音、下行业务消息带 session_id，`test/turn-guard.test.mjs` 3 项）。**设备工具可见性**（`DeviceMcpClient.catalog()` 只读目录、`GET /devices/tools` 在线/离线/参数校验，`test/device-mcp.test.mjs` + `test/http.test.mjs`）。

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
| 新设备一直连不上，OTA 返回 `403 device-pending` | 控制台「智能体」页顶部出现待审核卡片；`pending.json` 有该 MAC | 默认 `autoProvision: false`，陌生设备要先在控制台选智能体并批准；批准后设备下一次 OTA/WS 才放行。不是固件故障，也不需要激活码 |
| 配了 DeepSeek 语音后：说话没反应 / 没声音 | `voice.log` 里 `deepseek.asr.error` 或 `deepseek.tts.error 400` | 适配器自身保证音频 ≤120s / ≤8 MiB、WAV 采样率落在官方 7 档内，正常链路不会触发 413——若仍出现，多半是服务端按「整个请求体」限长或接口行为变了；TTS 400 = 文本未通过内容审核（`Content Exists Risk`）或没有可朗读文本。`429` = 账号并发超限（每账号最多 50 个在途请求） |
| 手表每次开机都连 `xiaozhi.me` / 插件收不到 OTA | 手表串口 `Ota: mDNS: no _xiaozhi._tcp service on this LAN`，随后 `Checking version at https://api.tenclass.net/...`；PC 上单独发 PTR 查询**能**收到应答 | 插件只对 `QU=1` 的查询单播，esp-idf 发的是 `QU=0`；只发 multicast 时出口从 VMware `192.168.10.1` 出去，手表收不到。2026-11-14 修：应答一律单播给查询方 + 同网段补 multicast（`src/mdns.js` 的 `send()`） |

## 八、当前的边界和未定项

- 判停有两套模式并存（`device` / `energy`），`energy` 只服务不发 `listen stop` 的老固件；两套语义在同一份配置里，读配置时容易混。
- 能量 VAD 的 `minSpeechMs` / `vadThreshold` 不是原厂值，原厂是神经 VAD，数值不可直接搬（技术债 TD-6）。
- mDNS 依赖局域网多播；有些路由器/访客网络会隔离，那种情况下设备会落到云端。同机虚拟网卡（VMware/TUN）会让 multicast 出口走错网卡，所以**应答单播是主路径、multicast 只是补充**（2026-11-14）。
- 全局设置与智能体配置都是**下次连接**生效，没有热更新通道。
- 智能体级"选 Harness 厂商就用 Harness 模型"的自动切换已在 2026-11-07 删除：`src/device-config.js` 现在只让智能体覆盖模型名，provider / Key / 端点一律由全局设置决定；`host` 只能由全局 `voice.llm.provider` 显式选择。`/agents/update` 仍接受 `hostProvider`（只校验是不是当前 profile 已注册的厂商），但它**不参与运行时装配**，属于历史字段。
- 联网工具（2026-11-07 起）：`web_search` 固定 `need_content: true`，回传每条结果的正文摘录（单条 ≤900 字、整批 ≤3800 字）；`web_fetch`（DeepSeek Fetch，Markdown 正文 ≤3500 字）。两者都用 DeepSeek Key（LLM 主用不是 DeepSeek 时自动从备用链找），Key 用运行时 getter，保存即生效；没 Key 时 `web_search` 退回 Harness `ctx.web.search`，`web_fetch` 明确报不可用。
- 配置 UI（2026-11-08 改版）：全局设置 = **三个环节概览卡 + 二级弹窗**：
  ① **服务商**（页面主体：ASR/LLM/TTS 三张概览卡——主用厂商 + 摘要 + 密钥/备用数/降级链 + 状态点，
  点「管理」进 `xz-stage-modal`；弹窗里主用卡一整行（`[编辑][测试]` 与状态点在标题行**右侧**）、
  备用纵向列表（**单行三段式**：`序号+厂商+状态` / 摘要 / 右侧 `[编辑][⋯]`；`⋯` 是**贴着按钮的浮层菜单**，
  不再在行内展开——行内展开会把行撑高、下面的行跟着跳，点空白或 Esc 关闭）、底部整行「+ 添加备用服务商」）；
  ② **语音默认参数**；③ **接入与网关**（折叠）。**没有「保存配置」按钮**：任何改动先落本地 state，
  防抖 700ms 自动 `POST /settings`；保存期间又有改动就等下一轮，服务端回写不覆盖刚输入的值。
  底部 sticky 只显示「保存中… / 已自动保存 / 自动保存失败 + 重试」。
  **人设不在全局设置**，只在「智能体 → 配置 → 角色」按智能体设置（`save()` 仍原样透传 systemPrompt，
  不会清掉已存值）；「配置」「设备(N)」「历史对话」都是弹窗（根层渲染，避开 card 的 backdrop-filter）；
  所有下拉是 `PillSelect` 胶囊浮层（`position:fixed`、不撑布局、可向上翻转），规范 `docs/pill-popover.md`。
  **自动保存 + 测试**：未落盘时测试按钮变「保存并测试」，先 `POST /settings` 再按服务端顺序测
  （契约仍是「只测已保存的配置」，只是把两步合成一次点击）；已自动保存时直接测。
- 弹窗尺寸（2026-11-08 修）：控制台 4 个弹窗**一律固定外框**、只有内部区域滚动，不要再退回「max-height + 内容撑开」（父层 `align-items:center`，高度一变标题与页签就上下跳）：智能体配置 `.xz-config-modal` 720×600（页签条固定，只有 `.xz-pane` 滚动）、历史对话 `.xz-history-modal` 920×720、服务商编辑 `.xz-modal-lg` 560×460（表单区滚动）、播报测试 `.xz-inject-modal` 520×320。高度统一写 `height:min(Xpx,86~88vh)` 兜底小视口；切页签 / 换厂商 / 消息增减都不得改变外框尺寸。**例外**：设备管理 `.xz-devices-modal` 用 `max-height:min(560px,86vh)` + 内容自适应高度（2026-11-09 修，设备少时不留大片空白），只有 `.xz-modal-body` 滚动。
- **设备封禁已删除（2026-11-09）**：设备只是智能体的麦克风/扬声器，封禁没有实际价值；已从 `devices.json` 字段、`DeviceStore.setBlocked`、OTA/WS 的 403 校验、控制台按钮、`/devices/block` 路由和 i18n 全部移除。旧 `devices.json` 里的 `blocked` 字段在加载时被忽略，不再拦截设备。
- **智能体卡片改版（2026-11-13）**：卡片 = 名字首字徽标（渐变方块）+ 名字/状态徽标（**未绑定** / 在线 / 离线）
  + 右上 `⋯` 浮层菜单（播报 / 重命名 / 删除智能体；相对卡片绝对定位，点空白或 Esc 关闭），中间三格信息
  （**角色** = 人设命中的角色模板名、没命中显示「自定义」；**模型**；**最近对话**），底部三按钮
  **配置 / 历史 / 设备 (N)**。取舍：设备明细不再铺在卡片里（都进「设备 (N)」弹窗），播报从常驻按钮挪进 `⋯`，
  操作条固定三格。改名仍是点名字就地编辑（`.xz-agent-rename`，28px 高、最多 220px 宽，不撑高卡片）；
  状态点换成文字徽标（`.xz-agent-chip` 的 warn/ok 两态）；动作小图标是内联 SVG（`ACTION_PATHS`），不引图标库。
  **删除改成确认弹窗（2026-11-13 用户要求）**：`⋯` → 「删除智能体」直接弹 `.xz-modal.xz-confirm-modal`
  （标题 + 「确定删除“<名字>”吗？…」+ 取消 / 红色删除），不再「再次点击删除」——菜单点一次就关，
  要求用户重开菜单再点一次既绕又容易误删。弹窗是 AgentsView 内、`.xz-card` 之外的兄弟节点，
  所以 `position:fixed` 的遮罩不会被 card 的 `backdrop-filter` 改变包含块。
  **菜单定位踩过的坑（2026-11-13 实测修）**：一开始用 `position:fixed` + 视口坐标，结果菜单整体偏移、
  还被卡片裁掉——因为卡片外层 `.xz-card` 有 `backdrop-filter`（会成为 fixed 的包含块），`.xz-agent-card` 的
  `overflow:hidden` 又把菜单裁在卡片边界。现在改成 **相对卡片定位**：菜单 inline `position:absolute`，
  坐标由 `getBoundingClientRect()` 换算成「相对卡片」的 `top`/`right`（按钮底 + 6 / 卡片右 − 按钮右），
  下方空间不足 150px 时向上翻成 `bottom`；`.xz-agent-card` 去掉 `overflow:hidden`、底部圆角交给 
  `.xz-agent-actions`。回归守卫 `npm run check:card`（`scripts/check-agent-card.mjs`，jsdom）：断言这两个根因不许回来
  （`.xz-agent-card` 无 `overflow:hidden`、`.xz-agent-menu` 必须是 `absolute`）+ 点开/关闭/重命名入口。**不要再改回 fixed。**
- **智能体重名拦截（2026-11-09）**：`AgentStore.create/update` 用 `assertNameAvailable` 做 trim 后的精确比较，重名抛 `duplicate-name`（HTTP 400）；改名时排除自己。控制台 `callApi` 带 `error.code`，`AgentsView` 把 `duplicate-name` 映射成 `agentNameDuplicate` 提示；新建默认名也改为找未占用的「智能体 N」，避免自动创建撞名。
- **扩展能力卡片（2026-11-09）**：`.xz-capability-name` 占满剩余宽度并单行省略，`.xz-capability .xz-switch` 固定 `margin-left:auto`，所以标签长短不会把开关顶到不同位置；`CapabilitiesView` 复用同一套 class，规则对它同样生效。
- **字体（2026-11-09 修，用户点名）**：中文**只许**走 `--xz-font`（`-apple-system…"Segoe UI","Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif`，本机实测落到 **Noto Sans SC**）；等宽**只给 ASCII**（MAC / IP / URL / JSON），统一用 `--xz-font-mono`（`ui-monospace…Consolas,"Noto Sans Mono CJK SC","Noto Sans SC","Microsoft YaHei",monospace`），这样即使等宽元素里混进中文也不会掉进宋体。**两个已踩的坑**：① 智能体卡片的设备行原本是 `.xz-devcard-mac{font-family:ui-monospace,monospace}`，于是空态「还没有绑定设备」和「1. 手表 ●」实际渲染成 **NSimSun（新宋体）**——已拆成 `.xz-devcard-devices`（sans、12px、`--xz-text-2`、行高 1.8），`AgentsView` 只有这一处用过旧类；② **这台机器的浏览器把 `sans-serif` 映射成 SimSun**，所以任何「继承裸 `sans-serif`」的文字都会变宋体：设备弹窗的 `.xz-hint`（「没有其他设备」）自己没有字体声明，就中招了——已加 `.xz-hint{font-family:var(--xz-font)}`，弹窗内 `.xz-modal-body .xz-hint` 统一 12px / `--xz-text-2` / 行高 1.5。复现方式（实测）：把浏览器字体预设 `sansserif` 改成 SimSun，旧栈 → `Segoe UI + SimSun`，新栈 → `Noto Sans SC`，裸 `sans-serif` → SimSun。回归守卫 `npm run check:fonts`（`scripts/check-fonts.mjs`，真浏览器 + CDP，需要 Edge/Chrome，可 `CHROME_PATH` 指定）**故意把 `sans-serif` 预设改成 SimSun 再跑**：断言「任何探针都不是宋/明体族 + 空态/设备行/弹窗提示/等宽里的中文与正文同字体 + MAC 仍是等宽」，漏一个就 exit 1（两种回归都注入验证过）。
- **待审核设备（2026-11-09）**：`autoProvision: false`（默认）时，陌生 OTA/WS 请求不再直接建档，而是 `src/pending.js` 的 `PendingStore` 写入 `~/.dsh-xiaozhi/pending.json`，返回 `403 device-pending`。控制台「智能体」页顶部显示「待审核设备」，每行可选一个智能体后「批准」（`POST /pending/approve`，`agentId` 为空则自动新建），或「拒绝」（`POST /pending/reject`）。批准后 `DeviceStore.ensureDevice` 建档并 `setAgentId`，设备下一次 OTA/WS 即通过；`GET /state` 带 `pending` 数组，`GET /pending` 单独可查。`autoProvision: true` 恢复旧的零接触自动登记。批准后设备下一次请求才放行；若手表停在错误页，重启/重新唤醒一次。**UI 注意**：待审核卡用 `.xz-pending-card` 关掉 `backdrop-filter`——卡片一旦有毛玻璃就会成为 `PillSelect` 的 fixed 包含块，把下拉菜单裁在卡片底边（2026-11-09 实测只显示一个智能体）。
- **TTS 归属（2026-11-08）**：全局设置 → TTS 合成只配「厂商 + 凭据」（volc = API Key；xunfei = APPID/APIKey/APISecret；edge 免密钥），不配音色 / 模型 / Resource ID / API URL——全局保存时这三项显式清空。音色（= TTS 模型族）只在「智能体 → 配置 → 角色」按智能体选，首项「默认音色」= 不覆盖，留空 = 厂商默认（`src/voice/voices.js` 的 `DEFAULT_TTS_VOICES`：火山 `zh_female_vv_uranus_bigtts` / Edge `zh-CN-XiaoxiaoNeural` / 讯飞 `xiaoyan`）；`resolveTtsVoice` 负责空音色→厂商默认、跨厂商残留→回落本厂商默认、自定义 ID 原样保留。智能体级音色只覆盖主用，备用 TTS 条目只存凭据、运行时用各自厂商默认音色。**输出语种同样只在智能体「角色」页**（全局设置里的那一项已删除，2026-11-08），同一智能体的设备共用；`cordis.patch.yml` 的 `voice.tts.language` 仅作服务端兜底。
  **TTS = 服务商池 + 智能体级选择（2026-11-14 定稿）**：全局 TTS **不再分主用/备用、不排序**，只是一个
  平铺的「已配置服务商」清单（添加/编辑/删除；第一行仍是「智能体没选时的默认」，但不叫主用）。
  用哪家、哪个音色在「智能体 → 配置 → 角色」选（`overrides.ttsProvider` + `overrides.voice`）；其余已配置
  服务商自动按列表顺序做降级。运行时由 `prioritizeTtsProvider()` 在**条目层**重排：把该厂商条目的整套
  凭据提为首选、原默认整套降为备用（只改 `provider` 字段会变成「厂商对、Key 是别家的」）。保存边界
  校验厂商确已配置（400 `invalid-tts-provider`），换服务商时前端把音色重置为默认，避免跨厂商残留。
  LLM / ASR 仍是「主用 + 备用 + 上移/下移/设为主用」的旧形态，不要顺手改掉。
  服务商池的**视觉**：一张白卡里排「首字徽标 + 名称/密钥 + 文字链（编辑/测试/删除）」，
  不用三颗描边按钮；TTS 弹窗带 `is-pool` 类，高度随内容收缩（`height:auto;max-height:min(640px,88vh)`），
  避免几行下面一大片空白；池内不再渲染第二行 `ttsVoicePerDevice` 提示（顶部 `xz-pool-hint` 已覆盖）。
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
- **入站 `/mcp`（2026-11-08）**：`src/mcp/inbound.js`（`InboundMcpChannel` / `InboundMcpRegistry`）+
  `src/ingress.js` 的 `/mcp` 路由；配置 `mcpToken`（留空不开放），连接 URL
  `ws://<host>:8989/mcp?token=<mcpToken>&agentId=<可选>`。服务端驱动裸 JSON-RPC
  initialize(id=1) / notifications/initialized / tools/list(id=2) / tools/call(id>=3)，
  工具按 agentId 聚合、同名加前缀，并入 `toolRegistry`。**官方 Python 版工具已全部覆盖**。
- **服务端插件工具（2026-11-08 第二批）**：`src/tools.js` 新增
  `get_news_from_newsnow`（NewsNow 公共 API，`voice.tools.newsnow`）、
  `get_lunar`（`Intl` 中国农历，只给农历/干支/生肖/星期）。
- **get_weather 已下掉（2026-11-09，用户要求）**：天气要先配 QWeather API Key，用户明确不配、不用。
  已删：`src/tools.js` 的 `get_weather` 注册（含城市查询 + `3d` 预报两段）、`src/client/core.js` 的
  `toolLabel` 映射、i18n `toolWeather`（zh/en）、`index.js` 对 `voice.tools.weather` 的解析、
  `cordis.patch.yml` 的 `weather:` 段、README 工具表行与配置说明、
  `docs/config-diff-vs-official.md` 的计数（14→13）。
  `test/tools-extra.test.mjs` 改成**反向断言**「注册表/catalog 里都不应再出现 get_weather」，防止被加回来。
  旧 `settings.json` 里若手写过 `voice.tools.weather`，现在**不读取也不报错**（留作回滚痕迹）。
  问天气现在只能走 `web_search`（DeepSeek Search，按次计费）；要恢复天气工具，先回答 Key 从哪来，
  再按「注册 + toolLabel + i18n + README + 文档 + 测试」六处一起加，别只加注册。
- **退出意图（2026-11-08）**：`handle_exit_intent` 返回 `{action:'close', response:say_goodbye}`；
  `VoiceSession` 直接播告别语、跳过后续模型续写，`AudioPlayer.whenDrained()` 等最后一条
  `tts stop` 发出后调 `close()`，`onClose` 由 ingress 关 WS（`connection.close(1000,'exit intent')`）。
- **HASS / RAGFlow（2026-11-08）**：`src/tools.js` 在 `voice.tools.hass` / `voice.tools.ragflow`
  配置齐全时注册 `hass_get_state` / `hass_set_state` / `hass_play_music` /
  `search_from_ragflow`；HASS 走 `/api/states` 与 `/api/services/*`，RAGFlow 走
  `/api/v1/retrieval`。未配置时**不注册**，不会给模型一堆“未配置”工具。
- **call_device（2026-11-08）**：`voice.tools.callDevice.url/secret` 配置齐全时注册，
  用当前 `deviceId` 作 `callerMac` 调 manager `/device/address-book/call`。
- **change_role 已下掉（2026-11-09，用户要求）**：角色只由控制台「智能体 → 配置 → 角色 → 人设」
  配置（改的是 `agents.json` 的 `systemPrompt`），语音侧不再有切换角色的工具——原来的
  `change_role` 会临时改本会话人设，和「角色只在管理台配」冲突，而且前端没有角色下拉做配套。
  已删：`src/tools.js` 的 `change_role` 注册与 `ROLE_PROMPTS`、`toolLabel` 映射、i18n
  `toolChangeRole`（zh/en）、README 工具表行、`docs/config-diff-vs-official.md` 的计数（15→14）。
  `test/tools-extra.test.mjs` 改成**反向断言**「注册表里不应再出现 change_role」，防止被加回来。
  **角色模板（2026-11-09 建，2026-11-10 换文案）**：控制台 `src/client/agents/rolePresets.js`
  （`ROLE_PRESETS` / `rolePresetPrompt` / `matchRolePreset`），在「智能体 → 配置 → 角色」的「人设」
  标签右侧做成 `PillSelect` 下拉（默认「自定义（不改动）」）；选中即把人设整段替换，之后仍可手改，
  手改后下拉回落「自定义」（`matchRolePreset` 用整段精确比较）。
  **文案不许自创（用户明确要求）**：现在的五段逐字来自**原服务端**——`xiaozhi-esp32-server` 的 manager
  种子数据 `main/manager-api/src/main/resources/db/changelog/202504092335.sql` 里 `ai_agent_template`
  表的模板（湾湾小何 / 星际游子 / 英语老师 / 好奇男孩 / 汪汪队长）。基准文件
  `test/fixtures/role-presets.json`（从 SQL 导出，**不要手改**），`npm run check:role` 与
  `test/role-presets.test.mjs` 双向逐字比对，改一个标点就红；要同步原服务端就重新导出生成。
  五段都含 `{{assistant_name}}`，控制台填入时换成智能体自己的名字。
  （2026-11-10 的前一版误从 `xiaozhi-golang-src` 的 lingxi NPC 抄过三段，已按用户要求撤掉。）
  **纯前端**，不注册工具、不改语音链路；交互回归 `npm run check:role`（`scripts/check-role-preset.mjs`，jsdom）。
  **保留**：`src/voice/session.js` 的 `action === 'change_prompt'` 处理（当前无工具产出，留作
  未来角色类工具/入站 MCP 的协议位；不要因为“没人产出”就删——删了要同步改协议文档）。
  智能体记录里残留的 `toolDisabled: ['change_role']` 无害（判定只是查集合）。
- **play_music（2026-11-08）**：`voice.tools.music.dir` 存在时注册；`src/voice/music.js`
  用 ffmpeg 把本地 mp3/wav 解码成 24k 单声道 PCM，再走 `encodeSpeech` → `AudioPlayer`；
  播放前先用 TTS 说「正在为您播放《…》」，文件帧与 TTS 共用同一条 player/`tts stop` 收尾。
  目录不存在时**不注册**；单曲上限 300 秒。`test/music.test.mjs` 用 ffmpeg 解码一段生成的 WAV
  验证 PCM 通道（真实手表播放未实测）。
- **音色列表来源（2026-11-13 定稿：只有内置清单）**：`GET /voices?provider=…` 直接回
  `src/voice/voices.js` 的 `VOICE_OPTIONS`（2026-11-14 按各家官方清单重建：火山 241 = 2.0 146 + 1.x 95 / Edge 14 / 讯飞 11 / 百智云 10 / DeepSeek 2），`source:'catalog'`；
  前端再按资源族过滤（`voicesForResource`，1.x/2.0 混选会 55000000）。
  **官方 `ListSpeakers` 已整段删除**（`volc-sign.js` / `volc-speakers.js` 与两个测试一起删）：它要的是
  AccessKey（`AKLT…`），与语音控制台 10 位数字 **AppID**、以及合成用的 `X-Api-Key` 是三套不同的凭据；
  把 AppID 填进 AK 字段只会得到网关错误 `InvalidClientTokenId 100009 / The security token[...] is invalid`。
  **不要再加回来**，除非同时解决「AK / AppID / API Key 三者的字段区分」。
- **ASR/TTS 表单必填项（2026-11-08 核对官方鉴权）**：火山新版控制台 TTS/ASR 只需 **`X-Api-Key` +
  `X-Api-Resource-Id`**（TTS 默认 `seed-tts-2.0`、ASR 默认 `volc.seedasr.sauc.duration`），不需要
  APPID/AccessKey；讯飞 = **APPID + APIKey + APISecret**（三者都必填）；Edge / 本地 SenseVoice 免密钥。
  `SchemaForm` 用 `*` 标必填，`commitEditor` 拦空并提示；其余字段留空走厂商默认。
- 控制台滚动（2026-11-07 修）：宿主面板高度不固定，`.xz-app` 由 JS 按「视口高度 - 顶端偏移」量测并设 inline height（`Console` 里的 effect，resize/view 切换时重算），`.xz-main` 加 `min-height:0;overflow:hidden`，`.xz-content` 成为唯一滚动容器（`flex:1 1 auto;min-height:0;overflow-y:auto`）。**不要再依赖宿主页面滚动**：单页配置变长后宿主不会替我们滚，表现为整页滑不动。
- 对话历史（2026-11-07 起，2026-11-08 起按智能体合并展示）：控制台「智能体 → 历史」= 绑定设备的会话合并列表 + 消息气泡 + 音频播放/下载。存储 `history/<device>.jsonl`（每条消息一行，`session` = 一条 WS 连接的 session_id）+ `history/audio/<device>/<audioId>.wav`（用户 16k / 助手 24k）。文本每设备 5000 条、音频 30 天 + 500MB 上限、单条 120s 截断；旧 `{at,user,assistant}` 行按 10 分钟间隔迁移成 legacy 会话（无音频）。写盘是 fire-and-forget，失败只 warn，不影响语音。契约 `docs/history.md`。
- **死代码**：`src/client/views/CapabilitiesView.js`（原独立「能力」页）仍存在但**已无渲染点**，`navCapabilities` 文案同样未接（页签已并入「智能体 → 配置 → 扩展能力」）。按"未接入模块不默认删"处理：保留原状并登记为待评估，清理要单独确认。
- 手表固件当前的本地改动：设备端判停（`application.cc/h`）、OTA 候选顺序 + mDNS（`ota.cc/h`、`Kconfig.projbuild`、`idf_component.yml` 里的 `espressif/mdns` 依赖）、以及 `sdkconfig` 里的 `CONFIG_OTA_URL_LAN`（已置空）。
- DSH 自己每次重启会换 GUI 端口，但设备入口始终是 8989；控制 API 前缀跟着插件配置走，不跟着 GUI 端口走。
- **表情跟随（2026-11-14）**：设备端 21 张表情图（`custom/emoji/chibi-maid_240/*.png`，名字与
  `noto_emoji.h` 的规范名一致）本来就支持服务端下发情绪，缺的是我们不发。现在按原服务端的做法补上：
  ① 系统提示词（`index.js` 的 `SHORT_REPLY_RULE`）要求**每条回复第一个字符**是 21 个之一的表情符号；
  ② `src/voice/emotion.js` 的 `EmotionFilter` 在流式文本里取出开头 emoji（能接住被 SSE 拆成
  `\uD83D` / `\uDE42` 两半的 emoji），映射成规范名，并把正文里的 emoji 全部清掉（不进 TTS、不进历史）；
  ③ `src/voice/session.js` 的 `#answer` 每轮只在第一次识别到时 `sendJson({type:'llm',emotion})`，
  固件 `application.cc` 的 `llm` 分支收到后 `SetEmotion()`，表情和 TTS 一起出来；
  ④ 模型没按约定开头时**不发** emotion（设备保持当前表情），不做关键词猜测；trace 记 `emotion.send`。
  生效：改代码重启 DSH，改提示词只影响下一轮。验收：`test/emotion.test.mjs` 6 项 + `voice.log` 的 `emotion.send` + 手表屏幕表情。
- **空回合后继续捕获（2026-11-15 实测修）**：设备判停模式下，设备发完 `listen stop` 仍停在
  Listening，**不一定重发 `listen start`**；旧逻辑在这个空回合（或 ASR 失败）后把 `capturing`
  关掉，用户接着说的话被整段丢弃，表现成「有时候说话触发不了」。现在 `#resumeCaptureAfterEmpty()`
  在空回合/ASR 失败后重新开捕获（trace `capture.reopen`）。注意：**正常回答**之后不要这样做——
  那时设备会进 Speaking，继续捕获会把 TTS 回声喂给 ASR。
  实测证据：12.6s 的采集里前 10s 是 -60dB 底噪、末尾几处敲击声，DeepSeek ASR 返回空（`duration 0`）；
  这是**音频里确实没有语音**，不是阈值被调高。
- **工具提示与失败兜底（2026-11-15）**：① 每次工具调用前发 `{type:'tts',state:'sentence_start',text:'% <工具名>'}`，
  固件 `application.cc` 的 `ToolCallNoticeLabel` 会把它转成「联网搜索中... / 调音量中...」的系统气泡（不朗读）；
  trace 记 `tool.notice`。② 工具抛错（参数缺 `query`、超时等）不再让整轮哑掉：错误作为 `role:"tool"` 回灌给模型，
  下一轮它可以改参数或换说法，trace 记 `tool.error`。③ 模型只回一个 emoji（或被过滤后没有正文）时用
  「嗯？我在呢，你再说一遍？」兜底，trace 记 `llm.empty`；LLM 抛异常时也播一句「抱歉，我这边出了点问题…」。
  回归：`test/turn-guard.test.mjs` 8 项。生效：重启 DSH（服务端改动，固件不动）。
- **唤醒开场白 + 播放中打断（2026-11-15）**：① 固件唤醒后本来就会发
  `{type:"listen", state:"detect", text:<唤醒词>}`（`application.cc` 的
  `SendWakeWordDetected`，Kconfig `SEND_WAKE_WORD_DATA` 默认 y）；原服务端把它当用户
  第一句话直接回答。现在 `session.js` 的 `handleListen` 收到 detect 且有 text 就
  `#answer(text)` 回一句开场白，不需要用户说唤醒词后再说第二句；开场白期间设备补发的
  `listen start` 记为 `pendingListenStart` 并压下（trace `listen.start.skipped`），
  结束后再开 ASR，避免把 TTS 回声当用户说话。② 播放/思考中插话：VAD 判到说话会
  `#interrupt(barge-in)`，现在同时把 `capturing` 置 true 并立刻开 ASR 流——旧逻辑
  只开流不开捕获，打断后的音频会被 `#onPcm` 丢掉（表现成「它说话时我说不进去」）。
- **播放期打断真正生效（2026-11-17）**：以前 `#answer` 把句子排进播放队列后立刻把
  `state` 置回 `listening`，而队列比播放快得多；结果**播放期间**收到的 `abort` 与 VAD
  barge-in 都被 `#interrupt` 的「state 必须是 speaking/thinking」门挡掉，设备把已排队的
  音频播完（表上表现为「按了停还是说个不停」）。现在收尾链 `await player.whenDrained()`
  再回落状态，`AudioPlayer.abort()` 也 `#resolveDrained()`（否则队列被清空后那条
  `tts stop` 永不发出，等待方会永远挂住）。回归：`test/voice-e2e.test.mjs` 的 abort 用例
  断言 stop 的 `reason === 'client abort'`（自然收尾不带 reason），不再依赖墙钟。
- **TTS 流式下发（2026-11-16）**：以前 `#speakSentence` 等整句 TTS 收齐再 `encodeSpeech`，
  首包 = 整句合成时间（实测 Edge 1.28–1.50s，是端到端预算主要项）。现在：① `codec.js`
  新增 `createOpusStreamEncoder`（一句一个 ffmpeg，`-page_duration 60000` + `-flush_packets 1`，
  否则 Ogg 页默认攒 1s 才吐）；② `ogg.js` 新增 `createOggOpusStreamDemuxer`（跨页/任意字节切分的
  增量解复用）；③ `session.js` 的 `#speakSentenceStreaming` 在第一个 Opus 包到达时才发
  `sentence_start`，边收边入队；④ `adapters/failover.js` 的 TTS 从「整句缓冲」改成「流式放行、
  首包前可换家」——已出过音频再换家会重念半句，所以带 `dshNoSwitch` 直接抛给会话层（与 LLM 契约一致）。
  没有 `createStreamEncoder` 的注入/测试仍走旧的整句路径。trace：`tts.stream.first` /
  `tts.stream.done` / `tts.stream_error`。实测（本地，真实 ffmpeg + 20ms/包的模拟 TTS）：首帧 254ms。
- **OTA 固件升级通道（2026-11-16）**：① `src/firmware.js` 管 `~/.dsh-xiaozhi/firmware/`（`index.json`
  + 一个现役 `.bin`，上限 16 MiB，只保留最新一份；非法名/路径穿越在仓库层拒绝）。② 控制台上传
  `POST /firmware/upload`（原始二进制体，`x-firmware-name` / `x-firmware-version` 头，CSRF），
  带版本号时顺手写进 `settings.firmware.version`；`GET /firmware` 返回文件信息与各设备当前版本；
  `POST /firmware/remove` 删除。③ 设备面 `GET /firmware/<name>` 返回 `application/octet-stream`；
  OTA 响应的 `firmware.url` 按请求 `Host` 拼绝对地址（换网段不用改配置）。④ `handleOta` 会读请求体
  `application.version` 写进设备名册（头里通常没有），没有升级包时版本回落为设备当前版本/0.0.0，
  避免「提示有新版本但 URL 为空」的升级失败。⑤ **`force` 必须发数字 `1/0`**：固件 ota.cc 用
  `cJSON_IsNumber(force) && valueint == 1` 判定，JSON 布尔 `true` 会被忽略。
  验证：`test/firmware.test.mjs` + `test/http.test.mjs` 的 OTA/上传/下载/force 用例；真机升级流程未实测。
- **错误气泡 + session_id（2026-11-16）**：① ASR / LLM / TTS 失败不再发 `stt {text:''}`（固件会按用户
  消息建一个空气泡），改发 `{type:'alert', status, message, emotion}`——固件 `application.cc` 的
  `Alert()` 会显示系统气泡 + 表情 + 状态栏文字（不是朗读内容）。ASR 失败后照旧重开捕获
  （`#resumeCaptureAfterEmpty`），TTS 失败每轮只提示一次。② `VoiceSession` 的 sink 给所有下行 JSON
  自动补 `session_id`（值 = hello 里下发的会话 id）；测试里没传 `sessionId` 的会话不加，避免旧断言
  被迫改写。回归：`test/turn-guard.test.mjs` 3 项。
- **设备工具可见性（2026-11-16）**：设备侧 MCP 工具以前只在 LLM 工具表里，控制台看不到。现在
  `DeviceMcpClient.catalog()` 暴露只读目录（清洗后的 `name` / `originalName` / `description` /
  `parameters`），`VoiceSession.deviceTools()` 返回 `{ ready, tools }`；控制台 `GET /devices/tools?deviceId=`
  按需拿在线会话的目录（离线返回 `online:false` + 空数组，缺 `deviceId` 400、未知设备 404）。
  「管理设备」弹窗每台绑定设备多一个「设备工具 ▼」按钮，展开显示 MCP 上报的工具；执行仍走
  `callTool` 的原始名映射，目录不参与执行。真机工具列表未实测（依赖设备在线完成 MCP 握手）。

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

## 十、智能体（agent）与设备绑定（2026-11-08）

页面单位从「设备」改成 **智能体**：人设/模型/音色/语种/记忆/工具都属于智能体，一台智能体可以
绑定多台设备（同一人格在几块表上说话）。参考实现是 `xiaozhi-esp32-server` 的
`ai_agent` / `ai_device.agent_id`；本插件的契约在 `docs/agent-device.md`。

- 存储：`agents.json`（0600、版本 1；字段 `id` / `name` / `overrides` / `memoryEnabled` / `toolDisabled` /
  `createdAt` / `updatedAt`，`name` ≤64 字符、`toolDisabled` ≤50 项）；`devices.json` 只多一个 `agentId`。
  记忆按智能体（`memory/<agentId>.json`），历史仍按设备（`history/<deviceId>.jsonl`），
  工具开关按智能体，OTA / 断开 / 删除仍是设备级。
- 迁移：启动时 `adoptLegacyDevices`（`src/agents.js`）给每台没有 `agentId` 的设备各建一个智能体，把旧
  `overrides` / `toolDisabled` / `memoryEnabled` 搬过去，并把设备键的记忆文件复制到智能体键。
  旧字段留在 devices.json 里不删（回滚安全），运行时只在没有绑定关系时才回落到它们
  （`index.js` 的 `agentOf(device)`）。
- 新设备：`autoProvision: false`（默认）时先进入 `PendingStore`（`pending.json`），控制台「智能体」页顶部
  选择智能体并批准后才 `ensureDevice` 建档；`autoProvision: true` 时仍由 `store.onCreated` 自动建智能体
  （零接触入网）。批准时选了已有智能体就传 `provisionAgent: false`，避免先多建一个再改绑。
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
- **设备矩阵 / 绑定语义（2026-11-09）**：正确模型是 **N 台设备 : 1 个智能体**——设备是智能体的麦克风/扬声器，多台设备绑到同一智能体就是不同区域的矩阵；一台设备同一时刻只属于一个智能体（`devices.agentId` 单值，移动绑定）。「设备(N)」弹窗把非本智能体设备标成「其他设备（可移入本智能体）」并显示 `当前：<智能体>`，按钮是「移入本智能体」——
  **点它会先弹确认（2026-11-13 用户反馈「过于草率」）**：属于别家时正文写「从「甲」移入「小智」」并说明原智能体不再使用，
  未绑定时写「绑定到「小智」」；取消不发请求，确认才 `POST /agents/bind`。回归 `npm run check:devices`。换个说法：避免把「未绑定到本智能体」误读成「只能一对一」。**删除设备入口已移除（2026-11-13 用户要求）**：设备行只留 OTA / 断开 / 解绑，`onDeviceAction` 的 `remove` 分支与 i18n `agentRemoveDevice` 一并删除；
  后端 `POST /devices/remove` 仍在（脚本/API 用，`test/http.test.mjs` 覆盖），只是控制台不再暴露——误操作会连历史一起丢。
  **布局（2026-11-09 修）**：头部 `.xz-devices-head` 用 `flex:1;min-width:0` 的标题块 + 右上 `.xz-modal-close`（不再用会换行的 `.xz-row`）；弹窗高度随内容、`max-height:min(560px,86vh)`；其他设备行用 `.xz-device-row-inline` 单行展示，按钮靠右；页脚关闭按钮已去掉（右上角关闭即可）。设备名用 `.xz-device-rename` 透明内联输入（26px 高、按字数 88–180px、悬停/聚焦才显边框），不要用固定 180px 的表单输入框。不要改成设备↔智能体多对多，除非另做会话路由。
- **删智能体是级联删除**：绑定设备、它们的历史与记忆一起删（对齐参考 `deleteAgent`），
  控制台做成**确认弹窗**（2026-11-13：点「删除智能体」直接弹窗，标题 + 带名字的后果说明 + 取消/删除，
  不再用「再次点击删除」——菜单每点一次都要重开，体验差且容易误删）。
- 控制台：三个平级视图 **概览 / 智能体 / 全局设置**。卡片 = 智能体（徽标 + 名字/状态徽标 + `⋯` 菜单
  [播报/重命名/删除智能体] + 角色·模型·最近对话三格 + 配置/历史/设备(N) 三按钮）；
  「设备(N)」弹窗里绑定/解绑、改设备别名、OTA/断开（**没有删除设备入口**）；
  「播报」发给该智能体所有在线设备（一台都不在线时提示「这个智能体没有在线设备」）。
- 验证：`node --test "test/*.test.mjs"`（294 项，含 `test/agents.test.mjs` 7 项、`test/deepseek.test.mjs` 18 项、主用/备用互换 3 项、智能体服务商/官方音色 6 项）。

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
4. **改数据模型**：`agents.json` / `devices.json` / `pending.json` / `settings.json` 都要能"手改坏也能启动"——
   `normalizeAgent` / `normalizeDevice` / settings 的规范化函数要容错，坏文件隔离而不是拒绝启动。
5. **改"谁来存"**：记忆按智能体、历史按设备、工具开关按智能体、OTA 按设备。任何时候都不要再把
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
8. **改完的验收底线**：`node --test "test/*.test.mjs"` 294 项全绿 + `npm run build` 成功 + `npm run smoke` 通过 + `npm run check:ui` 通过 + `npm run check:fonts` 通过（只改了样式才必跑）+ `npm run check:role` 通过（只改了角色页才必跑）+ `npm run check:card` 通过（只改了智能体卡片才必跑）+ `node --check client.js` 通过 +
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
| `docs/voice-role-language.md` | 官方「角色 ↔ 音色 ↔ 语种」查证、241 条 volc 音色对照（2026-11-14 按官方 2.0 表重建）、已落地的改动 |
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
  添加 → ⋯ 菜单 → 删除二次确认 → 模型回显 → 自动保存 → ASR 测试识别）；
  `npm run check:fonts`（`scripts/check-fonts.mjs`，真浏览器 + CDP 读实际命中的字体，防中文落回宋体）；
  `npm run check:role`（`scripts/check-role-preset.mjs`，jsdom 点「角色模板」下拉：选模板填充人设、
  与 `test/fixtures/role-presets.json` 逐字比对、手改后回落「自定义」、无 i18n 缺键）；
  `npm run check:card`（`scripts/check-agent-card.mjs`，jsdom 点智能体卡片 `⋯` 菜单：相对卡片定位、Esc/点项关闭、
  重命名入口；删除走确认弹窗（取消不删 / 确认发 `POST /agents/remove` 带 agentId）；并断言 `.xz-agent-card`
  不再 `overflow:hidden`、`.xz-agent-menu` 必须是 `absolute`）。
- **生效**：build 后刷新控制台；仍加载旧产物就重启 DSH（未实测 refresh 是否足够）。
- **不要**：手改 `client.js`；组件里直接 `import react`（统一走 `src/client/react.js`）。
- **加组件**：放 `src/client/{views,agents,settings}/`，从 `core.js` 取 `t` / `callApi` / 常量，
  从 `ui/` 取现成组件；文案同时加到 `i18n/zh.js` 与 `i18n/en.js`（键必须对齐）。
