import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const settings = {
  endpoints: { lanWsUrl: '', wanWsUrl: '', token: '', hasToken: false },
  firmware: { version: '1.0.0', url: '', force: false },
  gateway: { token: '', hasToken: false },
  voice: {
    systemPrompt: '',
    silenceMs: null,
    llm: {
      provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1',
      appId: '', apiKey: 'sk-••••99', hasApiKey: true, maxTokens: 120,
      backups: [{ id: 'b1', provider: 'deepseek', model: 'deepseek-chat', baseUrl: '', apiKey: 'sk-••••11', hasApiKey: true }]
    },
    tts: {
      provider: 'volc', rate: '', speed: '', url: '', language: '', appId: '',
      apiKey: 'volc-••••22', hasApiKey: true, apiSecret: '', voice: '', model: '', resourceId: '',
      backups: []
    },
    asr: {
      provider: 'volc', url: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      language: 'zh', accent: '', resourceId: 'volc.seedasr.sauc.duration', appId: '',
      apiKey: 'asr-••••33', hasApiKey: true, apiSecret: '', backups: []
    }
  }
}

const calls = []
const callBodies = []
function json(body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body }
}
globalThis.fetch = async (url, options = {}) => {
  const path = String(url)
  const method = options.method || 'GET'
  calls.push(`${method} ${path}`)
  if (options.body) callBodies.push(String(options.body))
  if (path.endsWith('/settings') && method === 'GET') return json({ settings, defaults: { systemPrompt: '', silenceMs: 400 } })
  if (path.endsWith('/settings') && method === 'POST') return json({ settings, defaults: { systemPrompt: '', silenceMs: 400 } })
  if (path.includes('/voices')) return json({ options: {} })
  // 模型清单故意**不包含**已保存的 gpt-4o-mini：验证「当前值不在清单里」时仍能回显，
  // 而不是显示「未选择」。
  if (path.includes('/models')) return json({ options: [{ value: 'some-other-model', label: 'some-other-model' }] })
  if (path.includes('/test/')) return json({ ok: true, totalMs: 100, firstTokenMs: 30, text: '你好小智' })
  return json({})
}

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { ConfigWizard } = await import('../src/client/settings/ConfigWizard.js')
const { setT } = await import('../src/client/core.js')
const { zh } = await import('../src/client/i18n/zh.js')
setT((key) => zh[key] ?? `MISSING:${key}`)

const errors = []
const origError = console.error
console.error = (...args) => { errors.push(args.map(String).join(' ')) }

const root = createRoot(document.getElementById('root'))
root.render(React.createElement(ConfigWizard, { state: {}, notify: () => {} }))
await new Promise((resolve) => setTimeout(resolve, 300))

const cards = [...document.querySelectorAll('.xz-stage-card')]
console.log('stage cards:', cards.length)
console.log('card titles:', cards.map((c) => c.querySelector('strong')?.textContent))
console.log('html has MISSING:', document.body.innerHTML.includes('MISSING:'))

cards[1].click()
await new Promise((resolve) => setTimeout(resolve, 200))
console.log('modal open:', !!document.querySelector('.xz-stage-modal'))
console.log('provider rows:', document.querySelectorAll('.xz-provider-row').length)
console.log('add row:', !!document.querySelector('.xz-backup-add-row'))

const more = document.querySelector('.xz-provider-more')
more.click()
await new Promise((resolve) => setTimeout(resolve, 100))
console.log('row menu open:', !!document.querySelector('.xz-provider-row-menu'))

const deleteButton = [...document.querySelectorAll('.xz-provider-row-menu .xz-provider-menu-item.is-danger')][0]
deleteButton.click()
await new Promise((resolve) => setTimeout(resolve, 100))
console.log('delete confirm text:', deleteButton.textContent)

const add = document.querySelector('.xz-backup-add-row')
add.click()
await new Promise((resolve) => setTimeout(resolve, 200))
console.log('provider dialog open:', !!document.querySelector('.xz-modal-lg'))

// 2026-11-10：LLM 新增「复用 DSH 已配置的厂商」并排在列表首位——它没有 Key 字段，
// 只有 DSH 厂商 + 模型；这里先确认默认就是它，再切回 DeepSeek 走后面的直连流程。
const addDialog = document.querySelector('.xz-modal-lg')
const defaultProvider = addDialog.querySelector('.xz-field .xz-pill-label')?.textContent.trim()
console.log('default provider:', defaultProvider)
console.log('host entry has key input:', !!addDialog.querySelector('input[type="password"]'))
console.log('host summary label:', [...addDialog.querySelectorAll('label')].some((label) => label.textContent.includes('DSH 厂商')))

const choosePill = async (labelText, optionText) => {
  const field = [...document.querySelectorAll('.xz-field')]
    .find((node) => node.querySelector('label')?.textContent.trim() === labelText)
  field.querySelector('.xz-pillselect-trigger').click()
  await new Promise((resolve) => setTimeout(resolve, 80))
  const item = [...document.querySelectorAll('.xz-menu-item')]
    .find((node) => node.textContent.trim() === optionText)
  item.click()
  await new Promise((resolve) => setTimeout(resolve, 150))
}
await choosePill('提供商', 'DeepSeek')
console.log('provider after switch:', document.querySelector('.xz-modal-lg .xz-field .xz-pill-label')?.textContent.trim())

