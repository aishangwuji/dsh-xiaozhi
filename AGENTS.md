# dsh-xiaozhi 项目说明

## 0. 改动纪律

改代码 = 改对应的能力文档；本文件只在“元信息”变化时更新。

| 改了什么 | 必须同步 |
|---|---|
| 功能、接口、配置、数据字段、UI | 对应 `docs/<capability>.md` + `systemmap/overview.md`；用户可见的变化再改 `README.md` |
| bug、踩坑、排障结论 | `docs/troubleshooting.md`；长期取舍追加到 `docs/current-state.md` |
| 发布、包名、安装方式 | `docs/release.md` |
| 两副本同步方式 | `docs/development-workflow.md` |
| 边界、私有约束、文档地图、当前阶段 | 本文件 |

- 同一次改动里更新文档；只改代码不更新文档，视为未完成。
- 未实测的结论必须标「未实测」；推断与实测分开写；结论变化时撤回旧结论。
- 新增能力写清四件事：是什么、入口（文件 + 符号）、生效条件、怎么验收。

## 1. 边界

- 小智 ESP32 设备接入 DSH 的插件：设备面（OTA / 语音 WS / 网关）+ 控制台面（宿主 webServer 上的管理页）。
- 只服务局域网里的自有设备；不是公网多租户服务，不做设备账号体系。
- 不改固件仓库 `D:\Demo\esp-xiaozhi\xiaozhi-esp32` 的代码；固件问题去那边处理。
- 不把设备面并进 DSH 的 webServer：设备入口固定 8989，控制台才走宿主 webServer。

## 2. 结构

```
index.js                 apply()、HTTP 路由、DSH agent/工具接入
src/control.js           控制台 API、CSRF、SSE
src/agents.js            智能体存储/迁移/绑定
src/settings.js          全局设置、服务商、密钥掩码
src/voice/               语音管道：session、adapters、ASR/TTS、VAD、device-mcp
src/mcp/                 外部 MCP（stdio/HTTP）与入站 MCP
src/firmware.js          OTA 固件仓库
src/client/**            控制台源码 → npm run build → client.js
build.mjs                esbuild 构建脚本
docs/                    能力契约与排障
systemmap/overview.md    代码级认知地图
```

数据目录 `~/.dsh-xiaozhi/`：`devices.json`、`pending.json`、`agents.json`、`settings.json`、`voice-sessions.json`、`memory/`、`history/`、`voice.log`、`crash.log`。技术债、未接入模块与待评估项见 `systemmap/tech-debt.md`，不要写回本文。

## 3. 项目私有约束

1. **两个面不要混**：设备入口始终 8989，控制 API 挂在宿主 `webServer`；写接口必须带 `x-dsh-xiaozhi: 1`（CSRF）。
2. **生效时机**：`settings.json` 保存即生效，但语音 adapter 是建连时装配，设备要重连；`index.js` / `src/**` 要重启 DSH；`src/client/**` 要 `npm run build` 后刷新页面。
3. **数据归属**：记忆按智能体、历史按设备、工具开关按智能体、OTA/断开按设备；不要写回 `devices.json`。
4. **坏文件也要能启动**：`agents.json` / `devices.json` / `pending.json` / `settings.json` 的规范化必须容错，坏文件隔离。
5. **绑定模型是 N 台设备 : 1 个智能体**；一台设备同一时刻只属于一个智能体。
6. **`client.js` 是构建产物**：源码在 `src/client/**`，`npm run build` 生成，必须提交，不要手改。
7. **新增内置工具改五处**：`src/tools.js`、`i18n/zh.js`、`i18n/en.js`、`core.js` 的 `toolLabel()`、README/对应 docs + 测试。
8. **新增控制 API**：`src/control.js` 加路由（写接口用 `requireTrustedMutation`）、`src/client/` 加入口、`docs/` 补契约、测试放 `test/http.test.mjs` 或对应域。
9. **新增服务商**：只改 `src/providers.js` 描述符 + 适配器；前端 0 改动；模型 id 从厂商 `/v1/models` 拉，不写死。

## 4. 命令与验证

```powershell
node --test "test/*.test.mjs"   # 319 项
npm run build
npm run smoke
node --check client.js
```

按改动范围追加：`npm run check:ui` / `check:fonts` / `check:role` / `check:devices` / `check:card` / `check:voice`。探针、日志与端侧编译见 `docs/testing.md`。

## 5. 踩坑

- **宿主代码不重启不生效**；`client.js` 才是刷新页面生效。
- **配置下次连接生效**：改音色/服务商/模型后，设备不重连会继续用旧 adapter。
- **mDNS 应答必须单播**：只发 multicast 时会被虚拟网卡带偏；现已一律先单播给查询方。
- **TTS 资源族不匹配**会报 `55000000 resource ID is mismatched with speaker`；1.x/2.0 音色不能混选。
- **`client.js` 必须随源码提交**；只 build 不提交，页面还是旧产物。

完整排障表见 `docs/troubleshooting.md`。

## 6. 仓库与发布

- GitHub：`aishangwuji/dsh-xiaozhi`（public，`main`）
- npm：`@aishangwuji/dsh-xiaozhi`，当前 `0.2.0`
- 安装：`dsh plugin --profile <p> add @aishangwuji/dsh-xiaozhi`
- 本机 profile：`link:D:/Demo/esp-xiaozhi/dsh-xiaozhi`（运行副本 A）
- 两张工作副本：A `D:\Demo\esp-xiaozhi\dsh-xiaozhi`、B `D:\Projects\dsh\dsh-xiaozhi`；同步规则见 `docs/development-workflow.md`，发布细节见 `docs/release.md`。

## 7. 文档地图

| 文件 | 写什么 |
|---|---|
| `docs/agent-device.md` | 智能体/设备两层模型契约 |
| `docs/client-architecture.md` | 控制台运行模型、源码结构、构建 |
| `docs/provider-descriptors.md` | 服务商描述符与加厂商步骤 |
| `docs/backup-providers.md` | 主用/备用与 failover 契约 |
| `docs/providers.md` | 多服务商实现与 UI 细节 |
| `docs/history.md` | 历史会话/音频布局与保留策略 |
| `docs/pill-popover.md` | PillSelect 浮层规范 |
| `docs/voice-role-language.md` | 角色/音色/语种对照 |
| `docs/config-diff-vs-official.md` | 与官方配置的逐项审计 |
| `docs/dsh-session-backend.md` | 回答来源走 DSH Session |
| `docs/protocol.md` | 对话链路、判停、mDNS |
| `docs/testing.md` | 服务端/端侧测试与探针 |
| `docs/troubleshooting.md` | 联动排障表 |
| `docs/current-state.md` | 当前边界、未定项、历史取舍 |
| `docs/release.md` | 分发、npm、2FA、push 网络 |
| `docs/development-workflow.md` | 两副本 pull/commit/push |
| `systemmap/overview.md` | 代码级认知地图 |

## 8. 交接检查清单

- [ ] 先读 §1–§3，再按任务跳到对应 `docs/`；
- [ ] 确认当前是运行副本 A 还是工作区副本 B；
- [ ] `git status -sb` 干净，`git pull --rebase origin main`；
- [ ] 确认生效时机（settings / 重连 / 重启 DSH / build + 刷新）；
- [ ] 改完跑 §4，按 §0 的纪律更新文档，再 commit + rebase + push。
