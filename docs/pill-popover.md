# Pill Popover：胶囊触发器 + 悬浮选择面板

这是小智控制台里所有「替代原生 `<select>`」的选择器使用的 UI 语言（provider / 音色 / 网卡 /
语种 / 模型），记录在这里，方便面板、设备卡片与以后新增的配置项复用同一套交互。
本文件是通用规范；实现见 `src/client/ui/PillSelect.js` / `src/client/ui/menu.js`。

## 一句话定义

**胶囊触发器（pill trigger） + 悬浮命令面板（floating command menu）**：触发器是一枚高度
26px 的全圆角胶囊，点开后在下方浮出一张 14px 圆角、带一层细边和投影的卡片，卡片内是分组标题
+ 胶囊行，选中行右侧打勾。

它属于 **popover**（浮层选择器）这一类，不是：

- 原生 `<select>`：系统弹层无法样式化，与胶囊语言冲突；
- 右键 `ContextMenu`：不依赖指针位置，而是锚定在触发器下方；
- `Dialog` / `Modal`：不抢焦点、不遮罩，点击外部即关闭。

## 适用边界

**适用：**

- 选项较少，约 ≤ 15 条（超出时限制高度并内部滚动，推荐 340px 上限）；
- 需要分组、勾选状态或当前项标识；
- 需要替代原生 `<select>`，并与胶囊式 UI 语言保持一致。

**不适用：**

- 选项很多且需要搜索 → 用「固定头 + 筛选 + 滚动列表」变体；
- 需要多选 → 另做多选面板；
- 破坏性动作 → 需要二次确认，不要放在单击即执行的行里。

## 视觉规格

尺寸为参考值，实际按 UI 密度微调；颜色走设计 token，括号内 fallback 仅用于 token 缺失时兜底。

本插件的 token 前缀是 `--xz-*`（定义在 `src/client/styles.js` 里），语义映射到 DSH 的
`--dsw-alias-*`：背景层 1 = `--xz-surface-strong`、背景层 2 = `--xz-surface-muted` /
`--xz-primary-soft`、边框 L1 = `--xz-line`、浮层背景 = `--xz-surface-strong`、
主/三级文本 = `--xz-text` / `--xz-text-3`、业务主色 = `--xz-primary`、面板阴影 = `--xz-shadow-lg`。

### 触发器

| 属性 | 参考值 / 说明 |
|---|---|
| 高度 | 26px（表单字段内为 32px、全宽，但仍是全圆角胶囊） |
| 圆角 | `999px`（**包括 `.xz-field` 表单字段内**——早期实现曾把字段内改成 12px 方框，已统一回胶囊） |
| 内边距 | `0 26px 0 11px`，右侧留给箭头 |
| 背景 | 背景层 1 |
| 文字 | 11.5px（字段内 12.5px），主文本色，超长省略 |
| 箭头 | 右侧 9px 宽、6px 高的三角形，三级文本色 |
| hover | 交互 hover 背景 |
| 展开态 | 背景层 2 |
| 禁用 | `opacity: .5`，`cursor: default` |

### 面板

| 属性 | 参考值 / 说明 |
|---|---|
| 定位 | **`position: fixed` + 内联 `left/top/width/maxHeight`**（打开时按触发器 `getBoundingClientRect()` 计算）：面板**不参与页面布局**，打开前后 `document.scrollHeight/scrollWidth` 不变，避免整页滚动条出现/消失导致的内容位移。距触发器 6px，默认左对齐；下方空间不足自动向上翻转；左右按视口 8px 边距 clamp |
| 包含块 | fixed 的包含块会被祖先的 `transform/filter/backdrop-filter/perspective/contain:paint` 改变（本控制台 `.xz-card`、`.xz-modal-mask` 都有 `backdrop-filter`）。实现里有 `fixedContainingBlock()` 找最近的这类祖先，把坐标换算成它的局部坐标；**可用空间仍按视口计算**，否则会「该翻转不翻转、菜单落到视口外」 |
| 最小宽度 | 240px（窄视口按 `82vw` 与 8px 边距收缩） |
| 最大宽度 | `min(420px, 82vw)` |
| 最大高度 | 340px，内部滚动 |
| 圆角 | 14px |
| 内边距 | 6px |
| 边框 | 1px 边框色 L1 |
| 背景 | 浮层背景 |
| 阴影 | 面板 elevation |
| 层级 | `z-index: 60`（高于弹窗遮罩 `.xz-modal-mask` 的 40，弹窗内下拉也能正常展示） |

### 分组标题

`9.5px` / `600` / `uppercase` / `letter-spacing: .04em`，三级文本色，内边距 `6px 8px 3px`。
分组由选项上的 `group` 字段驱动：同一 `group` 连续出现时只渲染一次标题。

### 行

