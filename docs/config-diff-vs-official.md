# dsh-xiaozhi 插件 vs 官方 xiaozhi-esp32-server：配置逐项对照审计

- 审计对象 A（以下简称**官方**）：`D:\Demo\esp-xiaozhi\xiaozhi-esp32-server\main\xiaozhi-server`
  （主配置 `config.yaml`、`config_from_api.yaml`、`agent-base-prompt.txt`，以及 `core/`、`plugins_func/` 中读取这些配置的实现）
- 审计对象 B（以下简称**插件**）：`D:\Demo\esp-xiaozhi\dsh-xiaozhi`
  （`index.js` 的 `resolveConfig()`、`cordis.patch.yml`、`src/settings.js`、`src/voice/**`、`src/ingress.js` 等）
- 运行期实际值：`C:\Users\15216\.dsh-xiaozhi\settings.json`（**只读**；本报告只记录「已配置 / 为空」，不抄录任何明文密钥、token、密码）
- 证据标注约定：`官方 config.yaml:625`、`插件 index.js:321` 均指**该仓库相对路径下的行号**，行号以文末「七、证据快照」为准。
- 结论分级：`✅ 等价`、`⚠️ 部分等价（语义/单位/实现不同）`、`❌ 不等价（会影响功能或体验）`、`❓ 未确认`。
- 对照规模：第二节 12 个域共 **85 行编号对照**，其中 `❌ 不等价 47 条`、`⚠️ 部分等价 27 条`、`✅ 等价 8 条`、`❓ 未确认 3 条`。
- 本审计**只读**代码与配置，未修改任何文件；唯一写入物即本文档。

> 重要前提（影响复现）：审计期间插件目录正被其他协作者持续修改（`src/settings.js`、`src/voice/adapters/index.js`、`src/voice/adapters/openai-llm.js` 等在审计窗口内发生变更）。本文所有插件侧行号绑定文末快照哈希；若文件已再次变化，先按「七、证据快照」核对哈希，再决定是否重读。官方侧文件在审计期间未变化。

---

## 一、TL;DR（最影响体验的 5 条）

