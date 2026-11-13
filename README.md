# dsh-xiaozhi

把 ESP32 小智设备（手写固件 v2.5.3 分支）接进 DeepSeek Harness：

1. **管理端**：设备自动入网后，在这里做配置——全局默认（**服务商**、凭据、LLM 模型、静音收口、回复参数）+ 每个智能体的覆盖（人设/音色/语种/模型，一台智能体可绑定多台设备）；**TTS 的音色与输出语种都按智能体选，全局只存厂商与凭据**（2026-11-08）；
2. **局域网自入网（待审核）**：手表在配网页面填本机 OTA 地址，上电后先进入控制台的「待审核设备」；管理员选择智能体并批准后才建档、连上。没有激活码、没有绑定台；
3. **设备侧网关**：手表用固件内置的 `self.server.exec` / `self.server.commands` 调本机的 `/exec`、`/commands`，Bearer token 鉴权、命令白名单执行；
4. **实时语音管道**：VAD → ASR → LLM 流式 → 分句 → TTS → Opus 定速下发，带代际打断。

两端怎么各自验证、怎么联动、踩过的坑长什么样，记在 [AGENTS.md](AGENTS.md)（现状笔记，不是规范）。

## 多设备怎么管

一个家不会只有一台。配置只有两层，没有第三层：

```
智能体（配置单位）──overrides──> 生效配置 <──全局默认──「全局设置」（服务商/凭据/LLM 模型/静音收口/回复参数）
      │
      └── 绑定 0..N 台设备（MAC）：设备只是硬件名册，只有别名 / OTA / 在线，不存配置
```

- **全局默认**在「配置 → 全局设置」里改一份，所有智能体共用；凭据也只存在插件配置与 `settings.json` 里；TTS 段只配「厂商 + 凭据」，不配音色（2026-11-08）；
- **智能体级覆盖**在「智能体 → 配置」里改（人设、音色、语种、模型、语速、静音），只影响这个智能体（它绑定的设备共用）；TTS 音色（= 模型族）就属于这一层，留空 = 用厂商默认音色，其余项留空即沿用全局；
- 于是「客厅用云希、书房用晓晓」是建两个智能体、各改一次，再把两台表分别绑过去；同一人格的多块表绑同一个智能体就共用一份配置；
- **凭据永远不进覆盖**：API key 只在设置里，面板只选「用哪个已配置的 provider/model」，管理面永远不存也不回显密钥；
- **智能体和设备各自有名字，不共用**（对齐参考服务端 `ai_agent.agent_name` / `ai_device.alias`）：
  自动建/迁移的智能体默认叫「智能体 1 / 2 …」，设备保留自己的别名（`nickName`）；
  在卡片上点智能体名只改智能体，在「设备(N)」弹窗里改名只改设备别名；
- **备用服务商也是全局默认的一部分**：智能体级覆盖只作用于「主用」（人设/音色/模型/静音阈值），
  不会改掉这个智能体的备用链；所有智能体共用同一份备用列表；TTS 备用条目同样只存凭据，运行时用各自厂商的默认音色（2026-11-08）；
- 改动在设备**下一次连接**时生效（每次连接按当前配置重建 adapters，cache key 里带人设与音色，改完不会用旧人设）；
- 全局默认里改「静音收口/回复参数」会立刻写进 `settings.json`，重启后仍是面板里的值；**人设按智能体配置**（智能体 → 配置 → 角色），不再放在全局设置里。

## 设备怎么接进来（这是正确的那条路）

固件的配网页面（长按 BOOT → 连 `xiaozhi` 热点 → `http://192.168.4.1` → 高级设置）本来就有三个字段：

| 字段 | 填什么 | 作用 |
|---|---|---|
| 自定义 OTA 地址 | `http://<本机 LAN IP>:8989/xiaozhi/ota/` | 手表上电先来问"连哪、有没有新固件" |
| 服务器网关地址 | `http://<本机 LAN IP>:8989` | `self.server.exec` 的目标 |
| 网关 Token | 与配置里的 `gateway.token` 一致 | `/exec` 的 Bearer 凭据，只存在设备 NVS |

> `<本机 LAN IP>` 不用自己查：控制台概览页会枚举本机网卡，直接给出真实地址（`192.168.x.x` 之类）并支持一键复制；有多张网卡时可以在「网卡」下拉里切换，虚拟网卡（WSL/Hyper-V/VMware）排在最后并标注「虚拟网卡」。

于是入网流程就是：

```
手表上电 → POST /xiaozhi/ota/（带 Device-Id / Client-Id）
        → 首次见到：进入待审核（403 device-pending），控制台选择智能体并批准
        → 批准后再请求：建档，返回 { websocket.url, activation: null }
        → 手表连 ws://…/xiaozhi/v1/，hello，开始语音
        → 需要动服务器时说一句，固件调 POST /exec（Bearer token）
```

`activation` 恒为 `null`：激活码 + 挑战应答是云控制台的产品流程，家用局域网里没有那套账号，硬套只会让手表卡在"等待绑定"。
`autoProvision: true` 可恢复“首次见到直接建档”的旧行为；默认 `false`，走待审核。批准后设备下一次 OTA/WS 请求才放行；如果手表停在错误页，重启或重新唤醒一次即可。

## 端点

### 设备入口（`0.0.0.0:8989`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST/GET | `/xiaozhi/ota/` | 自引导：已知设备下发 WS 地址；未知设备（`autoProvision:false`）→ 403 `device-pending` 并进待审核；缺 `Device-Id`/`Client-Id` → 400 |
| POST | `/xiaozhi/ota/activate` | 兼容占位：恒返回 200（从别的服务端切过来的表可能还留着旧挑战） |
| GET | `/xiaozhi/v1/` | WS 升级；`Device-Id` 缺失 400；未知设备 → 403 `device-pending`；同设备新连接以 4001 踢掉旧连接 |
| GET | `/health` | 网关存活（无鉴权，供手表排错） |
| GET | `/commands` | 命令清单（Bearer） |
| POST | `/exec` | `{"cmd":"disk"}` / `{"cmd":"echo","args":{"word":"alpha"}}`（Bearer） |
| GET | `/healthz` | 综合状态：设备数、连接数、网关、语音 |

