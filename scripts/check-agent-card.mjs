/**
 * 「智能体卡片 ⋯ 菜单」交互 + 样式回归（jsdom，不进单测套件）。
 *
 * 2026-11-13 实测过的 bug：菜单用 `position:fixed` + 视口坐标，但卡片外层 `.xz-card` 有
 * `backdrop-filter`（会成为 fixed 的包含块），结果菜单整体偏移、又被卡片 `overflow:hidden` 裁掉，
 * 看起来像"菜单钻到按钮下面"。这个脚本把两个根因都钉死：
 *   1) 菜单相对卡片定位（inline `position:absolute`），坐标 = 按钮相对卡片的偏移；
 *   2) `.xz-agent-card` 不再 `overflow:hidden`，`.xz-agent-menu` 不再 `position:fixed`；
 *   3) ⋯ 点开 → 菜单出现，重命名 / 删除 / 播报 三项可点；Esc 关闭；
 *   4) 全程无 i18n 缺键与 React 报错。
 *
 * 运行：node scripts/check-agent-card.mjs
 */
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// 给卡片和按钮不同的矩形，才能验证「相对卡片」的坐标换算（jsdom 默认全 0）。
const CARD_BOX = { top: 100, left: 20, right: 400, bottom: 320, width: 380, height: 220 }
const MENU_BTN_BOX = { top: 116, left: 350, right: 384, bottom: 148, width: 34, height: 32 }
dom.window.Element.prototype.getBoundingClientRect = function () {
  if (this.classList?.contains('xz-agent-card')) return { ...CARD_BOX, x: CARD_BOX.left, y: CARD_BOX.top }
  if (this.classList?.contains('xz-agent-menu-btn')) return { ...MENU_BTN_BOX, x: MENU_BTN_BOX.left, y: MENU_BTN_BOX.top }
  return { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 30, width: 200, height: 30 }
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body })
globalThis.fetch = async () => json({})

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { AgentsView } = await import('../src/client/agents/AgentsView.js')
const { setT } = await import('../src/client/core.js')
const { zh } = await import('../src/client/i18n/zh.js')
const { ROLE_PRESETS, rolePresetPrompt } = await import('../src/client/agents/rolePresets.js')
setT((key) => zh[key] ?? `MISSING:${key}`)

const problems = []
const origError = console.error
console.error = (...args) => {
  const text = args.map(String).join(' ')
  // React 19 在 jsdom 里对未包 act 的状态更新会 warn；这里不包 act，过滤掉这一条。
  if (text.includes('not wrapped in act')) return
  problems.push(text)
}

const failures = []
const check = (ok, message) => {
  if (ok) {
    origError(`  ok   ${message}`)
    return
  }
  failures.push(message)
  origError(`  FAIL ${message}`)
}
const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, '../src/client/styles.js'), 'utf8')

// ---- 1) 样式守卫：两个根因都不许回来 ----
const cardRule = CSS.match(/\.xz-agent-card\{[^}]*\}/)?.[0] || ''
check(Boolean(cardRule), 'styles.js 里有 .xz-agent-card 规则')
check(!/overflow:hidden/.test(cardRule), '.xz-agent-card 不再 overflow:hidden（否则菜单被裁掉）')
const menuRule = CSS.match(/\.xz-agent-menu\{[^}]*\}/)?.[0] || ''
check(/position:absolute/.test(menuRule), '.xz-agent-menu 用 position:absolute（相对卡片）')
check(!/position:fixed/.test(menuRule), '.xz-agent-menu 不再 position:fixed（backdrop-filter 会改包含块）')

// ---- 2) 交互：点开 ⋯ ----
const state = {
  version: 3,
  agents: [{
    id: 'a1',
    name: '大家好',
    online: false,
    deviceCount: 0,
    devices: [],
    systemPrompt: rolePresetPrompt(ROLE_PRESETS[0].prompt, '大家好'),
    overrides: { model: 'deepseek-chat' },
    lastSeenAt: 0,
    memoryEnabled: true,
    toolDisabled: []
  }],
  devices: [],
  pending: [],
  voice: { enabled: true }
}

const container = document.getElementById('root')
const root = createRoot(container)
root.render(React.createElement(AgentsView, { state, notify() {}, onChanged: async () => {} }))
await tick(120)

const button = container.querySelector('.xz-agent-menu-btn')
check(Boolean(button), '卡片右上角有 ⋯ 按钮')
check(container.querySelector('.xz-agent-menu') === null, '初始不渲染菜单')
check(!container.querySelector('.xz-agent-card[style*="overflow"]'), '卡片没有内联 overflow')

button.click()
await tick(120)

