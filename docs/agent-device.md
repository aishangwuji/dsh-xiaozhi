# 智能体（agent）与设备（device）

> 本文是「智能体 = 配置单位，设备 = 物理单位」这一层的实现契约。改动前先读完，
> 它同时约束存储、控制 API、运行时装配与控制台。

## 1. 为什么拆成两层

参考服务端（`xiaozhi-esp32-server` 的 `ai_agent` / `ai_device.agent_id`）把**人格**和**硬件**
分开：人设、模型、音色、语种、记忆、工具都属于智能体；一台智能体可以绑定多台设备
（同一人格在几块表上说话）。插件 2026-11-08 之前是「一台设备一份配置」，控制台卡片叫
「设备」——同一个人的两块表要配两遍，配置还会漂。

现在的语义：

```
智能体 agent（agents.json）        设备 device（devices.json）
├─ id                              ├─ deviceId (MAC，主键)
├─ name                            ├─ agentId → 指向智能体
├─ overrides {人设/模型/音色/…}      ├─ nickName（设备别名）
├─ memoryEnabled                   ├─ blocked / notes / otaEnabled
├─ toolDisabled[]                  ├─ lastSeenAt / lastConnectedAt / firmwareVersion
└─ createdAt / updatedAt           └─ createdAt / updatedAt
```

- **记忆按智能体**（`memory/<agentId>.json`）：换一块表说话，它还记得你。
- **历史按设备**（`history/<deviceId>.jsonl`）：音频与消息本来就是设备维度的；
  智能体页的「历史」把绑定设备的会话合并展示（每条带 `deviceId` / `deviceName`）。
- **工具开关按智能体**：`toolDisabled` 在 agent 上，同一智能体的设备共享。
- **OTA / 封禁 / 断开 / 删除设备** 仍是设备级（物理属性）。

## 2. 存储与迁移

`~/.dsh-xiaozhi/agents.json`（0600）：

```jsonc
{
  "version": 1,
  "agents": [
    {
      "id": "6f0c…",                 // randomUUID，服务端生成
      "name": "客厅智能体",           // 智能体自己的名字，与设备别名无关
      "overrides": {                 // 与旧 devices[].overrides 同形状
        "systemPrompt": "你是客厅音箱",
        "model": "",
        "voice": "zh_female_vv_uranus_bigtts",
        "language": "英语",
        "speed": "",
        "silenceMs": 400
      },
      "memoryEnabled": true,
      "toolDisabled": ["web_search"],
      "createdAt": 0,
      "updatedAt": 0
    }
  ]
}
```

`devices.json` 只新增一个字段：`agentId`（空串 = 未绑定）。

**名字模型**：智能体与设备各自命名，**不共用**（对齐参考服务端 `ai_agent.agent_name` /
`ai_device.alias`）。自动建/迁移的智能体默认叫「智能体 1 / 2 …」（`nextAgentName()`），
设备保留自己的 `nickName`；控制台里改智能体名只写 `agents.json`，改设备别名只写
`devices.json`。旧迁移曾把设备昵称抄成智能体名字——`adoptLegacyDevices` 启动时对
「单设备 + 名字 == 设备昵称 + 从未编辑（`updatedAt === createdAt`）」的智能体做一次改名
（返回 `renamed`，幂等），用户改过名/配置的不动。

**启动迁移**（`adoptLegacyDevices`，幂等）：

1. 设备已有 `agentId` 且智能体存在 → 跳过；
2. 否则按设备现有配置建一个智能体（**名字 = 「智能体 N」，不抄设备昵称**），把
   `overrides` / `toolDisabled` / `memoryEnabled` 搬过去，再写回 `device.agentId`；
3. 把 `memory/<deviceId>.json` 复制到 `memory/<agentId>.json`（目标已存在不覆盖）。

设备上的旧字段**保留不删**：回滚旧版本时还能按设备配置跑。

**新设备**（零接触入网）：`DeviceStore.ensureDevice` 创建记录后回调 `store.onCreated`，
index.js 在那里建一个属于它的智能体并绑定——手表第一次连上来就有卡片，和升级前一致。
之后可以在控制台把它绑定到别的智能体（绑定是移动，原智能体可能变成 0 台设备，可手动删）。

