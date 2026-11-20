# 分发与发布

> 项目自己的发布细节。通用的 npm 2FA/token 流程与 GitHub Release 步骤见 `D:\Projects\dsh\AGENTS.md` §5；本文只记 dsh-xiaozhi 特有的部分。

## 1. 分发

| 项 | 值 |
|---|---|
| GitHub | `aishangwuji/dsh-xiaozhi`（public，默认分支 `main`） |
| npm | `@aishangwuji/dsh-xiaozhi` |
| 当前版本 | 0.2.0（2026-11-17 发布） |
| 安装 | `dsh plugin --profile <p> add @aishangwuji/dsh-xiaozhi`；或 Plugins → Add plugin 填包名/仓库地址；或 `add github:aishangwuji/dsh-xiaozhi`。装完刷新页面 |
| 本机开发 | profile `desktop` 里是 `link:D:/Demo/esp-xiaozhi/dsh-xiaozhi`（运行副本 A）。改 `index.js` / `src/**` 后重启 DSH；只改 `cordis.patch.yml` 默认值不重装也生效 |

包名用 scope 而不是裸 `dsh-xiaozhi`：npm 上那个名字已被一个无关项目（「旗驭小智 AI 网关」）占用，装错会得到别人的插件。目录仍叫 `dsh-xiaozhi`，数据目录仍是 `~/.dsh-xiaozhi/`。

历史上短暂用过 `@local/dsh-xiaozhi` 与 `dsh-xiaozhi-server`，均已弃用并从 npm 撤下。

## 2. npm 发布

```powershell
npm publish --registry https://registry.npmjs.org/ --access public
```

- 本机默认 registry 是 npmmirror，**必须显式指 npmjs**。
- 发布必须用 **granular access token 并勾 Allow bypass 2FA**；普通 `npm_` token 会 403：
  `granular access token with bypass 2fa enabled is required`。
- 首次发布时 npm 会自动建一条 `0.0.0-stage` 占位版本（`"Temporary package placeholder for staged publishing"`），正常，`latest` 仍指向真版本。

### 已踩的两个坑

1. **bypass-2FA token 不能删包**：`npm unpublish` 会 403 `may not perform this action`。改包名后只能用 `npm deprecate` 标注迁移；删旧包得去 npm 网页用 2FA 操作。
2. **新包/新版本刚发布时 pnpm 可能一直 404**：pnpm 会把首个 `404 Not Found ...@aishangwuji%2Fxxx` 缓存住，`pnpm cache delete @aishangwuji/xxx` 后立刻可装，或等几分钟。

## 3. push 与网络

- **push 前扫密钥**。2026-11-17 首次推送被 GitHub push protection 拦下：历史里 `test/volc-sign.test.mjs`（已删）带着 Volcengine 官方文档示例的 AK/SK，被当成真实密钥。已用 `git filter-repo --replace-text` 把这些历史 blob 换成 `EXAMPLE_*` 占位值；真机 MAC 也换成了 `02:DE:AD:BE:EF:xx` 例示值。
- **不要把任何“看起来像真 Key”的串写进测试文件**，哪怕是文档抄来的。
- 本机直连 `github.com:443` 会间歇 `Recv failure: Connection was reset` / 超时（`gh` API 不受影响）。重试通常能过；实在不行走 Clash 代理，按单条命令使用，不要写进全局 config：

```powershell
# SOCKS（端口随 Clash 变动，先 Get-NetTCPConnection -State Listen 确认）
git -c http.proxy=socks5h://127.0.0.1:10808 push origin main

# 或 HTTP 代理
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
```

## 4. 发版检查

1. 改 `package.json` version + 更新 `CHANGELOG`（如有）；
2. `node --test "test/*.test.mjs"` 全绿 + `npm run build` + `npm run smoke`；
3. `git status` 干净，提交并 push；
4. `npm publish --registry https://registry.npmjs.org/ --access public`；
5. 轮询 registry：`npm view @aishangwuji/dsh-xiaozhi version --registry=https://registry.npmjs.org`；
6. 打 tag、建 GitHub Release（通用步骤见 `D:\Projects\dsh\AGENTS.md` §5）；
7. 从 registry 真实安装一次验证：`dsh plugin --profile <p> add @aishangwuji/dsh-xiaozhi`。


