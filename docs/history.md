# 历史对话（会话 / 消息 / 音频）

控制台「智能体 → 历史对话」背后的本地存储与控制 API。对应官方 manager 的
`ai_agent_chat_history`（session_id + chat_type + content + audio_id）与
`ai_agent_chat_audio`（音频 blob），这里用**纯文件、零依赖**实现。

实现：`src/history.js`（存储）、`src/control.js`（HTTP）、`src/voice/session.js`（每轮落库）、
`src/ingress.js`（sessionId 来源）、`index.js`（装配 / 配置 / 清理定时器）。

---

## 1. 数据布局

数据根目录 `<dataRoot>` 默认是 `~/.dsh-xiaozhi`，历史在 `<dataRoot>/history/`：

```
history/
├── B8_1F_3F_D8_2C_CC.jsonl          # 每设备一份消息流水（sanitize 后的 deviceId）
├── 02_00_00_00_00_FF.jsonl
└── audio/
    ├── B8_1F_3F_D8_2C_CC/
    │   ├── <audioId>.wav             # 用户（16k）或助手（24k），PCM16 单声道
    │   └── <audioId>.wav
    └── 02_00_00_00_00_FF/
```

- `sanitize(deviceId)`：把 `[A-Za-z0-9._-]` 以外的字符换成 `_`，所以
  `B8:1F:3F:D8:2C:CC` → `B8_1F_3F_D8_2C_CC.jsonl`（与历史数据文件名一致）。
- `audioId = randomUUID().replace(/-/g,'')`，32 位十六进制；音频文件名是 `<audioId>.wav`。
- 消息文件每行一条 JSON（JSONL，追加写）：

```json
{"at":1793885457654,"session":"3f2c…","role":"user","content":"你好。","audioId":"a1b2c3d4e5f60718293a4b5c6d7e8f90"}
{"at":1793885457654,"session":"3f2c…","role":"assistant","content":"你好！有什么可以帮你的吗？","audioId":null}
```

| 字段        | 含义 |
|-----------|------|
| `at`      | epoch 毫秒 |
| `session` | 会话 id（见第 4 节） |
| `role`    | `user` / `assistant` |
| `content` | 文本（保存时 trim，最多 2000 字符） |
| `audioId` | 该条消息的 WAV id；没有音频时为 `null` |

### 旧数据兼容（读取时迁移）

旧版本每行是 `{"at","user","assistant"}` 一条=一轮。读取时：

- 每行拆成 `user` + `assistant` 两条消息（空文本的那条跳过），`audioId=null`；
- **连续的**旧行按 `at` 间隔聚合：相邻两行间隔 ≤ **10 分钟**归入同一 legacy 会话，
  会话 id 为 `legacy-<该会话第一行的 at>`；间隔 > 10 分钟才开新会话；
- 遇到新格式行会打断 legacy 连续段（不会把升级后的新消息混进旧会话）。

> 为什么必须聚合：真实数据里 `B8_1F_3F_D8_2C_CC.jsonl` 有 48 行旧格式，如果一行一个
> `legacy-<at>` 会话，控制台列表会冒出 48 条「会话」，完全没法用。按 10 分钟聚合后是
> 正常的一段段对话。
>
> 新写入**只写新格式**；旧行保持原样直到被清理/重写（`clearConversation` 重写时顺手转成新格式）。

标题不调 LLM：`deriveTitle(首条用户内容)` —— 去掉空白/标点/符号，最多 20 个字符；
没有用户消息时用首条助手内容，仍为空则 `对话 HH:mm`。

---

## 2. 保留策略

| 项 | 默认 | 说明 |
|---|---|---|
| 每设备文本消息数 | 5000 | 超过后裁到最近 5000 条（追加时裁剪，磁盘上不会长期超出） |
| 音频保留天数 | 30 | 按文件 mtime 判断，启动 + 每日各清一次；`?` 控制台底部有提示 |
| 音频总容量 | 500 MB | 超过后按**最旧优先**删除，直到回到上限内 |
| 单条音频时长 | 120 s | 写入时截断（用户 16k / 助手 24k 都适用） |

`cleanup()` 在 `index.js` 的 `apply()` 里：启动跑一次（清上次异常退出的残留），之后
`setInterval(24h).unref()`。清理失败只 `logger.warn`，不影响插件启动/语音。

