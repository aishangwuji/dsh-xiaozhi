# dsh-xiaozhi 两个工作副本的开发流程

这份文档只管一件事：**同一个插件在两张工作副本之间怎么同步**。插件架构、设备面/操作台面的现状见项目根目录 `AGENTS.md` 和它指向的 `docs/`；DSH 插件怎么装载、npm 怎么发布写在 `D:\Projects\dsh\AGENTS.md`；设备固件在 `D:\Demo\esp-xiaozhi\xiaozhi-esp32`，不归本文管。

## 0. 唯一事实来源

**GitHub `origin/main` 是唯一事实来源。** 两张工作副本都不是权威版本，谁先推送谁先到达远端，另一张必须通过 `git pull` 拿到。

- 远端：`https://github.com/aishangwuji/dsh-xiaozhi.git`
- 分支：`main`
- 任何“我这边的代码才是最新的”判断都无效，以 `git log origin/main` 为准。

## 1. 两张工作副本

| 副本 | 路径 | 角色 | 说明 |
|---|---|---|---|
| **A** | `D:\Demo\esp-xiaozhi\dsh-xiaozhi` | **运行副本** | DSH profile 里的 `link:` 指向这里；旁边就是固件仓库 `xiaozhi-esp32`，适合插件 + 设备联调 |
| **B** | `D:\Projects\dsh\dsh-xiaozhi` | **工作区副本** | 和 `dsh-git`、`dsh-notify` 并列，适合在 DSH 插件工作区里改代码、跑文档和测试 |

两张副本的 `origin` 必须完全一致：

```powershell
git -C D:\Demo\esp-xiaozhi\dsh-xiaozhi remote -v
git -C D:\Projects\dsh\dsh-xiaozhi remote -v
```

输出的 fetch / push 两行都必须是 `https://github.com/aishangwuji/dsh-xiaozhi.git`。

### 1.1 只有 A 会被 DSH 加载

当前 profile `desktop` 的依赖是：

```json
"@aishangwuji/dsh-xiaozhi": "link:D:/Demo/esp-xiaozhi/dsh-xiaozhi"
```

所以：

- 在 **A** 改 `index.js` / `src/**`，重启 DSH 就能验证。
- 在 **B** 改完，DSH **不会**自动加载；必须先推送到远端，再在 A 里 `git pull`，重启 DSH。
- 不要同时把 profile 指向 B 又偶尔在 A 改；一次只保留一个运行副本。确实要切到 B，改 profile 的 `link:` 后重装/重载，并记住切回来。

`client.js` 是 `npm run build` 的产物，但插件运行时由宿主直接加载，**必须提交**，不能只留在本地。

## 2. 铁律

1. **一次只在一个副本里改代码。** 不要在 A 和 B 同时改同一个文件。
2. **每次开工先 `git pull --rebase`。** 先拿到远端最新，再动手。
3. **每次收工先 `git pull --rebase` 再 `git push`。** 不要跳过 rebase 直接推。
4. **不 force push `main`。** 推不上去就 pull + rebase + 重跑测试，再推。
5. **不提交** `node_modules/`、`.env*`、`*.log`、`coverage/`、`*.tgz`。
6. **`client.js` 要提交。** 改了 `src/client/**` 就 `npm run build`，把源码和产物一起提交。
7. **远端是唯一事实来源。** 本地干净、`git log -1` 与 `origin/main` 一致，才算同步完成。

## 3. 开工（每次，选一张副本）

```powershell
cd D:\Projects\dsh\dsh-xiaozhi    # 或 D:\Demo\esp-xiaozhi\dsh-xiaozhi

git status -sb
# 必须干净。若有未提交改动：先 commit，或 git stash（收工前记得 stash pop）

git pull --rebase origin main
git log -1 --oneline

# 首次、或 pnpm-lock.yaml 有变化时
pnpm install --frozen-lockfile
```

检查点：

- `git status -sb` 的输出里不能有 `ahead` / `behind` / 未跟踪的源码文件。
- `git log -1` 应是远端最新提交（或包含你刚 rebase 上来的本地提交）。
- `node_modules` 每张副本各自安装，不要用软链接共享。

## 4. 开发中

- 只改当前副本。
- 改了 `src/client/**`：`npm run build`，并提交 `client.js`。
- 按改动范围跑测试，至少：

```powershell
node --test "test/*.test.mjs"
npm run build
npm run smoke
```

