# 当前边界与未定项（详细）

> 本文来自原 `AGENTS.md` §8，保留全部功能取舍、UI 决策与历史原因。`AGENTS.md` 只保留摘要；新增边界或未定项写这里。

- 判停有两套模式并存（`device` / `energy`），`energy` 只服务不发 `listen stop` 的老固件；两套语义在同一份配置里，读配置时容易混。
- 能量 VAD 的 `minSpeechMs` / `vadThreshold` 不是原厂值，原厂是神经 VAD，数值不可直接搬（技术债 TD-6）。
- mDNS 依赖局域网多播；有些路由器/访客网络会隔离，那种情况下设备会落到云端。同机虚拟网卡（VMware/TUN）会让 multicast 出口走错网卡，所以**应答单播是主路径、multicast 只是补充**（2026-11-14）。
- 全局设置与智能体配置都是**下次连接**生效，没有热更新通道。
- 智能体级"选 Harness 厂商就用 Harness 模型"的自动切换已在 2026-11-07 删除：`src/device-config.js` 现在只让智能体覆盖模型名，provider / Key / 端点一律由全局设置决定；`host` 只能由全局 `voice.llm.provider` 显式选择。`/agents/update` 仍接受 `hostProvider`（只校验是不是当前 profile 已注册的厂商），但它**不参与运行时装配**，属于历史字段。
- 联网工具（2026-11-07 起）：`web_search` 固定 `need_content: true`，回传每条结果的正文摘录（单条 ≤900 字、整批 ≤3800 字）；`web_fetch`（DeepSeek Fetch，Markdown 正文 ≤3500 字）。两者都用 DeepSeek Key（LLM 主用不是 DeepSeek 时自动从备用链找），Key 用运行时 getter，保存即生效；没 Key 时 `web_search` 退回 Harness `ctx.web.search`，`web_fetch` 明确报不可用。
- 配置 UI（2026-11-08 改版）：全局设置 = **三个环节概览卡 + 二级弹窗**：
  ① **服务商**（页面主体：ASR/LLM/TTS 三张概览卡——主用厂商 + 摘要 + 密钥/备用数/降级链 + 状态点，
  点「管理」进 `xz-stage-modal`；弹窗里主用卡一整行（`[编辑][测试]` 与状态点在标题行**右侧**）、
  备用纵向列表（**单行三段式**：`序号+厂商+状态` / 摘要 / 右侧 `[编辑][⋯]`；`⋯` 是**贴着按钮的浮层菜单**，
  不再在行内展开——行内展开会把行撑高、下面的行跟着跳，点空白或 Esc 关闭）、底部整行「+ 添加备用服务商」）；
  ② **语音默认参数**；③ **接入与网关**（折叠）。**没有「保存配置」按钮**：任何改动先落本地 state，
  防抖 700ms 自动 `POST /settings`；保存期间又有改动就等下一轮，服务端回写不覆盖刚输入的值。
  底部 sticky 只显示「保存中… / 已自动保存 / 自动保存失败 + 重试」。
  **人设不在全局设置**，只在「智能体 → 配置 → 角色」按智能体设置（`save()` 仍原样透传 systemPrompt，
  不会清掉已存值）；「配置」「设备(N)」「历史对话」都是弹窗（根层渲染，避开 card 的 backdrop-filter）；
  所有下拉是 `PillSelect` 胶囊浮层（`position:fixed`、不撑布局、可向上翻转），规范 `docs/pill-popover.md`。
  **自动保存 + 测试**：未落盘时测试按钮变「保存并测试」，先 `POST /settings` 再按服务端顺序测
  （契约仍是「只测已保存的配置」，只是把两步合成一次点击）；已自动保存时直接测。
