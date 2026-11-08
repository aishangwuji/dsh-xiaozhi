/**
 * 控制台客户端冒烟测试（不进单测套件，手动跑）：
 *   1) 产物能在 __ModuleLoader__ 下注册，factory(require) 能拿到 { inject, apply }；
 *   2) apply 能把 main / sidebar.panellist 两个 slot 注册上；
 *   3) 主要页面组件用真实 React 做一次 SSR 渲染，抓 undefined / 拼错的名字。
 *
 * 运行：node scripts/smoke-client.mjs
 */
import fs from 'node:fs'
import vm from 'node:vm'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const bundle = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let loaded = null
const sandbox = {
  window: {
    __ModuleLoader__: { load: (mod) => { loaded = mod } },
    addEventListener() {},
    removeEventListener() {},
    setTimeout() {},
    clearTimeout() {},
    setInterval() { return 0 },
    clearInterval() {},
    requestAnimationFrame() { return 0 },
    cancelAnimationFrame() {},
    innerWidth: 1280,
    innerHeight: 800,
    getComputedStyle() { return {} },
  },
  document: {
    head: { appendChild() {} },
    documentElement: { clientHeight: 800 },
    createElement() { return { dataset: {}, remove() {} } },
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  },
  fetch: async () => ({ ok: false, json: async () => null }),
  console,
  setTimeout() {},
  clearTimeout() {},
}
vm.createContext(sandbox)
vm.runInContext(bundle, sandbox)
if (!loaded || loaded.id !== '@local/dsh-xiaozhi') throw new Error('module not registered')
const plugin = loaded.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})
if (typeof plugin.apply !== 'function') throw new Error('apply missing')
const registrations = []
const ctx = {
  effect(fn) { fn(); },
  locale: {
    register() {},
    bind() { return (key) => key },
  },
  slots: {
    inject(_name, fn) { fn() },
    register(options, component) { registrations.push({ options, component }); return { dispose() {} } },
  },
  layout: { selectPanel() {} },
}
plugin.apply(ctx)
const main = registrations.find((entry) => entry.options.name === 'main')
const side = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
if (!main || !side) throw new Error('slots not registered')
console.log('slots ok:', registrations.map((entry) => entry.options.name).join(', '))

// ---- 组件 SSR 冒烟：真实 React，抓渲染期错误 ----
const { Console } = await import('../src/client/console/Console.js')
const { AgentsView } = await import('../src/client/agents/AgentsView.js')
const { ConfigWizard } = await import('../src/client/settings/ConfigWizard.js')
const { ProviderSection } = await import('../src/client/settings/ProviderSection.js')
const { AgentConfigDialog } = await import('../src/client/agents/AgentConfigDialog.js')
const { AgentDevicesDialog } = await import('../src/client/agents/AgentDevicesDialog.js')
const { HistoryDialog } = await import('../src/client/agents/HistoryDialog.js')

const state = {
  version: 3,
  addresses: [{ ip: '192.168.1.10', iface: 'WLAN', virtual: false }],
  endpoints: { lanIp: '192.168.1.10', otaPath: '/xiaozhi/ota/' },
  listener: { host: '0.0.0.0', port: 8989 },
  gateway: { enabled: true, commands: 3 },
  voice: { enabled: true },
  devices: [
    { deviceId: '02:00:00:00:00:FF', nickName: '测试设备1', online: true, agentId: 'a1', otaEnabled: true },
  ],
  agents: [
    {
      id: 'a1',
      name: '客厅智能体',
      overrides: { voice: 'zh_female_vv_uranus_bigtts' },
      memoryEnabled: true,
      devices: [
        { deviceId: '02:00:00:00:00:FF', nickName: '测试设备1', online: true, agentId: 'a1', otaEnabled: true },
      ],
      deviceCount: 1,
      online: true,
      lastSeenAt: Date.now(),
    },
  ],
}
const notify = () => {}
const noop = () => {}

function render(label, element) {
  const html = renderToStaticMarkup(element)
  console.log(`${label}: ${html.length} bytes`)
}

render('Console', React.createElement(Console, { state, refresh: noop, notify }))
render('AgentsView', React.createElement(AgentsView, { state, notify, onChanged: noop }))
render('ConfigWizard(loading)', React.createElement(ConfigWizard, { state, notify }))
render(
  'ProviderSection',
  React.createElement(ProviderSection, {
    stage: 'llm',
    primary: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-••••99', hasApiKey: true },
    entries: [{ id: 'e1', provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-••••99', hasApiKey: true }],
    providersDirty: false,
    primaryTest: null,
    testingPrimary: '',
    testResults: {},
    testingId: '',
    confirmDelete: '',
    onEditPrimary: noop,
    onAdd: noop,
    onEdit: noop,
    onMove: noop,
    onDelete: noop,
    onTest: noop,
    onTestPrimary: noop,
  })
)
render(
  'AgentConfigDialog',
  React.createElement(AgentConfigDialog, {
    agent: state.agents[0],
    // 非空工具目录：扩展能力页签会走 toolLabel()，空数组会漏掉未导入的符号。
    tools: [
      { name: 'web_search', description: '联网搜索', enabled: true },
      { name: 'get_current_time', description: '当前时间', enabled: false },
    ],
    memory: [],
    memoryDraft: '',
    onMemoryDraft: noop,
    onAddMemory: noop,
    onRemoveMemory: noop,
    onToggleTool: noop,
    onToggleMemory: noop,
    onSaved: noop,
    onClose: noop,
  })
)
render(
  'AgentDevicesDialog',
  React.createElement(AgentDevicesDialog, {
    agent: state.agents[0],
    devices: state.devices,
    busyId: '',
    onBind: noop,
    onUnbind: noop,
    onDeviceAction: noop,
    onClose: noop,
  })
)
render('HistoryDialog', React.createElement(HistoryDialog, { agent: state.agents[0], onClose: noop }))
console.log('smoke ok')