清理顺序：过期（> retentionDays）→ 容量上限（最旧优先）→ 回收空设备音频目录 →
文本文件按 `historyMaxMessages` 裁剪。

### 配置（`cordis.patch.yml` 的 `voice` 段，均可省略）

```yaml
voice:
  historyAudio: true          # 是否保存 WAV；与 dumpPcm 解耦（默认 true）
  historyRetentionDays: 30    # 音频保留天数（1–3650）
  historyMaxMessages: 5000    # 每设备文本消息上限（100–100000）
```

`historyAudio: false` 时仍然写文本消息，只是不产 WAV（`audioId` 为 `null`）。

---

## 3. 控制 API

前缀 `/dsh-xiaozhi-7c3a`。**GET 开放**（控制台只能本机打开，且 `<audio>`/下载链接
无法带自定义 header）；`POST` 照旧要求 `x-dsh-xiaozhi: 1`（缺失 403 `csrf`）。
JSON 响应都是 `error: {code, message}` 形态；写接口用 `requireTrustedMutation`。

### 3.1 `GET /history/conversations?deviceId=<id>&limit=50`

会话列表，新→旧，`limit` 1–200（默认 50）。

智能体页用的是 `GET /history/agent-conversations?agentId=<id>&limit=50`：把该智能体绑定的
所有设备的会话合并，按 `endedAt` 倒序；每条额外带 `deviceId` / `deviceName`，详情与音频
仍按单设备的 `/history/conversation`、`/history/audio` 取（存储本来就按设备落盘）。

```json
{
  "deviceId": "B8:1F:3F:D8:2C:CC",
  "conversations": [
    {
      "sessionId": "legacy-1793885457654",
      "title": "你好",
      "startedAt": 1793885457654,
      "endedAt": 1793885461893,
      "messages": 96,
      "preview": "需要我帮你查时间、搜资讯，还是听条新闻？",
      "hasAudio": false
    }
  ]
}
```

- `messages` 是**消息条数**（number，不是数组）——列表里显示「N 条」。一条 = 一条
  user 或 assistant 消息，所以「一轮问答」通常算 2 条。
- `title` 取首条用户内容；`preview` 取**最后一条**消息内容（最多 80 字符）。
- 缺 `deviceId` → 400 `device-required`。

### 3.2 `GET /history/conversation?deviceId=<id>&sessionId=<id>`

单个会话的消息，按写入顺序。

```json
{
  "deviceId": "B8:1F:3F:D8:2C:CC",
  "found": true,
  "sessionId": "legacy-1793885457654",
  "title": "你好",
  "startedAt": 1793885457654,
  "endedAt": 1793885461893,
  "messages": [
    { "role": "user", "content": "你好。", "at": 1793885457654, "audioId": "a1b2…" },
    { "role": "assistant", "content": "你好！…", "at": 1793885457654, "audioId": null }
  ]
}
```

- 会话不存在不是错误：HTTP 200 + `{"found": false, "title": "", "startedAt": null,
  "endedAt": null, "messages": []}`（控制台刚清空/刚刷新的正常竞态）。
- 缺 `deviceId` → 400 `device-required`；缺 `sessionId` → 400 `session-required`。

### 3.3 `GET /history/audio?deviceId=<id>&audioId=<id>`

成功：`200`，`content-type: audio/wav`，`content-length` 为文件字节数，
`content-disposition: inline; filename="dsh-xiaozhi-<device>-<audioId>.wav"`（inline 以便 `<audio>` 直接播放；下载用同源 `<a download>`），
`cache-control: no-store`，body 是 WAV 二进制（`createReadStream` 流式返回，不整块进内存）。

| 情况 | 状态码 | body |
|---|---|---|
| 正常 | 200 | `audio/wav` 二进制 |
| `audioId` 不是 `[A-Za-z0-9]+`（含 `../`、空串） | 400 | `{"error":{"code":"invalid-audio-id",…}}` |
| 文件不存在 / 已过保留期 | 404 | `{"error":{"code":"audio-not-found",…}}` |
| 缺 `deviceId` | 400 | `device-required` |

> `audioId` 直接拼文件路径，所以只允许字母数字，并在 `readAudio` 里再做一次
> resolved path 前缀校验防穿越。客户端不要自己拼文件名。

### 3.4 `POST /history/clear`

```json
{ "deviceId": "B8:1F:3F:D8:2C:CC", "sessionId": "可省略" }
```