### 操作台（Harness Web，`/dsh-xiaozhi-7c3a`，仅本机）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/state` | 概览 + 设备列表 + 智能体列表 + 待审核设备 + 全局默认摘要 |
| GET | `/pending` | 待审核设备列表（`deviceId`/`lastIp`/`firstSeenAt`/`attempts`） |
| POST | `/pending/approve` | `{deviceId, agentId?}`：批准；`agentId` 为空时自动新建智能体 |
| POST | `/pending/reject` | `{deviceId}`：拒绝并移出待审核队列 |
| GET | `/devices` | 已批准设备列表 |
| GET | `/agents` | 智能体列表（每条带绑定设备、在线、最近在线） |
| POST | `/agents` | `{name}` 新建智能体 |
| POST | `/agents/update` | `{agentId, name?, systemPrompt?, voice?, language?, model?, silenceMs?}`：智能体级配置（空串 = 删掉该覆盖） |
| POST | `/agents/bind` | `{agentId, deviceId}` 绑定设备（已在别的智能体上 = 移动） |
| POST | `/agents/unbind` | `{agentId, deviceId}` 解绑 |
| POST | `/agents/remove` | `{agentId}` 删智能体，**级联删除绑定设备、历史与记忆** |
| GET | `/settings` | 设置快照（密钥掩码）+ 插件配置里的默认人设/静音收口；三段各带 `backups`（备用服务商） |
| POST | `/settings` | 保存设置（端点、固件、网关、人设、静音收口、各段 provider 与 `backups`） |
| POST | `/test/provider` | `{kind, source:'primary'\|'backup', index?}`：逐条测已保存的 LLM / TTS 服务商 |
| POST | `/devices/settings` | `{deviceId, nickName?, notes?}` |
| POST | `/devices/rename` | `{deviceId, nickName}` |
| POST | `/devices/config` | 兼容入口：按设备反查智能体后写同一份配置（新页面用 `/agents/update`） |
| POST | `/devices/disconnect` | 踢掉当前连接 |
| POST | `/devices/remove` | 删记录（下次上电会重新自入网） |
| GET | `/history/agent-conversations` | `?agentId=&limit=50`：智能体绑定设备的会话合并列表（每条带 `deviceId`/`deviceName`） |
| GET | `/history/conversations` | `?deviceId=&limit=50`：会话列表（标题/起止时间/条数/预览/是否有音频） |
| GET | `/history/conversation` | `?deviceId=&sessionId=`：一段会话的消息（role/content/at/audioId） |
| GET | `/history/audio` | `?deviceId=&audioId=`：单条消息的 WAV 音频（inline，供播放/下载） |
| POST | `/history/clear` | `{deviceId, sessionId?}`：清整台设备或单段会话的历史与音频 |

写接口要求 `x-dsh-xiaozhi: 1` 请求头（跨站表单设不了）。

## 控制台（管理端）

侧栏「小智设备」打开的就是管理控制台，Apple Light 视觉（毛玻璃卡片、`--xz-*` 设计变量、圆角/阴影阶梯），桌面侧边栏 + 移动端底部 TabBar。

| 视图 | 内容 |
|---|---|
| 概览 | 设备/在线/语音/网关四张指标卡；OTA、WebSocket、网关三个地址一键复制；**OTA 连通性测试**（服务端回环探针，结果以 JSON 展示）；最近事件 |
| 智能体 | 卡片 = 智能体（配置单位），一台智能体可以绑定多台设备（对齐参考服务端 `ai_agent` / `ai_device`，契约 `docs/agent-device.md`）。卡片：名称（点名字就地改名，回车或失焦确认、Esc 退出）、在线呼吸灯（任一绑定设备在线）、播报、绑定设备列表（`序号. 名称 ●`），音色 / 设备数 / 最近在线，底部 **配置** / **设备(N)** / **历史** / **删除**。**配置**弹窗三个页签（角色 / 模型与记忆 / 扩展能力）改的是智能体 `overrides`，同一智能体的设备共用；「角色」页的「人设」右侧还有 **角色模板** 下拉（湾湾小何 / 星际游子 / 英语老师 / 好奇男孩 / 汪汪队长，文案逐字取自原服务端 `xiaozhi-esp32-server` 的 `ai_agent_template`，选中整段填进人设，手改后回落「自定义」，纯前端不回传）；其中「模型」是 **LLM 模型名**（空 = 全局默认，厂商/Key/端点仍用全局设置，下拉来自全局 LLM 的 `/models`）；**设备(N)** 弹窗里绑定/解绑、改设备别名、OTA 开关、断开、删除设备；一台智能体可绑定多台设备（不同区域的麦克风/扬声器矩阵），一台设备同一时刻只属于一个智能体，其他智能体的设备会显示当前归属并以「移入本智能体」移动；**历史**合并该智能体所有设备的会话（列表项带设备名）；**播报**发给所有在线设备；**删除**是二次确认（第一次点击变「再次点击删除」），确认后级联删除绑定设备与历史。新设备默认先进「待审核设备」，管理员选智能体并批准后才建档；`autoProvision: true` 才恢复自动建智能体 |
| 全局设置 | **三个环节概览卡 + 二级弹窗，无侧边栏**：① **服务商**（页面主体：ASR 识别 / LLM 模型 / TTS 合成 三张概览卡，每张 = 主用厂商 + 摘要 + 密钥/备用数/降级链 + 状态点，点「管理」进弹窗；弹窗里主用卡一整行、备用纵向列表、底部「+ 添加备用服务商」；失败按顺序自动切换）；**TTS 块只配「厂商 + 凭据」，没有音色/模型/Resource ID**（音色在「智能体 → 配置 → 角色」按智能体选，2026-11-08）**LLM 备用条目不要求选模型**：DeepSeek 有厂商默认（`deepseek-chat`）自动填默认并隐藏模型字段，
MiMo 无默认仍要选（模型清单走 `/v1/models`）；**LLM 可选「DSH 已配置」（复用 DSH 里已配置的厂商与凭据、
不用再填 Key，2026-11-10 起排在首位）/ DeepSeek / 小米 MiMo**（OpenAI / 火山 / 星火已从 LLM 段移除，
火山与讯飞仍保留 TTS/ASR）；主用模型仍是全局默认，智能体「模型」可覆盖 ② **语音默认参数**（静音收口 / 回复长度上限 / 回复速度）③ **接入与网关**（默认折叠：LAN/WAN WS、OTA Token、固件版本/URL、强制升级、网关 Token）④ **没有保存按钮**：改动防抖 700ms 自动落盘，底部只显示「保存中… / 已自动保存 / 失败重试」，设备下次连接生效；未落盘时测试按钮变「保存并测试」。**人设不在这里**——按智能体在「智能体 → 配置 → 角色」里设置。所有下拉都是**胶囊式浮层**（`docs/pill-popover.md`）：`position:fixed`、不参与页面布局，展开时不会撑出滚动条或让页面内容位移，下方空间不足自动向上翻转 |

