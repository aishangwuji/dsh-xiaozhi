/**
 * 构建控制台客户端产物：`src/client/**` → `client.js`。
 *
 * 宿主只认一种格式：
 *
 *   window.__ModuleLoader__.load({ id: '@local/dsh-xiaozhi', factory(require) { ... } })
 *
 * 所以这里把 esbuild 打出来的 IIFE 包在 factory 里；`react` 保持 external，运行时由
 * factory 的 `require` 参数解析（页面模块表提供 React，插件不自带）。
 *
 * 用法：`node build.mjs`（或 `npm run build`）。改完客户端代码要重新构建，
 * 然后刷新控制台；仍加载旧产物就重启 DSH。
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/client/index.js'],
  outfile: 'client.js',
  bundle: true,
  format: 'iife',
  globalName: 'DshXiaozhi',
  platform: 'browser',
  target: ['es2022'],
  external: ['react'],
  legalComments: 'none',
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      "  id: '@local/dsh-xiaozhi',",
      '  factory(require) {',
    ].join('\n'),
  },
  footer: {
    js: ['    return DshXiaozhi;', '  }', '});', ''].join('\n'),
  },
})