const menu = container.querySelector('.xz-agent-menu')
check(Boolean(menu), '点 ⋯ 后出现菜单')
check(menu?.style.position === 'absolute', `菜单 inline position=absolute（实际 ${menu?.style.position || '空'}）`)
check(menu?.style.top === `${MENU_BTN_BOX.bottom - CARD_BOX.top + 6}px`, `菜单 top 相对卡片 = 按钮底 + 6（实际 ${menu?.style.top}）`)
check(menu?.style.right === `${CARD_BOX.right - MENU_BTN_BOX.right}px`, `菜单 right 相对卡片 = 卡片右 - 按钮右（实际 ${menu?.style.right}）`)
const items = [...(menu?.querySelectorAll('.xz-provider-menu-item') || [])].map((node) => node.textContent.trim())
check(items.length === 3, `菜单三项（实际 ${items.length} 项）`)
check(items[0]?.startsWith(zh.inject), '第一项是播报')
check(items[1] === zh.agentMenuRename, '第二项是重命名')
check(items[2] === zh.agentMenuDelete, '第三项是删除智能体')
check(menu?.textContent.includes('MISSING:') === false, '菜单无 i18n 缺键')

// ---- 3) Esc 关闭；再开 → 点「重命名」进入就地编辑 ----
document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
await tick(80)
check(container.querySelector('.xz-agent-menu') === null, 'Esc 关闭菜单')

container.querySelector('.xz-agent-menu-btn').click()
await tick(80)
const renameItem = [...container.querySelectorAll('.xz-provider-menu-item')]
  .find((node) => node.textContent.trim() === zh.agentMenuRename)
renameItem.click()
await tick(120)
check(Boolean(container.querySelector('.xz-agent-rename')), '点「重命名」后出现就地编辑输入框')
check(container.querySelector('.xz-agent-menu') === null, '点菜单项后菜单关闭')

// ---- 4) 删除走确认弹窗（2026-11-13 用户要求，不再「再次点击删除」）----
check(zh.agentDeleteConfirm === undefined, '智能体删除不再有「再次点击删除」的 i18n 键（备用服务商那条另算）')
check(!(menu?.textContent || '').includes('再次点击删除'), '菜单里没有二次点击删除的文案')

container.querySelector('.xz-agent-menu-btn').click()
await tick(80)
const deleteItem = [...container.querySelectorAll('.xz-provider-menu-item')]
  .find((node) => node.textContent.trim() === zh.agentMenuDelete)
deleteItem.click()
await tick(120)

const dialog = container.querySelector('.xz-confirm-modal')
check(Boolean(dialog), '点「删除智能体」直接弹出确认弹窗')
check(container.querySelector('.xz-agent-menu') === null, '弹窗打开时菜单已关闭')
check(dialog?.querySelector('h3')?.textContent === zh.agentDeleteTitle, '弹窗标题是「删除智能体」')
check(
  (dialog?.querySelector('.xz-confirm-text')?.textContent || '').includes('大家好'),
  '弹窗正文里带智能体名字'
)
const dialogButtons = [...(dialog?.querySelectorAll('.xz-btn') || [])].map((node) => node.textContent.trim())
check(dialogButtons.includes(zh.cancel), '弹窗有「取消」')
check(dialogButtons.includes(zh.remove), '弹窗有「删除」')

// 取消 → 弹窗关闭，且不发删除请求
const cancelButton = [...(dialog?.querySelectorAll('.xz-btn') || [])]
  .find((node) => node.textContent.trim() === zh.cancel)
cancelButton.click()
await tick(100)
check(container.querySelector('.xz-confirm-modal') === null, '点「取消」关闭弹窗')
check(container.querySelector('.xz-agent-card') !== null, '取消后卡片还在')

// 删除 → 关闭弹窗并调用 POST /agents/remove
const calls = []
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body })
  return json({})
}
container.querySelector('.xz-agent-menu-btn').click()
await tick(80)
;[...container.querySelectorAll('.xz-provider-menu-item')]
  .find((node) => node.textContent.trim() === zh.agentMenuDelete)
  .click()
await tick(120)
;[...(container.querySelector('.xz-confirm-modal')?.querySelectorAll('.xz-btn') || [])]
  .find((node) => node.textContent.trim() === zh.remove)
  .click()
await tick(150)
const removeCall = calls.find((item) => item.url.includes('/agents/remove'))
check(Boolean(removeCall), '点「删除」发出 POST /agents/remove')
check(removeCall?.method === 'POST', '删除请求是 POST')
check(JSON.parse(removeCall?.body || '{}').agentId === 'a1', '删除请求带 agentId')
check(container.querySelector('.xz-confirm-modal') === null, '删除后弹窗关闭')

const missingI18n = [...container.querySelectorAll('*')]
  .map((node) => node.textContent || '')
  .filter((text) => text.includes('MISSING:'))
check(missingI18n.length === 0, '卡片无 i18n 缺键')
check(problems.length === 0, `无 React 报错${problems.length ? `：${problems[0]}` : ''}`)

root.unmount()
console.error = origError
if (failures.length) {
  console.error(`智能体卡片检查失败 ${failures.length} 项：`)
  for (const item of failures) console.error(`  - ${item}`)
  process.exit(1)
}
console.log('智能体卡片检查通过：⋯ 菜单定位/关闭、重命名入口、样式守卫 都正常')