- 弹窗尺寸（2026-11-08 修）：控制台 4 个弹窗**一律固定外框**、只有内部区域滚动，不要再退回「max-height + 内容撑开」（父层 `align-items:center`，高度一变标题与页签就上下跳）：智能体配置 `.xz-config-modal` 720×600（页签条固定，只有 `.xz-pane` 滚动）、历史对话 `.xz-history-modal` 920×720、服务商编辑 `.xz-modal-lg` 560×460（表单区滚动）、播报测试 `.xz-inject-modal` 520×320。高度统一写 `height:min(Xpx,86~88vh)` 兜底小视口；切页签 / 换厂商 / 消息增减都不得改变外框尺寸。**例外**：设备管理 `.xz-devices-modal` 用 `max-height:min(560px,86vh)` + 内容自适应高度（2026-11-09 修，设备少时不留大片空白），只有 `.xz-modal-body` 滚动。
- **设备封禁已删除（2026-11-09）**：设备只是智能体的麦克风/扬声器，封禁没有实际价值；已从 `devices.json` 字段、`DeviceStore.setBlocked`、OTA/WS 的 403 校验、控制台按钮、`/devices/block` 路由和 i18n 全部移除。旧 `devices.json` 里的 `blocked` 字段在加载时被忽略，不再拦截设备。
- **智能体卡片改版（2026-11-13）**：卡片 = 名字首字徽标（渐变方块）+ 名字/状态徽标（**未绑定** / 在线 / 离线）
  + 右上 `⋯` 浮层菜单（播报 / 重命名 / 删除智能体；相对卡片绝对定位，点空白或 Esc 关闭），中间三格信息
  （**角色** = 人设命中的角色模板名、没命中显示「自定义」；**模型**；**最近对话**），底部三按钮
  **配置 / 历史 / 设备 (N)**。取舍：设备明细不再铺在卡片里（都进「设备 (N)」弹窗），播报从常驻按钮挪进 `⋯`，
  操作条固定三格。改名仍是点名字就地编辑（`.xz-agent-rename`，28px 高、最多 220px 宽，不撑高卡片）；
  状态点换成文字徽标（`.xz-agent-chip` 的 warn/ok 两态）；动作小图标是内联 SVG（`ACTION_PATHS`），不引图标库。
  **删除改成确认弹窗（2026-11-13 用户要求）**：`⋯` → 「删除智能体」直接弹 `.xz-modal.xz-confirm-modal`
  （标题 + 「确定删除“<名字>”吗？…」+ 取消 / 红色删除），不再「再次点击删除」——菜单点一次就关，
  要求用户重开菜单再点一次既绕又容易误删。弹窗是 AgentsView 内、`.xz-card` 之外的兄弟节点，
  所以 `position:fixed` 的遮罩不会被 card 的 `backdrop-filter` 改变包含块。
  **菜单定位踩过的坑（2026-11-13 实测修）**：一开始用 `position:fixed` + 视口坐标，结果菜单整体偏移、
  还被卡片裁掉——因为卡片外层 `.xz-card` 有 `backdrop-filter`（会成为 fixed 的包含块），`.xz-agent-card` 的
  `overflow:hidden` 又把菜单裁在卡片边界。现在改成 **相对卡片定位**：菜单 inline `position:absolute`，
  坐标由 `getBoundingClientRect()` 换算成「相对卡片」的 `top`/`right`（按钮底 + 6 / 卡片右 − 按钮右），
  下方空间不足 150px 时向上翻成 `bottom`；`.xz-agent-card` 去掉 `overflow:hidden`、底部圆角交给 
  `.xz-agent-actions`。回归守卫 `npm run check:card`（`scripts/check-agent-card.mjs`，jsdom）：断言这两个根因不许回来
  （`.xz-agent-card` 无 `overflow:hidden`、`.xz-agent-menu` 必须是 `absolute`）+ 点开/关闭/重命名入口。**不要再改回 fixed。**
