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
import assert from 'node:assert/strict'
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
if (!loaded || loaded.id !== 'dsh-xiaozhi-server') throw new Error('module not registered')
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
const { ProviderDialog } = await import('../src/client/settings/ProviderDialog.js')

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
  pending: [
    { deviceId: '02:00:00:00:00:AA', lastIp: '192.168.1.11', firstSeenAt: Date.now() - 60_000, attempts: 3 },
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
  return html
}

render('Console', React.createElement(Console, { state, refresh: noop, notify }))
const agentsHtml = render('AgentsView', React.createElement(AgentsView, { state, notify, onChanged: noop }))
assert.match(agentsHtml, /pendingTitle/, 'pending devices panel should render')
assert.match(agentsHtml, /xz-pending-card/, 'pending card should opt out of backdrop-filter clipping')
assert.match(agentsHtml, /02:00:00:00:00:AA/, 'pending device id should render')
assert.match(agentsHtml, /pendingApprove/, 'pending approve action should render')
render('ConfigWizard(loading)', React.createElement(ConfigWizard, { state, notify }))
render(
  'ProviderSection',
  React.createElement(ProviderSection, {
    stage: 'llm',
    primary: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-••••99', hasApiKey: true },
    entries: [
      { id: 'e1', provider: 'deepseek', model: 'deepseek-flash', apiKey: 'sk-••••99', hasApiKey: true },
      { id: 'e2', provider: 'mimo', model: 'mimo-v2', baseUrl: 'https://api.xiaomimimo.com/v1' },
    ],
    // dirty 时测试按钮应变成「保存并测试」且不再禁用（2026-11-08 改版）。
    providersDirty: true,
    primaryTest: { ok: true, totalMs: 120, firstTokenMs: 40 },
    testingPrimary: '',
    testResults: { e1: { ok: true, totalMs: 90, firstTokenMs: 30 } },
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
const devicesHtml = render(
  'AgentDevicesDialog',
  React.createElement(AgentDevicesDialog, {
    agent: state.agents[0],
    agents: state.agents,
    devices: [
      ...state.devices,
      { deviceId: '02:00:00:00:00:EE', nickName: '测试设备2', online: false, agentId: 'a2', otaEnabled: true },
    ],
    busyId: '',
    onBind: noop,
    onUnbind: noop,
    onDeviceAction: noop,
    onClose: noop,
  })
)
assert.match(devicesHtml, /xz-devices-head/, 'device dialog header should render')
assert.match(devicesHtml, /xz-modal-close/, 'close button should sit in the header')
assert.match(devicesHtml, /xz-device-row-inline/, 'other devices should use one compact row')
assert.match(devicesHtml, /xz-device-rename/, 'device name should be an inline rename field')
assert.match(devicesHtml, /agentOtherTitle/, 'other devices section should render')
render('HistoryDialog', React.createElement(HistoryDialog, { agent: state.agents[0], onClose: noop }))
render(
  'ProviderDialog',
  React.createElement(ProviderDialog, {
    stage: 'llm',
    mode: 'backup',
    index: 0,
    isNew: false,
    draft: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
    },
    onDraft: noop,
    onConfirm: noop,
    onCancel: noop,
  })
)

// 描述符驱动表单的覆盖矩阵：每个 stage/provider 组合都要渲染出描述符里声明的字段。
// 加厂商只改 src/providers.js，这里不新增用例也能覆盖（字段来自描述符本身）。
const DIALOG_MATRIX = [
  { stage: 'llm', provider: 'deepseek', expect: ['baseUrl', 'apiKey'] },
  // 2026-11-10：LLM 可以「复用 DSH」——没有 Key 字段，只有 DSH 厂商 + 模型。
  { stage: 'llm', provider: 'host', expect: ['hostProvider', 'model'] },
  // MiMo 没有厂商默认模型，备用条目仍要选模型（模型清单来自 /v1/models）。
  { stage: 'llm', provider: 'mimo', expect: ['model', 'baseUrl', 'apiKey'] },
  { stage: 'tts', provider: 'xunfei', expect: ['appId', 'apiKey', 'apiSecret'] },
  { stage: 'tts', provider: 'baizhi', expect: ['apiKey'] },
  { stage: 'tts', provider: 'edge', expect: ['ttsEdgeKeyless'] },
  // 2026-11-14：DeepSeek 也有语音两段（同一把 Key；没有语种字段）。
  { stage: 'tts', provider: 'deepseek', expect: ['apiKey', 'deepseekTtsNote'] },
  { stage: 'asr', provider: 'deepseek', expect: ['apiKey', 'deepseekAsrNote'] },
  { stage: 'asr', provider: 'volc', expect: ['apiKey', 'resourceId'] },
  { stage: 'asr', provider: 'baizhi', expect: ['apiKey', 'asrLanguage'] },
  { stage: 'asr', provider: 'xunfei', expect: ['appId', 'apiKey', 'apiSecret', 'asrLanguage'] },
  { stage: 'asr', provider: 'local', expect: ['asrLanguage', 'localAsrNote'] },
]
for (const item of DIALOG_MATRIX) {
  const html = renderToStaticMarkup(
    React.createElement(ProviderDialog, {
      stage: item.stage,
      mode: 'backup',
      index: 0,
      isNew: true,
      draft: { provider: item.provider },
      onDraft: noop,
      onConfirm: noop,
      onCancel: noop,
    })
  )
  for (const key of item.expect) {
    assert.ok(html.includes(key), `${item.provider}/${item.stage} 缺少字段 ${key}`)
  }
  console.log(`dialog ${item.stage}/${item.provider}: ok`)
}
console.log('smoke ok')