| 属性 | 参考值 / 说明 |
|---|---|
| 高度 | 最小 28px |
| 圆角 | `999px` |
| 内边距 | `0 8px` |
| 字号 / 间距 | 12px，`gap: 7px` |
| hover / 键盘聚焦 | 交互 hover 背景 |
| 选中 | 背景层 2 + `font-weight: 600` |
| 勾选图标 | 13px，业务主色，贴右 |
| 右侧提示 `hint` | 10px，三级文本色 |
| 禁用行 | `opacity: .45`，不可点击 |

### 其他部件

- **筛选框**：26px 高胶囊输入框，背景层 1，1px 边框 L2。
- **分组动作**：底部居中的文字按钮（如「子项 4」/「收起」），上方 1px 分隔线，24px 高胶囊，
  文字用业务主色。
- **空态 / 错误**：`padding: 8px 10px`，11px，次要色；错误用删除红色。

## 交互与状态

- 点击触发器切换展开；点击外部（`pointerdown` 捕获阶段）关闭；`Esc` 关闭。
- 选择一行：先关闭，再执行动作；当前项带勾，重复点击同一项不触发动作。
- 触发器上可带计数徽标和图标。
- 列表可超出高度后滚动；带筛选的变体把 Tab + 筛选框固定在顶部，仅列表区滚动。
- 面板打开时监听 `scroll`（捕获）与 `resize` 重新定位；首帧按选项数估算高度，`requestAnimationFrame` 后用实测高度修正一次，避免翻转判断抖动。
- 无障碍：触发器 `aria-haspopup="listbox"`、`aria-expanded`；面板 `role="listbox"`；
  行 `role="option"` + `aria-selected`。

> 布局抖动的兜底：`.xz-app` 与 `.xz-content` 都设有 `scrollbar-gutter: stable`，即使某处
> 仍有滚动条出现/消失，内容宽度也不会跳。配置界面本身也尽量不改变页面高度：全局设置是
> **单页分区**（服务商为主体，无左侧步骤侧边栏/步骤弹窗），设备的「配置」是弹窗（`DeviceConfigDialog`）。

## 变体

1. **普通列表**：provider / 音色 / 语种选择。
2. **分组列表**：按 `group` 渲染标题，如「已配置」/「未配置」。
3. **固定头 + 筛选 + 滚动列表**：选项很多时（分支/模型目录），Tab + 筛选固定在顶部。
4. **表单字段变体**：全宽胶囊触发（`.xz-field` 内 32px，圆角仍为 999px），面板宽度与字段宽度一致。

## 复用清单

- 组件：`PillSelect`、`MenuItem`、`IconCheck`；
- 定位辅助：`fixedContainingBlock()`（处理 `backdrop-filter` 等祖先造成的 fixed 包含块偏移）；
- CSS：`.xz-pillselect`、`.xz-pillselect-trigger`、`.xz-pillselect-chevron`、`.xz-pill-label`、
  `.xz-menu*` 整段；
- 依赖：`React.createElement` 包装（`h`）、`t()` 取文案、`useState/useRef/useEffect`；
- token：`--xz-surface-strong`、`--xz-surface-muted`、`--xz-primary-soft`、`--xz-line`、
  `--xz-text`、`--xz-text-2/3`、`--xz-primary`、`--xz-shadow-sm/lg`。

## 实现索引（dsh-xiaozhi 当前）

| 位置 | 内容 |
|---|---|
| `src/client/ui/PillSelect.js` `PillSelect` | 触发器 + fixed 定位面板（打开测量、翻转、clamp、scroll/resize 重定位） |
| `src/client/ui/PillSelect.js` `fixedContainingBlock` | 找最近的 transform/filter/backdrop-filter/perspective/contain:paint 祖先，换算 fixed 坐标 |
| `src/client/ui/menu.js` `MenuItem` / `IconCheck` | 行（胶囊）与勾选图标 |
| `src/client/styles.js` `.xz-pillselect-trigger` / `.xz-field .xz-pillselect-trigger` | 页面级 26px / 字段内 32px，两者都是 `999px` 胶囊 |
| `src/client/styles.js` `.xz-menu` | `position:fixed`、`z-index:60`、`max-height:340px`、内部滚动 |
| `src/client/settings/ConfigWizard.js` | 全局设置 = 单页分区：服务商（ASR/LLM/TTS 三块）+ 语音默认参数 + 接入与网关 + 底部保存；无人设、无侧边栏（2026-11-07） |

## 已知限制 / 后续可补

- 只支持 `Esc` 和点外部关闭，没有 `↑` / `↓` / `Home` / `End` 键盘导航与首字母跳转；
- 未用 ReactDOM portal：面板仍渲染在触发器 DOM 树内，靠 `position:fixed` 脱离布局；若宿主
  在路径上新增 `overflow:hidden/clip` 的祖先，需要重新验算（当前控制台已实测无裁切）；
- 翻转依赖首帧估算 + rAF 实测修正；极端情况下（打开瞬间选项列表高度变化）会再修正一次，
  可能有 1 帧位置变化；
- 如果以后多个插件复用，建议把组件与 CSS 抽到共享包，而不是各自复制。
