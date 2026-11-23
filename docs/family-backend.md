# 家庭语音后端（`voice.backend = "family"`，dsh-family 融合 M1）

> 状态：2026-11-23 首次实现（M1）。契约的权威来源是
> [`dsh-family/docs/voice-fusion.md`](../../dsh-family/docs/voice-fusion.md)（跨插件契约），
> 本文只写 **xiaozhi 这一侧**的实现入口、生效条件、验收与未实测项。
>
> 相关代码：`src/voice/adapters/family.js`、`index.js`（`backendFor` / `adaptersFor` /
> `voice.build`）、`src/store.js`（`familyMemberId`）、`src/control.js`
> （`GET /family/members`、`POST /devices/family`）、`src/client/agents/AgentDevicesDialog.js`、
> `src/client/agents/AgentConfigDialog.js`。
>
> 单元测试：`test/family.test.mjs`（13 项）。

## 1. 它是什么

前面两种回答来源都由本插件自己拥有会话：

| `backend` | 会话归谁 | 记忆/人设/工具 |
|---|---|---|
| `llm` | 插件直连模型，每轮自己拼提示词 | 都在插件（`agents.json`） |
| `session` | 一条 DSH Session（Bot） | 都在那条会话 |
| `family` | **dsh-family 里该成员的「语音」会话** | 都在 family（成员/角色卡/工作区/记忆/用量） |

`family` 模式下本插件只做「耳朵和嘴」：ASR → 把原话交给 `familyVoice.ask()` → 摘要 →
TTS。插件**不建 DSH 会话**，也不写 family 的记忆/用量；历史音频与消息仍按设备落
`~/.dsh-xiaozhi/history/<deviceId>`（调试/回放用），对话正文以 family 的 thread 为准。

一台设备同一时刻只替**一位家庭成员**说话，绑定记在 `devices.json` 的
`familyMemberId`（空串 = 未绑定）。切换成员 = 改这个字段，**下一轮生效**（适配器每轮重新解析）。

## 2. 入口

| 位置 | 符号 | 作用 |
|---|---|---|
| `index.js` | `familyVoice()` | 惰性 getter：`ctx.get('familyVoice')`（family 可能晚于本插件 `apply` 挂载） |
| `index.js` | `backendFor(device)` | 智能体 `overrides.backend` 优先，空 = 跟随全局 `voice.backend`；只认 `llm`/`session`/`family` |
| `index.js` | `adaptersFor()` | `family` 时 LLM 段不建 provider 候选链，改由 family 适配器提供 `stream()`；缓存 key 带 backend + deviceId |
| `index.js` | `voice.build()` | `family` 与 `session` 同一套让路：`sessionPrompt=''`、`toolsEnabled=false`、`memoryEnabled=false`、`memoryKey=''`；TTS/ASR/语速/音色仍按 Bot 配置 |
| `src/voice/adapters/family.js` | `createFamilyLlm()` | 与 `dsh-session.js` 同形状的 `stream({ messages, signal, session })` |
| `src/store.js` | `familyMemberId` / `setFamilyMemberId()` | 设备级绑定；坏值/非字符串按未绑定容错 |
| `src/control.js` | `GET /family/members`、`POST /devices/family` | 控制台读成员列表 / 写绑定（写接口带 CSRF 头） |
| `src/voice/session.js` | `#answer` 的 `adapters.llm.stream({ …, session: this })` | 让适配器拿到 `VoiceSession`，把 family 的审批/提问接到语音 |

适配器每轮做的事：

1. 取最后一条 user 文本；空 → 直接返回；
2. 惰性取 `familyVoice`，没有 `ask` → 上屏并朗读「家庭服务未就绪」；
3. 读该设备当前的 `familyMemberId`，为空 → 上屏并朗读「还没绑定家庭成员，请在控制台绑定」；
4. `await familyVoice.ask({ memberId, text, onApproval, onQuestion })`；
5. 返回的 `result.text` 先走语音摘要（与 Bot 会话同一套 `summarize`），失败/太短回落
   `toSpeech()`；最终作为 `text` 事件吐给 `VoiceSession`；
6. abort → `familyVoice.cancel({ memberId })`（审批等待按 `cancelled` 收口）。

审批/提问：

- `onApproval({ id, tool, reason })` → `session.askApproval({ text, timeoutMs })`，
  返回 `allowed-once` / `rejected` / `cancelled`；说不清/超时/异常 → `null`；
- `onQuestion({ id, questions })` → `session.askUserQuestions(questions, { timeoutMs })`，
  返回 `{ answers }`；任何一题说不清/异常 → `null`；
- 返回 `null` 由 family 把卡放行到 PWA（手表/手机谁先答谁生效）。

## 3. 生效条件

1. **family 插件已安装并在同一 profile 里加载**，且 `ctx.get('familyVoice')` 能取到服务；
2. Bot（`agents.json`）的 `overrides.backend = "family"`，或全局 `voice.backend = "family"`；
3. **设备绑定了成员**（控制台「设备」弹窗 → 家庭成员，或 `POST /devices/family`）；
4. 改宿主代码（`index.js` / `src/**`）要**重启 DSH**；改 `src/client/**` 要
   `npm run build` 后刷新页面；
