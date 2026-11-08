# 控制台客户端：运行模型、源码结构与构建

> 本文是 `client.js` 这一层的契约（2026-11-08 起）。改动控制台 UI、加组件、加文案、
> 排查"页面没更新"之前先读。服务端契约见 `docs/agent-device.md` / `docs/backup-providers.md`。

## 1. 宿主怎么加载客户端

产物必须长这样（`build.mjs` 负责生成）：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-xiaozhi',
  factory(require) {
    // ...
    return DshXiaozhi   // { inject: [...], apply(ctx) }
  }
});
```

约束（来自 DSH 的 UI 插件规范）：

- **单文件产物**：宿主只读 `package.json` 的 `exports["./client"]`（`client.js`），按原样执行；
  没有 ESM import、没有 npm 解析、没有构建期 hook。
- **React 由页面模块表提供**：`require('react')` 是 baseline，插件不能自带第二份 React，
  也不该从 CDN/UMD 找。`dsh.client.external` 只能声明"页面已经提供的模块"。
- **slot 收 React 组件**：`ctx.slots.register({ name: 'main', key: 'xiaozhi' }, XiaozhiPanel)`、
  `sidebar.panellist` 注册图标 + `label()`；宿主用 React 渲染。
- **副作用放在 `apply` 里**：样式 `<style>`、locale 字典、事件监听都用 `ctx.effect` 注册并返回清理。

### 能不能用 Vue？

**不能直接用**：页面模块表里没有 `vue`，`require('vue')` 会失败；`dsh.client.external` 也变不出
一个页面没提供的框架。

技术上可以走"自带 Vue"：把 Vue 打进 `client.js`，在 React slot 组件里用 `useRef + useEffect`
挂 `createApp(Root).mount(el)`，卸载时 `app.unmount()`。代价是双框架、包体 +60~100KB、
生命周期/事件/主题/locale 都要桥接；对这个页面（表单 + 卡片 + 弹窗）收益不大。
**当前决定：保留 React**，用多文件 + 构建解决"单文件难维护"，而不是换框架。

## 2. 源码结构

`client.js` 是构建产物，**不要手改**；源码在 `src/client/`：

| 路径 | 内容 |
|---|---|
| `src/client/index.js` | 入口：`__ModuleLoader__` 注册、`apply(ctx)`、两个 slot、样式/locale/音色目录 |
| `src/client/react.js` | 从 `require('react')` 取 `h` / hooks 的唯一出口 |
| `src/client/core.js` | 常量（`NS` / `API` / `POLL_MS`）、`PROVIDER_CATALOG`、`t()` 绑定、`callApi`、格式化、备用卡片辅助、`toolLabel` |
| `src/client/i18n/zh.js` / `en.js` | 中英文案（两边键必须对齐） |
| `src/client/styles.js` | 全部 CSS（`apply` 里插 `<style>`） |
| `src/client/ui/` | `Icon` / `PillSelect` / `menu`（`MenuItem`、`IconCheck`）/ `primitives`（`Badge`、`Metric`、`EndpointRow`） |
| `src/client/views/` | `Dashboard`（概览）、`CapabilitiesView`（已无渲染点，保留待评估） |
| `src/client/agents/` | `AgentsView`、`AgentConfigDialog`、`AgentDevicesDialog`、`HistoryDialog` |
| `src/client/settings/` | `ConfigWizard`（全局设置页）、`ProviderSection`、`ProviderDialog`、`ModelField` |
| `src/client/console/` | `Console`（导航/滚动外壳）、`XiaozhiPanel`（面板根组件） |
| `build.mjs` | esbuild 构建脚本 |
| `scripts/smoke-client.mjs` | 冒烟：产物加载 + slot 注册 + 主要组件 SSR 渲染 |

## 3. 构建

```powershell
npm run build    # src/client/** → client.js
npm run smoke    # 冒烟
```

`build.mjs` 的关键点：

- `bundle: true`、`format: 'iife'`、`globalName: 'DshXiaozhi'`；
- `external: ['react']`：产物里保留 `require("react")`，由 factory 参数解析（页面模块表）；
- banner/footer 把 IIFE 包进 `window.__ModuleLoader__.load({ id, factory(require) { ... } })`，
  footer `return DshXiaozhi;`；
- `platform: 'browser'`、`target: 'es2022'`。

开发依赖只有 `esbuild`（构建）与 `react` / `react-dom`（冒烟用真实 React 做 SSR）；
运行时 React 仍来自宿主，`client.js` 里不含 React。

## 4. 冒烟测试

`scripts/smoke-client.mjs`：

1. 用 `vm` 执行 `client.js`，截获 `window.__ModuleLoader__.load`；
2. 调 `factory(require)`，`require('react')` 返回真实 React，断言拿到 `{ inject, apply }`；
3. 用桩 `ctx` 跑 `apply`，断言 `main` / `sidebar.panellist` 都注册了；
4. 用 `react-dom/server` 渲染 `Console`、`AgentsView`、`ConfigWizard`、`ProviderSection`、
   三个弹窗——抓渲染期的 undefined / 拼错名字。

它不替代浏览器验收（样式、交互、定位仍需人眼），但能在不重启 DSH 的情况下拦住大部分改崩。

## 5. 编码约定

- 组件里**不要**直接 `import react`，统一 `import { h, useState, ... } from '../react.js'`。
- `t` / `callApi` / `PROVIDER_CATALOG` / 格式化函数从 `../core.js` 取；**用了哪个就写进
  import 列表**——拆文件后最容易漏的就是共享 helper（2026-11-08 `AgentConfigDialog` 漏导入
  `toolLabel`，点「新建智能体」打开配置弹窗时 ReferenceError → 整页白屏）。
- `npm run smoke` 的样例数据要**非空**（工具目录 / 设备 / 记忆）：空数组会让 `map` 里的调用
  短路，漏掉未导入符号这类错误。
- 新增文案：`i18n/zh.js` 与 `i18n/en.js` **同时**加，键名一致（没有自动校验，靠 review + 冒烟）。
- 新增样式：加到 `styles.js` 的模板字符串里，沿用 `xz-*` 类名与 `--xz-*` 变量。
- 新增页面：放 `views/`，在 `console/Console.js` 的 `nav` 与 `content` 里接上（不要出现"有组件无入口"）。
- 弹窗：固定外框、只有内部区域滚动（尺寸规则见 `AGENTS.md` § 八"弹窗尺寸"）。
- 不要在 `apply` 之外做副作用；组件卸载要清理定时器/监听/Audio。
- 不要替换 app 根节点、不要读写别的插件的 DOM/样式。

## 6. 生效与验收

| 改了什么 | 怎么生效 |
|---|---|
| `src/client/**` | `npm run build` → 刷新控制台页面；仍加载旧产物就重启 DSH（未实测 refresh 是否足够） |
| 服务端 `index.js` / `src/**` | 重启 DSH |
| `settings.json` 里的配置项 | 控制台保存即生效；adapter 建连时装配，设备要重连 |

验收底线：

```powershell
npm run build
npm run smoke
node --check client.js
node --test "test/*.test.mjs"   # 189 项
```

## 7. 变更记录

- **2026-11-08**：从 3580 行单文件 `client.js` 拆成 `src/client/**` 21 个文件，新增
  `build.mjs`（esbuild + `__ModuleLoader__` 包装 + React external）与 `scripts/smoke-client.mjs`；
  `client.js` 变为构建产物（约 160KB）。同一轮删除了服务商区块标题右侧的「备用 N 个」提示
  （用户要求：卡片区里数量一眼能数，头部不再挂计数）。
- **2026-11-08（修）**：`AgentConfigDialog` 补 `toolLabel` 导入——拆分时漏了，打开配置弹窗
  即白屏；`npm run smoke` 改为用非空 `tools` 渲染该弹窗，覆盖「扩展能力」页签。