- **智能体重名拦截（2026-11-09）**：`AgentStore.create/update` 用 `assertNameAvailable` 做 trim 后的精确比较，重名抛 `duplicate-name`（HTTP 400）；改名时排除自己。控制台 `callApi` 带 `error.code`，`AgentsView` 把 `duplicate-name` 映射成 `agentNameDuplicate` 提示；新建默认名也改为找未占用的「智能体 N」，避免自动创建撞名。
- **扩展能力卡片（2026-11-09）**：`.xz-capability-name` 占满剩余宽度并单行省略，`.xz-capability .xz-switch` 固定 `margin-left:auto`，所以标签长短不会把开关顶到不同位置；`CapabilitiesView` 复用同一套 class，规则对它同样生效。
- **字体（2026-11-09 修，用户点名）**：中文**只许**走 `--xz-font`（`-apple-system…"Segoe UI","Noto Sans SC","Microsoft YaHei UI","Microsoft YaHei",sans-serif`，本机实测落到 **Noto Sans SC**）；等宽**只给 ASCII**（MAC / IP / URL / JSON），统一用 `--xz-font-mono`（`ui-monospace…Consolas,"Noto Sans Mono CJK SC","Noto Sans SC","Microsoft YaHei",monospace`），这样即使等宽元素里混进中文也不会掉进宋体。**两个已踩的坑**：① 智能体卡片的设备行原本是 `.xz-devcard-mac{font-family:ui-monospace,monospace}`，于是空态「还没有绑定设备」和「1. 手表 ●」实际渲染成 **NSimSun（新宋体）**——已拆成 `.xz-devcard-devices`（sans、12px、`--xz-text-2`、行高 1.8），`AgentsView` 只有这一处用过旧类；② **这台机器的浏览器把 `sans-serif` 映射成 SimSun**，所以任何「继承裸 `sans-serif`」的文字都会变宋体：设备弹窗的 `.xz-hint`（「没有其他设备」）自己没有字体声明，就中招了——已加 `.xz-hint{font-family:var(--xz-font)}`，弹窗内 `.xz-modal-body .xz-hint` 统一 12px / `--xz-text-2` / 行高 1.5。复现方式（实测）：把浏览器字体预设 `sansserif` 改成 SimSun，旧栈 → `Segoe UI + SimSun`，新栈 → `Noto Sans SC`，裸 `sans-serif` → SimSun。回归守卫 `npm run check:fonts`（`scripts/check-fonts.mjs`，真浏览器 + CDP，需要 Edge/Chrome，可 `CHROME_PATH` 指定）**故意把 `sans-serif` 预设改成 SimSun 再跑**：断言「任何探针都不是宋/明体族 + 空态/设备行/弹窗提示/等宽里的中文与正文同字体 + MAC 仍是等宽」，漏一个就 exit 1（两种回归都注入验证过）。
- **待审核设备（2026-11-09）**：`autoProvision: false`（默认）时，陌生 OTA/WS 请求不再直接建档，而是 `src/pending.js` 的 `PendingStore` 写入 `~/.dsh-xiaozhi/pending.json`，返回 `403 device-pending`。控制台「智能体」页顶部显示「待审核设备」，每行可选一个智能体后「批准」（`POST /pending/approve`，`agentId` 为空则自动新建），或「拒绝」（`POST /pending/reject`）。批准后 `DeviceStore.ensureDevice` 建档并 `setAgentId`，设备下一次 OTA/WS 即通过；`GET /state` 带 `pending` 数组，`GET /pending` 单独可查。`autoProvision: true` 恢复旧的零接触自动登记。批准后设备下一次请求才放行；若手表停在错误页，重启/重新唤醒一次。**UI 注意**：待审核卡用 `.xz-pending-card` 关掉 `backdrop-filter`——卡片一旦有毛玻璃就会成为 `PillSelect` 的 fixed 包含块，把下拉菜单裁在卡片底边（2026-11-09 实测只显示一个智能体）。
- **TTS 归属（2026-11-08）**：全局设置 → TTS 合成只配「厂商 + 凭据」（volc = API Key；xunfei = APPID/APIKey/APISecret；edge 免密钥），不配音色 / 模型 / Resource ID / API URL——全局保存时这三项显式清空。音色（= TTS 模型族）只在「智能体 → 配置 → 角色」按智能体选，首项「默认音色」= 不覆盖，留空 = 厂商默认（`src/voice/voices.js` 的 `DEFAULT_TTS_VOICES`：火山 `zh_female_vv_uranus_bigtts` / Edge `zh-CN-XiaoxiaoNeural` / 讯飞 `xiaoyan`）；`resolveTtsVoice` 负责空音色→厂商默认、跨厂商残留→回落本厂商默认、自定义 ID 原样保留。智能体级音色只覆盖主用，备用 TTS 条目只存凭据、运行时用各自厂商默认音色。**输出语种同样只在智能体「角色」页**（全局设置里的那一项已删除，2026-11-08），同一智能体的设备共用；`cordis.patch.yml` 的 `voice.tts.language` 仅作服务端兜底。
  **TTS = 服务商池 + 智能体级选择（2026-11-14 定稿）**：全局 TTS **不再分主用/备用、不排序**，只是一个
  平铺的「已配置服务商」清单（添加/编辑/删除；第一行仍是「智能体没选时的默认」，但不叫主用）。
  用哪家、哪个音色在「智能体 → 配置 → 角色」选（`overrides.ttsProvider` + `overrides.voice`）；其余已配置
  服务商自动按列表顺序做降级。运行时由 `prioritizeTtsProvider()` 在**条目层**重排：把该厂商条目的整套
  凭据提为首选、原默认整套降为备用（只改 `provider` 字段会变成「厂商对、Key 是别家的」）。保存边界
  校验厂商确已配置（400 `invalid-tts-provider`），换服务商时前端把音色重置为默认，避免跨厂商残留。
  LLM / ASR 仍是「主用 + 备用 + 上移/下移/设为主用」的旧形态，不要顺手改掉。
  服务商池的**视觉**：一张白卡里排「首字徽标 + 名称/密钥 + 文字链（编辑/测试/删除）」，
  不用三颗描边按钮；TTS 弹窗带 `is-pool` 类，高度随内容收缩（`height:auto;max-height:min(640px,88vh)`），
  避免几行下面一大片空白；池内不再渲染第二行 `ttsVoicePerDevice` 提示（顶部 `xz-pool-hint` 已覆盖）。
- **设备侧 MCP / IoT（2026-11-08 首阶段）**：`src/voice/device-mcp.js` 在 hello 的
  `features.mcp===true` 后发 `{type:'mcp',payload:{jsonrpc,id,method}}`（initialize id=1、
  tools/list id=2、tools/call 从 3 起），工具名按官方 `sanitize_tool_name` 清洗并映射回原名；
  `src/voice/device-iot.js` 处理设备 `{type:'iot',descriptors|states}`，把属性/方法注册成
  `get_<device>_<property>` / `<device>_<method>`，控制回 `{type:'iot',commands:[...]}`。
  `VoiceSession` 把这两类动态工具与内置工具合并（同名内置优先），`close()` 拒绝未完成 MCP 调用。
