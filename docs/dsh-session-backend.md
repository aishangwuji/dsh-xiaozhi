# DSH 会话后端（`voice.backend = "session"`）

> 状态：2026-11-19 首次实现，单元测试通过；**真实手表 → 会话的端到端延迟未实测**。
> 相关代码：`src/host-session.js`、`src/session-bindings.js`、`src/voice/adapters/dsh-session.js`、`index.js`。

## 1. 它是什么

默认的语音回答由插件**直连模型**产生（`llm.stream`）。会话后端把同一句话改成：

```
ASR 文本
  → ctx.sessionController.prompt({ sessionId, requestId, mode:'queue', content:[{type:'text',text}] })
  → 等这一轮跑完（可含工具）
  → 只取「这一轮最终那条没有 tool-call 的 assistant 消息」
  → toSpeech() 去 Markdown / 代码块 / 截断
  → 现有分句 → TTS → Opus 下发
```

它不依赖 DS-Bot。DS-Bot 的每个 Bot 就是一条普通 DSH Session，绑同一个 `sessionId` 即可对话。

## 2. 配置

全局（`cordis.patch.yml` 或 profile patch）：

```yaml
voice:
  backend: llm            # llm = 直连（默认）；session = 送进 DSH 会话
  session:
    sessionId: ''         # 固定绑定；空 = 首次连接自动建
    instruction: ''       # 拼在用户话前面的语音指令；空 = 内置默认
    timeoutMs: 120000     # 一轮总预算；超时取消该会话当前 turn
    maxChars: 600         # 念出来的最大字数（按句末截断）
    cwd: ''               # 自动建会话时的工作目录；空 = <dataRoot>/voice-sessions
```

智能体级（`agents.json` 的 `overrides`）：

| 字段 | 取值 | 语义 |
|---|---|---|
| `backend` | `llm` / `session` / 空 | 空 = 跟随全局 |
| `sessionId` | `session-…` / 空 | 空 = 自动建并复用 |

控制台入口：**智能体 → 配置 → 模型与记忆** 顶部（`AgentConfigDialog`）。
控制 API：`POST /agents/update` 接受 `backend` / `sessionId`；`GET /sessions` 提供最近会话（只读）。

## 3. 语义与不变量

1. **只念最终结论**：带 `tool-call` 的 assistant 消息是过程，丢弃；一轮里最后一条纯文本消息才念。
2. **按会话分发**：桥按 `session.id` 过滤事件，别的会话的字不会念出来。
3. **本轮归属**：用 `source.rpcId === requestId` 把 `user/message` 与这次 prompt 对上；
   `turn/start` 记录轮号，`turn/end` 收口。会话正忙时消息进队列，不会把上一轮的字当成这一轮。
4. **打断 = cancel**：`VoiceSession` abort → 适配器 `sessionController.cancel({sessionId})`，
   避免它在后台继续跑、下一句排在长任务后面。超时同样 cancel 并抛错（会话层播兜底话术）。
5. **工具/记忆归会话**：`toolsEnabled` / `memoryEnabled` 关掉，`memoryKey` 清空，`sessionPrompt` 为空。
   插件不再注入自己的工具表与记忆，避免两套并存。
6. **绑定按智能体**：`voice-sessions.json`（0600，版本 1）只做运行期缓存；损坏/缺失时重新建一条，不阻断语音。
7. **失败可见**：会话服务未装配时，`backend=session` 的构建期直接报错（不回落到直连，免得用户以为在用会话）；
   会话不存在/无权限 → `prompt` 抛错 → 设备收 `alert` + 兜底语音。

## 4. 为什么不做成「接 DS-Bot 插件」

- DS-Bot 没有对外注入的服务；它的 `POST /api/bot` 走浏览器 cookie 鉴权，`dsBot/call` 是 Remote 通道，
  两者都是给 UI/手机用的，不是给同进程插件用的稳定接口。
- Bot 会换 part（压缩、换目录），`sessionId` 随之变化；把语音绑到 Bot 上等于把 DS-Bot 的内部状态
  变成语音链路的前置条件。绑「会话」则只依赖 DSH 自己的会话生命周期。
- 结论：接的是**DSH 会话**；DS-Bot 只是「怎么找到想要的 sessionId」的一个来源，且由用户显式填写。

## 5. 验收

```powershell
node --test "test/session-backend.test.mjs"   # 9 项
node --test "test/agents.test.mjs"            # 含回答来源保存/坏值/GET /sessions
npm run build; npm run smoke; npm run check:ui
```

真机验收（未做）：

1. 控制台新建智能体 → 回答来源选「DSH 会话」→ 留空会话 → 用手表说一句。
2. `~/.dsh-xiaozhi/voice-sessions.json` 应出现该智能体的 `session-…`；`voice.log` 的 `session.build`
   带 `backend:"session"`。
3. 首字延迟、长回答截断、播放中打断（应在 DSH 里看到该 turn 被取消）三项各记一次。

## 6. 已知限制

- 不是流式首字：必须等最终 assistant 消息落库才开始合成（比直连模型慢，具体差多少未实测）。
- 会话回复里的表格/代码块会被 `toSpeech` 直接丢掉，可能损失信息。
- 审批类工具（写文件、跑命令）在手表上无法确认；建议给语音会话用只读/受限 preset。
  当前实现**不识别审批事件**：会话弹出审批卡时这一轮会一直等到 `timeoutMs` 才取消并播兜底，
  不会主动说「需要你在电脑上点一下」（下一步再做）。
- 一条会话同时只服务一台设备；多台表绑同一智能体时会排队（`mode:'queue'`）。
