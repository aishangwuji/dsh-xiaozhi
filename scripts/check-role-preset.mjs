/**
 * 「智能体 → 配置 → 角色」交互检查（jsdom，不进单测套件）：
 *   1) 角色页有「人设」+ 右侧「角色模板」下拉，默认「自定义（不改动）」；
 *   2) 选「湾湾小何」→ 人设文本框被整段替换为模板原文；
 *   3) 手改人设后，下拉回落「自定义」，不会假装还是那个模板；
 *   4) 模板文案与 `test/fixtures/role-presets.json` 逐字一致（原服务端导出的基准）；
 *   5) 全程没有 i18n 缺键（MISSING:）与 React 报错。
 *
 * 运行：node scripts/check-role-preset.mjs
 * 说明：五段模板来自 xiaozhi-esp32-server 的 ai_agent_template 种子（2026-11-10 起），
 * 替换掉原先抄官方 change_role.py 的版本；模板只填文本框，不产生任何工具调用。
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
// PillSelect 打开时读元素矩形；jsdom 全 0，给个最小实现避免抛错。
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 30, width: 200, height: 30 }
}
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body })
globalThis.fetch = async (url) => {
  const path = String(url)
  // 用插件真实内置清单回包：音色下拉要按资源族过滤，空清单会让断言变成「空列表也算过」。
  if (path.includes('/voices')) return json({ options: { volc: voiceOptionsFor('volc') }, source: 'catalog' })
  if (path.includes('/settings')) return json({ settings: { voice: { tts: { provider: 'volc', resourceId: '' } } }, defaults: {} })
  if (path.includes('/models')) return json({ options: [] })
  return json({})
}

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { AgentConfigDialog } = await import('../src/client/agents/AgentConfigDialog.js')
const { setT } = await import('../src/client/core.js')
const { zh } = await import('../src/client/i18n/zh.js')
const { ROLE_PRESETS, rolePresetPrompt } = await import('../src/client/agents/rolePresets.js')
const { voiceOptionsFor } = await import('../src/voice/voices.js')
setT((key) => zh[key] ?? `MISSING:${key}`)

// 模板文案的唯一来源是 xiaozhi-esp32-server 导出的基准文件；这里逐字比对，禁止自创或手改措辞。
const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, '../test/fixtures/role-presets.json')

function compareWithFixture() {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const normalize = (text) => String(text).replace(/\r\n/g, '\n').trimEnd()
  if (ROLE_PRESETS.length !== fixture.length) {
    throw new Error(`模板数量不一致：本地 ${ROLE_PRESETS.length} 个 / 基准 ${fixture.length} 个`)
  }
  for (const [index, expected] of fixture.entries()) {
    const actual = ROLE_PRESETS[index]
    if (actual.id !== expected.id) throw new Error(`第 ${index + 1} 个模板 id 不一致：${actual.id} ≠ ${expected.id}`)
    if (normalize(actual.prompt) !== normalize(expected.prompt)) {
      throw new Error(`模板「${expected.name}」与基准不一致（本地 ${actual.prompt.length} 字 / 基准 ${expected.prompt.length} 字）：必须逐字复用原服务端文案`)
    }
  }
  console.log(`  与 test/fixtures/role-presets.json 逐字比对通过（${fixture.length} 个模板）`)
}

const problems = []
const origError = console.error
console.error = (...args) => { problems.push(args.map(String).join(' ')) }
const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  compareWithFixture()
  const root = createRoot(document.getElementById('root'))
  root.render(React.createElement(AgentConfigDialog, {
    agent: { id: 'a1', name: '小智', overrides: {}, toolDisabled: [], memoryEnabled: true },
    tools: [],
    memory: [],
    memoryDraft: '',
    onMemoryDraft: () => {},
    onAddMemory: () => {},
    onRemoveMemory: () => {},
    onToggleTool: () => {},
    onToggleMemory: () => {},
    onSaved: async () => {},
    onClose: () => {}
  }))
  await tick(400)

  const presetTrigger = () => document.querySelector('.xz-pillselect-trigger[aria-label="角色模板"]')
  const textarea = () => document.querySelector('.xz-pane textarea')
  const presetLabel = () => presetTrigger()?.querySelector('.xz-pill-label')?.textContent ?? ''
  const check = (condition, message) => { if (!condition) throw new Error(message) }

  origError(`  默认模板 = ${presetLabel()}`)
  check(presetLabel() === zh.rolePresetCustom, `默认应显示「${zh.rolePresetCustom}」，实际「${presetLabel()}」`)
  check(textarea()?.value === '', '新智能体的人设应为空')

  presetTrigger().click()
  await tick(150)
  const option = [...document.querySelectorAll('.xz-menu-item')]
    .find((item) => item.textContent.trim() === zh.rolePresetWanwanXiaohe)
  check(Boolean(option), '下拉里没有「湾湾小何」选项')
  option.click()
  await tick(150)

  const filled = textarea()?.value ?? ''
  origError(`  选模板后人设前 20 字 = ${filled.slice(0, 20)}…`)
  check(filled.startsWith('[角色设定]\n我是'), '人设没有被模板填充')
  // 弹窗会把 {{assistant_name}} 换成智能体名字，所以对照替换后的整段。
  check(filled === rolePresetPrompt(ROLE_PRESETS[0].prompt, '小智'), '填进文本框的文案与模板不完全一致')
  check(presetLabel() === zh.rolePresetWanwanXiaohe,
    `选完后下拉应显示「${zh.rolePresetWanwanXiaohe}」，实际「${presetLabel()}」`)

  // 手改人设：下拉应回落「自定义」
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(textarea(), '我是一只住在冰箱里的企鹅。')
  textarea().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  await tick(150)
  origError(`  手改后模板 = ${presetLabel()}`)
  check(presetLabel() === zh.rolePresetCustom, '手改人设后下拉应回落「自定义」')

  // 音色下拉必须按资源族过滤：全局 TTS 是火山默认 2.0 时，1.x 的「湾湾小何」(moon) 不许出现，
  // 否则选中就会 55000000（有字没声）；2.0 的「小何」(uranus) 要在列表里。
  const voiceTrigger = document.querySelector('.xz-pillselect-trigger[aria-label="' + zh.voice + '"]')
  check(Boolean(voiceTrigger), '角色页没有音色下拉')
  voiceTrigger.click()
  await tick(120)
  const voiceLabels = [...document.querySelectorAll('.xz-menu-item')].map((item) => item.textContent.trim())
  check(!voiceLabels.some((label) => label.startsWith('湾湾小何')), '2.0 资源里混进了 1.x 音色「湾湾小何」')
  // 火山 2.0 清单已按官方表重建（2026-11-14），标签形如「小何 2.0」。
  check(voiceLabels.some((label) => label === '小何 2.0' || label.startsWith('小何（')), '2.0 音色「小何」不在列表里')
  origError(`  音色列表 ${voiceLabels.length} 项，无 1.x 混入`) 

  check(!document.body.innerHTML.includes('MISSING:'), '有 i18n 缺键（页面里出现 MISSING:）')
  const reactErrors = problems.filter((line) => !line.includes('not wrapped in act'))
  check(reactErrors.length === 0, 'React 报错：' + reactErrors[0])
}

try {
  await run()
  console.error = origError
  console.log('角色模板检查通过：模板填充 / 名称替换 / 手改回落 都正常')
} catch (error) {
  console.error = origError
  console.error('角色模板检查失败：' + error.message)
  process.exitCode = 1
}