- **外部 MCP server / 接入点（2026-11-08）**：`src/mcp/stdio-client.js`（stdio）+ `src/mcp/http-client.js`
  （SSE / Streamable HTTP）+ `src/mcp/ws-endpoint-client.js`（MCP 接入点）+ `src/mcp/manager.js`；
  server 配置 `~/.dsh-xiaozhi/mcp_servers.json`，接入点配置 `mcpEndpoint`（顶层或 voice 下）；
  启动时异步连接、initialize/tools/list，工具并入 `toolRegistry`（控制台 `catalog` 也能看到）。
- **入站 `/mcp`（2026-11-08）**：`src/mcp/inbound.js`（`InboundMcpChannel` / `InboundMcpRegistry`）+
  `src/ingress.js` 的 `/mcp` 路由；配置 `mcpToken`（留空不开放），连接 URL
  `ws://<host>:8989/mcp?token=<mcpToken>&agentId=<可选>`。服务端驱动裸 JSON-RPC
  initialize(id=1) / notifications/initialized / tools/list(id=2) / tools/call(id>=3)，
  工具按 agentId 聚合、同名加前缀，并入 `toolRegistry`。**官方 Python 版工具已全部覆盖**。
- **服务端插件工具（2026-11-08 第二批）**：`src/tools.js` 新增
  `get_news_from_newsnow`（NewsNow 公共 API，`voice.tools.newsnow`）、
  `get_lunar`（`Intl` 中国农历，只给农历/干支/生肖/星期）。
- **get_weather 已下掉（2026-11-09，用户要求）**：天气要先配 QWeather API Key，用户明确不配、不用。
  已删：`src/tools.js` 的 `get_weather` 注册（含城市查询 + `3d` 预报两段）、`src/client/core.js` 的
  `toolLabel` 映射、i18n `toolWeather`（zh/en）、`index.js` 对 `voice.tools.weather` 的解析、
  `cordis.patch.yml` 的 `weather:` 段、README 工具表行与配置说明、
  `docs/config-diff-vs-official.md` 的计数（14→13）。
  `test/tools-extra.test.mjs` 改成**反向断言**「注册表/catalog 里都不应再出现 get_weather」，防止被加回来。
  旧 `settings.json` 里若手写过 `voice.tools.weather`，现在**不读取也不报错**（留作回滚痕迹）。
  问天气现在只能走 `web_search`（DeepSeek Search，按次计费）；要恢复天气工具，先回答 Key 从哪来，
  再按「注册 + toolLabel + i18n + README + 文档 + 测试」六处一起加，别只加注册。
- **退出意图（2026-11-08）**：`handle_exit_intent` 返回 `{action:'close', response:say_goodbye}`；
  `VoiceSession` 直接播告别语、跳过后续模型续写，`AudioPlayer.whenDrained()` 等最后一条
  `tts stop` 发出后调 `close()`，`onClose` 由 ingress 关 WS（`connection.close(1000,'exit intent')`）。
- **HASS / RAGFlow（2026-11-08）**：`src/tools.js` 在 `voice.tools.hass` / `voice.tools.ragflow`
  配置齐全时注册 `hass_get_state` / `hass_set_state` / `hass_play_music` /
  `search_from_ragflow`；HASS 走 `/api/states` 与 `/api/services/*`，RAGFlow 走
  `/api/v1/retrieval`。未配置时**不注册**，不会给模型一堆“未配置”工具。
- **call_device（2026-11-08）**：`voice.tools.callDevice.url/secret` 配置齐全时注册，
  用当前 `deviceId` 作 `callerMac` 调 manager `/device/address-book/call`。
- **change_role 已下掉（2026-11-09，用户要求）**：角色只由控制台「智能体 → 配置 → 角色 → 人设」
  配置（改的是 `agents.json` 的 `systemPrompt`），语音侧不再有切换角色的工具——原来的
  `change_role` 会临时改本会话人设，和「角色只在管理台配」冲突，而且前端没有角色下拉做配套。
  已删：`src/tools.js` 的 `change_role` 注册与 `ROLE_PROMPTS`、`toolLabel` 映射、i18n
  `toolChangeRole`（zh/en）、README 工具表行、`docs/config-diff-vs-official.md` 的计数（15→14）。
  `test/tools-extra.test.mjs` 改成**反向断言**「注册表里不应再出现 change_role」，防止被加回来。
  **角色模板（2026-11-09 建，2026-11-10 换文案）**：控制台 `src/client/agents/rolePresets.js`
  （`ROLE_PRESETS` / `rolePresetPrompt` / `matchRolePreset`），在「智能体 → 配置 → 角色」的「人设」
  标签右侧做成 `PillSelect` 下拉（默认「自定义（不改动）」）；选中即把人设整段替换，之后仍可手改，
  手改后下拉回落「自定义」（`matchRolePreset` 用整段精确比较）。
  **文案不许自创（用户明确要求）**：现在的五段逐字来自**原服务端**——`xiaozhi-esp32-server` 的 manager
  种子数据 `main/manager-api/src/main/resources/db/changelog/202504092335.sql` 里 `ai_agent_template`
  表的模板（湾湾小何 / 星际游子 / 英语老师 / 好奇男孩 / 汪汪队长）。基准文件
  `test/fixtures/role-presets.json`（从 SQL 导出，**不要手改**），`npm run check:role` 与
  `test/role-presets.test.mjs` 双向逐字比对，改一个标点就红；要同步原服务端就重新导出生成。
  五段都含 `{{assistant_name}}`，控制台填入时换成智能体自己的名字。
  （2026-11-10 的前一版误从 `xiaozhi-golang-src` 的 lingxi NPC 抄过三段，已按用户要求撤掉。）
  **纯前端**，不注册工具、不改语音链路；交互回归 `npm run check:role`（`scripts/check-role-preset.mjs`，jsdom）。
  **保留**：`src/voice/session.js` 的 `action === 'change_prompt'` 处理（当前无工具产出，留作
  未来角色类工具/入站 MCP 的协议位；不要因为“没人产出”就删——删了要同步改协议文档）。
  智能体记录里残留的 `toolDisabled: ['change_role']` 无害（判定只是查集合）。
