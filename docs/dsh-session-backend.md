# Bot = DSH 会话（`voice.backend = "session"`）

> 状态：2026-11-19 首次实现「回答来源 = 会话」；**2026-11-20 改成以 Bot 为单位**——
> 每个 Bot 是一条长期会话，语音与 DSH 聊天页的文本框共用同一段上下文。
> 摘要/进度/审批已写单元测试；**真实手表 → 会话的端到端链路仍未实测**。
>
> 相关代码：`src/host-session.js`、`src/session-bindings.js`、
> `src/voice/adapters/dsh-session.js`、`src/voice/spoken-summary.js`、`index.js`、
> `src/control.js`。

## 1. 它是什么

控制台里的「智能体」现在按 **Bot** 理解：Bot 不是一段提示词配置，而是一条长期存活的
DSH 会话。会话自己拥有模型、preset/人设、工具、权限、审批、记忆和多轮上下文；插件
只负责把「设备麦克风」接进去、把回答念出来。

```
设备麦克风 → ASR 文本 → sessionController.prompt(用户原话)
                          → 会话里跑（可能有工具/审批）
                          → 工具过程：设备气泡 + 一句进度
                          → 这一轮最终 assistant 消息
                          → 语音摘要（可选）→ 分句 → TTS → Opus 下发
```

一个 Bot 可以绑 0..N 台设备：一人一个 Bot，或者全家共用一个 Bot 都可以。同一 Bot
的多台设备共用一段上下文；历史对话仍按设备落盘（音频/消息互不混淆）。

DSH 的聊天页打开的就是这条会话：在文本框里打字和在手表上说话，看到的是同一段对话。

## 2. 数据与入口

| 东西 | 位置 | 说明 |
|---|---|---|
| Bot 配置 | `agents.json`（`AgentStore`） | 名字、人设、模型、音色、语种、`overrides.backend` / `overrides.sessionId` |
| Bot → 会话 | `voice-sessions.json`（`SessionBindingStore`） | 只缓存「自动建」的会话 id；显式 `overrides.sessionId` 优先 |
| Bot 工作目录 | `~/.dsh-xiaozhi/voice-sessions/<agentId>/` | 每个 Bot 一个目录；`voice.session.cwd` 显式配置时共用 |
| 会话本身 | DSH 的 Session 存储 | 插件不拥有它的生命周期 |

入口：

- `src/host-session.js` 的 `createSessionBridge`：`list/create/prompt/cancel/subscribe/statusOf`，
  以及 `setApprovalAnswerer`（语音审批）。
- `src/voice/adapters/dsh-session.js` 的 `createDshSessionLlm`：与直连 LLM 同形状的
  `stream()`，吐文本、`notice`、`progress` 三种事件。
- `index.js` 的 `ensureVoiceSession` / `voiceSessions.rotate|clear|bind`。

## 3. 一轮语音的语义

1. **原话直送**：默认不再拼 `[语音通道]` 指令，会话看到的用户消息就是 ASR 文本，
   与在文本框里输入一致。需要时用 `voice.session.instruction` 显式加前缀。
2. **只念最终结论**：带 `tool-call` 的 assistant 消息是过程，跳过；只取这一轮最后
   一条没有 tool-call 的纯文本消息。`source.rpcId` 把 prompt 与 `user/message` 对上，
   `turn/end` 收口。
3. **过程可见**：
   - 每次 `tool/call` → 设备气泡 `% <工具名>`（不朗读）；
   - 工具名映射成一句进度（`我正在联网查。` / `我正在执行命令，稍等。` …），
     首次工具必念，之后至少间隔 `progressMinIntervalMs`；长任务按 `heartbeatMs`
     念「还在处理，马上就好。」；
   - 摘要调用前念「我整理一下，马上说。」，避免设备静默。
4. **总结式朗读**：最终回复先交给 `createSpeechSummarizer` 压成 2–3 句口语
   （额外一次、无工具、有超时的小模型调用）；摘要为空/超时/回复太短时回落到
   `toSpeech()`（去 Markdown + 按句末截断）。
5. **打断 = cancel**：`VoiceSession` abort → 适配器 `sessionController.cancel({sessionId})`，
   超时同样 cancel 并抛错。
6. **审批**：`ctx.on('approval/request', …, { prepend: true })`，只有「这条会话绑在
   一个有在线设备的 Bot 上，且设备正处在 `thinking`/`speaking`（这一轮是语音发起的）」才接；
   念出原因，等一次「允许/拒绝」，说清则返回 `allowed-once` / `rejected`。含糊、超时、异常
   一律 `next()` 交回桌面审批卡，不擅自放行。**桌面发起的 turn 不抢**，避免一台只是连着的表
   把桌面卡片拖住十几秒。**`ask_user_question` 仍未接语音**。