### 权限模型：本机即管理员

- **没有登录**。控制台由 Harness Web 服务提供，而它只监听回环地址——能打开这个面板的人，本来就已经拿到了这台机器。
- 所有写接口只保留一道闸：`x-dsh-xiaozhi: 1` 请求头（防别的网页跨站 POST）。
- 删掉的复杂度：口令哈希、会话签名、登录页、角色守卫、越权告警——都不再存在，也不再需要维护。

### 密钥处理

- 读取：`GET /settings` 只返回 `••••` 掩码 + `hasToken/hasApiKey` 布尔，明文不进 DOM 也不进响应。
- 写入：留空 = 保持原值（表单回填掩码，不会把掩码写回去）；`clearToken/clearApiKey` 才真正清空。
- 备用服务商逐条同理：每条带自己的 `id`，掩码/空串回传时**只有同 id 且同 provider** 才保留旧密钥；
  换了厂商就当作另一家的凭据（旧 Key 不会跟过去），删掉卡片则该条密钥从磁盘消失。
- 备用条数**不设上限**；非法 provider 会让**整次保存失败**（不做半保存）。

### 主用 + 备用服务商（自动冗余）

入口：全局设置页的 `ASR 识别` / `LLM 模型` / `TTS 合成` **三张概览卡**（主用厂商 + 摘要 + 密钥/备用数/降级链 + 状态点），点「管理」进入该环节的弹窗：

- 弹窗里最上面一张「主用」卡（淡蓝描边 + 主用徽标），下面按优先级排列备用**纵向列表**（备用 1、备用 2…），
  末尾是整行「+ 添加备用服务商」；
- 备用行右侧只有 `[编辑]` 和 `⋯`；`上移 / 下移 / 测试 / 删除` 收进**浮层菜单**（贴着按钮弹出、
  不撑高行，点空白或 Esc 关闭）；删除仍是二次确认；主用的 `[编辑][测试]` 也在标题行右侧（2026-11-09 排版收敛）；
- 所有条目都走**同一个编辑弹窗**：先选厂商，再只显示该厂商需要的字段；不再有「上面一个
  provider 下拉、下面又一个添加服务商」两套入口；
- **TTS 卡只有「厂商 + 凭据」**（2026-11-08）：编辑弹窗不出现音色 / 模型 / Resource ID / API URL；
  音色（= TTS 模型族）在「智能体 → 配置 → 角色」按智能体选，留空 = 厂商默认（火山
  `zh_female_vv_uranus_bigtts` / Edge `zh-CN-XiaoxiaoNeural` / 讯飞 `xiaoyan` / 百智云 `vivi`，见
  `src/voice/voices.js` 的 `DEFAULT_TTS_VOICES`）；备用条目运行时也用各自厂商默认音色；
  **火山 TTS 主用可另填 AccessKey ID / SecretAccessKey（可选）**：只用于调官方 `ListSpeakers`
  拉真实可用音色，合成仍用 API Key；不填时智能体「角色」页显示内置清单并标注「可能含未开通音色」；
- 同一家可以填多条（多账号/多把 Key），顺序即优先级；备用条数**不设上限**（2026-11-08 起）；
- 改动**自动保存**（2026-11-08 起）：任何字段改完防抖 700ms 落盘，底部只显示「保存中… / 已自动保存 /
  自动保存失败（可重试）」；保存中又有改动会等下一轮，服务端回写不会覆盖刚输入的内容。未落盘时测试按钮
  变「保存并测试」——先保存再测。

控制台只列出**当前环境真实可用**的服务商（目录统一在 `src/providers.js` 的描述符里，控制台通过 `GET /providers` 拉取；**加厂商只改描述符 + 适配器，前端不用改**，见 `docs/provider-descriptors.md`）：

| 环节 | 可选服务商 |
|---|---|
| LLM | **DSH 已配置**（复用 DSH 的厂商与凭据，免密钥）/ DeepSeek / 小米 MiMo |
| TTS | 火山引擎豆包 / 讯飞语音合成 / 百智云语音合成 / 微软 Edge（免密钥） |
| ASR | 火山引擎豆包 / 讯飞语音听写 / 百智云语音识别 / 本地 SenseVoice（免密钥，用 Harness 内置识别） |

`mock`（仅桌面联调）、`host`（Harness 自带厂商，没有服务商 Key）、`funasr`（需本机额外部署
FunASR 服务）不出现在下拉里；其中 FunASR 适配器仍保留在服务端，手工写配置可用，只是控制台不列。

**厂商端点地址一律内置在适配器里，控制台不再出现「ASR 地址」这类输入框**（2026-11-09）：地址几乎不改，
露在表单里只会让人以为必须填。需要自建/代理端点时，手写 `settings.json` 的 `voice.asr.url` 仍然生效
（存储白名单保留该字段，主用保存也不会把它覆盖成空串）；LLM 的 `Base URL` 不在其中，仍保留在表单里。