- **play_music（2026-11-08）**：`voice.tools.music.dir` 存在时注册；`src/voice/music.js`
  用 ffmpeg 把本地 mp3/wav 解码成 24k 单声道 PCM，再走 `encodeSpeech` → `AudioPlayer`；
  播放前先用 TTS 说「正在为您播放《…》」，文件帧与 TTS 共用同一条 player/`tts stop` 收尾。
  目录不存在时**不注册**；单曲上限 300 秒。`test/music.test.mjs` 用 ffmpeg 解码一段生成的 WAV
  验证 PCM 通道（真实手表播放未实测）。
- **音色列表来源（2026-11-13 定稿：只有内置清单）**：`GET /voices?provider=…` 直接回
  `src/voice/voices.js` 的 `VOICE_OPTIONS`（2026-11-14 按各家官方清单重建：火山 241 = 2.0 146 + 1.x 95 / Edge 14 / 讯飞 11 / 百智云 10 / DeepSeek 2），`source:'catalog'`；
  前端再按资源族过滤（`voicesForResource`，1.x/2.0 混选会 55000000）。
  **官方 `ListSpeakers` 已整段删除**（`volc-sign.js` / `volc-speakers.js` 与两个测试一起删）：它要的是
  AccessKey（`AKLT…`），与语音控制台 10 位数字 **AppID**、以及合成用的 `X-Api-Key` 是三套不同的凭据；
  把 AppID 填进 AK 字段只会得到网关错误 `InvalidClientTokenId 100009 / The security token[...] is invalid`。
  **不要再加回来**，除非同时解决「AK / AppID / API Key 三者的字段区分」。
- **ASR/TTS 表单必填项（2026-11-08 核对官方鉴权）**：火山新版控制台 TTS/ASR 只需 **`X-Api-Key` +
  `X-Api-Resource-Id`**（TTS 默认 `seed-tts-2.0`、ASR 默认 `volc.seedasr.sauc.duration`），不需要
  APPID/AccessKey；讯飞 = **APPID + APIKey + APISecret**（三者都必填）；Edge / 本地 SenseVoice 免密钥。
  `SchemaForm` 用 `*` 标必填，`commitEditor` 拦空并提示；其余字段留空走厂商默认。
