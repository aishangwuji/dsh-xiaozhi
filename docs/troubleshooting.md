# 联动排障：现象 → 实际原因

> 本文来自原 `AGENTS.md` §7。新增排障项追加到表尾；保留「当时看到的东西」，否则下次无法复现判断依据。

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
| 控制台「扩展能力」里出现英文工具名 | 卡片显示 `web_fetch`，旁边几个都是中文 | `src/client/core.js` 的 `toolLabel()` 是白名单映射，新工具没登记就原样显示工具名。2026-11-08 补了 `web_fetch → 网页抓取`；新增工具时 `AGENTS.md` §2 的「新增内置工具」那几处要一起改 |
| 智能体页点「+ 新建」后整页白屏 | 控制台没弹错误，页面直接空白；`crash.log` 无新记录（React 19 卸载根树不抛 window error） | `src/client/agents/AgentConfigDialog.js` 用了 `toolLabel` 却没从 `core.js` 导入。配置弹窗一打开就提前构造「扩展能力」页签，`toolLabel(tool.name)` 抛 ReferenceError → React 卸载整棵树。已修：补 import；`npm run smoke` 的 `AgentConfigDialog` 改成非空 `tools`（空数组会把 `map` 里的调用短路掉，正是这次漏检的原因） |
| 服务商编辑弹窗里「模型」下拉显示「未选择」，已保存的模型看起来丢了 | 编辑一条备用 LLM，模型触发器是「未选择」；直接保存后值其实还在（`draft.model` 没变） | `ModelField` 只在厂商 `/models` 返回的 `options` 里找当前值。厂商清单没包含该 id（模型下线 / 手填自定义 id / 接口只返回一部分）时，`PillSelect` 回退到 `selectPlaceholder`（未选择）。2026-11-08 修：`ModelField` 把当前值补进选项（同 `AgentConfigDialog` 音色的做法）；`PillSelect` 新增 `placeholder`，空值显示描述符 `modelHint`（DeepSeek = `deepseek-chat`）而不是「未选择」；`npm run check:ui` 用「清单故意不含 `gpt-4o-mini`」回归 |
| 新设备一直连不上，OTA 返回 `403 device-pending` | 控制台「智能体」页顶部出现待审核卡片；`pending.json` 有该 MAC | 默认 `autoProvision: false`，陌生设备要先在控制台选智能体并批准；批准后设备下一次 OTA/WS 才放行。不是固件故障，也不需要激活码 |
| 配了 DeepSeek 语音后：说话没反应 / 没声音 | `voice.log` 里 `deepseek.asr.error` 或 `deepseek.tts.error 400` | 适配器自身保证音频 ≤120s / ≤8 MiB、WAV 采样率落在官方 7 档内，正常链路不会触发 413——若仍出现，多半是服务端按「整个请求体」限长或接口行为变了；TTS 400 = 文本未通过内容审核（`Content Exists Risk`）或没有可朗读文本。`429` = 账号并发超限（每账号最多 50 个在途请求） |
| 手表每次开机都连 `xiaozhi.me` / 插件收不到 OTA | 手表串口 `Ota: mDNS: no _xiaozhi._tcp service on this LAN`，随后 `Checking version at https://api.tenclass.net/...`；PC 上单独发 PTR 查询**能**收到应答 | 插件只对 `QU=1` 的查询单播，esp-idf 发的是 `QU=0`；只发 multicast 时出口从 VMware `192.168.10.1` 出去，手表收不到。2026-11-14 修：应答一律单播给查询方 + 同网段补 multicast（`src/mdns.js` 的 `send()`） |
| 会话模式手表念的比屏幕短很多 | DSH 聊天页里是完整回复；`voice.log` 的 `session.build` 有 `summary:true` | 这是设计行为：最终回复先经 `voice.session.summary` 压成 2–3 句再 TTS。要听全文，把 `voice.session.summary` 设为 `false`（或调大 `summaryMaxChars`） |
| 会话模式工具跑了很久，手表一直安静 | `voice.log` 有 `tool.notice`，但没有 `tts.begin`；`session.build` 的 `progress:false` | 进度播报被关掉了，或工具太快（短于 `progressMinIntervalMs`）只发了 `% 工具名` 气泡。`progress:true` + `heartbeatMs>0` 才会有「我正在… / 还在处理」 |
| 控制台显示「宿主没有会话服务」/ 手表第一句报「会话服务未装配」 | `GET /state` 的 `agents[].session.available` 是 false；`voice.log` 没有 `session.build` 的 `backend:"session"` | 2026-11-23 修：插件 `apply()` 早于 `sessionController` 挂载，旧代码只在构造时取一次服务句柄，于是永远 false。现在按调用惰性解析，事件订阅也不再依赖 available。**必须重启 DSH**（宿主代码改动）后再看 |
| 审批弹出手表没念问题、直接等超时 | DSH 里出现审批卡；`voice.log` 没有 `approval.answer` / `approval.timeout` | 三种可能：① 该会话没有绑在「有在线设备」的 Bot 上；② 设备不在 `thinking/speaking`（这一轮不是语音发起的，比如在桌面输入框里问的）；③ `approval/request` 被桌面应答器先接走。语音只接「语音发起、正在等这一轮」的审批，其余交回桌面 |
| 手表上 `ask_user_question` 没念选项 / 说了没选中 | `voice.log` 没有 `question.answer`；或只有 `question.retry` | 选项按「精确标签 > 标签包含 > 序号（第2个/2/二）」匹配；多选要按顿号/逗号/和/与拆开说。多个选项同时命中、没选项且识别为空、超时（`questionTimeoutMs`）都会 `next()` 交回桌面，不猜答案。桌面发起的 turn 也不会被手表抢答 |
| 手表说了「允许/拒绝」但会话没继续 | `voice.log` 有 `approval.retry` 或没有 `approval.answer` | 只认明确的允许/拒绝；否定词优先。说「行吧」「可以可以」通常能识别，说「嗯…那个」会被判为说不清并交回桌面（`approvalTimeoutMs` 后）。审批语音**未真机实测** |
| 控制台点了「新建会话」，下一轮还在旧上下文 | `voice-sessions.json` 已换成新 id；`session.build` 的 `sessionId` 仍是旧值 | 新建会话是**下一轮**生效（适配器每轮重新解析会话），不需要重连；如果下一轮仍是旧 id，看是不是该 Bot 的 `overrides.sessionId` 被旧页面覆盖了（刷新控制台再保存一次） |

