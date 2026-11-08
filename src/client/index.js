/**
 * 控制台客户端入口。
 *
 * 产物格式（见 build.mjs）：`window.__ModuleLoader__.load({ id, factory(require) { ... } })`，
 * 本文件只负责把页面组件挂到宿主的 slot 上；React 从 `require('react')` 来，由 build 时
 * 标记 external、运行时由 factory 参数解析。
 *
 * 目录约定：
 *   core.js        常量、服务商目录、i18n 绑定、API 调用与格式化（无 React）
 *   i18n/          中英文案
 *   styles.js      全部 CSS（apply 里插 <style>）
 *   ui/            Icon / PillSelect / 基础小组件
 *   views/         概览、能力页
 *   agents/        智能体页 + 三个弹窗
 *   settings/      全局设置页 + 服务商卡片/弹窗/模型选择器
 *   console/       控制台外壳（导航/滚动）与面板根组件
 */
import { NS, t, setT, setVoices, setProviders } from './core.js'
import { zh } from './i18n/zh.js'
import { en } from './i18n/en.js'
import { CSS } from './styles.js'
import { XiaozhiPanel } from './console/XiaozhiPanel.js'
import { XiaozhiIcon } from './ui/Icon.js'

export const inject = ['slots', 'locale', 'layout']

export function apply(ctx) {
  // Renderer-side forensics: a console crash leaves no trace on the host, so
  // report the first few uncaught errors before the frame can die.
  ctx.effect(() => {
    let reported = 0
    const report = (payload) => {
      if (reported >= 5) return
      reported += 1
      try {
        fetch('dsh-xiaozhi-7c3a/crashes/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dsh-xiaozhi': '1' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {})
      } catch {
        /* reporting must never throw */
      }
    }
    const onError = (event) => {
      report({
        message: String(event?.message ?? 'renderer error'),
        stack: String(event?.error?.stack ?? ''),
        source: String(event?.filename ?? ''),
        line: event?.lineno,
        column: event?.colno,
      })
    }
    const onRejection = (event) => {
      const reason = event?.reason
      report({
        message: String(reason?.message ?? reason ?? 'unhandled rejection'),
        stack: String(reason?.stack ?? ''),
        source: 'unhandledrejection',
      })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, 'dsh-xiaozhi: crash reporting')

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshXiaozhi = 'styles'
    const host = document.head || document.documentElement
    if (!host) return () => {}
    host.appendChild(style)
    style.textContent = CSS
    return () => style.remove()
  }, 'dsh-xiaozhi: styles')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-xiaozhi: dictionaries')

  // 音色目录：与 Go 服务端 voice_constants.go 同源，面板里的下拉用它填。
  ctx.effect(() => {
    let alive = true
    fetch('dsh-xiaozhi-7c3a/voices')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (alive && data?.options) setVoices(data.options)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, 'dsh-xiaozhi: voice catalog')

  // 服务商描述符：`GET /providers` 回来后替换打包兜底，服务端加厂商前端不用发版。
  ctx.effect(() => {
    let alive = true
    fetch('dsh-xiaozhi-7c3a/providers')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (alive && data) setProviders(data)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, 'dsh-xiaozhi: provider descriptors')

  setT(ctx.locale.bind(NS))

  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: 'xiaozhi', locale: NS }, XiaozhiPanel)
  )

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: 'xiaozhi',
        order: 6,
        locale: NS,
        label: () => t('brand'),
        inject: () => ({ openPanel: () => ctx.layout.selectPanel('xiaozhi') })
      },
      XiaozhiIcon
    )
  )
}
