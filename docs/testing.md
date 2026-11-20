# 测试入口（服务端 + 端侧）

> 本文来自原 `AGENTS.md` §5–§6。命令按当前机器记录；换机器时只改端口、工具链路径和 COM 号，判定标准不变。

## 服务端测试

单测 + 语法检查（改完必跑）：

```powershell
cd D:\Demo\esp-xiaozhi\dsh-xiaozhi
node --test "test/*.test.mjs"          # 全量 336 项，必须全绿
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

当前 336 项，覆盖分句、VAD、Ogg/Opus 往返、mock 整轮、打断、20 轮、语种、音色族、**TTS 默认音色**（全局只存凭据可清空、只带凭据的主用/备用条目可构建、空音色→厂商默认、跨厂商残留→本厂商默认、自定义 ID 原样保留）、设备级覆盖合并（含「设备 hostProvider 不再强切 host」）、全局设置（人设/静音收口、`applyRuntimeSettings` 的 hostProvider/backups 叠加回归）、备用服务商（持久化/掩码/留空保留/整次失败/**条数不设上限**/`/test/provider`）、**服务商描述符**（描述符与 `BACKUP_SPEC` 白名单一致、字段可存储、stage 级名字覆盖、`hidden` 只存不展示、`GET /providers` 路由，`test/providers.test.mjs` 8 项）、**ASR 在线测试**（TTS→ASR 编排：分块喂 PCM、TTS mock/无音频/ASR error 的报错，`test/asr-probe.test.mjs` 5 项）、**设备侧 MCP/IoT**（MCP initialize/tools/list/tools/call 与工具名清洗、IoT descriptors/states/commands，`test/device-mcp.test.mjs` 5 项 + `test/device-iot.test.mjs` 2 项）、**外部 MCP（stdio）**（子进程 JSON-RPC initialize/tools/list/tools/call，`test/mcp-stdio.test.mjs` 1 项）、**外部 MCP（SSE / Streamable HTTP）**（本地 HTTP server 走通 initialize/tools/list/tools/call，`test/mcp-http.test.mjs` 1 项）、**MCP 接入点**（WebSocket JSON-RPC initialize/tools/list/tools/call，`test/mcp-endpoint.test.mjs` 1 项）、**入站 `/mcp`**（token 鉴权 + 服务端驱动 initialize/tools/list/tools/call，`test/mcp-inbound.test.mjs` 2 项 + `test/http.test.mjs` 1 项）、**服务端插件工具**（newsnow 热榜 / Intl 农历 / exit 退出 / HASS / RAGFlow / call_device / play_music + 「change_role / get_weather 已下掉」反向断言，`test/tools-extra.test.mjs` 9 项；音乐解码 `test/music.test.mjs` 1 项）、**待审核设备**（`PendingStore` 持久化/尝试次数/重新加载、`autoProvision:false` 时 OTA/WS 返回 `device-pending`、控制台批准并绑定指定智能体、拒绝移除、批准后 OTA 放行，`test/pending.test.mjs` 1 项 + `test/http.test.mjs` 1 项）、三段 failover（LLM 未出字前切换、TTS 首包前切换/出音频后不换家、ASR 回放不推 partial、abort 不切换、粘性回落）、mDNS 报文与地址过滤、小米 MiMo（api-key 认证头 / thinking / SSE / 工具调用 / 模型清单走 /v1/models 无内置兜底）、联网工具（Search 带正文与截断预算 / web_fetch 正文与 403·404 语义 / 动态 Key / 无 Key 回退）、对话历史（会话聚合与标题 / 旧格式 10 分钟迁移 / WAV 读写与路径安全 / 30 天保留与容量清理 / clear 粒度 / 4 条 HTTP 路由）、**智能体/设备绑定**（旧设备迁移与记忆复制 / 多设备绑定与移动 / 解绑 / 配置共享 / 级联删除 / 历史合并 / **智能体重名拦截**，`test/agents.test.mjs` 9 项）、**百智云语音**（描述符覆盖 ASR/TTS、语种归一化、语速能力门控、WAV 解析/重采样、TTS 请求体与 401 报错、ASR 真实节奏发送 + commit + delta/final 拼接 + 服务端错误帧，`test/baizhi.test.mjs` 13 项）、**DeepSeek 语音**（描述符覆盖 ASR/TTS、WAV 编解码与立体声下混、multipart `file` 上传、采样率归一、120s 截断、空音频不发请求、TTS 请求体与重采样、400 与计费字符上限，`test/deepseek.test.mjs` 18 项）、**主用/备用互换**（服务端整段互换且密钥不出进程、空主用不留空壳、CSRF / 非法 index / 坏 hostProvider 被拒，`test/settings.test.mjs` 3 项）、**表情跟随**（21 个表情名与固件 `chibi-maid_240` 资源一一对应、emoji 被 SSE 拆成两半仍能识别、无 emoji 不发 emotion、TTS 文本与历史里都不含 emoji，`test/emotion.test.mjs` 6 项）、**回合守卫**（listen stop 后的续话窗口：窗口内继续说不收口、窗口内没声音正常收口、工具调用前发 `% 工具名` 提示、工具报错回灌给模型、模型只回表情时用兜底话术收尾，`test/turn-guard.test.mjs` 8 项，含「空回合后不重发 listen start 也能接住下一句」）。**TTS 流式下发**（首包早于合成结束、流式 Ogg 解复用跨页/跨字节边界、abort 停流且不产生幽灵帧、空音频不发 sentence_start，`test/tts-stream.test.mjs` 4 项）。**固件升级通道**（固件仓库保存/替换/删除与非法名拒绝、OTA 请求体解析设备版本、上传后 OTA 下发绝对 URL、force 以数字下发、移除后回落到设备版本，`test/firmware.test.mjs` 4 项 + `test/http.test.mjs` 5 项）。**错误气泡与 session_id**（ASR 失败 alert、LLM 失败 alert + 兜底语音、下行业务消息带 session_id，`test/turn-guard.test.mjs` 3 项）。**设备工具可见性**（`DeviceMcpClient.catalog()` 只读目录、`GET /devices/tools` 在线/离线/参数校验，`test/device-mcp.test.mjs` + `test/http.test.mjs`）。**DSH 会话后端**（只念最终结论、工具步骤文字被丢弃、按 sessionId 分发防串台、`source.rpcId` 对上本轮、打断取消当前 turn、超时取消并抛错、绑定按智能体持久化，`test/session-backend.test.mjs` 10 项；回答来源保存/坏值 400/`GET /sessions` 过滤子代理，`test/agents.test.mjs` 2 项）。

**Bot = DSH 会话（2026-11-20）**：`test/session-backend.test.mjs` 12 项（原话直送 / 只念最终结论 / 工具进度与气泡 / 摘要与回落 / 不串台 / rpcId / 打断与超时 / 绑定持久化）、`test/spoken-summary.test.mjs` 5 项（短回复跳过 / 清理与截断 / 失败与超时回落 / 提示词 / 进度话术）、`test/approval.test.mjs` 2 项（意图分类先判拒绝 / 桥在含糊、失败、未装配时 `next()` 交回桌面）、`test/question-voice.test.mjs` 5 项（单选标签/序号、多选拆分、自由文本、桥的 `next()` 回落）、`test/question-voice-session.test.mjs` 2 项（进程内真跑 TTS/player 与短捕获）、`test/agents.test.mjs` 增至 10 项（Bot 会话视图与 `/agents/session` 的 new/auto/bind）。**未实测**：真实手表端到端、摘要耗时、审批语音。

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

## 端侧测试

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