- 控制台滚动（2026-11-07 修）：宿主面板高度不固定，`.xz-app` 由 JS 按「视口高度 - 顶端偏移」量测并设 inline height（`Console` 里的 effect，resize/view 切换时重算），`.xz-main` 加 `min-height:0;overflow:hidden`，`.xz-content` 成为唯一滚动容器（`flex:1 1 auto;min-height:0;overflow-y:auto`）。**不要再依赖宿主页面滚动**：单页配置变长后宿主不会替我们滚，表现为整页滑不动。
- 对话历史（2026-11-07 起，2026-11-08 起按智能体合并展示）：控制台「智能体 → 历史」= 绑定设备的会话合并列表 + 消息气泡 + 音频播放/下载。存储 `history/<device>.jsonl`（每条消息一行，`session` = 一条 WS 连接的 session_id）+ `history/audio/<device>/<audioId>.wav`（用户 16k / 助手 24k）。文本每设备 5000 条、音频 30 天 + 500MB 上限、单条 120s 截断；旧 `{at,user,assistant}` 行按 10 分钟间隔迁移成 legacy 会话（无音频）。写盘是 fire-and-forget，失败只 warn，不影响语音。契约 `docs/history.md`。
- **死代码**：`src/client/views/CapabilitiesView.js`（原独立「能力」页）仍存在但**已无渲染点**，`navCapabilities` 文案同样未接（页签已并入「智能体 → 配置 → 扩展能力」）。按"未接入模块不默认删"处理：保留原状并登记为待评估，清理要单独确认。
- 手表固件当前的本地改动：设备端判停（`application.cc/h`）、OTA 候选顺序 + mDNS（`ota.cc/h`、`Kconfig.projbuild`、`idf_component.yml` 里的 `espressif/mdns` 依赖）、以及 `sdkconfig` 里的 `CONFIG_OTA_URL_LAN`（已置空）。
- DSH 自己每次重启会换 GUI 端口，但设备入口始终是 8989；控制 API 前缀跟着插件配置走，不跟着 GUI 端口走。
- **表情跟随（2026-11-14）**：设备端 21 张表情图（`custom/emoji/chibi-maid_240/*.png`，名字与
  `noto_emoji.h` 的规范名一致）本来就支持服务端下发情绪，缺的是我们不发。现在按原服务端的做法补上：
  ① 系统提示词（`index.js` 的 `SHORT_REPLY_RULE`）要求**每条回复第一个字符**是 21 个之一的表情符号；
  ② `src/voice/emotion.js` 的 `EmotionFilter` 在流式文本里取出开头 emoji（能接住被 SSE 拆成
  `\uD83D` / `\uDE42` 两半的 emoji），映射成规范名，并把正文里的 emoji 全部清掉（不进 TTS、不进历史）；
  ③ `src/voice/session.js` 的 `#answer` 每轮只在第一次识别到时 `sendJson({type:'llm',emotion})`，
  固件 `application.cc` 的 `llm` 分支收到后 `SetEmotion()`，表情和 TTS 一起出来；
  ④ 模型没按约定开头时**不发** emotion（设备保持当前表情），不做关键词猜测；trace 记 `emotion.send`。
  生效：改代码重启 DSH，改提示词只影响下一轮。验收：`test/emotion.test.mjs` 6 项 + `voice.log` 的 `emotion.send` + 手表屏幕表情。
- **空回合后继续捕获（2026-11-15 实测修）**：设备判停模式下，设备发完 `listen stop` 仍停在
  Listening，**不一定重发 `listen start`**；旧逻辑在这个空回合（或 ASR 失败）后把 `capturing`
  关掉，用户接着说的话被整段丢弃，表现成「有时候说话触发不了」。现在 `#resumeCaptureAfterEmpty()`
  在空回合/ASR 失败后重新开捕获（trace `capture.reopen`）。注意：**正常回答**之后不要这样做——
  那时设备会进 Speaking，继续捕获会把 TTS 回声喂给 ASR。
  实测证据：12.6s 的采集里前 10s 是 -60dB 底噪、末尾几处敲击声，DeepSeek ASR 返回空（`duration 0`）；
  这是**音频里确实没有语音**，不是阈值被调高。
- **工具提示与失败兜底（2026-11-15）**：① 每次工具调用前发 `{type:'tts',state:'sentence_start',text:'% <工具名>'}`，
  固件 `application.cc` 的 `ToolCallNoticeLabel` 会把它转成「联网搜索中... / 调音量中...」的系统气泡（不朗读）；
  trace 记 `tool.notice`。② 工具抛错（参数缺 `query`、超时等）不再让整轮哑掉：错误作为 `role:"tool"` 回灌给模型，
  下一轮它可以改参数或换说法，trace 记 `tool.error`。③ 模型只回一个 emoji（或被过滤后没有正文）时用
  「嗯？我在呢，你再说一遍？」兜底，trace 记 `llm.empty`；LLM 抛异常时也播一句「抱歉，我这边出了点问题…」。
  回归：`test/turn-guard.test.mjs` 8 项。生效：重启 DSH（服务端改动，固件不动）。
- **唤醒开场白 + 播放中打断（2026-11-15）**：① 固件唤醒后本来就会发
  `{type:"listen", state:"detect", text:<唤醒词>}`（`application.cc` 的
  `SendWakeWordDetected`，Kconfig `SEND_WAKE_WORD_DATA` 默认 y）；原服务端把它当用户
  第一句话直接回答。现在 `session.js` 的 `handleListen` 收到 detect 且有 text 就
  `#answer(text)` 回一句开场白，不需要用户说唤醒词后再说第二句；开场白期间设备补发的
  `listen start` 记为 `pendingListenStart` 并压下（trace `listen.start.skipped`），
  结束后再开 ASR，避免把 TTS 回声当用户说话。② 播放/思考中插话：VAD 判到说话会
  `#interrupt(barge-in)`，现在同时把 `capturing` 置 true 并立刻开 ASR 流——旧逻辑
  只开流不开捕获，打断后的音频会被 `#onPcm` 丢掉（表现成「它说话时我说不进去」）。