5. 成员切换与 `familyVoice` 上下线都是**下一轮**生效，不需要设备重连（adapter 每轮重新解析
   成员与服务）；但 **`backend` 本身是建连时装配**，改后端后设备要重连。

## 4. 失败与降级

| 场景 | 行为（本实现） |
|---|---|
| `familyVoice` 不存在 / 没有 `ask` | 气泡 + 朗读「家庭服务还没就绪，请稍后再试」 |
| 设备未绑成员 | 气泡 + 朗读「这台设备还没绑定家庭成员，请先在控制台绑定」 |
| 成员不存在（`404` / `member-not-found`） | 气泡 + 朗读「这台设备绑定的成员已经不在了，请在控制台重新绑定」 |
| 成员没有工作区（`no-workspace`） | 气泡 + 朗读「这个成员还没有工作区，请先在家庭页面里打开一次」 |
| `ask` 409 busy | 气泡 + 朗读「上一条还在想，你稍等一下再说」 |
| `text-required` | 气泡 + 朗读「我没听清，你再说一遍？」 |
| 其它错误（family 内部超时 / 服务故障 / `thread-not-found`） | 抛给 `VoiceSession`，走原有错误气泡 + 「抱歉，我这边出了点问题」兜底 |
| 控制台写绑定时 family 不可用 | `409 family-unavailable`（非空成员不能盲写）；**解绑仍允许** |
| 绑定指向已删除成员 | 控制台下拉保留一项「成员已失效（id）」，不会假装成未绑定 |

> **提示的呈现**：失败提示同时发 `notice`（固件 `%` 系统气泡，只上屏）和 `text`（正常
> 回复通道，会朗读并进设备历史）。手表常常不看屏，只留气泡会让用户以为设备死机。
> `text` 的内容是解释性的一句话，不是 family 的回答。

## 5. 控制 API 与控制台

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/family/members` | `{ available: boolean, members: Member[] }`；`Member = { id, name, roleLabel, isAdmin }`。服务不存在/抛错 → `available:false` + 空数组（200，不 500） |
| POST | `/devices/family` | `{ deviceId, memberId }` → `{ device }`；`memberId` 空串 = 解绑，非空必须是当前成员（否则 400 `member-not-found`，非字符串 400 `invalid-member-id`）；family 不可用且要绑非空成员 → 409 `family-unavailable`；未知设备 404；缺 `x-dsh-xiaozhi: 1` → 403 |

控制台：

- 「Bot → 配置 → 模型与记忆 → 回答来源」新增 **家庭会话**；选中后显示「家庭成员按设备在
  「设备」弹窗里选」的提示（不再显示会话选择器）。
- 「设备(N)」弹窗：每台已绑定设备多一行 **家庭成员**（未绑定 / 成员列表 / 刷新）。
  `available:false` 显示「家庭服务未就绪」；成员为空显示「家庭里还没有成员」。
- `GET /state` 的 `devices[]` 带 `familyMemberId`，`/agents` 的 `devices[]` 同样（同一投影）。

## 6. 验收

自动化（本地已跑）：

```powershell
node --test "test/family.test.mjs"   # 13 项：成员透传/绑定/解绑/无效成员/适配器事件/审批提问接线/打断
node --test "test/*.test.mjs"        # 全量 350 项
npm run build; npm run smoke; node --check client.js
npm run check:devices                # 设备弹窗交互（家庭成员行不会破坏原有二次确认）
```

人工验收（契约 §6，**未实测**，需要 family 插件与真机）：

1. 控制台把设备 A 绑定到成员「爸爸」，Bot 后端设为 `family`；
2. 对设备 A 说一句普通问题：落在爸爸的「语音」会话，PWA 能看到原话与完整回复，设备听到摘要；
3. 触发一次审批：设备念原因并等「允许/拒绝」，说清后继续；超时后 PWA 出现审批卡；
4. 把设备切到「妈妈」：下一轮落到妈妈的会话；
5. 删掉成员：绑该成员的设备下一轮应听到提示（并看到「成员已失效」气泡）。

## 7. 已知限制 / 未实测

- **未实测**：真实手表 → family 会话的端到端延迟、摘要耗时、审批/提问语音、owner 归属
  （`family` 的 `voiceTurns` 是否按预期只让一台设备接审批）。
- 一轮的超时由 family 内部 120s 负责；本插件**没有**再加本地看门狗（DSH 会话后端有）。
  如果 family 卡死，设备会等到它的超时/取消。
- 成员被删后 `devices.json` 里的孤儿 `familyMemberId` **不自动清理**（契约列为 M2 非目标）。
- 设备未绑成员时不会自动挑一个默认成员，也不做语音口令切换。
- 历史：`history/<deviceId>` 仍会记「用户原话 + 设备念出的摘要」，与 family 的 thread 各记一份
  （用途不同：前者是调试/回放，后者是对话真相）。

## 8. 非目标（M2+）

- 语音口令切换成员、切换门槛（家庭口令/按键确认）；
- 语音打断与进度念白的体验调优；
- 成员删除后的孤儿绑定自动清理；
- 用量/历史面板按 voice 渠道区分展示。
