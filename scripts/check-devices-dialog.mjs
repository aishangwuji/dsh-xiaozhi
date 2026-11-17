/**
 * 「管理设备」弹窗回归（jsdom）：**「移入本智能体」必须二次确认**，不能一键改归属。
 *
 * 2026-11-13 用户反馈：点「移入本智能体」直接把设备从别的智能体抢过来太草率。现在改成弹确认弹窗：
 *   - 设备属于别的智能体 → 「确定把“X”从「甲」移入「小智」吗？…」
 *   - 设备未绑定 → 「确定把“X”绑定到「小智」吗？…」
 *   - 取消不发请求；确认才调 onBind（由外层发 /agents/bind）。
 *
 * 运行：node scripts/check-devices-dialog.mjs
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Node = dom.window.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 30, width: 200, height: 30 }
}

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { AgentDevicesDialog } = await import('../src/client/agents/AgentDevicesDialog.js')
const { setT } = await import('../src/client/core.js')
const { zh } = await import('../src/client/i18n/zh.js')
setT((key) => zh[key] ?? `MISSING:${key}`)

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`)
  if (!ok) failures.push(message)
}
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

const problems = []
const origError = console.error
console.error = (...args) => {
  const text = args.map(String).join(' ')
  if (text.includes('not wrapped in act')) return
  problems.push(text)
}

const me = {
  id: 'a2',
  name: '小智',
  devices: [{ deviceId: '02:DE:AD:BE:EF:00', nickName: '小智手表', online: false, otaEnabled: false }]
}
const agents = [{ id: 'a1', name: '甲' }, me]
const devices = [
  { deviceId: '02:DE:AD:BE:EF:01', nickName: '未命名', agentId: 'a1', online: false },
  { deviceId: '02:DE:AD:BE:EF:02', nickName: '空闲表', agentId: '', online: false }
]

const bound = []
const container = document.getElementById('root')
const root = createRoot(container)
root.render(React.createElement(AgentDevicesDialog, {
  agent: me,
  agents,
  devices,
  busyId: '',
  onBind: (device) => bound.push(device.deviceId),
  onUnbind: () => {},
  onDeviceAction: () => {},
  onClose: () => {}
}))
await tick(120)

const moveButtons = () => [...container.querySelectorAll('.xz-device-row-actions .xz-btn.primary')]
check(moveButtons().length === 2, `其他设备每行一个「移入本智能体」（实际 ${moveButtons().length} 个）`)

// 0) 已绑定设备的行里**不许有「删除设备」**（2026-11-13 用户要求：误操作代价太大，直接不给入口）
const dialogText = container.textContent || ''
check(!dialogText.includes('删除设备'), '弹窗里没有「删除设备」按钮')
check(container.querySelectorAll('.xz-device-row-actions .xz-btn.danger').length === 0, '设备行里没有危险色按钮')
check(zh.agentRemoveDevice === undefined, 'i18n 里的 agentRemoveDevice 已删除（不许只藏按钮）')
const boundRow = container.querySelector('.xz-device-row')
const boundRowButtons = [...(boundRow?.querySelectorAll('.xz-btn') || [])].map((node) => node.textContent.trim())
check(
  boundRowButtons.some((label) => label.startsWith('OTA')) && boundRowButtons.includes(zh.agentUnbind),
  `已绑定设备保留 OTA/解绑（实际：${boundRowButtons.join(' / ')}）`
)

// 1) 从别的智能体移入 → 弹确认，带「从甲移入小智」
moveButtons()[0].click()
await tick(120)
let dialog = container.querySelector('.xz-confirm-modal')
check(Boolean(dialog), '点「移入本智能体」先弹确认弹窗，不直接改归属')
const text = dialog?.querySelector('.xz-confirm-text')?.textContent || ''
check(text.includes('未命名'), '正文带设备名')
check(text.includes('甲') && text.includes('小智'), '正文写清「从甲移入小智」')
check(bound.length === 0, '弹窗出现时还没发绑定请求')

const clickDialog = (label) => {
  const button = [...(dialog?.querySelectorAll('.xz-btn') || [])]
    .find((node) => node.textContent.trim() === label)
  button.click()
}

clickDialog(zh.cancel)
await tick(120)
check(container.querySelector('.xz-confirm-modal') === null, '点「取消」关闭弹窗')
check(bound.length === 0, '取消后不发绑定请求')

// 2) 再来一次，确认 → 调 onBind
moveButtons()[0].click()
await tick(120)
dialog = container.querySelector('.xz-confirm-modal')
clickDialog(zh.agentMoveAction)
await tick(120)
check(bound.length === 1 && bound[0] === devices[0].deviceId, '确认后才调 onBind，且带的是那台设备')
check(container.querySelector('.xz-confirm-modal') === null, '确认后弹窗关闭')

// 3) 未绑定的设备 → 文案是「绑定」，不是「移入」
bound.length = 0
moveButtons()[1].click()
await tick(120)
dialog = container.querySelector('.xz-confirm-modal')
const bindText = dialog?.querySelector('.xz-confirm-text')?.textContent || ''
check(bindText.includes('空闲表'), '未绑定设备的确认正文带设备名')
check(!bindText.includes('移入'), '未绑定设备用「绑定」文案，不提「移入」')
clickDialog(zh.agentMoveAction)
await tick(120)
check(bound.length === 1 && bound[0] === devices[1].deviceId, '未绑定设备确认后也走 onBind')

check(!document.body.innerHTML.includes('MISSING:'), '无 i18n 缺键')
check(problems.length === 0, `无 React 报错${problems.length ? `：${problems[0]}` : ''}`)

root.unmount()
console.error = origError
if (failures.length) {
  console.error(`管理设备弹窗检查失败 ${failures.length} 项`)
  process.exit(1)
}
console.log('管理设备弹窗检查通过：移入/绑定都要二次确认，取消不发请求')