- **播放期打断真正生效（2026-11-17）**：以前 `#answer` 把句子排进播放队列后立刻把
  `state` 置回 `listening`，而队列比播放快得多；结果**播放期间**收到的 `abort` 与 VAD
  barge-in 都被 `#interrupt` 的「state 必须是 speaking/thinking」门挡掉，设备把已排队的
  音频播完（表上表现为「按了停还是说个不停」）。现在收尾链 `await player.whenDrained()`
  再回落状态，`AudioPlayer.abort()` 也 `#resolveDrained()`（否则队列被清空后那条
  `tts stop` 永不发出，等待方会永远挂住）。回归：`test/voice-e2e.test.mjs` 的 abort 用例
  断言 stop 的 `reason === 'client abort'`（自然收尾不带 reason），不再依赖墙钟。
- **TTS 流式下发（2026-11-16）**：以前 `#speakSentence` 等整句 TTS 收齐再 `encodeSpeech`，
  首包 = 整句合成时间（实测 Edge 1.28–1.50s，是端到端预算主要项）。现在：① `codec.js`
  新增 `createOpusStreamEncoder`（一句一个 ffmpeg，`-page_duration 60000` + `-flush_packets 1`，
  否则 Ogg 页默认攒 1s 才吐）；② `ogg.js` 新增 `createOggOpusStreamDemuxer`（跨页/任意字节切分的
  增量解复用）；③ `session.js` 的 `#speakSentenceStreaming` 在第一个 Opus 包到达时才发
  `sentence_start`，边收边入队；④ `adapters/failover.js` 的 TTS 从「整句缓冲」改成「流式放行、
  首包前可换家」——已出过音频再换家会重念半句，所以带 `dshNoSwitch` 直接抛给会话层（与 LLM 契约一致）。
  没有 `createStreamEncoder` 的注入/测试仍走旧的整句路径。trace：`tts.stream.first` /
  `tts.stream.done` / `tts.stream_error`。实测（本地，真实 ffmpeg + 20ms/包的模拟 TTS）：首帧 254ms。
- **OTA 固件升级通道（2026-11-16）**：① `src/firmware.js` 管 `~/.dsh-xiaozhi/firmware/`（`index.json`
  + 一个现役 `.bin`，上限 16 MiB，只保留最新一份；非法名/路径穿越在仓库层拒绝）。② 控制台上传
  `POST /firmware/upload`（原始二进制体，`x-firmware-name` / `x-firmware-version` 头，CSRF），
  带版本号时顺手写进 `settings.firmware.version`；`GET /firmware` 返回文件信息与各设备当前版本；
  `POST /firmware/remove` 删除。③ 设备面 `GET /firmware/<name>` 返回 `application/octet-stream`；
  OTA 响应的 `firmware.url` 按请求 `Host` 拼绝对地址（换网段不用改配置）。④ `handleOta` 会读请求体
  `application.version` 写进设备名册（头里通常没有），没有升级包时版本回落为设备当前版本/0.0.0，
  避免「提示有新版本但 URL 为空」的升级失败。⑤ **`force` 必须发数字 `1/0`**：固件 ota.cc 用
  `cJSON_IsNumber(force) && valueint == 1` 判定，JSON 布尔 `true` 会被忽略。
  验证：`test/firmware.test.mjs` + `test/http.test.mjs` 的 OTA/上传/下载/force 用例；真机升级流程未实测。
- **错误气泡 + session_id（2026-11-16）**：① ASR / LLM / TTS 失败不再发 `stt {text:''}`（固件会按用户
  消息建一个空气泡），改发 `{type:'alert', status, message, emotion}`——固件 `application.cc` 的
  `Alert()` 会显示系统气泡 + 表情 + 状态栏文字（不是朗读内容）。ASR 失败后照旧重开捕获
  （`#resumeCaptureAfterEmpty`），TTS 失败每轮只提示一次。② `VoiceSession` 的 sink 给所有下行 JSON
  自动补 `session_id`（值 = hello 里下发的会话 id）；测试里没传 `sessionId` 的会话不加，避免旧断言
  被迫改写。回归：`test/turn-guard.test.mjs` 3 项。
- **设备工具可见性（2026-11-16）**：设备侧 MCP 工具以前只在 LLM 工具表里，控制台看不到。现在
  `DeviceMcpClient.catalog()` 暴露只读目录（清洗后的 `name` / `originalName` / `description` /
  `parameters`），`VoiceSession.deviceTools()` 返回 `{ ready, tools }`；控制台 `GET /devices/tools?deviceId=`
  按需拿在线会话的目录（离线返回 `online:false` + 空数组，缺 `deviceId` 400、未知设备 404）。
  「管理设备」弹窗每台绑定设备多一个「设备工具 ▼」按钮，展开显示 MCP 上报的工具；执行仍走
  `callTool` 的原始名映射，目录不参与执行。真机工具列表未实测（依赖设备在线完成 MCP 握手）。