- 带 `sessionId`：只清该会话的消息 + 它用到的音频文件，其它会话保留。
- 不带 `sessionId`：清整台设备（消息文件 + 音频目录）。
- 缺 `deviceId` → 400；缺 CSRF header → 403 `csrf`。

```json
{ "deviceId": "B8:1F:3F:D8:2C:CC", "sessionId": "legacy-1793885457654", "cleared": true,
  "removedMessages": 96, "removedAudio": 2, "entries": [] }
```

`entries: []` 是旧版响应的兼容字段（旧控制台/脚本会读它），可以忽略。

### 3.5 旧接口（保留）

- `GET /history?deviceId=&limit=` → `{deviceId, entries:[{at,user,assistant}]}`，扁平旧语义。
- `POST /history/clear` 不带 `sessionId` 时行为与旧版一致（清全设备），并额外返回 `cleared` 等字段。

---

## 4. sessionId 从哪来

`src/ingress.js` 每次 WebSocket 连接生成 `session.id = randomUUID()`（它同时作为 hello
下发给设备的 `session_id`），建 `VoiceSession` 时传 `sessionId: session.id`。

`src/voice/session.js` 每完成一轮对话（`#answer` 的 closing，等本轮所有 TTS 句子合成完）
调 `#recordTurn()`：

- 文本：`user` + `assistant` 两条消息（assistant 是实际排队朗读的句子拼接）；
- 音频：用户侧取自 `#finalizeUtterance` 的 `utterance.pcm`（16k）、助手侧为本轮各句
  `#speakSentence` 产出的 PCM 按顺序拼接（24k），各写一条 WAV；
- 落库是 **fire-and-forget**（`void` + 内部 catch），失败只 `logger.warn`，绝不 await 在语音路径上。

所以：**一条 WebSocket 连接 = 一个会话**。设备重连（哪怕紧接着）会产生新的 `sessionId`，
历史里就是新的一段对话——这与官方 manager 的 session 语义一致。被打断/插话的轮次也会
记录（用户确实说了话、助手也确实播了一部分）。

---

## 5. 失败降级语义（重要）

| 失败 | 行为 |
|---|---|
| 消息写盘失败（磁盘满/权限） | `logger.warn`，本轮历史丢失，语音与 LLM 上下文不受影响 |
| 音频写盘失败 | 只丢这一条 WAV（`audioId=null`），**文本照常落库**；两条路径各自独立 catch |
| WAV 为空/编码没产出 | 不写音频（`saveAudio` 返回 null），消息照写 |
| `cleanup()` 失败 | 只 warn；已处理的文件不回滚，下次再清 |
| 读取损坏/半行 JSON | 跳过该行（`parseRecords` 容错），不影响其它消息 |
| 历史文件不存在 | 返回空列表，不是 500 |
| 未知 `deviceId`（suffix 文件不存在） | `conversations: []` |

历史写入与语音主链路是两套东西：历史失败**不会**导致设备卡住、TTS 不播、LLM 不回复。

---

## 6. 前端/调用方需要注意的坑

1. **`messages` 在列表里是数字**（条数），在详情里才是数组。一轮问答 = 2 条（user + assistant）。
2. **标题可能为空？** 不会：文本至少有一条时 `deriveTitle` 可能得到空串（纯标点/表情），
   此时回退到首条助手内容，再回退 `对话 HH:mm`。前端仍建议 `title || preview || '未命名'`。
3. **音频播放 URL 不要加前导 `/`**，与 `client.js` 其它 GET 一致：
   `dsh-xiaozhi-7c3a/history/audio?deviceId=…&audioId=…`。GET 无 CSRF 要求。
4. **音频可能被保留期清掉**：列表里的 `hasAudio` 是历史快照，点播放时文件可能已经过期
   （30 天）或被容量上限清理，此时 404 `audio-not-found`——前端按「音频已过期」提示即可。
5. **一条连接一个会话**：设备重连会把对话切成两段；不要在列表里假设「同一天 = 同一会话」。
6. **清空粒度**：`/history/clear` 不传 `sessionId` 会清整台设备（不是当前选中的会话），
   控制台要区分「清空该会话」与「清空全部」两个动作。
7. **旧数据没有音频**：legacy 会话的 `audioId` 全是 `null`，播放按钮应隐藏。
8. **旧数据标题**：legacy 会话 id 形如 `legacy-<epoch ms>`；标题来自首条用户内容，不是 id。