1. **工具面整体仍缺位（设备侧 MCP/IoT、外部 MCP、接入点、入站 `/mcp` 与 weather/newsnow/lunar 已补）**：官方有 15+ 服务端插件工具、设备侧 IoT、设备侧 MCP、外部 MCP server、MCP 接入点（`官方 config.yaml:132-188, 281-292`、`plugins_func/functions/*.py`、`helloHandle.py:56-73`、`mcp_server_settings.json:9-55`）；插件服务端工具现有 7 个（`get_current_time` / `web_search` / `web_fetch` / `get_news_from_chinanews` / `get_news_from_newsnow` / `get_weather` / `get_lunar`），**设备侧 MCP**、**设备侧 IoT**、**外部 MCP（stdio/SSE/Streamable HTTP）**、**MCP 接入点** 与 **入站 `/mcp`** 已实现；音乐/HASS/RAGFlow/exit/change_role/call_device 仍未接。
2. **判停/VAD 完全不是同一套**：官方是 Silero 神经 VAD（阈值 0.5/0.3、静音 200ms，`官方 config.yaml:606-612`、`silero.py:26-37,88-113`）；插件默认「设备判停」（等固件发 `listen stop`），兜底能量 VAD 是 RMS 0.05/静音 400ms（`插件 index.js:280-290,282`、`src/voice/vad.js:19-37`）。两套阈值量纲不同、不可换算，句尾时延与环境音误触发的表现不同。
3. **回答长度与上下文被压得很短**：官方同类模型 `max_tokens: 500`（`官方 config.yaml:625`），插件默认 `max_tokens: 120` 并追加 `<voice_reply_limits>` 强制 1–2 句（`插件 index.js:321,62-67`）；会话历史官方全量进 LLM（`官方 core/utils/dialogue.py:151-161`），插件裁到 8 轮（`插件 index.js:295`、`src/voice/session.js:563`）。**这是设计取舍而非缺陷**，但会直接让「讲长故事 / 连续追问」类对话变差。
4. **音频下行参数不同**：官方下行 24kHz/单声道/**60ms** 帧（`官方 config.yaml:92-97`、`sendAudioHandle.py:15`），插件下行 24kHz/**20ms** 帧（`插件 index.js:305,309`，并在 hello 里如实声明，`src/ingress.js:329-342`）。同样时长语音的 WS 帧数是官方 3 倍，设备缓冲与网络抖动敏感度不同。
5. **空闲/心跳策略更激进，且缺「结束语」**：官方 120s 无语音触发 `end_prompt` 告别对话、180s 才强制断开（`官方 config.yaml:61,227-231`、`connection.py:184-186,1720-1745`、`receiveAudioHandle.py:110-134`）；插件 30s 发 ping、**90s 无任何入站消息即断开**（`插件 index.js:257,261`、`src/ingress.js:276-286`），且没有告别话术与「退出/关闭」命令（`官方 config.yaml:84-86`、`intentHandler.py:53-63`）。

---

## 二、分域对照

### 2.1 服务与端口 / OTA / WS / hello

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 1 | WS 监听端口 | `server.port: 8000`（`config.yaml:12`） | `8989`（`index.js:46,201`；`cordis.patch.yml:6`） | ❌ | 设备 OTA 地址、部署端口规划 |
| 2 | HTTP/OTA 端口 | 独立 `http_port: 8003`（`config.yaml:14`；`core/http_server.py:40`） | 与 WS 同端口 8989，无独立 HTTP 端口（`src/ingress.js:400-408,444`） | ❌ | 端口数量、防火墙/TLS 前置 |
| 3 | OTA 路径 | `GET/POST /xiaozhi/ota/`、`/xiaozhi/ota/download/{file}`（`core/http_server.py:45-64`） | `/xiaozhi/ota/`、`/xiaozhi/ota/activate`；无下载路由（`src/ingress.js:399-408`） | ⚠️ | 固件下载链路 |
| 4 | OTA 响应体 | `server_time{timestamp,timezone_offset}`、`firmware{version,url}`、`websocket{url,token}`、可选 `mqtt`（`core/api/ota_handler.py:223-298`） | `websocket{url,token}`、`server_time`、`activation:null`、`firmware`（`src/ingress.js:148-157`） | ⚠️ | 激活流程 / MQTT 网关 / 固件升级 |
| 5 | 固件升级 | 扫 `data/bin/{model}_{version}.bin`，比较版本后下发下载 URL（`core/api/ota_handler.py:57-64,300-338`） | 只回配置里的静态 `firmware.version/url`，设备级 `otaEnabled` 可关；**无版本比较**（`src/ingress.js:153-157`） | ❌ | **无法通过 OTA 远程升级固件** |
| 6 | WS 路径 | `/xiaozhi/v1/`（`core/api/ota_handler.py:141`；`core/http_server.py:33`） | `/xiaozhi/v1/`（`index.js:8,783`） | ✅ | — |
| 7 | 下发 WS 地址来源 | 配置 `server.websocket`，未配置则按本机 IP 拼（`core/api/ota_handler.py:125-141`） | `endpoints.lanWsUrl/wanWsUrl` 覆盖，空则**按请求 Host 头推导**（`src/ingress.js:90-99`） | ⚠️ | 反代/NAT 后地址正确性；插件方案对 Host 依赖更强 |
| 8 | hello 超时 | 未见显式 hello 超时（连接即后台初始化并回 welcome，`connection.py:242-250,790-796`）→ ❓未确认 | `helloTimeoutMs` 默认 10s，未发 hello 即断（`index.js:253`；`src/ingress.js:269-274`） | ❓ | 异常设备的连接生命周期 |
| 9 | hello 应答内容 | 回 `config.xiaozhi`（type/version/transport/audio_params）+ `session_id`（`config.yaml:88-97`；`connection.py:242-243`；`helloHandle.py:48-67`） | 回 `type/transport/session_id/audio_params`（**无 version 字段**）（`src/ingress.js:337-342`） | ⚠️ | 固件对 version 字段的容忍度（当前固件未报错） |
| 10 | 心跳与空闲 | WS 库 `ping_interval=None`；`enable_websocket_ping:false` 时忽略 ping（`core/websocket_server.py:76-82`；`core/handle/textHandler/pingMessageHandler.py:26-30`）；无语音 120s 触发结束语、180s 强制关（`config.yaml:61`；`connection.py:184-186,1720-1745`） | 每 30s 主动发 WS ping；90s 无入站即断（`index.js:257,261`；`src/ingress.js:276-286`） | ❌ | 长时间沉默被踢；无告别话术 |
| 11 | WS 鉴权 | `server.auth.enabled` 默认 false；开启后校验 `Authorization: Bearer`（`config.yaml:31-37`；`core/websocket_server.py:210-231`） | 仅校验 `Device-Id` 头 + `autoProvision`/封禁名单；`endpoints.token` 只随 OTA 下发，**WS 建连不校验**（`src/ingress.js:148-149,179-206`） | ❌ | 同网段任意设备可直连（LAN 场景风险，公网暴露前必须补） |
| 12 | 时区单位 | `server.timezone_offset: +8`（小时），下发时 ×60 = 480（`config.yaml:29`；`core/api/ota_handler.py:226`） | 配置即 480（分钟），直接下发（`index.js:212-214`；`src/ingress.js:150`） | ⚠️ | 线上值等价，**配置单位不同**，改配置易错 |
| 13 | 激活码 / 绑定 | 走 manager-api 绑定流程（`connection.py:800-830`；`receiveAudioHandle.py:148-183`） | 不激活：首轮 OTA/WS 即登记（`src/ingress.js:115-138,185-206`；`activate` 恒返回 ok，`:166-168`） | ⚠️ | 零接触接入 vs 运营侧账号体系 |

### 2.2 音频参数

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 14 | 上行采样率 | 由设备 hello 决定并回显（`helloHandle.py:50-55`；`connection.py:246`），VAD 固定按 16k 喂模型（`core/providers/vad/silero.py:80`） | 默认 16000，sanitize 允许 8000–48000（`index.js:304`；`src/ingress.js:72`） | ⚠️ | 上行解码/ASR |
| 15 | 下行采样率 | 24000（`config.yaml:95`） | 24000（`index.js:305`） | ✅ | — |
| 16 | 下行帧长 | **60ms**（`config.yaml:97`；`core/handle/sendAudioHandle.py:15`） | **20ms**（`index.js:309`；hello 里声明，`src/ingress.js:329-342`；编码参数 `codec.js:36`） | ❌ | 帧数×3、设备缓冲/抖动、单帧丢包听感 |
| 17 | 上行帧长 | 60ms（`config.yaml:97`；`core/utils/p3.py:10`） | 60ms（`index.js:308`；`src/ingress.js:324-325` 用设备上报值） | ✅ | — |
| 18 | 声道 | 1（`config.yaml:96`） | 1（`codec.js:32,46`；`src/ingress.js:73`） | ✅ | — |
| 19 | Opus 编码参数 | 配置里不暴露，走 libopus 默认（`config.yaml` 无对应键）→ ❓未确认 | ffmpeg `libopus`，32kbps、`voip`、按帧长 20ms（`src/voice/codec.js:36-60,173-180`） | ❓ | 音质/流量；官方无对照项 |

### 2.3 判停 / VAD

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 20 | VAD 实现 | Silero ONNX 神经 VAD（`config.yaml:606-612`；`core/providers/vad/silero.py:12-37`） | 默认 `vadMode: device`＝**固件 AFE 判停**，插件只收 `listen stop`；`energy` 模式才用自研 RMS 能量 VAD（`index.js:282`；`src/voice/session.js:259-261,279-285`；`src/voice/vad.js:19-37`） | ❌ | 判停归属、老固件兼容、环境音误触发 |
| 21 | 阈值 | `threshold: 0.5`、`threshold_low: 0.3`（模型打分 0–1，双阈值滞回）（`config.yaml:609-610`；`silero.py:88-103`） | `vadThreshold: 0.05`（int16 RMS 0–1）；代码注释明示两者量纲不同、不可换算（`index.js:290`；`src/voice/vad.js:10-16,27`） | ❌ | 起说灵敏度/打断灵敏度 |
| 22 | 句尾静音判定 | `min_silence_duration_ms: 200`（`config.yaml:612`；`silero.py:33-35,105-109`） | `device` 模式由固件决定（固件 `vad_min_noise_ms=300`，见仓库 AGENTS.md 三）；`energy` 模式 `silenceMs: 400`（`index.js:280`；`cordis.patch.yml:54`） | ❌ | 句尾时延（插件路径更长/更依赖固件） |
| 23 | 起始语音门槛 | 5 帧滑动窗内 ≥3 帧判为有声（`silero.py:37,100-103`） | `minSpeechMs: 120`ms 能量累计（`index.js:283`；`vad.js:71-77`） | ❌ | 短促语气词是否被当一句话 |
| 24 | 判停模式作为配置项 | 无（单一 Silero，开关只体现在 `selected_module.VAD`，`config.yaml:236`） | `vadMode: device|energy` 两套语义共存于同一配置（`index.js:281-282`；`cordis.patch.yml:50-56`） | ⚠️ | 配置误用风险（插件特有，已在 AGENTS.md 记为技术债 TD-6） |

### 2.4 ASR

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 25 | 供应商集合 | FunASR 本地 / FunASRServer / Sherpa×2 / Doubao ASR / Doubao Stream / Doubao Stream V2 / Tencent / Aliyun / AliyunStream / Baidu / OpenAI / Groq / Vosk / Qwen3-ASR-Flash / Xunfei / AliyunBL（`config.yaml:359-605`） | mock / funasr / xunfei / local（宿主 SenseVoice）/ volc（`src/voice/adapters/index.js:173-220`） | ❌ | 可选厂商与成本 |
| 26 | 默认选择 | `selected_module.ASR: FunASR`（本地 SenseVoice，`config.yaml:238,360-366`） | 代码默认 `mock`；运行期 `volc`（`index.js:332-337`；`~/.dsh-xiaozhi/settings.json`） | ❌ | 离线能力、识别语言 |
| 27 | 火山端点/资源组合 | DoubaoStreamASR：`type: doubao_stream`、`resource_id: volc.bigasr.sauc.duration`（1.0 资源）（`config.yaml:409-419`） | `bigmodel_async` 端点 + `volc.seedasr.sauc.duration`（2.0 资源）（`src/voice/adapters/volc-asr.js:25-33`；`settings.json` 运行期同值） | ❌ | 资源与端点必须同代，错配直接 403（插件注释 `volc-asr.js:1-19`；AGENTS.md 记录实测） |
| 28 | endpointing / 尾包静音 | Doubao Stream `end_window_size: 200`（ms，`config.yaml:428-429`） | `endWindowSize` 默认 **800ms**，且控制台/设置里无此字段可改（`src/voice/adapters/index.js:216`；`volc-asr.js:77`） | ❌ | 句尾等待约 4 倍，**直接影响每轮首响延迟** |
| 29 | 其他厂商断句静音 | AliyunStream `max_sentence_silence: 800`；AliyunBL `max_sentence_silence: 200`（`config.yaml:492-493,597-598`） | 无对应厂商/参数（`adapters/index.js:173-220`） | ❌ | 无对照实现 |
| 30 | 热词 / 替换词 / ITN | `boosting_table_name`、`correct_table_name`（`config.yaml:405-407,420-422`）；manager 下发 `correct_words` 注入 TTS/ASR（`connection.py:922-927`） | 无热词/替换词；ITN、标点固定 `true`（`volc-asr.js:66-79`） | ❌ | 专有名词/人名识别 |
| 31 | 识别语言 | FunASR `language: auto`；Doubao `enable_multilingual: False`（`config.yaml:366,424`） | `asr.language` 默认 `zh`（`index.js:335`），讯飞固定 `zh_cn`（`adapters/index.js:194`） | ⚠️ | 非中文场景 |
| 32 | 中间结果（partial） | 每句只在 `startToChat` 发一次 `stt`（`core/handle/receiveAudioHandle.py:102`） | 默认不推 partial（`partialStt` 未在 `resolveConfig` 暴露默认关，`session.js:234-238`） | ✅ | 字幕（两者都是整句） |

### 2.5 LLM（含工具调用 / 意图识别）

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 33 | 供应商集合 | openai / dify / ollama / gemini / coze / fastgpt / xinference / homeassistant / AliBL 等，含 15 个预置实例（`config.yaml:614-745`） | host（复用 DSH 厂商）/ mock / deepseek / openai / volc / spark / mimo（`adapters/index.js:45-56,68-109`） | ❌ | 模型可选范围 |
| 34 | 默认模型 | `selected_module.LLM: ChatGLMLLM` → `glm-4-flash`（`config.yaml:240,657-664`） | 代码默认 `mock`（`cordis.patch.yml:74`）；运行期 settings.json 为 `host` + `opencode-go` + `deepseek-v4.1-flash`，但**新代码已把 host 从设备链路退役**（`device-config.js:7-12`；`cordis.patch.yml:70-74`）；LLM 直连白名单为 deepseek / mimo / openai / volc / spark（`cordis.patch.yml:70`）→ 运行期值需重存后才与新代码一致，❓未确认 | ❌ | 输出质量、是否消耗 Harness 额度 |
| 35 | max_tokens | AliLLM `500`（`config.yaml:625`）；未配置的实例不发送该参数（`core/providers/llm/openai/openai.py:55-71,129-139`） | 默认 **120**，控制台可改（`index.js:321`；`cordis.patch.yml:78`；`settings.js:230-231,448-454` 量程 32–2048） | ❌ | 回复长度/首响/TTS 时长（插件显著更短） |
| 36 | temperature | 0.7（AliLLM，`config.yaml:624`）；未配置则不发送（`openai.py:55-71`） | 0.7（`index.js:319`），**控制台无 temperature 字段**（`settings.js:223-235`） | ⚠️ | 语气可控性（运行期改不了） |
| 37 | 工具调用机制 | `response_with_functions` + `Intent.functions` 白名单（`config.yaml:275-292`；`openai.py:166-207`） | `streamWithTools`，`tool_choice:'auto'`，工具=固定 4 个 × 设备开关（`adapters/openai-llm.js:53-56`；`session.js:494-495`；`tools.js:17`） | ⚠️ | 能调什么（插件极少） |
| 38 | 工具循环上限 | `MAX_DEPTH = 5`（`connection.py:1079-1093`，到顶改为强制作答） | `MAX_TOOL_ROUNDS = 3`（`tools.js:15`；`session.js:498`） | ❌ | 多步任务能否完成 |
| 39 | 工具调用超时 | `tool_call_timeout: 30`（`config.yaml:65`；`connection.py:1347-1353`、`intentHandler.py:170-178`） | 无统一超时，仅单工具自带（如新闻 8s，`tools.js:192-193`）；`session.js:534` 直接 await | ❌ | 工具卡死时整轮悬挂 |
| 40 | 意图识别 | 三选一：`function_call` / `intent_llm`（独立 LLM，历史 4 条）/ `nointent`（`config.yaml:252-292`；`core/providers/intent/intent_llm/intent_llm.py:31`；`intentHandler.py:20-50`） | **无意图模块**，只有 LLM function calling（`session.js:494-542`） | ❌ | 前置拦截、退出、音量/音乐类系统指令 |
| 41 | 思考模式 | 按域名关闭 thinking（`openai.py:12-20`） | MiMo 固定 `thinking: disabled`，其余不发 thinking（`adapters/index.js:50-55`；`openai-llm.js:57`） | ⚠️ | 首字延迟（插件覆盖范围更小） |
| 42 | 会话上下文 | 全量 dialogue 进 LLM，不裁剪（`core/utils/dialogue.py:151-161`） | `historyTurns: 8` → 只保留最近 16 条（`index.js:295`；`session.js:561-563`） | ❌ | 长对话连贯性（设计取舍） |

### 2.6 TTS

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 43 | 供应商集合 | edge / doubao(+302AI) / huoshan 双向流式×2 / siliconflow / cozecn / volces gateway / openai / fishspeech / gpt_sovits×2 / minimax / aliyun×2 / tencent / alibl_stream / xunfei_stream / custom / paddle / index_stream（`config.yaml:771-1176`） | mock / edge / xunfei / volc（HTTP 单向流式）（`adapters/index.js:117-164`） | ❌ | 音色/成本/延迟选择 |
| 44 | 默认选择 | `selected_module.TTS: EdgeTTS`，`voice: zh-CN-XiaoxiaoNeural`（`config.yaml:244,773-778`） | 代码默认 `mock`；patch 默认 `mock`（`cordis.patch.yml:80-85`）；运行期 `volc` + 实际生效音色 `zh_female_vv_uranus_bigtts` + 资源 `seed-tts-2.0`（2026-11-08 起全局条目只存「厂商 + 凭据」，音色按设备选、留空 = 厂商默认，`settings.json` 不再存 voice） | ❌ | 开箱可用性（插件默认 mock 只适合桌面联调） |
| 45 | 下行音频格式 | provider 产出后统一编码为 opus 24k（`config.yaml:95`；`core/utils/opus_encoder_utils.py:25`） | 要求 provider 直接给 PCM 24000，再 ffmpeg 编 opus（`session.js:578-581`；`volc-http-tts.js:41`；`codec.js:173-180`） | ⚠️ | 重采样质量/链路（实现路径不同） |
| 46 | 流式方式 | 支持双向流式（Huoshan double stream、aliyun_stream、xunfei_stream）（`config.yaml:798-863,1021-1044,1155-1176`） | 按句整段 HTTP 单向流式合成，等整句 PCM 收完再编码（`session.js:572-621`；`volc-http-tts.js:1-12`） | ❌ | 长句首包延迟 / 打断响应 |
| 47 | 语速/音量/音高 | provider 级独立参数（doubao `speed_ratio/volume_ratio/pitch_ratio`；huoshan `speech_rate/loudness_rate`）（`config.yaml:794-796,815-818`） | 设置里有 `tts.speed`（`settings.js:236-252`；`index.js:144` 会叠加），但 **volc 分支不接收 speed**（`adapters/index.js:152-161`）；edge 用 `rate`（`:128-136`）；讯飞用 `speed/volume/pitch`（`:138-151`） | ❌ | **控制台改语速对火山 TTS 不生效**（保存成功、运行期无效果） |
| 48 | 超时 | `tts_timeout: 15`（`config.yaml:63`；`core/providers/tts/base.py:40-42`） | edge/xunfei 15s（`adapters/index.js:135,149`），volc 20s（`volc-http-tts.js:24`） | ⚠️ | 失败重试时延 |
| 49 | 语速参数默认值（讯飞） | `speed: 50`（0–100，`config.yaml:1174`） | `speed: 50`（`adapters/index.js:145`） | ✅ | — |

### 2.7 提示词

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 50 | 结构 | `config.yaml` 的 `prompt`（人设）+ `prompt_template: agent-base-prompt.txt` 模板渲染（`config.yaml:205-221`；`core/utils/prompt_manager.py:251-327`） | 单段 `systemPrompt` + 追加 `<voice_reply_limits>` + 时钟 + 可选语种指令（`index.js:272-281,493,535-537`） | ❌ | 提示词工程能力（插件无模板/分段） |
| 51 | 时间注入 | `<context>` 中 `{{current_time}}` 每轮替换为 `HH:MM`，另有日期/星期/农历（`agent-base-prompt.txt:72-80`；`dialogue.py:109-112`；`prompt_manager.py:132-144`） | 末尾追加 `当前时间和日期: yyyy年MM月dd日 HH:mm:ss 星期X`（`index.js:73-80`） | ⚠️ | 「现在几点」两套都能答；插件无农历 |
| 52 | 位置/天气/动态上下文 | `local_address`、`weather_info`、`dynamic_context` 注入（`agent-base-prompt.txt:76-79`；`prompt_manager.py:146-249`；`config.yaml:126-129`） | **无** | ❌ | 「明天天气」免工具直答、位置感知 |
| 53 | 语种指令 | `<output_language_directive>`，取 `TTS.language`，缺省「中文」（`agent-base-prompt.txt:14-33`；`prompt_manager.py:291-297`） | 白名单 6 个值，空=不注入（`src/voice/language.js:14-21,56-68`；`index.js:493,535-537`）；全局 UI 已删，只在智能体 `overrides.language` | ⚠️ | 多语种一致性（插件更安全，覆盖面略窄） |
| 54 | 语音输出格式约束 | `<tts_format_constraints>`：禁 Markdown/括号动作、emoji 白名单（`agent-base-prompt.txt:42-51`；`prompt_manager.py:29-51`） | `<voice_reply_limits>` 限长 + segmenter 剥离 Markdown/emoji（`index.js:62-67`；`segmenter.js:13-14,237`） | ⚠️ | 朗读质量（插件无 emoji 白名单，靠剥离） |
| 55 | ASR 容错 / 告别工具约束 | `<core_rules>`：容忍同音字、告别时必须调 `handle_exit_intent`（`agent-base-prompt.txt:7-12`） | 无（也没有退出工具） | ❌ | 告别/退出体验 |
| 56 | 声纹说话人注入 | `<speaker_recognition>` + `speakers_info`（`agent-base-prompt.txt:66-70`；`dialogue.py:123-146`） | 无 | ❌ | 多人区分（依赖缺失的声纹能力） |

### 2.8 记忆 / 历史

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 57 | 记忆默认开关 | `selected_module.Memory: nomem`（默认不开）（`config.yaml:246,348-350`） | 默认开启本地记忆，可按智能体关闭（`index.js` 的 `agentOf`；`memory.js:20-23`；`session.js:488`） | ❌ | 隐私取向相反 |
| 58 | 记忆实现 | mem0ai / powermem / mem_local_short（LLM 总结，独立 LLM，`max_tokens=2000/temperature=0.2`）（`config.yaml:294-357`；`mem_local_short.py:135-198`） | 原样保留最近 8 轮 + 「记住…」事实（≤20 条），注入截断 500 字（`memory.js:20-23,86-139`） | ❌ | 记忆质量、token 成本、长期画像 |
| 59 | 记忆存储 | `data/.memory.yaml`，按 `role_id` 分节（`mem_local_short.py:101-103,126-133`） | `~/.dsh-xiaozhi/memory/<device>.json`（`memory.js:46,71-79`） | ❌ | 可运维性/迁移 |
| 60 | 注入位置 | `<memory>…</memory>` 标签内（`dialogue.py:114-121`） | system prompt 末尾 `用户个性化信息: …`（`memory.js:161-166`；`session.js:488-491`） | ⚠️ | 提示词形态（与 Go 服务端对齐，非官方 Python 形态） |
| 61 | 会话历史裁剪 | 不裁剪（`dialogue.py:151-161`） | 8 轮 = 16 条（`index.js:295`；`session.js:563`） | ❌ | 长对话（同 #42） |
| 62 | 长期历史 | 上报 manager（`chat_history_conf`，`connection.py:111,285,915-916`） | 本地 JSONL，2000 行封顶，不回灌提示词（`history.js:14,42-73`） | ⚠️ | 运营侧可见性 |

### 2.9 工具 / MCP / 插件

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 63 | 服务端插件工具 | 15+ `@register_function`：change_role / get_weather / get_news×2 / play_music / handle_exit_intent / get_lunar / hass×3 / search_from_ragflow / web_search / call_device（`plugins_func/functions/*.py` 各装饰器行；`plugins_func/register.py:85-100`） | 7 个：get_current_time / web_search / web_fetch / get_news_from_chinanews / get_news_from_newsnow / get_weather / get_lunar（`tools.js`） | ⚠️ | 天气/热榜/农历已补；音乐、HASS、RAGFlow、退出、角色切换仍缺 |
| 64 | 外部 MCP server | `data/.mcp_server_settings.json`，支持 stdio / sse / streamable-http（`mcp_server_settings.json:9-55`） | **已实现**：`src/mcp/stdio-client.js` + `http-client.js` + `manager.js`；配置 `~/.dsh-xiaozhi/mcp_servers.json`，三种传输都支持 | ✅ | 外部工具生态已可接入 |
| 65 | 设备侧 MCP | `features.mcp` → `MCPClient`，hello 后发 initialize + tools/list（`helloHandle.py:56-73`；`core/providers/tools/device_mcp/mcp_handler.py:148-203`） | **已实现**：`src/voice/device-mcp.js`；hello 后发 `type:'mcp'` initialize/tools/list，工具名清洗、tools/call 从 id=3、30s 超时（`test/device-mcp.test.mjs`） | ✅ | 设备/游戏上报工具已可接入；外部 MCP server 另见 #64 |
| 66 | MCP 接入点（出站） | `mcp_endpoint` 配置 + `connect_mcp_endpoint`（`config.yaml:119-121`；`core/providers/tools/unified_tool_handler.py:81-101`） | **已实现**：`src/mcp/ws-endpoint-client.js`；配置 `mcpEndpoint`，裸 JSON-RPC initialize/tools/list/tools/call（`test/mcp-endpoint.test.mjs`） | ✅ | 对接小智 MCP 接入点 |
| 67 | IoT 设备控制 | iot descriptors/status/commands（`core/providers/tools/device_iot/iot_handler.py:50-63`；`iot_executor.py:102-135`） | **已实现**：`src/voice/device-iot.js`；descriptors/states 注册 `get_*` / `<device>_<method>`，控制回 `type:'iot'` commands（`test/device-iot.test.mjs`） | ⚠️ | 智能家居/设备属性控制已可用；尚无官方 IoT 描述符生态/示例 |
| 68 | 工具白名单 | `Intent.functions` 列表（服务端统一）（`config.yaml:281-292`） | 设备级 `toolsDisabled`/`toolsEnabled` 开关（`tools.js:105-107`；`control.js:319`；`index.js:582`） | ⚠️ | 粒度更细但可列的工具仍少 |
| 69 | 工具调用超时/轮次 | 见 #38/#39 | 见 #38/#39 | ❌ | — |

### 2.10 打断 / 静音 / 重连 / 并发 / 后处理

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 70 | 打断触发 | `client_abort` + 服务端 AEC 实时打断（`receiveAudioHandle.py:27-32,91-92`；`abortHandle.py:13`） | 能量 VAD `speech-start` 触发 barge-in + generation epoch 丢弃已排队音频并补发 `tts stop`（`session.js:265-278,638-652`；`elements.js:179-196`） | ⚠️ | 插件防「幽灵音频」更彻底，但无服务端 AEC（回声更易误触发，靠 0.05 阈值压） |
| 71 | 打断收尾协议 | 发 `tts stop`，清 speaking 状态，等队列（`sendAudioHandle.py:282-315`） | 立即发 `{"type":"tts","state":"stop","reason":…}`（多 `reason` 字段）（`elements.js:188-194,273-275`） | ⚠️ | 固件是否忽略未知字段（当前固件忽略） |
| 72 | 空回合 / 无语音处理 | 无特殊处理（VAD 门控），靠 120s 结束语兜底（`receiveAudioHandle.py:110-134`） | 空回合重开捕获、不补 `tts` 防设备卡死；`turn.empty_close`/`asr.empty` 可观测（`session.js:166-177,422-433`） | ⚠️ | 插件独有防死锁逻辑（AGENTS.md 记录的「只能聊一轮」修复） |
| 73 | 重连 | 每个 WS 新建 `ConnectionHandler`（`websocket_server.py:121-131`） | 每个 WS 新建 `VoiceSession`，同 deviceId 旧连接被替换（`src/ingress.js:222-239`；hub） | ✅ | — |
| 74 | 并发上限 | 每连接 `ThreadPoolExecutor(5)`（`connection.py:124`）；无设备总数限制 | `maxDevices: 1000`（`index.js:207-210`）；单设备单会话 | ⚠️ | 资源保护策略不同 |
| 75 | 输出字数上限 | `device_max_output_size` + 超限播报（`receiveAudioHandle.py:82-88,137-145`） | 无 | ❌ | 成本/滥用保护 |
| 76 | 唤醒词 / 问候 / 退出命令 | `wakeup_words` 11 条 + 唤醒回复缓存 + `enable_greeting` + `exit_commands`（`config.yaml:67-69,84-86,107-118`；`helloHandle.py:76-134`；`intentHandler.py:53-63`） | 全部依赖设备/固件，插件无对应配置 | ❌ | 「退出/关闭」语音指令、唤醒应答 |
| 77 | 服务端 AEC / 声纹 | `features.aec`、`client_aec`（`helloHandle.py:63-65`）；voiceprint（`config.yaml:190-200`） | 无 | ❌ | 免提回声、多人识别 |
| 78 | 提示音 / 结束语 | `enable_stop_tts_notify` + `stop_tts_notify_voice`、`end_prompt`（`config.yaml:71-73,227-231`） | 无 | ❌ | 说完提示音、告别话术 |

### 2.11 双方独有能力

官方独有而插件缺失的能力（按风险分级）见**第三节**；插件独有/更强的能力见**第四节**。

### 2.12 config_from_api.yaml / 环境变量 / settings.json 的覆盖关系

| # | 配置项 | 官方值/行为（证据） | 插件值/行为（证据） | 等价 | 影响功能 |
|---|---|---|---|---|---|
| 79 | 本地覆盖机制 | `config.yaml` ← `data/.config.yaml` 深度合并（`config.yaml:1-3`；`config/config_loader.py:35-46`） | `cordis.patch.yml`（Loader）→ `resolveConfig()` 默认值（`cordis.patch.yml`；`index.js:179-340`） | ⚠️ | 部署方式不同，都是「文件叠文件」 |
| 80 | 远程/管理平台覆盖 | `config_from_api.yaml` 配 `manager-api.url/secret`，整体配置改由 manager-api 下发；本地仅保留 server 段与 prompt_template（`config_from_api.yaml:20-27`；`config/config_loader.py:42-84`） | 无 manager；改运行时值走控制 API（`POST {prefix}/settings`，`control.js:382`；`settings.js:398-506`） | ❌ | 多设备运营、集中配置 |
| 81 | 设备级覆盖 | 每设备私有配置可覆盖 VAD/ASR/TTS/LLM/VLLM/Memory/Intent/plugins/prompt/voiceprint/summaryMemory/max_output_size/chat_history_conf/mcp_endpoint/context_providers/correct_words（`connection.py:839-927`） | 仅 人设 / LLM **模型名**（provider/Key/端点固定由全局设置决定，`device-config.js:7-12,33-38`）/ TTS 音色+语种+语速（`:39-44`）/ 静音阈值（`:45`） | ❌ | 单设备差异化能力 |
| 82 | 生效时机 | WS 连接时拉私有配置并初始化组件（`connection.py:790-934`） | 建连时快照；改设置后**下次连接**生效（`src/ingress.js:241-267`；`index.js:390-411`） | ⚠️ | 调参反馈周期 |
| 83 | 环境变量 / `.env` | 主服务未发现 dotenv 或通用 env 覆盖（`grep os.environ/getenv` 仅命中 `XIAOZHI_PYDUB_OVERRIDE_FFMPEG`、代理与测试开关；`core/utils/util.py:38`）→ 任务中所称「.env 语义」在本仓库**不存在**，❓未确认是否有部署侧注入 | 无 env 覆盖，全部走配置文件 + settings.json | ✅ | — |
| 84 | 密钥存储/回显 | 配置文件明文占位符 + manager 平台 | `settings.json` 0600，快照输出掩码（`settings.js:36-41,195-206`） | ⚠️ | 密钥卫生（插件更好） |
| 85 | 运行期实际值 | 未见部署实例的 `data/.config.yaml`，只有仓库模板 → ❓未确认 | `~/.dsh-xiaozhi/settings.json`：endpoints.token 为空、gateway.token 为空；LLM=host/opencode-go/deepseek-v4.1-flash（备用 deepseek）；TTS=volc/zh_female_vv_uranus_bigtts/seed-tts-2.0（备用 edge；2026-11-08 起全局 TTS 只存凭据、不再写 voice，此项属旧版快照）；ASR=volc/volc.seedasr.sauc.duration/language=zh_cn（**4 条备用**：local + 2.0 concurrent + 2 条 1.0 `volc.bigasr.*`）；apiKey/apiSecret 均「已配置」但不抄录；文件内含 `auth.*` 段而工作区 `settings.js` 无此段 → **运行期与工作区快照版本不一致，❓未确认** | ❓ | 排障基准（报告以工作区代码为准） |

---

## 三、官方有能力而插件缺失（风险分级 + 不补齐会怎样）

| 风险 | 能力 | 官方证据 | 插件现状 | 不补齐会怎样 |
|---|---|---|---|---|
| **高** | 设备侧 MCP（`features.mcp`） | `helloHandle.py:56-73`、`device_mcp/mcp_handler.py:148-203` | **已实现首阶段**：`src/voice/device-mcp.js`（initialize/tools/list/tools/call，30s 超时） | 设备/游戏上报的工具已能被模型看到并调用；外部 MCP server / 接入点仍未接 |
| **高** | 设备 IoT 控制 | `device_iot/iot_handler.py:50-63`、`iot_executor.py:102-135` | **已实现**：`src/voice/device-iot.js`（descriptors/states/commands） | 「把灯调暗」类指令可用；尚无官方 IoT 描述符生态/示例 |
| **高** | 服务端插件工具集 | `plugins_func/functions/*.py`、`config.yaml:281-292` | 仅 4 个工具（时/搜/网页/新闻） | 音乐播放、天气、家电、角色切换、知识库问答、退出意图全部缺失 |
| **高** | 意图识别模块 | `config.yaml:252-292`、`intentHandler.py:20-50` | 无，仅 function calling | 无法前置拦截系统指令、无法用独立小模型做意图路由；工具多时更慢更贵 |
| **高** | 外部 MCP server / MCP 接入点 | `mcp_server_settings.json:9-55`、`unified_tool_handler.py:81-101` | 无 | 无法把第三方 MCP 工具接进语音；也无法对外提供接入点 |
| **中** | Silero 神经 VAD | `config.yaml:606-612`、`silero.py` | 依赖固件判停/能量 VAD | 老固件或强噪声环境下句尾不准；跨固件版本行为漂移 |
| **中** | 视觉理解 VLLM + `/mcp/vision/explain` | `config.yaml:747-770`、`core/http_server.py:66-76` | 无 | 摄像头识图/看图回答不可用 |
| **中** | 声纹识别 | `config.yaml:190-200`、`voiceprint_provider.py` | 无 | 多人场景无法区分说话人，提示词里也就没有身份信息 |
| **中** | TTS 双向流式与多厂商 | `config.yaml:798-863` 等 | 仅 4 家、按句整段合成 | 长句首包延迟更高；音色/成本选择少 |
| **中** | ASR 多厂商 + 热词/ITN 控制 | `config.yaml:359-605` | 5 家、无热词、ITN 固定开 | 专有名词识别差；换供应商成本高 |
| **中** | 固件 OTA 版本管理与下载 | `ota_handler.py:57-64,300-338` | 只回静态版本/URL | 无法远程升级固件，只能手工刷机 |
| **中** | 结束语 / 退出命令 / 唤醒应答 | `config.yaml:67-69,84-86,227-231` | 无 | 设备静默更久时被直接断开；语音说「退出」无反应 |
| **中** | 输出字数上限 | `receiveAudioHandle.py:82-88,137-145` | 无 | 单设备可刷爆 TTS 额度（成本风险） |
| **低** | 说完提示音、日志级别/文件、`delete_audio` | `config.yaml:44-59,71-73` | 无 | 体验细节 / 磁盘与日志治理 |
| **低** | 位置/天气/农历上下文注入 | `prompt_manager.py:146-249` | 无 | 「明天天气」需要走工具（而工具也缺） |
| **低** | 服务端 AEC | `helloHandle.py:63-65` | 无 | 免提/外放场景回声打断概率更高 |
| **低** | manager 控制台与上报 | `config_from_api.yaml:20-27`、`connection.py:111,285,915-916` | 本地控制 API + JSONL | 多设备运营、远程排障弱 |

## 四、插件多出的能力 / 更强的地方

| 能力 | 插件证据 | 官方对应 | 说明 |
|---|---|---|---|
| 复用 DSH 宿主 LLM 厂商（不重复存 Key、不花插件额度） | `src/voice/adapters/host-llm.js:1-18`（`provider: 'host'`） | 无（官方每厂商各存一份 Key） | 代价：依赖 DSH profile 注册的厂商 id，配错即 NO_ADAPTER（`host-llm.js:13-18`）；**2026-11-07 起 host 只能由全局 `voice.llm.provider` 显式选择，设备级不再自动切 host**（`device-config.js:7-12`；`cordis.patch.yml:73`） |
| 三段（LLM/TTS/ASR）多服务商故障转移链，备用条数不设上限（2026-11-08 去掉原来的 5 条），切成功后有冷却粘性 | `adapters/index.js:230-271`；`settings.js:25-26,50-89`；`failover.js` | 无 | 主用挂掉自动顶上，语音不中断 |
| 智能体级覆盖（人设/模型名/音色/语种/语速/静音，一台智能体可绑定多台设备） | `src/agents.js`；`src/device-config.js:23-47`（合并函数） | 官方是设备级（见 #81）；插件按智能体配，更接近官方 manager 的 `ai_agent` | 「同一个智能体在几块表上共用配置」；provider/Key/端点仍全局，不能按智能体改 |
| 运行时设置热更新（`settings.json` + 控制 API，不用重启 DSH，下次连接生效） | `settings.js:208-506`；`control.js:377-390`；`index.js:390-411` | 官方靠 manager 平台 | 面板改完设备重连即可 |
| 控制 API + 设备管理（状态/设备/记忆/历史/工具开关/OTA 探测/注入播报/重命名/封禁/断开/删除） | `control.js:160-575`（`/state`、`/devices/*`、`/memory/*`、`/tools/toggle`、`/settings`、`/probe/ota`、`/test/*`） | 官方为 manager 控制台（独立服务） | 单机轻量运维 |
| 本机命令网关（白名单 + Bearer + 限流 + 失败锁定） | `src/gateway.js:104-149` | 无 | 手表可执行本机命令（高风险能力，默认 token 空=关闭） |
| mDNS 广播 `_xiaozhi._tcp` + `xiaozhi.local` | `src/mdns.js:20,136-186` | 无（`grep mdns` 无命中） | 免手工填 OTA 地址、DHCP 换 IP 自愈 |
| 防「幽灵音频」的 generation epoch + 播放队列丢弃策略 | `src/voice/elements.js:12-25,179-196`；`session.js:638-652` | 官方靠 `client_abort` 标志（较粗） | 打断后不会把上一轮残音念出来 |
| 空回合收口 / 防「只能聊一轮」死锁 | `session.js:166-177,422-433` | 官方无此问题（不同的收口模型） | 已由 AGENTS.md 记录为实战修复 |
| 预卷 300ms 上行缓冲，避免首字被切 | `session.js:29,368-384` | 官方无显式 pre-roll | 起说第一字更完整 |
| 本地记忆（按智能体）+ 本地历史（按设备） | `memory.js`、`history.js`、`src/agents.js` | 官方为 mem0/powermem/本地总结 | 零外部依赖；同一智能体的设备共用记忆 |
| 语音链路可观测（`voice.log` JSONL + `session.build` 快照 + failover 事件） | `src/voice/trace.js`；`index.js:542-562` | 官方日志较粗 | 排障效率 |
| 崩溃护栏（插件异常不拖垮 Harness） | `src/crash-guard.js` | 无 | 进程级稳定性 |
| 强制短回答规则（语音场景） | `index.js:62-67` | 官方提示词要求「简短」但无硬上限 | 首响更快；代价是信息量少 |

---

## 五、按影响排序的整改建议

> 原则：插件是「个人/局域网语音终端」定位，不是官方服务端的替代品。以下区分「建议补」与「属设计取舍、不用改」。

### P0（不补会直接挡功能）
1. **设备侧 MCP / IoT 已补首阶段**（`src/voice/device-mcp.js`、`device-iot.js`）；下一步是**外部 MCP server（stdio/SSE/streamable-http）与 MCP 接入点**，以及入站 `/mcp`。参考 `官方 helloHandle.py:56-73`、`device_mcp/mcp_handler.py`、`mcp_server_settings.json`。
2. **补最小工具集**：`play_music`/`stop`、退出意图（`exit_commands` + 告别）、天气（先走上下文注入即可）。**插件侧改**（`tools.js` + 提示词）。参考 `官方 config.yaml:84-86,281-292`。
3. **ASR endpointing 可配**：把 `endWindowSize` 暴露到设置（官方同类为 200ms，插件硬编码 800ms）。**插件侧改**（`settings.js` + `adapters/index.js:216`），预计直接降低每轮尾包延迟。
4. **WS 鉴权补齐**：启用 `endpoints.token` 校验或至少设备白名单，公网暴露前必须做。**插件侧改**（`ingress.js:179-206`）。参考 `官方 websocket_server.py:210-231`。

### P1（体验/成本）
5. **火山 TTS 语速等参数打通**：`tts.speed` 在 `volc` 分支被丢弃（`adapters/index.js:152-161`），要么透传（火山 HTTP 接口用 `audio_params.speech_rate`），要么在控制台隐藏该字段。
6. **空闲断开与告别**：90s 太激进且无告别；建议 `idleTimeoutMs` 提到 120–180s 并补 end_prompt 式告别（或至少发一条 `tts` 提示）。**插件侧改**（`index.js:261`、`ingress.js:276-286`）。
7. **`max_tokens` 默认值分场景**：保持 120 作为默认可以，但建议「用户明确要求详细」时允许更大（提示词已有该分支，`index.js:62-67`），或把上限从 2048 提高到与官方同量级（500 是官方同模型默认）。
8. **TTS 双向流式**：若首响仍不达标，评估火山双向流式（官方 `huoshan_double_stream`）替代 HTTP 单向。**插件侧改**（新增 adapter）。
9. **补 `tool_call_timeout`**：给 `tools.execute` 包统一超时（官方 30s）。**插件侧改**（`session.js:534`）。

### P2（长期/运营）
10. **提示词模板化**：把 `<core_rules>`/`<tts_format_constraints>`/`<context>` 等段做成模板，至少补上 ASR 容错与「告别必须调用退出工具」两条。**插件侧改**。
11. **位置/天气上下文注入**（或明确不做，靠工具）。
12. **OTA 固件升级**：如需远程刷机，补 `data/bin` 版本比较与下载路由；否则在文档里写明「只做 OTA 引导，不做固件分发」。
13. **配置单位统一**：`timezoneOffset` 插件用分钟、官方用小时（#12），在 `cordis.patch.yml` 注释与 README 写明，避免照抄官方配置。
14. **运行期/代码版本一致性**：`~/.dsh-xiaozhi/settings.json` 含工作区代码没有的 `auth.*` 段，且其 `voice.llm.provider=host` 与新代码「host 已从设备链路退役」方向冲突（`device-config.js:7-12`；`cordis.patch.yml:70-74`）——本机跑的可能不是这份快照。建议核对部署路径与版本、重存一次全局设置后再据此排障。

### 属于设计取舍、不建议改
- `max_tokens 120` + `<voice_reply_limits>`：明确为「语音场景短回答」设计（AGENTS.md 第 10 条）；要长内容应走「详细说说」分支，而不是回调官方值。
- `historyTurns 8` / 记忆用原样轮次而非 LLM 总结：插件定位轻量、零外部依赖；如需长期记忆再引入总结式 provider。
- `vadMode device`：与固件 AFE 分工明确，强行搬 Silero 会与固件判停冲突（AGENTS.md 已记 TD-6）。
- 无 manager 控制台：单机部署不需要，控制 API 已覆盖日常运维。
- 下行 20ms 帧：若设备侧已验证无异常（当前实测可用），改成 60ms 只会降低控制粒度，收益有限。

---

## 六、未确认项清单

1. **官方 hello 超时**：`connection.py` 未找到显式 hello 超时逻辑（仅后台初始化 + 回 welcome），是否由 `websockets` 库或部署层兜底 → ❓未确认。
2. **官方 Opus 编码参数**（码率/application/复杂度）：`config.yaml` 无对应键，实现走 libopus 默认，未进一步核对 C 绑定参数 → ❓未确认。
3. **官方 `.env` 语义**：主服务未发现 dotenv/通用 env 读取；docker-compose 是否注入环境变量未在本仓库核对 → ❓未确认（「config.yaml 由环境变量覆盖」这一说法在本仓库不成立）。
4. **官方部署实例的实际 `data/.config.yaml`**：仓库内只有模板，无法得知线上真实覆盖值 → ❓未确认。
5. **插件运行期 `settings.json` 与工作区代码的版本对应关系**：文件含 `auth.*` 段（passwordHash/salt/sessionSecret），而工作区 `settings.js` 默认值与更新逻辑都没有 auth；且其 `voice.llm.provider=host` 与新代码「host 从设备链路退役」矛盾 → 运行期可能来自另一份更新/更旧的插件副本（本机另存在 `D:\Demo\zzz\dsh-pl\dsh-xiaozhi`，版本更旧）→ ❓未确认。
6. **插件审计期间代码仍在变化**：审计窗口内 `settings.js`、`voice/adapters/index.js`、`voice/adapters/openai-llm.js`、`device-config.js`、`cordis.patch.yml` 均发生过变更（新增 MiMo provider、authStyle/thinking、移除设备级 host 自动切换、patch 注释扩写）。本报告按文末快照陈述（快照时刻晚于这些变更）；若文件再次变化，需按「七、证据快照」核对。
7. **ASR 适配器缓存与 `endWindowSize` 是否可被设备覆盖注入**：`resolveConfig` 未暴露该字段，但设备 `overrides` 是否可能带进来未验证 → ❓未确认（倾向不可）。
8. **`turn.empty_close` / `asr.empty` 等 trace 事件在固件侧的实际可见性**：插件侧日志已验证，设备侧未复核 → ❓未确认。

---

## 七、证据快照（可复核）

审计快照（`SHA256` 前 16 位 + 行数 + mtime）。插件目录在审计期间有并发修改，**复现前请先核对哈希**；官方侧文件在审计期间未变化。

**官方（`xiaozhi-esp32-server/main/xiaozhi-server`）**

| 文件 | 行数 | SHA256(16) |
|---|---|---|
| `config.yaml` | 1176 | `E10743EAF5504CDE` |
| `config_from_api.yaml` | 27 | `502D2516AAE0FE17` |
| `agent-base-prompt.txt` | 83 | `E544A7BBE684FBFA` |
| `mcp_server_settings.json` | 56 | `2D922963308FB2CD` |
| `config/config_loader.py` | 178 | `85F696F67999A474` |
| `plugins_func/register.py` | 150 | `B96778E6AA0ACBED` |
| `core/connection.py` | 1852 | `0245465D3A9DDEFC` |
| `core/websocket_server.py` | 231 | `63D73D53194A3143` |
| `core/http_server.py` | 92 | `044B136D14C51D73` |
| `core/api/ota_handler.py` | 415 | `98E39597A77769CB` |
| `core/handle/helloHandle.py` | 209 | `C47FAA127AF7BEAE` |
| `core/handle/receiveAudioHandle.py` | 183 | `ACA9EB28A5BAF305` |
| `core/handle/sendAudioHandle.py` | 356 | `E17894D169D31CDB` |
| `core/handle/intentHandler.py` | 252 | `E99D26B0DA43EC55` |
| `core/handle/textHandler/pingMessageHandler.py` | 45 | `D3DD40C2C4ED9833` |
| `core/utils/dialogue.py` | 163 | `762F50BDF93E160C` |
| `core/utils/prompt_manager.py` | 331 | `B29CB28D63499EF1` |
| `core/utils/p3.py` | 59 | `9C16B21FB5BB78EC` |
| `core/utils/util.py` | 681 | `445FC1B342F9719D` |
| `core/providers/vad/silero.py` | 116 | `B5E717C060C3E019` |
| `core/providers/llm/openai/openai.py` | 207 | `39AE44A0EF224930` |
| `core/providers/memory/mem_local_short/mem_local_short.py` | 201 | `CAA1CBBBB59C32B1` |
| `core/providers/tts/base.py` | 706 | `094A74074B6EA570` |
| `core/providers/intent/intent_llm/intent_llm.py` | 296 | `0A3E15FADC04B2AE` |
| `core/providers/tools/unified_tool_handler.py` | 242 | `B7C7BFCA5EF579A8` |
| `core/providers/tools/device_iot/iot_handler.py` | 87 | `1FF753DEBD0B6CEC` |
| `core/providers/tools/device_iot/iot_executor.py` | 238 | `1397B0C2D57F1A90` |
| `core/providers/tools/device_mcp/mcp_handler.py` | 313 | `7CC53990E7DCA6A5` |

**插件（`dsh-xiaozhi`）**

| 文件 | 行数 | SHA256(16) | mtime |
|---|---|---|---|
| `index.js` | 823 | `1832CC7FA2D3CDEC` | 2026-11-07 16:27:56 |
| `cordis.patch.yml` | 89 | `7721AD17BA5FE992` | 2026-11-07 16:40:34 |
| `src/settings.js` | 529 | `8DD9B1107CA85A77` | 2026-11-07 16:32:25 |
| `src/control.js` | 599 | `B59CFAC668B0FBB4` | 2026-11-07 16:28:37 |
| `src/ingress.js` | 462 | `C65D9503E5A18EF6` | 2026-11-06 16:17:41 |
| `src/device-config.js` | 48 | `48B56D529A747196` | 2026-11-07 16:32:52 |
| `src/gateway.js` | 326 | `8FD372104D519D2F` | 2026-11-07 11:15:30 |
| `src/mdns.js` | 383 | `53C0E47F10A1DD54` | 2026-11-07 14:21:05 |
| `src/memory.js` | 166 | `3AA2D2E4D94A99EE` | 2026-11-05 15:38:23 |
| `src/history.js` | 83 | `72EA170149FEA4F6` | 2026-11-05 15:48:06 |
| `src/tools.js` | 290 | `26439A000FED6148` | 2026-11-05 15:15:57 |
| `src/crash-guard.js` | 120 | `C666A489B4C47E39` | — |
| `src/voice/session.js` | 684 | `F57F045C6110FD4F` | 2026-11-07 15:16:12 |
| `src/voice/vad.js` | 102 | `5CA7772D7138C308` | 2026-11-06 16:17:41 |
| `src/voice/elements.js` | 280 | `4E8F2245437B1F7E` | 2026-11-07 10:53:35 |
| `src/voice/segmenter.js` | 344 | `36ACF48EFD419520` | 2026-11-07 10:51:48 |
| `src/voice/codec.js` | 208 | `B92B234B97144186` | 2026-11-07 11:01:28 |
| `src/voice/language.js` | 76 | `01D82ADA4C76B978` | 2026-11-07 16:14:19 |
| `src/voice/trace.js` | 45 | `FC6FAD366C40AF2B` | — |
| `src/voice/adapters/index.js` | 301 | `D4B9F87541A320B9` | 2026-11-07 16:32:01 |
| `src/voice/adapters/openai-llm.js` | 202 | `609721A34224592B` | 2026-11-07 16:31:50 |
| `src/voice/adapters/host-llm.js` | 92 | `7D37142CED6EF1F2` | 2026-11-07 16:24:04 |
| `src/voice/adapters/failover.js` | 449 | `E48177A204F57100` | 2026-11-07 15:27:53 |
| `src/voice/adapters/volc-asr.js` | 285 | `D1EB49B29A755B82` | 2026-11-06 22:23:52 |
| `src/voice/adapters/volc-http-tts.js` | 160 | `AA558D475E48DAB0` | 2026-11-07 16:23:07 |
| `src/voice/adapters/edge-tts.js` | 301 | `B12EF1B252CC2D08` | 2026-11-07 10:56:24 |
| `src/voice/adapters/funasr-asr.js` | 165 | `EC999A1DE5591E1B` | 2026-11-07 10:50:26 |

抽查记录（写作后逐条回读原文核对）：

- 官方 `config.yaml:625` = `max_tokens: 500`（AliLLM）；`:612` = `min_silence_duration_ms: 200`；`:97` = `frame_duration: 60`；`:61` = `close_connection_no_voice_time: 120`；`:95` = `sample_rate: 24000`。
- 插件 `index.js:321` = `maxTokens: … 120`；`:295` = `historyTurns … 8`；`:309` = `downlink: … 20`；`:261` = `idleTimeoutMs … 90_000`；`:290` = `vadThreshold … 0.05`；`:304` = `uplink … 16_000`。
- 插件 `src/voice/session.js:563` = `this.history.slice(-this.config.historyTurns * 2)`；`src/voice/vad.js:27` = 能量 VAD 默认参数；`src/tools.js:15` = `MAX_TOOL_ROUNDS = 3`；`src/voice/adapters/index.js:216` = `endWindowSize: spec.endWindowSize ?? 800`；`src/device-config.js:33-38` = 设备仅覆盖模型名。
- 官方 `core/utils/dialogue.py:151-161` 全量追加非 system 消息（无裁剪）；`core/providers/vad/silero.py:33-37` 静音阈值与窗口阈值；`core/handle/receiveAudioHandle.py:110-134` 静音结束语逻辑。
- 插件 `cordis.patch.yml:78` = `maxTokens: 120`（快照 89 行版本）；`:52` = `vadMode: 'device'`；`:61` = `historyTurns: 8`。
- 运行期 `~/.dsh-xiaozhi/settings.json`：`voice.llm.provider=host`、`voice.tts.provider=volc`、`voice.asr.provider=volc`；`endpoints.token` / `gateway.token` 为空；密钥字段仅记录「已配置/为空」。2026-11-08 起全局 TTS 条目的 `voice` / `model` / `resourceId` 控制台保存时显式清空（音色归设备级，见 `src/voice/voices.js` 的 `DEFAULT_TTS_VOICES` / `resolveTtsVoice`）。

> 行号与哈希对不上时以本节哈希为准重取；本报告不做无出处推测，查不到的已列入第六节「未确认」。

---

## 八、审计后的变更（Lead 补充，2026-11-07 16:5x）

本节的改动发生在审计快照之后，**不影响第二~七节的证据行号**（那些行号绑定第七节哈希），
但会改变「运行期实际值」与部分差异项的结论。复核时先看本节：

1. **LLM 主路径已从 Harness 宿主改回插件直连**（回应第六节未确认项⑤的「运行期 provider=host」）：
   - 代码：`src/device-config.js` 删除「设备 `hostProvider` 强制 `provider:'host'`」；设备级只覆盖模型名。
   - 运行期：`~/.dsh-xiaozhi/settings.json` 的 `voice.llm` 已改为
     `provider=deepseek` / `model=deepseek-chat` / `apiKey=已配置`、`hostProvider=''`；
     实测 `POST /dsh-xiaozhi-7c3a/test/llm` 返回 `ok:true`（首 token ≈1.2s，样本正常）。
   - 结论变化：2.5 节的「LLM 运行期走 host、依赖 DSH 厂商注册」不再成立；`host` 仅保留为
     全局显式选项（历史兼容），控制台不再列它。
2. **新增小米 MiMo（`mimo`）直连服务商**（2.5 节 LLM 供应商集合 +1）：
   - 端点 `https://api.xiaomimimo.com/v1`（OpenAI chat/completions 兼容）、认证头 `api-key`（非 Bearer）、
     模型 id 由控制台从厂商 `GET /v1/models` 实时拉取（插件不内置），
     语音场景默认 `thinking:{type:'disabled'}` 以降首字延迟。
   - 可作主用，也可进 `voice.llm.backups`（条数不设上限）做冗余；控制台「全局设置 → LLM」可见。
3. **测试**：`node --test "test/*.test.mjs"` = 153 项全绿（新增 MiMo 8 项、运行时设置叠加 6 项、
   联网工具 10 项，以及设备级合并用例调整）。审计报告里「当前 130 项」一类的描述以本数为准。
4. **联网工具从「只能看摘要」升级为「能读正文」**（缩小第 1 条 P0 的一部分）：
   `web_search` 固定 `need_content: true` 并回传正文摘录（单条 ≤900、整批 ≤3800 字）；
   新增 `web_fetch`（DeepSeek Fetch，Markdown 正文 ≤3500 字）。
   - 实测（2026-11-07，真实 API）：Search 返回 `content` 1099–2660 字；Fetch 返回 2111 字 Markdown 正文；
   - 工具 Key 改为运行时 getter（控制台保存后下一轮生效）；LLM 主用不是 DeepSeek 时自动从备用链找 DeepSeek Key；
   - `test/tools.test.mjs` 10 项覆盖正文回灌、截断预算、count、403/404、动态 Key、无 Key 回退。
5. **对话历史对齐官方（2026-11-07）**：新增控制台「设备 → 历史」会话浏览 + 消息气泡 + 音频播放/下载，
   本地实现官方 `ai_agent_chat_history`（session_id/chat_type/content/audio_id）与 `ai_agent_chat_audio`：
   - 存储 `history/<device>.jsonl`（每条消息一行）+ `history/audio/<device>/<audioId>.wav`（用户 16k / 助手 24k）；
   - 旧数据按 10 分钟间隔聚合迁移（实测 48 行旧记录 → 9 段会话），旧会话无音频；
   - 保留：文本 5000 条/设备、音频 30 天 + 500MB、单条 120s 截断，启动 + 每日清理；
   - 与官方的差距（未做）：LLM 生成的会话标题/摘要（官方 `AgentChatTitle/SummaryService`），当前标题取首条用户消息。
6. 其余差异（服务端插件工具、外部 MCP server / 接入点、ASR endpointing 800ms、VAD 语义、下行 20ms 帧、
   90s 空闲断开等）**未在本轮修复**，仍是后续整改建议里的 P0/P1 项。