- 改 UI / 字体 / 角色 / 设备弹窗 / 卡片 / 音色时，再跑 `docs/testing.md` 对应的 `check:*`。
- 不在这个仓库里改固件；固件在 `D:\Demo\esp-xiaozhi\xiaozhi-esp32`，按那边的流程走。

## 5. 收工（每次）

```powershell
cd <当前副本>

git status -sb
git diff --stat
git add -A
git commit -m "<type>: <一句话说明为什么>"

# 先接远端，避免非快进
git pull --rebase origin main

# rebase 之后必须重跑一遍测试
node --test "test/*.test.mjs"
npm run build
npm run smoke

git push origin main
```

如果 `git push` 被拒绝（`non-fast-forward`）：

```powershell
git pull --rebase origin main
# 解决冲突、跑测试，然后：
git push origin main
```

**不要**用 `git push --force` / `--force-with-lease` 覆盖 `main`。

## 6. 切到另一张副本

```powershell
cd <另一张副本>
git status -sb
git pull --rebase origin main
pnpm install --frozen-lockfile   # pnpm-lock.yaml 有变化时
```

如果切到的副本是 **A（运行副本）**，并且改了 `index.js` / `src/**`，需要重启 DSH 才生效；只改 `cordis.patch.yml` 默认值可以不重装，但保险起见重启一次。

## 7. 两边都改了 / 冲突处理

如果 A、B 各自有未推送的提交：

1. 选一张先推送（通常选测试更完整的那张）。
2. 另一张执行：

```powershell
git pull --rebase origin main
```

3. 有冲突时：

```powershell
git status                  # 看 both modified
# 手工改文件，保留两边需要的逻辑
git add <文件>
git rebase --continue
```

4. rebase 完成后重跑测试；确认无误再 `git push`。
5. 想放弃这次 rebase：`git rebase --abort`，回到 rebase 前状态。

**冲突解决后不要直接 push 未经测试的代码。** 特别是 `client.js`：如果 `src/client/**` 有冲突，重新 `npm run build`，不要手工合并产物。

## 8. 较大改动：分支 + PR（可选）

小改动（单文件、文档、局部 bug）直接在 `main` 上走第 3–5 节。

跨文件、接口变化、需要留评审记录的改动：

```powershell
git switch -c feat/<topic>
# 开发、测试、提交
git push -u origin feat/<topic>
# GitHub 上开 PR，合并到 main
```

合并后两张副本都执行：

```powershell
git switch main
git pull --rebase origin main
```

## 9. 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 在 B 改完，DSH 里没变化 | profile 的 `link:` 指向 A | 推送到远端 → A `git pull` → 重启 DSH；或临时把 profile 改指 B |
| `git pull` 报 “cannot pull with rebase: You have unstaged changes” | 工作区不干净 | 先 commit 或 `git stash`，pull 完再 `stash pop` |
| `git push` 被拒 | 远端比本地新 | `git pull --rebase`，跑测试，再 push；不要 force |
| 页面还是旧 UI | 只改了源码没 `npm run build`，或没提交 `client.js` | `npm run build`，提交 `client.js`，重启 DSH |
| 两边同时改同一文件 | 没有遵守“一次只在一张副本改” | 选定一边，另一边 `git pull --rebase`，按第 7 节解冲突 |
| `pnpm install` 后依赖版本不对 | 没按 lockfile 安装 | `pnpm install --frozen-lockfile` |

## 10. 速查

| 动作 | 命令 |
|---|---|
| 开工 | `git status -sb && git pull --rebase origin main` |
| 装依赖 | `pnpm install --frozen-lockfile` |
| 构建客户端 | `npm run build` |
| 全量测试 | `node --test "test/*.test.mjs"` |
| 渲染冒烟 | `npm run smoke` |
| 收工 | `git add -A && git commit && git pull --rebase origin main && npm test && git push` |
| 看远端最新 | `git log --oneline origin/main -5` |
| 看两副本差异 | `git -C <A> rev-parse HEAD; git -C <B> rev-parse HEAD` |

网络提示：本机直连 GitHub 偶尔 `Recv failure: Connection was reset`，重试或按 `docs/release.md` 走代理（`socks5h://127.0.0.1:10808` 或 `http://127.0.0.1:7897`，按当次实际监听端口为准），只对单条命令生效，不要写进全局 config。