- **DSH 会话后端（2026-11-19）**：回答来源多了一条 `session`——不再由插件直连模型，而是把这句话
  送进一条 DSH Session（DS-Bot 的 Bot 也是普通 Session，绑同一个 sessionId 即可），只念这一轮的
  **最终结论**。四件事：
  - **是什么**：`voice.backend`（全局，默认 `llm`）+ 智能体 `overrides.backend`（`llm` / `session` /
    空=跟随全局）+ `overrides.sessionId`（空 = 首次连接自动建并记在 `voice-sessions.json`）。
  - **入口**：`src/host-session.js` 的 `createSessionBridge`（`ctx.sessionController` + `ctx.on('session/event')`）、
    `src/voice/adapters/dsh-session.js` 的 `createDshSessionLlm`（与 `host-llm.js` 同接口，只有 `stream`，
    不实现 `streamWithTools`）、`src/session-bindings.js` 的 `SessionBindingStore`、`index.js` 的
    `backendFor` / `pinnedSessionFor` / `ensureVoiceSession`。控制 API：`GET /sessions`（只读，最近 60 条，
    过滤子代理会话）、`POST /agents/update` 新增 `backend` / `sessionId`（坏值 400：`invalid-backend` /
    `invalid-session-id`）。控制台在「智能体 → 配置 → 模型与记忆」顶部。
  - **生效条件**：保存后**设备下一次连接**生效（adapter 缓存 key 已带 backend / agentId）；改代码仍要重启 DSH。
  - **语义与边界**：会话模式下 `toolsEnabled` / `memoryEnabled` / `memoryKey` 一律关掉/清空（工具与记忆
    由会话负责，插件再塞一份会打架）；`sessionPrompt` 为空；用户话前面拼一段 `[语音通道]…` 指令
    （`voice.session.instruction` 可覆盖）。只念「这一轮最终那条没有 tool-call 的 assistant 消息」，
    工具步骤里的过程文字丢弃；`toSpeech()` 去掉 Markdown/代码块并按句末截断（`voice.session.maxChars`，
    默认 600）。用 `source.rpcId` 把 prompt 与 `user/message` 对上，`turn/end` 收口；打断 → `cancel`，
    超时（`voice.session.timeoutMs`，默认 120s）→ 也 `cancel` 并抛错（由会话层播兜底话术）。
    **未实测**：真实手表 → 会话的端到端延迟、会话里工具/审批卡片对语音的体感、DS-Bot Bot 回复长文时的
    截断效果；`host-llm` 与 `session` 两种后端的 A/B 延迟数据也还没采。
- **回答来源的取舍（2026-11-19，用户确认）**：DS-Bot 不是可注入的后端服务，它的 Bot 就是一条 DSH
  Session；所以接的是「DSH 会话」，不是「DS-Bot 插件」。不要为了接 DS-Bot 去读它的 `state.json`
  或调 `POST /api/bot`（浏览器 cookie 鉴权、Bot 换 part 后 sessionId 会变）——那是耦合，不是集成。
- **Bot = DSH 会话（2026-11-20，用户确认方向）**：控制台的「智能体」按 **Bot** 理解：一个 Bot
  一条长期会话，手表/家里端侧设备只是它的麦克风与扬声器；一人一个 Bot 或全家共用一个都行。
  文本聊天界面直接用 DSH 自己的会话页（不重复造 UI），插件控制台只做 Bot/设备/音色管理。
  - **原话直送**：默认不拼 `[语音通道]` 前缀，会话里看到的就是用户原话；需要时用
    `voice.session.instruction` 显式加。
  - **只念最终结论 + 总结式**：最终 assistant 消息先经 `createSpeechSummarizer`
    压成 2–3 句（额外一次无工具调用，默认开、有超时），失败/太短回落 `toSpeech()`。
  - **过程可见**：`tool/call` → 设备气泡 `% 工具名`；同时按工具名念一句进度；长任务
    `heartbeatMs` 心跳；摘要前念「我整理一下」。进度话术不进最终正文/历史。
  - **语音审批 / 提问**：`approval/request` 与 `user-questions/request` 都是前置监听；只接
    「绑在有在线设备的 Bot 上、且设备正在 `thinking`/`speaking`」的会话（桌面发起的 turn 不抢）。
    审批念原因、收「允许/拒绝」；提问逐题念题和选项，按标签/序号映射，多选按顿号/和拆开。
    含糊/超时/异常 `next()` 交回桌面卡片。
  - **会话服务惰性解析（2026-11-23 修）**：插件 `apply()` 早于 `sessionController` 挂载，
    原来构造时取一次句柄 → `session.available` 永远 false、设备一说话就报「会话服务未装配」。
    现在每次调用重新 `ctx.get('sessionController')`，事件订阅也不再依赖 `available`。
  - **每个 Bot 一个工作目录**：`~/.dsh-xiaozhi/voice-sessions/<agentId>/`（`voice.session.cwd`
    显式配置时共用）；新建 Bot 默认 `backend=session`。
  - **控制 API**：`POST /agents/session` 的 `new` / `auto` / `bind`；`GET /agents` 带
    `session: { id, available, running }`。
  - **未实测**：真实手表端到端延迟、摘要耗时、审批/提问语音。
  - **取舍**：不读 DS-Bot `state.json`；以后若启用 DS-Bot，用「绑定已有会话」手工接，
    或补只读适配器。
