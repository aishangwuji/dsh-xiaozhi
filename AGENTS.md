# dsh-xiaozhi 项目元信息

> 这是进入本仓库的第一份文件，只放**所有改动都适用的元信息**：项目边界、关键不变量、文档地图、验证入口、当前阶段。
> 具体能力契约在 `docs/`，代码级认知地图在 `systemmap/overview.md`。不要把逐条实现细节写回这里。

## 0. 改动纪律

**改代码 = 改对应的能力文档。** 不要再把细节堆进本文件；本文件只在“元信息”变化时更新。

| 改了什么 | 必须同步 |
|---|---|
| 功能、接口、配置项、数据字段、UI 结构 | 对应的 `docs/<capability>.md`（没有就新建）+ `systemmap/overview.md`；用户可见的变化再改 `README.md` |
| bug、踩坑、排障结论 | `docs/troubleshooting.md`；涉及长期取舍的追加到 `docs/current-state.md` |
| 发布、包名、安装方式 | `docs/release.md` |
| 两个工作副本的同步方式 | `docs/development-workflow.md` |
| 项目边界、关键不变量、文档地图、当前阶段 | 本文件 |

- 同一次改动里更新对应文档；只改代码不更新文档，视为改动未完成。
- **未实测的结论必须标「未实测」**；推断与实测分开写；结论变化时撤回旧结论。
- 新增能力写清四件事：**是什么、入口（文件 + 符号名）、生效条件（重连/重启/重装）、怎么验收**。
- 改完至少跑一遍 §4 的验证入口，结果写进交付说明。

## 1. 项目是什么

**服务端**：DSH 插件，本目录，跑在 DSH 主进程里。两个面不要混：

| 面 | 入口 | 谁在用 |
|---|---|---|
| 设备面 | `0.0.0.0:8989`（插件自己 `net.createServer`，配置项 `host` / `port`） | 手表固件：OTA、语音 WS、`/healthz`、网关 `/health` `/commands` `/exec` |
| 操作台面 | 宿主 Harness 的 `webServer`，前缀 `/dsh-xiaozhi-7c3a`（`control.prefix`） | 控制台页面：`/state`、`/pending*`、`/agents*`、`/devices*`、`/settings`、`/history*`、`/events` 等 |

- 控制 API 不占 8989，端口跟着 DSH GUI 走；**写接口必须带 `x-dsh-xiaozhi: 1`**（CSRF），缺了 403。
- 配置优先级：插件 `cordis.patch.yml` 默认值 → profile 的 `cordis.patch.yml` → 控制台保存的 `settings.json`（运行时叠加）。
- 数据目录 `~/.dsh-xiaozhi/`：`devices.json`、`pending.json`、`agents.json`、`settings.json`、`voice-sessions.json`、`memory/`、`history/`、`voice.log`、`crash.log`。`profiles.json` / `tools.json` 是遗留文件，代码已不读写。

**端侧**：`D:\Demo\esp-xiaozhi\xiaozhi-esp32`，板子 waveshare ESP32-S3-Touch-AMOLED-2.06，target `esp32s3`，分区表 `partitions/v2/32m.csv`（NVS 在 `0x3B000`，840K）。

**链路**：OTA 拿地址 → 唤醒建 WS → hello → 音频上下行。细节见 `docs/protocol.md`。

**分发**：

| 项 | 值 |
|---|---|
| GitHub | `aishangwuji/dsh-xiaozhi`（public，`main`） |
| npm | `@aishangwuji/dsh-xiaozhi`（0.2.0，2026-11-17 起） |
| 安装 | `dsh plugin --profile <p> add @aishangwuji/dsh-xiaozhi`，或 Plugins → Add plugin，或 `add github:aishangwuji/dsh-xiaozhi` |
| 本机 | profile `desktop` 是 `link:D:/Demo/esp-xiaozhi/dsh-xiaozhi`（运行副本 A） |

npm 发布的 2FA/token、stage 占位版本、`unpublish` 限制、pnpm 404 缓存、push 网络与密钥扫描，统一见 `docs/release.md`。

## 2. 关键不变量（改代码前先确认）

1. **两个面不要混**：设备入口始终 8989，控制 API 挂在宿主 `webServer`；不要为了控制台去占 8989。
2. **生效时机**：`settings.json` 保存即生效，但语音 adapter 是**建连时**装配，设备要重连；`index.js` / `src/**` 要重启 DSH；`src/client/**` 要 `npm run build` 后刷新页面；`cordis.patch.yml` 默认值要重启。
3. **数据归属**：记忆按智能体（`memory/<agentId>.json`）、历史按设备（`history/<deviceId>.jsonl`）、工具开关按智能体、OTA/断开按设备。**不要再把配置写回 `devices.json`**（旧字段只读，只做回滚兜底）。
4. **坏文件也要能启动**：`agents.json` / `devices.json` / `pending.json` / `settings.json` 的规范化函数必须容错，坏文件隔离，不要拒绝启动。
5. **绑定模型是 N 台设备 : 1 个智能体**：设备是智能体的麦克风/扬声器；一台设备同一时刻只属于一个智能体（`devices.agentId` 单值）。
6. **`client.js` 是构建产物**：源码在 `src/client/**`，`npm run build` 生成 `client.js`；**必须提交**，不要手改。
7. **新增内置工具改五处**：`src/tools.js` 注册、`src/client/i18n/zh.js`、`src/client/i18n/en.js`、`src/client/core.js` 的 `toolLabel()`、`README.md` 工具表 + 对应 `docs/` + 测试。
8. **新增控制 API**：`src/control.js` 加路由（写接口用 `requireTrustedMutation`）、`src/client/` 加调用入口、`docs/` 补契约、`test/http.test.mjs` 或对应域补测试。
9. **新增服务商**：只改 `src/providers.js` 描述符 + 适配器（OpenAI 兼容 LLM 在 `OPENAI_COMPATIBLE` 加 preset；TTS/ASR 加 adapter 分支）。前端 0 改动；模型 id 从厂商 `/v1/models` 拉，不写死。见 `docs/provider-descriptors.md`。
10. **公开仓库**：push 前扫密钥。不要把任何“看起来像真 Key”的串写进测试或文档；真机 MAC 用 `02:DE:AD:BE:EF:xx` 例示值。
11. **两个工作副本**：`D:\Demo\esp-xiaozhi\dsh-xiaozhi`（运行副本 A）与 `D:\Projects\dsh\dsh-xiaozhi`（工作区副本 B）共用 `origin/main`；一次只在一张副本改，开工先 pull，收工先 rebase 再 push。见 `docs/development-workflow.md`。