> **LLM 主路径是插件直连服务商**（`voice.llm.provider` = `deepseek` / `mimo` / …，用本插件自己
> 填的 Key）。`host`（复用 DSH 自己的 `llm` 服务）只是历史兼容路径：**智能体级不再自动切 host**，
> 只有全局显式选 `host` 时才走它。线上曾因设备 `hostProvider` 覆盖把 provider 强切成 host，
> 持续报 `no adapter registered for provider "…"`，设备停在「聆听中」，2026-11-07 已改回直连。

完整契约见 [`docs/backup-providers.md`](docs/backup-providers.md)，选择器规范见
[`docs/pill-popover.md`](docs/pill-popover.md)。

运行时的切换规则：

| 环节 | 何时切换 | 说明 |
|---|---|---|
| LLM | 只在还没吐出任何 token 之前 | 已经出字再换会把同一句话念两遍；此时按原 `llm_failed` 路径收尾 |
| TTS | 每句话整句重试 | 候选音频先收齐再放行，不产生半句「幽灵音频」 |
| ASR | 整段话音结束时回放重试 | 已写入的 PCM 缓存一份（上限 60s），换下一家重放且不重复推字幕 |

切到备用并成功后，这个会话会先继续用它（粘性），5 分钟后重新先试主用；主动打断不算失败、不触发切换。
改动在设备**下一次连接**生效（与其它全局设置一致）。切换过程只记 `logger.warn` 与
`voice.log` 的 `llm/tts/asr.failover` 事件（`from` / `to` / `provider` / `error` / `ms`）。
- 运行时生效：保存后立即覆盖 OTA/固件/网关/语音 provider，无需重启插件。

## 设备网关的安全边界

`/exec` 是"让手表在你机器上执行命令"，所以它默认关闭，并且有四道闸：

1. **没有 token 就没有 /exec**：`gateway.token` 为空时整个 `/exec` 返回 404，不是 401。
2. **只有白名单 argv**：`shell: false`，`;`、`|`、`$()`、反引号都只是普通字符；`argv[0]` 不允许含占位符。
3. **参数逐项白名单**：`{"word": ["alpha","beta"]}`，越界即 400；没在 `params` 里声明的占位符会让该命令失效（白名单不允许失败开放）。
4. **限流与爆破保护**：每 IP 每分钟 30 次；鉴权失败 10 次/分钟锁 60 秒（429）。

子进程只拿到 `PATH`/`LANG`/`HOME`/`TZ`/`TERM`/`SystemRoot` 这几个环境变量，单条命令有超时（默认 8s，`[exit 124]`）和输出上限（默认 4KB，超出截断并标注）。

成功与命令失败都回 **HTTP 200**，业务结果在正文里：

```
$ whoami
desktop\operator
[exit 0, 27 ms]
```

因为手表把正文当文本念给模型听，用 500 表示"命令失败了"会让模型以为请求没发出去，而命令其实已经执行了。

## 内置工具

语音会话里的工具（`src/tools.js`）由模型按需 function-calling 调用，结果以 `role:"tool"`
回灌。控制台「智能体 → 配置 → 扩展能力」可以按智能体单独开关（同一智能体的设备共享）。

