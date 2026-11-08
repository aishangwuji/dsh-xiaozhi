# 服务商描述符：快速接入的架构

> 目标：**加一个厂商 = 改描述符 + 适配器，前端零改动**。本文是这条链路的契约；
> 存储/掩码/failover 的语义仍见 `docs/backup-providers.md`。

## 1. 之前卡在哪

加一家服务商要在前端改 8~10 处（`PROVIDER_CATALOG`、`PRIMARY_EDIT_FIELDS`、`blankBackup`、
`backupKeyState`/`backupSummaryText` 的 `stage ===` 分支、`ProviderDialog` 的
`if (stage === 'llm') … else if (provider === 'xunfei') …`），再加后端适配器、白名单、测试分支——
前后端都要发版，而且同一份元数据写了两遍，容易漂移。

根因：**元数据写在前端代码里，且和调用逻辑混在一起**。

## 2. 单一数据源

`src/providers.js`（纯数据 + 纯函数，无 Node 依赖）：

- 服务端 `src/settings.js` 用它派生备用服务商白名单（`allProvidersForStage`，含 `hidden`）；
- 服务端 `src/control.js` 用它提供 `GET /providers`；
- 客户端 `src/client/core.js` **打包一份兜底**，启动后再 `GET /providers` 覆盖
  （服务端加厂商时，旧前端刷新即可看到，不需要重新构建 client.js）。

```jsonc
{
  "schemaVersion": 1,
  "providers": [
    {
      "id": "volc",
      "name": "火山引擎豆包",
      "group": "cloud",
      "stages": {
        "llm": {
          "baseUrlHint": "https://ark.cn-beijing.volces.com/api/v3",
          "modelHint": "doubao-1.5-pro-32k",
          "fields": [
            { "key": "model", "type": "model", "modelKind": "llm", "label": "model", "placeholderKey": "modelFromApi" },
            { "key": "baseUrl", "type": "url", "label": "baseUrl", "placeholder": "https://ark.cn-beijing.volces.com/api/v3" },
            { "key": "apiKey", "type": "secret", "label": "apiKey", "required": true }
          ],
          "summary": ["model", "baseUrl"],
          "secretFields": ["apiKey"],
          "probe": { "kind": "chat" }
        },
        "tts": { "fields": [{ "key": "apiKey", "type": "secret", "label": "apiKey" }], "summary": [], "secretFields": ["apiKey"], "probe": { "kind": "tts" } },
        "asr": { "fields": ["apiKey", "resourceId", "url"], "summary": ["url", "resourceId"], "secretFields": ["apiKey"], "probe": { "kind": "none" } }
      }
    }
  ],
  "stages": {
    "llm": { "labelKey": "step4", "storageFields": ["model", "baseUrl", "appId", "apiKey"], "editFields": ["model", "baseUrl", "appId", "apiKey"] },
    "tts": { "labelKey": "step5", "storageFields": ["voice", "rate", "speed", "model", "resourceId", "url", "appId", "apiKey", "apiSecret"], "editFields": ["appId", "apiKey", "apiSecret"] },
    "asr": { "labelKey": "step3", "storageFields": ["url", "language", "accent", "resourceId", "appId", "apiKey", "apiSecret"], "editFields": ["url", "language", "accent", "resourceId", "appId", "apiKey", "apiSecret"] }
  }
}
```

（上面 `asr.fields` 为了篇幅简写了，真实结构见 `src/providers.js`。）

### 字段类型（前端 `SchemaForm` 的渲染器注册表）

| type | 渲染 | 说明 |
|---|---|---|
| `text` | `<input>` | 默认类型；未知 type 也降级到这里 |
| `url` | `<input type=url>` | |
| `secret` | `<input type=password>` | 掩码/留空保留/密钥状态只看它 |
| `number` / `checkbox` | 原生 | 预留 |
| `select` | `PillSelect` | `options` 静态；动态枚举后续可加 `optionsEndpoint` |
| `model` | `ModelField` | `modelKind: 'llm'` 拉 `/v1/models`；`modelKind: 'asrResource'` 拉 ASR 资源。当前值不在清单里时仍回显（补进选项）；空值用描述符 `modelHint` 占位 |

字段级可选：`placeholder`、`placeholderKey`（i18n）、`note`（i18n）、`required`、
`showWhen: { key, equals }`（同表单条件显示）、`primaryOnly: true`（只在主用编辑弹窗出现，
备用条目编辑时隐藏——火山 AK/SK 拉音色就属于这种）。

### 段级元数据（`stages`）