## 4. 配置

全局（`cordis.patch.yml` 或 profile patch）：

```yaml
voice:
  backend: session          # session = Bot 会话（主推）；llm = 直连模型（兼容）
  session:
    sessionId: ''           # 固定绑定；空 = 首次说话自动建
    instruction: ''         # 可选前缀；空 = 原话直送
    timeoutMs: 120000       # 一轮总预算；超时取消该会话当前 turn
    maxChars: 600           # 摘要结果与回落截断共用的上限
    summary: true           # 最终回复是否先做语音摘要
    summaryMaxChars: 160    # 摘要念出来的最大字数
    summaryMinChars: 80     # 回复短于此不摘要，直接 toSpeech
    summaryTimeoutMs: 8000  # 摘要调用超时 → 回落
    progress: true          # 工具/长等待时念进度
    progressMinIntervalMs: 8000
    heartbeatMs: 20000      # 0 = 关闭心跳
    approvalTimeoutMs: 12000
    cwd: ''                 # 自动建会话的根目录；空 = dataRoot/voice-sessions/<agentId>
```

Bot 级（`agents.json` 的 `overrides`）：`backend`（`llm` / `session` / 空）、
`sessionId`（空 = 自动建）、人设、模型、音色、语种、TTS 服务商等。

## 5. 控制台 / 控制 API

- **新建 Bot 默认 `backend=session`**（界面入口）；直连模型仍可在「配置 → 模型与记忆」切回。
- 卡片状态：会话在跑显示「会话运行中」，否则按设备在线/离线/未绑定。
- 「配置 → 模型与记忆」的会话行有 **新建会话** 按钮和「运行中/空闲」提示。
- `GET /agents` 每项带 `session: { id, available, running }`。
- `POST /agents/session`：
  - `{ action: 'new', agentId }` → 立即新建会话并钉死；
  - `{ action: 'auto', agentId }` → 解除钉死，下一轮首次说话自动建/复用；
  - `{ action: 'bind', agentId, sessionId }` → 绑定已有会话（`session-…`）。

## 6. 为什么不做成「接 DS-Bot」

DS-Bot 的 Bot 也是一条普通 DSH Session，但它的 Bot→当前会话映射存在自己的
`state.json`，Bot 换 part 后 sessionId 会变，而且它没有对外注入的服务。这里实现的是
**同样的 Bot 形态**（每个 Bot 一条长期会话、可共享、可加设备），不读 DS-Bot 的内部
状态；以后若 DS-Bot 启用，可以通过「绑定已有会话」手工接，或再补一个只读适配器。

## 7. 验收

```powershell
node --test "test/session-backend.test.mjs"   # 12 项：原话直送/只念结论/进度/摘要/打断/超时
node --test "test/spoken-summary.test.mjs"    # 5 项：短回复跳过/清理/超时回落/话术
node --test "test/approval.test.mjs"          # 2 项：意图分类/桥的 next() 回落
node --test "test/agents.test.mjs"            # 10 项：Bot 会话视图 / 换会话 API
npm run build; npm run smoke
```

真机验收（未做）：

1. 控制台新建 Bot（默认会话）→ 绑手表 → 说一句。
2. `~/.dsh-xiaozhi/voice-sessions.json` 出现该 Bot 的 `session-…`；`voice.log` 的
   `session.build` 带 `backend:"session"`、`summary:true`。
3. 在 DSH 聊天页打开这条会话，应看到用户原话（没有 `[语音通道]` 前缀）和完整回复；
   手表听到的是摘要。
4. 让会话触发一个需要审批的工具：手表应念出原因并等待「允许/拒绝」；说清后会话继续；
   不说/说含糊应在 `approvalTimeoutMs` 后回到桌面审批卡。
5. 记录首字延迟、摘要耗时、长回答截断、播放中打断四项。

## 8. 已知限制

- 不是流式首字：必须等最终 assistant 消息落库才能摘要 + 合成；工具多时体感偏慢。
- 摘要是额外一次模型调用（默认开），会产生额外 token；主用 LLM 不可用时自动回落截断。
- 会话回复里的表格/代码块在 `toSpeech` 回落路径会被丢掉；摘要路径会提示「详细内容在会话里」。
- `ask_user_question` 仍未接语音；审批语音也尚未真机验证。
- 一条会话同时只跑一轮；多台设备绑同一 Bot 时会排队（`mode:'queue'`）。
- 审批答案只认「允许 / 拒绝」两类明确说法；否定词优先，避免「不行」被误判为允许。