| 工具 | 作用 | 数据源 |
|---|---|---|
| `get_current_time` | 当前日期时间（模型不必再猜） | 本地 |
| `web_search` | 联网搜索；**固定 `need_content: true`**，回传每条结果的标题/链接/摘要/**网页正文摘录**（单条正文 ≤900 字、整批 ≤3800 字） | DeepSeek Search API（Bearer，按成功请求计费） |
| `web_fetch` | 抓取**单个网页正文**（Markdown，≤3500 字）；搜索摘录不够、用户给了链接、要看公告/文档/价格时用 | DeepSeek Fetch API（Bearer，按成功请求计费） |
| `get_news_from_chinanews` | 社会 / 国际 / 财经新闻播报 | 中国新闻网 RSS |
| `get_news_from_newsnow` | 热榜新闻（澎湃/百度热搜/财联社/知乎/微博/36氪/IT之家等）；可抓上一条详情 | NewsNow 公共 API（`voice.tools.newsnow`） |
| `get_lunar` | 农历日期、干支年、生肖、星期（宜忌/节气暂不支持） | 本地 `Intl` 中国农历 |
| `handle_exit_intent` | 用户说“再见/结束对话”时播告别语并断开连接 | 无 |
| `hass_get_state` / `hass_set_state` / `hass_play_music` | 查询/控制 Home Assistant 设备（灯、音量、媒体播放） | Home Assistant REST API（`voice.tools.hass`） |
| `search_from_ragflow` | 从 RAGFlow 知识库检索并回答 | RAGFlow retrieval API（`voice.tools.ragflow`） |
| `call_device` | 按备注名呼叫另一台设备（manager 通讯录） | manager API（`voice.tools.callDevice`） |
| `play_music` | 从本地音乐目录按歌名匹配/随机播放；先 TTS 说“正在为您播放…”，再播音频 | 本地目录（`voice.tools.music`，ffmpeg 解码） |

要点：

- 工具 Key 用 **DeepSeek Key**：LLM 主用是 DeepSeek 时直接复用；主用换成 MiMo/火山等时，
  自动从 LLM 备用链里找 `provider=deepseek` 的那把 Key（`index.js` 的 `deepSeekToolKey`）。
  取 Key 是**运行时 getter**，控制台刚保存的 Key 下一轮对话就生效，不用重启。
- 没配 Key 时 `web_search` 退回 Harness 的 `ctx.web.search`；`web_fetch` 会明确回
  「还没有配置 DeepSeek API Key」，不会静默失败。
- 计费按**成功请求次数**（Search / Fetch 各 5 元/1000 次），`count` 不影响单价；
  Search 无结果、请求失败、超时不收费。语音链路最多 3 轮工具（`MAX_TOOL_ROUNDS`），
  搜一次再看 1–2 个页面刚好在预算内。
- 新闻配置在 `cordis.patch.yml` 的 `voice.tools.newsnow`：`newsnow.url` / `newsnow.sources`。
- **天气工具已下掉（2026-11-09）**：要用得先配 QWeather Key，用户明确不用，所以 `get_weather`
  不再注册、`voice.tools.weather` 段也不再解析；问天气让模型走 `web_search`。

### 设备侧 MCP / IoT（2026-11-08 首阶段）

- **设备侧 MCP**：设备 hello 里带 `features.mcp === true` 时，服务端在 hello 之后按官方顺序发
  `{type:'mcp', payload:{jsonrpc:'2.0', id:1, method:'initialize'}}` 和 `id:2 tools/list`；
  设备回 `tools/list` 后，工具动态进入语音会话，模型调用时服务端发 `tools/call`（id 从 3 起，30s 超时），
  结果以 `content[0].text` 回灌。工具名按官方规则清洗，调用时映射回设备原名。
- **设备侧 IoT**：设备发 `{type:'iot', descriptors:[...]}` 注册属性/方法，服务端生成
  `get_<device>_<property>`（查询）和 `<device>_<method>`（控制）两类工具；设备发
  `{type:'iot', states:[...]}` 更新属性值；控制时服务端回 `{type:'iot', commands:[...]}`。
- 两类动态工具与内置工具合并，同名时内置优先；控制台「扩展能力」的总开关仍生效。
- 官方 Python 版服务端插件工具已全部覆盖；`play_music` 需要本地音乐目录和 ffmpeg，目录不存在时工具不注册。

### 外部 MCP server（stdio / SSE / Streamable HTTP）

配置文件 `~/.dsh-xiaozhi/mcp_servers.json`，格式与官方 `data/.mcp_server_settings.json` 一致：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "remote-sse": {
      "url": "http://localhost:8080/sse",
      "headers": { "Authorization": "Bearer TOKEN" }
    },
    "remote-http": {
      "url": "http://localhost:8000/mcp",
      "transport": "streamable-http",
      "headers": { "Authorization": "Bearer TOKEN" }
    }
  }
}
```

- `command`：stdio 子进程，按行 JSON-RPC。
- `url` 不带 `transport`：SSE（GET 事件流 + POST endpoint）。
- `url` + `transport: "streamable-http"`（或 `"http"`）：Streamable HTTP。

插件启动时异步连接、`initialize → notifications/initialized → tools/list`，工具并入语音会话的
function-calling；控制台「扩展能力」的 `catalog` 也能看到。**改完配置要重启 DSH**。

**MCP 接入点（出站）**：在 `cordis.patch.yml` 顶层加 `mcpEndpoint: 'ws://.../mcp/...'`
（或 `voice.mcpEndpoint`）。插件启动时连上去，走裸 JSON-RPC（initialize id=1、tools/list id=2、
tools/call 从 3 起），工具同样并入 `toolRegistry`。

**入站 `/mcp`（游戏/外部 MCP server 注册工具）**：配置 `mcpToken`（留空不开放），
客户端连 `ws://<本机>:8989/mcp?token=<mcpToken>&agentId=<可选>`。服务端发
initialize/tools/list/tools/call，客户端回 result；工具按 `agentId` 聚合，同名工具加 agent 前缀。
这是给 lingxi 常驻工具通道用的，**不是**设备侧 `features.mcp`。

## 对话历史（会话 / 消息 / 音频）

控制台「智能体 → `历史`」打开，对齐官方 manager 的「手表 · 历史对话」：左侧是**一段一段的会话**
（标题 + 相对时间 + `N 条`，列表项带设备名），右侧是该段的消息气泡（用户右蓝、助手左白，HH:mm）；每条消息有
▶ 播放 / ⬇ 下载自己的 WAV 音频，助手消息下标注「以上内容由 AI 生成」，底部注明
「音频数据仅保留 30 天」。契约细节见 [`docs/history.md`](docs/history.md)。

存储（本机文件，无数据库）：

```
~/.dsh-xiaozhi/agents.json                              # 智能体（配置单位）+ 绑定关系在 devices.json
~/.dsh-xiaozhi/devices.json                             # 已批准设备名册（0600，版本 2）
~/.dsh-xiaozhi/pending.json                             # 待审核设备队列（0600，版本 1）
~/.dsh-xiaozhi/memory/<agentId>.json                    # 记忆按智能体（同一智能体的设备共用）
~/.dsh-xiaozhi/history/<deviceId>.jsonl                 # 每行一条消息：{at,session,role,content,audioId}
~/.dsh-xiaozhi/history/audio/<deviceId>/<audioId>.wav   # PCM16 单声道：用户 16k、助手 24k
```

- **会话 id = 一条 WS 连接**（hello 里的 `session_id`）；设备重连就开始新的一段。标题取该段首条
  用户消息（去标点、截 20 字），不额外调 LLM。
- **保留策略**：每设备文本最多 5000 条；音频保留 30 天、总容量 500MB（最旧优先清）；单条音频超
  120s 截断。清理在插件启动时跑一次 + 每天一次，失败只 warn。
- **旧数据兼容**：升级前的 `{at,user,assistant}` 行在读取时迁移——相邻行间隔 ≤10 分钟聚合成一段
  legacy 会话（实测 48 行旧记录 → 9 段），旧会话没有音频（`audioId=null`，不显示播放按钮）。
- **失败降级**：历史/音频写盘是尽力而为，异步且吞异常；写音频失败只丢音频，不影响文本落库，
  更不影响语音主链路。
- 开关（`cordis.patch.yml` 的 `voice` 段，均可省略）：`historyAudio: true` 是否存 WAV；
  `historyRetentionDays: 30`；`historyMaxMessages: 5000`。
- 与「记忆」的区别：记忆是**要记住的信息**（设备配置 → 模型与记忆里可编辑，注入下一轮 prompt）；
  历史是**说过什么的只读流水**，不注入模型。

## 实时语音管道

```
设备上行 opus ──decode(ffmpeg+Ogg)──> PCM16 ──(判停)──> 一句
                                          └─ 300ms pre-roll，首字不截断
一句 ──ASR──> 文本 ──LLM 流式──> 分句器 ──句──> TTS ──encode──> Opus 包 ──定速下发──> 设备

打断：cancel(turn) → generation++ → 清队列 → 立即下发 tts_stop
      发送循环对 generation 不匹配的帧物理丢弃（幽灵音频）
```

**判停以设备为准**（`voice.vadMode: device`，默认）：固件用 esp-sr AFE 的 `VAD_MODE_0` + `vad_min_noise_ms=100`（原厂值，见 `afe_audio_engine.cc`）判到静音后发 `listen stop`，服务端收到就收口。阈值只有一份，就在固件里；插件不再自己决定"说完了"。

老固件（不发 `listen stop`）把 `vadMode` 设成 `energy`，退回插件自己的能量 VAD：`silenceMs 400` 对齐 Go 的 `chat_max_silence_duration`，另外两个（`minSpeechMs` / `vadThreshold`）是能量算法自己的参数，不是原厂值。

### 厂商与协议

ASR / LLM / TTS 三段各自独立配置，**互不共享凭据**；默认全部走插件直连厂商（自己填 Key），
不消耗 DSH 自身模型的额度。`host`（Harness 宿主 LLM）仅作历史兼容，需在全局设置里显式选中。
TTS 段的全局配置只有「厂商 + 凭据」，音色（= TTS 模型族）按智能体在「智能体 → 配置 → 角色」选，
留空 = 厂商默认（2026-11-08）。

| 阶段 | provider | 协议 | 状态 |
|---|---|---|---|
| ASR | `mock` / `funasr` | 本地 FunASR 2pass WebSocket | 已实现（控制台默认不列出：需本机自部署） |
| ASR | `xunfei` | 讯飞听写 `wss://iat-api.xfyun.cn/v2/iat`，HMAC-SHA256 签名、`status 0/1/2` 分帧、`ws[].cw[].w` 累加 | 已实现（单测覆盖签名与解析） |
| LLM | `mock` / `deepseek` | OpenAI 兼容 chat/completions 流式 | 已实现 |
| LLM | `host`（复用 DSH） | 走 DSH 的 `llm` 服务（`ctx.llm.stream`），厂商为当前 profile 注册的 id（`hostProvider`），插件**不存 Key**；厂商清单来自 `GET /llm/providers`，模型仍单独选 | 已实现（保存/构建期校验 hostProvider，未注册即明确报错） |
| LLM | `mimo`（小米 MiMo） | OpenAI 兼容 chat/completions（`api.xiaomimimo.com/v1`），**认证走 `api-key` 头**（不是 Bearer）；**模型清单从 `GET /v1/models` 实时拉取，插件不内置任何模型 id**（拿不到就手填）；语音场景默认请求 `thinking:{type:'disabled'}` 压低首字延迟 | 已实现（单测覆盖认证头/流式/工具调用） |
| — | ~~`openai` / `volc` / `spark`~~ | 已从 **LLM 段**移除（2026-11-09，只保留 DeepSeek / MiMo）；手写 settings 里残留会以 `unknown LLM provider` 明确报错 | 已移除（火山/讯飞的 TTS/ASR 不受影响） |
| TTS | `mock` / `edge` | Edge TTS，MP3 → ffmpeg → PCM | 已实现 |
| TTS | `xunfei` | 讯飞在线合成 `wss://tts-api.xfyun.cn/v2/tts`，`aue=raw` 直出 PCM16 | 已实现（单测覆盖请求/响应帧） |
| TTS | `volc`（豆包） | HTTP 单向流式 `api/v3/tts/unidirectional`（`seed-tts-2.0`），逐行 JSON + base64 PCM | 已实现 |
| ASR | `volc`（豆包） | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`，二进制帧 + gzip，只支持 2.0 资源（`volc.seedasr.*`） | 已实现（2026-11-06 用真实语音端到端验证） |

讯飞三件套的签名规则一致（`host/date/request-line` 的 HMAC-SHA256，再 base64 包成 `authorization`），实现在 `src/voice/adapters/xunfei-auth.js`，被 iat 与 tts 共用。

三段都支持「主用 + 备用」候选链（`src/voice/adapters/failover.js`，契约见
[`docs/backup-providers.md`](docs/backup-providers.md)）：候选按优先级逐个构建，构建失败的那条只跳过
（一条配错的备用不会把整条语音链路打死）；只要有一条能起来语音就可用，一条都起不来才抛主用的原始错误。
控制台选择器统一用胶囊浮层（规范见 [`docs/pill-popover.md`](docs/pill-popover.md)），不用原生 `<select>`。

| 文件（`src/voice/`） | 职责 |
|---|---|
| `segmenter.js` | 流式分句，端口自参考实现的 `sentence.go`（`3:30`、`1.` 序号不误切），外加首句硬上限与 `<think>`/代码块/emoji 清理 |
| `elements.js` | 代际计数器、有界队列、定速发送（120ms 前瞻信用，与参考实现的 `playbackTail` 同构） |
| `session.js` | 会话状态机：listen/abort、ASR 流、LLM→分句→TTS 串行链、打断、指标 |
| `voices.js` | 音色目录 + 每厂商默认音色（`DEFAULT_TTS_VOICES`）；`resolveTtsVoice` 把配置值整理成实际生效音色：空 → 厂商默认、跨厂商残留 → 回落本厂商默认、自定义 ID 原样保留（2026-11-08） |
| `ogg.js` / `codec.js` | Ogg Opus 封包/解包 + ffmpeg 编解码桥 |
| `ws-client.js` | 自实现 WS 客户端（供应商要求自定义头） |
| `adapters/` | `mock` / `edge`（TTS）/ `funasr`（ASR）/ `openai`（LLM） |

配置见 `cordis.patch.yml` 的 `voice` 块。真实链路示例：

```yaml
  llm:  { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '<注入，不要提交>' }
  # TTS 的音色（= 模型族）归智能体级：控制台全局设置只存厂商 + 凭据。这里写的 voice 只是
  # Loader 兜底（控制台保存过全局设置后被显式清空，改用智能体级/厂商默认，2026-11-08）。
  tts:  { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural', language: '日语' }
  asr:  { provider: 'funasr', url: 'ws://127.0.0.1:10096/' }
```

### 输出语种（含日语）

`tts.language` 决定**模型用哪种语言说话**，和 `asr.language` 的「识别语言」是两件事；留空 = 不干预，跟随音色。

**输出语种只在「智能体 → 配置 → 角色」按智能体设置**（2026-11-08 起；全局设置里的那一项已删除，避免和智能体页重复）。同一智能体的所有设备共用；不同智能体可以各说各的语言。`cordis.patch.yml` 里的 `voice.tts.language` 仍作为服务端兜底默认（控制台不再有入口）。

做法照官方 Java 分支的两层：语种先写进系统提示词的 `<output_language_directive>`（`src/voice/language.js`），豆包 2.0 再补一个 `req_params.additions.explicit_language`。取值只收白名单：普通话 / 英语 / 日语 / 粤语 / 韩语，白名单外的值一律退化为「跟随音色」——因为这段文本会被拼进提示词。

日语的最小组合：

| 位置 | 值 |
|---|---|
| 智能体 → 配置 → 角色 → 输出语种 | 日语（只影响这个智能体；同智能体的设备共用） |
| 智能体 → 配置 → 角色 → 音色 | `zh_female_vv_uranus_bigtts`（Vivi，官方标注「普通话、日语、印尼语、墨西哥西班牙语」）；留空 = 火山默认音色就是它（2026-11-08：音色只在智能体级选） |
| 可选 | 目录末尾 4 条 `multi_*` 日语音色属 1.x，需要账号开通 `seed-tts-1.0` 资源；本机账号只有 2.0，暂时用不了 |

音色必须与 TTS 资源**同代**：`seed-tts-2.0` 只认 `*_uranus_bigtts` 与 `saturn_*_tob`；`*_moon_bigtts` / `*_mars_bigtts` / `*_jupiter_bigtts` / `multi_*` 会回 `55000000 resource ID is mismatched with speaker related resource`，现象是**屏幕有字、喇叭没声**，手表还停在「聆听中」。设备面板的音色下拉按全局 TTS 的 Resource ID 过滤同代音色（Resource ID 已不在界面配置，空 = 插件默认 `seed-tts-2.0`，2026-11-08）；服务端建立会话时也会打一条 error 指出不匹配。

音色条目自带官方 `ai_tts_voice.languages` 标注，只作内部对照，不在界面上展示；语种与音色不匹配也不拦截（官方同样不拦）。粤语没有 `explicit_language` 码，只靠提示词 + 音色本身。

智能体「角色」页选「跟随音色」会删除该智能体的 `language` 覆盖、撤掉语种指令；如果只在 `cordis.patch.yml` 里写过默认语种，需要智能体上显式选一次别的值再选回来，才能覆盖掉它。

实测（`node --test "test/*.test.mjs"`，251 项）：

| 指标 | 结果 | 条件 |
|---|---|---|
| 一整轮（真 Opus 编解码） | 277 ms | 真实 opus 上行 → ffmpeg 解码 → VAD → ASR → 分句 → 编码 → 下发 |
| 首帧延迟（管道本身） | 40–100 ms | mock 供应商，预算 1200ms |
| 打断 | < 100 ms 内不再有帧，`tts_stop` 立即到 | 含"打断后下一轮仍可用" |
| 20 轮连续对话 | 队列有界、`turns=20`、无泄漏 | — |
| Edge TTS 首包 | 1.28–1.50 s，且整句一次性到达 | 真实网络；**这是端到端预算的主要项** |

结论直说：管道自身是几十毫秒级；Edge 是整句合成后才吐包，会把端到端首帧推到 2 s 上下。要进 800–1200ms 得换真正流式的 TTS（豆包 `doubao_ws` / CosyVoice），适配器接口就是为此留的。

## 语音排障

每次真实会话都会把关键节点写进 `~/.dsh-xiaozhi/voice.log`（JSONL，一行一个事件）：

| 事件 | 说明 |
|---|---|
| `session.build` | 这台设备这次用的 `voice`（**实际生效**：设备选的 / 厂商默认 / 跨厂商回落后）/ `resourceId` / `model` / 采样率——先看这条，确认音色是不是你以为的那个 |
| `vad.start` / `vad.end` | 上行判停是否触发（有这两条说明音频真的到了服务端） |
| `asr.result` / `asr.empty` / `asr.error` | 识别结果；`empty` 表示有声音但没出字 |
| `volc.request` / `volc.first` / `volc.done` | 火山合成：请求参数、首个音频块、总字节数 |
| `tts.pcm` / `tts.encoded` | 合成出来的 PCM 字节、编码出的 Opus 包数 |
| `ws.json` + `frames` / `bytes` | 发给设备的 JSON（`tts start` / `sentence_start` / `stop`）以及当时已下发的帧数/字节数 |
| `tts.error` / `volc.http.error` / `tts.encode.error` | 失败点，附原始错误 |

排查顺序：`session.build`（选的什么音色）→ `volc.done`（有没有合成出音频）→ `tts.encoded`（有没有编成包）→ `ws.json` 的 `stop` 事件里 `frames > 0`（有没有真的发出去）。前面都有、设备还是不响，问题就在设备侧解码/功放。

## 控制台源码与构建（2026-11-08）

控制台客户端不再是单文件手写：源码在 `src/client/`，用 esbuild 构建成 `client.js`（构建产物，**不要手改**）。

| 目录 | 内容 |
|---|---|
| `src/providers.js` | 服务商描述符（唯一元数据来源）：有哪些厂商、每段要填什么、摘要/密钥/探测声明 |
| `src/client/core.js` | 常量、描述符消费（`PROVIDERS` / `STAGE_META` / `setProviders`）、`t()`、`callApi`、格式化、备用卡片辅助（无 React） |
| `src/client/i18n/zh.js` / `en.js` | 中英文案（两边键必须对齐） |
| `src/client/styles.js` | 全部 CSS（`apply` 里插 `<style>`） |
| `src/client/ui/` | `Icon` / `PillSelect` / `MenuItem` / `Metric` 等基础组件 |
| `src/client/views/` | 概览、能力页（能力页已无渲染点） |
| `src/client/agents/` | 智能体页 + 配置 / 设备 / 历史弹窗 |
| `src/client/settings/` | 全局设置页 + 服务商卡片 / 编辑弹窗 / 模型选择器 |
| `src/client/console/` | 控制台外壳（导航/滚动）与面板根组件 |
| `src/client/index.js` | `window.__ModuleLoader__.load` 注册 + `apply(ctx)` |

```powershell
npm run build    # src/client/** → client.js（React 保持 external，由宿主 require('react') 提供）
npm run smoke    # 真实 React SSR 渲染主要页面 + slot 注册校验
```

改完源码要重新 build 再刷新控制台；仍加载旧产物就重启 DSH。完整契约（运行模型、Vue 评估结论、
编码约定）见 [`docs/client-architecture.md`](docs/client-architecture.md)。

## 测试

```powershell
node --test "test/*.test.mjs"   # 251 项
npm run build && npm run smoke  # 控制台构建 + 冒烟
```

覆盖：标识归一化/私网判定/存储（待审核、损坏文件隔离）；智能体覆盖合并与越界回落（含「hostProvider 不再强切 host」）；全局设置（人设/静音收口持久化、空值回落插件配置、`applyRuntimeVoiceSettings` 的 hostProvider/backups 叠加回归）；**三段备用服务商持久化/掩码/逐条留空保留/非法整次失败**；**TTS 默认音色**（全局只存凭据、`voice`/`model`/`resourceId` 可清空、只带凭据的主用/备用条目可构建、空音色→厂商默认、跨厂商残留→本厂商默认、自定义 ID 原样保留，2026-11-08）；HTTP 端到端（待审核/批准、`activation: null`、互斥 4001、CSRF、`/test/provider` 参数与回包）；网关（`/health` 免鉴权、`/commands` 401/200、`/exec` 白名单/参数注入 400/超时 124/截断/限流 429/爆破锁定）；语音（分句器边界、VAD、Ogg 往返、真 Opus 整轮、打断、20 轮）；**failover**（LLM 未出字前切换/出字后不切、TTS 整句重试、ASR 回放且不推 partial、abort 不切换、候选构建失败跳过、粘性与 5 分钟回落）；**小米 MiMo**（`api-key` 认证头、`thinking` 开关、SSE 文本/工具调用、模型清单走 /v1/models（无内置兜底））；**联网工具**（Search 带正文/截断预算、web_fetch 正文与 403/404 语义、动态 Key、无 Key 回退）；**对话历史**（会话聚合/标题/旧格式迁移/音频 WAV 读写与路径安全/保留期与容量清理/clear 粒度/4 条 HTTP 路由）；**智能体/设备绑定**（旧设备迁移与记忆复制、多设备绑定/移动/解绑、配置共享、级联删除、历史合并、智能体重名拦截，`test/agents.test.mjs` 7 项）。

## 已知限制

- **局域网信任（默认改为待审核）**：`autoProvision: false`（默认）时，陌生设备只进 `pending.json`，控制台批准后才建档；`autoProvision: true` 则恢复“任何能访问 8989 的设备都自动登记”的旧行为。公网暴露前仍应加 WS 鉴权/防火墙。
- 手表侧的 OTA 地址与网关地址要手工填一次（配网页面）；插件会广播 `_xiaozhi._tcp`（mDNS），路由器隔离多播时才会回落到手工地址/云端。
- TTS 首包延迟受供应商限制（见上）。
- ASR 依赖外部 FunASR 服务；无该服务时只能用 `mock`。
- 无唤醒词：依赖设备侧唤醒或持续监听。
- 音频编解码依赖本机 `ffmpeg`；缺失时语音禁用，网关功能不受影响。
- **自动切换是「会话内候选链」**：配置改动在设备下一次连接才生效；LLM 已经出字之后不会中途换家；
  TTS 换家要把整句重新合成（会多一整句的延迟）；ASR 回放缓存上限 60s，超长的一段话音失败后无法重试。
- **切换只有单测覆盖**：真实厂商的故障切换未做在线 E2E（需要真的让一家 Key 失效来验），上线后可用
  `voice.log` 的 `*.failover` 事件确认；备用服务商的「测试」按钮只测已保存的配置。
- **回答长度**：语音场景默认 `max_tokens = 120`（约 60 个汉字），并在系统提示词末尾追加
  不可协商的短回答规则（默认 1 句、最多 2 句、不复述问题、不用 Markdown/表情）。参考官方
  `xiaozhi-esp32-server` 的 `agent-base-prompt.txt`（`[Get to the point]` + TTS 格式约束）。
  控制台「全局设置 → LLM → 回复长度上限」可覆盖（32–2048，留空 = 120），改完下一次连接生效。
- **空回合**：ASR 空结果不再回 tts（回 tts 会让环境音触发的假句尾把设备弹一下，像“自己触发对话”）；
  收到「没有进行中 utterance 的 `listen stop`」时服务端直接 `#beginCapture()` 重开捕获，
  否则设备不会重发 `listen start`、后续话音会被整段丢弃。固件侧短于 400ms 的假片段不发 stop。
- **火山 ASR 资源只用 2.0**：`volc.seedasr.sauc.duration` / `.concurrent`。
  `volc.bigasr.*` 会与 `bigmodel_async` 端点不匹配、握手 403，现象是「识别恒为空、手表停在聆听中」；
  控制台已只列 2.0 资源。
- **改配置后必须重连**：adapters 在建连时构建并缓存（缓存 key 覆盖三段全量配置），改完设置要让
  设备重新连接才生效；插件代码本身改动仍需重启 DSH。
- 无 MQTT 传输；单进程内存态连接表；固件只做 `firmware.version/url/force` 透传。
