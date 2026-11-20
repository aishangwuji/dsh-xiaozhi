---
scope: dsh-xiaozhi
covered_paths:
  - dsh-xiaozhi/index.js
  - dsh-xiaozhi/src/
  - dsh-xiaozhi/src/client/
  - dsh-xiaozhi/test/
last_verified_commit: 6ac5be5
verified_at: 2026-11-20
status: current
note: 技术债/未接入模块的持久记录；AGENTS.md 只保留边界、结构、约束、命令、坑、仓库状态。
---

# dsh-xiaozhi 技术债与未决项

## 已知问题

### `CapabilitiesView` 是死代码

`src/client/views/CapabilitiesView.js` 已无渲染点，`navCapabilities` 文案同样未接；按“未接入模块不默认删”保留待评估，清理要单独确认。

### 真实设备端到端仍有未实测项

会话后端延迟、工具/审批卡片对语音的体感、DS-Bot 长文截断效果、固件升级全流程，均未在真实手表上完整验证。

### 客户端双份产物靠 CI 兜底

`src/client/**` 与 `client.js` 是双份产物；CI 会校验 `client.js` 与源码一致，但本地提交前仍要自己 `npm run build`。

### 控制台 UI 历史细节分散

若干历史布局/交互决策散落在 `docs/current-state.md`，没有统一设计系统。

## 未接入模块 / 待评估

- `src/client/views/CapabilitiesView.js`（见上）。

## 处理约定

新增技术债写本文件，并在 `AGENTS.md` §2 只保留一句指针；状态变化时更新本文件，不要回写 AGENTS。