// 备用 LLM 有厂商默认模型：添加时不再让用户选模型（MiMo 例外，没有默认）。
const backupHasModel = [...document.querySelectorAll('.xz-modal-lg label')]
  .some((label) => label.textContent.trim() === '模型')
console.log('backup model field:', backupHasModel)

// 必填校验：不填 API Key 点保存应被拦下（弹窗不关）；填了才允许提交。
const confirmBeforeKey = [...document.querySelector('.xz-modal-lg').querySelectorAll('.xz-btn.primary')][0]
confirmBeforeKey.click()
await new Promise((resolve) => setTimeout(resolve, 100))
const requiredBlocked = !!document.querySelector('.xz-modal-lg')
console.log('required blocked:', requiredBlocked)

const keyInput = [...document.querySelector(".xz-modal-lg").querySelectorAll('input[type="password"]')][0]
if (keyInput) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(keyInput, 'sk-check-123456')
  keyInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// 编辑弹窗「保存」只改本地状态 → dirty；主用测试应变成「保存并测试」并先 POST /settings。
const dialog = document.querySelector('.xz-modal-lg')
const confirm = [...dialog.querySelectorAll('.xz-btn.primary')][0]
confirm.click()
await new Promise((resolve) => setTimeout(resolve, 150))
console.log('dirty hint:', document.body.textContent.includes('有未保存修改'))
const primaryCard = document.querySelector('.xz-primary-card')
const testButton = [...primaryCard.querySelectorAll('.xz-btn')].find((button) => button.textContent.includes('保存并测试'))
console.log('primary test label:', testButton ? testButton.textContent : 'MISSING')
testButton.click()
await new Promise((resolve) => setTimeout(resolve, 300))
console.log('calls after save-and-test:', calls.join(' | '))

// 编辑备用（DeepSeek）同样不再显示模型字段；保存只改本地状态。
const row = document.querySelector('.xz-provider-row')
const editButton = [...row.querySelectorAll('.xz-btn')].find((button) => button.textContent.trim() === '编辑')
editButton.click()
await new Promise((resolve) => setTimeout(resolve, 250))
const editDialog = document.querySelector('.xz-modal-lg')
const editHasModel = [...editDialog.querySelectorAll('label')]
  .some((label) => label.textContent.trim() === '模型')
console.log('edit backup model field:', editHasModel)

// 自动保存：点编辑弹窗的「保存」（只改本地）后不点任何页面按钮，防抖后应自动 POST /settings。
const postsBefore = calls.filter((call) => call.startsWith('POST') && call.includes('/settings')).length
const editSave = [...editDialog.querySelectorAll('.xz-btn.primary')][0]
editSave.click()
await new Promise((resolve) => setTimeout(resolve, 900))
const postsAfter = calls.filter((call) => call.startsWith('POST') && call.includes('/settings')).length
console.log('auto-save posts:', postsBefore, '->', postsAfter)

// ASR 也必须有在线测试：关掉 LLM 弹窗，进 ASR，点「测试识别」应 POST /test/provider {kind:'asr'}。
const stageClose = [...document.querySelectorAll('.xz-stage-modal .xz-modal-foot .xz-btn')]
  .find((button) => button.textContent.includes('关闭'))
stageClose?.click()
await new Promise((resolve) => setTimeout(resolve, 150))
document.querySelectorAll('.xz-stage-card')[0].click()
await new Promise((resolve) => setTimeout(resolve, 200))
const asrPrimary = document.querySelector('.xz-stage-modal .xz-primary-card')
const asrTestButton = [...asrPrimary.querySelectorAll('.xz-btn')]
  .find((button) => button.textContent.includes('测试识别'))
console.log('asr test button:', asrTestButton ? asrTestButton.textContent.trim() : 'MISSING')
asrTestButton?.click()
await new Promise((resolve) => setTimeout(resolve, 300))
const asrResult = asrPrimary.querySelector('.xz-backup-test')?.textContent || ''
const lastTestBody = [...callBodies].reverse().find((body) => body.includes('"source":"primary"') && body.includes('"kind":"asr"')) || ''
console.log('asr test result:', asrResult)

const failures = []
if (backupHasModel) failures.push('backup add dialog still asks for a model')
if (editHasModel) failures.push('backup edit dialog still asks for a model')
if (!requiredBlocked) failures.push('required-field validation did not block the empty API Key')
if (postsAfter <= postsBefore) failures.push('auto-save did not POST /settings')
if (!asrTestButton) failures.push('ASR primary test button missing')
if (!lastTestBody) failures.push('ASR test did not POST /test/provider with kind=asr')
if (!asrResult.includes('你好小智')) failures.push(`ASR test result = ${asrResult || '(empty)'}`)
if (failures.length) {
  console.log('FAILURES:\n' + failures.join('\n'))
  process.exit(1)
}

console.log('calls:', calls.join(' | '))
const realErrors = errors.filter((text) => !text.includes('not wrapped in act'))
if (realErrors.length) {
  console.log('ERRORS:\n' + realErrors.join('\n---\n').slice(0, 3000))
  process.exit(1)
} else {
  console.log('no react errors')
  process.exit(0)
}