- `storageFields`：一条备用条目在 `settings.json` 里允许的字段（`blankBackup` 用它造空骨架）；
- `editFields`：主用编辑写回的扁平字段（换厂商时清残留）；
- `labelKey`：弹窗/卡片标题的 i18n key。

### `hidden`

`funasr` 需要本机自部署，控制台**不展示**，但存储白名单保留（手写配置不被清掉）。
`providersForStage()` 过滤 `hidden`，`allProvidersForStage()` 不过滤（给 `settings.js` 用）。

## 3. 前端怎么消费

- `src/client/core.js`：`PROVIDERS`/`STAGE_META` 来自打包兜底；`setProviders(payload)` 用
  `GET /providers` 覆盖。`stageProviders` / `stageProviderLabel` / `providerOptionsFor` /
  `blankBackup` / `backupKeyState` / `backupSummaryText` / `isKeylessProvider` /
  `primaryEditFields` 全部读描述符，**没有 `stage ===` / `provider ===` 分支**。
- `src/client/settings/SchemaForm.js`：按 `fields` 渲染；`type` 未知降级 text；
  `showWhen` 条件显示；secret 字段统一「留空 = 保留」提示。
- `src/client/settings/ProviderDialog.js`：只做「选厂商 + 换厂商重置 + SchemaForm + 取消/保存」，
  没有厂商分支。
- 测试按钮是否显示由 `probe.kind` 决定（`none` 不显示），不再写 `stage === 'asr'`。

## 4. 加一个厂商要改什么

1. **`src/providers.js`**：加一条描述符（或给已有 provider 加一个 stage）。
   - 存储白名单自动跟上（`settings.js` 的 `allProvidersForStage`），不用改 `BACKUP_SPEC`。
2. **`src/voice/adapters/index.js`**：
   - OpenAI 兼容 LLM：只加 `OPENAI_COMPATIBLE[provider] = { baseUrl, model?, authStyle?, thinking? }`；
   - TTS/ASR：加适配器文件 + `buildTtsAdapter` / `buildAsrAdapter` 的一个分支
     （协议差异大，这层保留分支是有意的，不强行统一）。
3. **可选**：`src/models.js`（模型清单接口不兼容时）、`src/voice/voices.js`（音色目录）。
4. **测试**：`test/providers.test.mjs` 会自动校验「描述符字段 ⊆ 存储白名单」；
   `npm run smoke` 的 `DIALOG_MATRIX` 会按描述符渲染每个 stage/provider 组合。

**前端：0 改动**（旧 client.js 刷新后会从 `GET /providers` 拿到新厂商）。

## 5. 探测（Probe）

描述符只声明**语义**：`probe.kind = chat | tts | asr | none`。

- `none`：UI 不显示测试按钮（当前没有厂商用；留给确实无法在线探测的实现）；
- `chat` / `tts`：`/test/provider`（主用 LLM 仍走 `/test/llm`）；
- `asr`：`/test/provider` 用全局 TTS 合成一句固定话再喂被测 ASR（`src/voice/asr-probe.js`），
  返回识别文本；TTS 不可用时明确报错。按钮文案由 `probe.labelKey` 决定（如「测试识别」）。

探测的 HTTP 细节在适配器里，不进描述符——否则 schema 会膨胀成第二套业务代码。

## 6. 版本与降级

- `schemaVersion: 1`；前端遇到不认识的字段 `type` 降级为 `text`，不认识的顶层字段忽略；
- `GET /providers` 返回空/失败时保留打包兜底，页面不会空；
- 后端仍然做最终校验（`settings.js` 的白名单/长度/掩码规则），前端校验只为体验。

## 7. 边界（不要做）

- 描述符只描述**配置形态**，不描述调用顺序/重试/降级——那些在适配器与 failover 层；
- 不把 schema 冻结成"插件市场公共 API"；等真有第三方再固化；
- 不给 TTS/ASR 硬套 OpenAI 兼容基座（二进制帧/HMAC/SSE 差异太大）；
- 新厂商的 i18n 文案（`label`/`note`）加到 `zh.js`/`en.js`；没加时显示 key 本身，可接受。

## 8. 验收

```powershell
node --test "test/*.test.mjs"   # 210 项，含 test/providers.test.mjs 6 项 + /providers 路由
npm run build
npm run smoke                   # 描述符表单矩阵：llm/deepseek、tts/xunfei、tts/edge、asr/volc、asr/xunfei、asr/local
npm run check:ui                # 全局设置交互
node --check client.js
```

手动：`curl http://127.0.0.1:<gui-port>/dsh-xiaozhi-7c3a/providers` 应返回描述符；
控制台「全局设置 → 服务商 → 管理 → 添加备用」的下拉里应包含新厂商。