**运行时兜底**：`agentOf(device)` 在 `agentId` 为空或智能体不存在时，用设备上的旧字段
拼一个临时智能体视图。所以迁移没跑完、或手改坏了 devices.json，语音链路仍按旧配置工作。

## 3. 控制 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/agents` | 列表；每条带 `devices` / `deviceCount` / `online` / `lastSeenAt` |
| POST | `/agents` | `{name, ...overrides}` 新建 |
| POST | `/agents/update` | `{agentId, name?, systemPrompt?, voice?, language?, model?, speed?, silenceMs?}`；空串 = 删掉该覆盖 |
| POST | `/agents/bind` | `{agentId, deviceId}` 绑定（设备已在别的智能体上 = 移动） |
| POST | `/agents/unbind` | `{agentId, deviceId}` 解绑；设备不属于该智能体 → 400 |
| POST | `/agents/remove` | `{agentId}` **级联删除**绑定设备（含历史与记忆），与参考 `deleteAgent` 一致 |
| GET | `/history/agent-conversations` | `?agentId=&limit=` 合并绑定设备的会话，按 `endedAt` 倒序 |
| GET/POST | `/memory*`、`/tools*` | 接受 `agentId`；兼容旧 `deviceId`（按绑定关系反查） |

兼容入口：`POST /devices/config` 按设备反查智能体后写同一份配置（旧页面/脚本不会 404）；
`/devices/ota|block|disconnect|remove|rename` 不变。

写接口照旧要 `x-dsh-xiaozhi: 1` 头。删智能体是**破坏性**操作：控制台做成二次确认，
提示里带「会一起删掉几台设备」。

## 4. 运行时装配

- `voice.build(device)`：`agentOf(device).overrides` 经 `mergeDeviceConfig` 叠加在全局默认上
  （人设 / 模型名 / 音色 / 语种 / 语速 / 静音）；provider / Key / 端点仍来自全局设置。
- `config.memoryEnabled` 取智能体的；`config.memoryKey = agent.id`，`VoiceSession` 用它读写记忆
  （历史仍用 `deviceId`）。
- 工具：`isDisabled(name, scope)` 的 scope 可以是设备 id（语音链路）或智能体 id（控制台），
  两者都解析到智能体的 `toolDisabled`。
- adapter 缓存 key 已覆盖三段配置 + 设备 overrides；智能体配置改了之后设备重连即生效
  （和旧版一样，运行中的会话不热更）。

## 5. 控制台

- 侧栏与页面标题都是 **智能体**；卡片 = 智能体。
- 卡片：名字（点击改名）、在线点（任一绑定设备在线）、绑定设备列表（`序号. 名称 ●`）、
  音色 / 设备数 / 最近在线，动作：`配置` / `设备(N)` / `历史` / `播报` / `删除`。
- 「配置」弹窗：角色（人设 / 音色 / 输出语种）、模型与记忆（模型名 / 记忆开关 / 记忆列表）、
  扩展能力（工具开关）——全部写智能体。
- 「设备(N)」弹窗：已绑定设备（改名 / OTA / 断开 / 封禁 / 解绑 / 删除设备）+
  未绑定设备（绑定）。绑定/解绑立刻生效（设备下次连接用新智能体的配置）。
- 「历史」弹窗：合并该智能体所有设备的会话，列表项带设备名；清空 = 逐台清。
- 「播报」：发给该智能体所有在线设备；一台都不在线时提示「这个智能体没有在线设备」。
- 「删除」：二次确认（第一次点击变成「再次点击删除」），确认后级联删设备与历史。

## 6. 验收

```powershell
cd D:\Demo\esp-xiaozhi\dsh-xiaozhi
node --test "test/*.test.mjs"      # 全量 216 项必须全绿（2026-11-08）
npm run build && npm run smoke      # 控制台构建 + 冒烟（src/client/** → client.js）
node --check client.js
```

`test/agents.test.mjs` 覆盖：

- 旧设备 → 智能体迁移（配置/工具/记忆开关搬家、记忆文件复制、幂等）；
- 一台智能体绑定多台设备；绑定是移动不是复制；解绑；跨智能体解绑 400；
- 智能体配置共享与改名；记忆/工具接口接受 `agentId`；
- 删智能体级联删设备 + 历史 + 记忆，未绑定设备不受影响；
- 智能体历史合并（每条带 `deviceId`，详情仍按设备取）。