## 3. 文档地图

| 文件 | 写什么 |
|---|---|
| `README.md` | 使用者视角：接设备、端点、控制台、内置工具、已知限制 |
| `docs/agent-device.md` | 智能体 / 设备两层模型的契约（存储、迁移、API、运行时装配、控制台、验收） |
| `docs/client-architecture.md` | 控制台运行模型、源码结构、esbuild 构建与冒烟、编码约定 |
| `docs/provider-descriptors.md` | 服务商描述符（`src/providers.js` / `GET /providers` / `SchemaForm`）与加厂商步骤 |
| `docs/backup-providers.md` | 主用 + 备用服务商的存储、`/test/provider`、failover 语义 |
| `docs/providers.md` | 多服务商实现与 UI 细节（含 TTS 服务商池、逐厂商历史） |
| `docs/history.md` | 历史会话 / 消息 / 音频的数据布局、保留策略、控制 API |
| `docs/pill-popover.md` | PillSelect 胶囊浮层规范（fixed 定位、视口 clamp、向上翻转） |
| `docs/voice-role-language.md` | 官方「角色 ↔ 音色 ↔ 语种」查证、音色表与已落地改动 |
| `docs/config-diff-vs-official.md` | 与官方 `xiaozhi-esp32-server` 的配置逐项审计 |
| `docs/dsh-session-backend.md` | 回答来源走 DSH Session 的契约（`voice.backend: session`） |
| `docs/protocol.md` | 一次完整对话、判停（VAD/续话窗口）、mDNS/OTA 地址选择 |
| `docs/testing.md` | 服务端测试命令、不接设备的探针、端侧编译/抓串口/读 NVS |
| `docs/troubleshooting.md` | 联动排障表：现象 → 当时看到的东西 → 实际原因 |
| `docs/current-state.md` | 当前边界、未定项、功能取舍与 UI 历史（原 AGENTS §8） |
| `docs/release.md` | 分发、npm 发布、2FA token、push 网络与密钥扫描 |
| `docs/development-workflow.md` | 两个工作副本的 pull/commit/push 流程 |
| `systemmap/overview.md` | 认知地图：入口点、数据模型、状态机、关键决策与原因（比本文更贴代码） |

## 4. 验证入口

```powershell
node --test "test/*.test.mjs"   # 全量 319 项，必须全绿
npm run build                   # src/client/** → client.js
npm run smoke                   # 真实 React SSR + slot 注册
node --check client.js          # 构建产物语法检查
```

按改动范围追加：

```powershell
npm run check:ui       # 全局设置交互
npm run check:fonts    # 改样式必跑
npm run check:role     # 改角色页必跑
npm run check:devices  # 改设备弹窗必跑
npm run check:card     # 改智能体卡片必跑
npm run check:voice    # 改音色/服务商必跑
```

服务端探针、`voice.log` 事件、端侧编译/串口/NVS 读法见 `docs/testing.md`；排障见 `docs/troubleshooting.md`。

## 5. 当前阶段与边界（摘要）

- 0.2.0 已发布 npm；2026-11-19 新增 `voice.backend: session`（回答来源走一条 DSH 会话，只念最终结论）。
- 判停以设备 `listen stop` 为准，服务端 300ms 续话窗口兜底；`energy` 模式只服务不发 `listen stop` 的老固件。
- mDNS 应答一律先单播给查询方，再补同网段 multicast；查不到才回落云端。
- 全局设置/智能体配置是**下次连接**生效，没有热更新通道。
- 仍有一些真实设备端到端路径未实测（如会话后端延迟、工具/审批卡片体感、固件升级全流程）；具体未实测项见 `docs/current-state.md`。
- 死代码：`src/client/views/CapabilitiesView.js` 无渲染点，按“未接入模块不默认删”保留待评估。

**完整边界、未定项、每个功能的历史取舍都在 `docs/current-state.md`。** 改到边界判断时先读它，不要在代码里重新发明结论。

## 6. 交接检查清单

- [ ] 先读 §0–§2，再按任务跳到对应 `docs/` 能力文档；
- [ ] 确认当前工作副本：运行副本 A（`D:\Demo\esp-xiaozhi\dsh-xiaozhi`）还是工作区副本 B（`D:\Projects\dsh\dsh-xiaozhi`）；
- [ ] `git status -sb` 干净，`git pull --rebase origin main` 到最新；
- [ ] 改动前先确认生效时机（settings / 重连 / 重启 DSH / build + 刷新）；
- [ ] 改完跑 §4 的验证，按 §0 更新对应文档，再 commit + rebase + push；
- [ ] 不要在两张副本同时改；不要把 `node_modules`、`.env`、`*.log`、`*.tgz` 提交进去。
