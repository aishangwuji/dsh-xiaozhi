/**
 * 「智能体 → 配置 → 角色」的 TTS 服务商 + 音色下拉检查（jsdom，不进单测套件）。
 *
 * 目的（2026-11-14 用户要求）：所有已配置服务商的音色都能在智能体页面直接下拉选，
 * 且清单来自官方目录（火山 2.0 / 百智云 / Edge / DeepSeek）。
 *
 * 断言：
 *   1) 「TTS 服务商」下拉只列全局已配的主用/备用（+「跟随全局主用」），不含没配的厂商；
 *   2) 切到火山 → 音色列表是该厂商的 2.0 清单（官方 146 条），且不含 1.x 的「湾湾小何」；
 *   3) 切到百智云 → 10 个官方音色（微澜/知夏/…），切到 Edge → 14 个中文音色（晓晓/…）；
 *   4) 换服务商把音色重置为「默认音色」；
 *   5) 保存时 POST /agents/update 带上 ttsProvider；
 *   6) 无 i18n 缺键、无 React 报错。
 *
 * 运行：node scripts/check-agent-voice.mjs
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
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

const settingsBody = {
  settings: {
    voice: {
      llm: { provider: 'deepseek', model: 'deepseek-chat' },
      tts: {
        provider: 'deepseek',
        apiKey: 'sk-••••de',
        hasApiKey: true,
        backups: [
          { provider: 'volc', resourceId: 'seed-tts-2.0', apiKey: 'volc-••••01', hasApiKey: true },
          { provider: 'baizhi', apiKey: 'bz-••••02', hasApiKey: true },
          { provider: 'edge' },
        ],
      },
    },
  },
  defaults: {},
}

const posted = []
const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body })
globalThis.fetch = async (url, options = {}) => {
  const path = String(url)
  if (options.method === 'POST' && path.includes('/agents/update')) {
    posted.push(JSON.parse(String(options.body)))
    return json({ agent: { id: 'a1', name: '小智', overrides: {} } })
  }
  if (path.includes('/settings')) return json(settingsBody)
  if (path.includes('/voices')) {
    const provider = new URL(path, 'http://x').searchParams.get('provider') || ''
    return json({ options: { [provider]: voiceOptionsFor(provider) }, source: 'catalog' })
  }
  if (path.includes('/models')) return json({ options: [] })
  return json({})
}

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { AgentConfigDialog } = await import('../src/client/agents/AgentConfigDialog.js')
const { setT } = await import('../src/client/core.js')
const { zh } = await import('../src/client/i18n/zh.js')
const { voiceOptionsFor, voicesForResource } = await import('../src/voice/voices.js')

setT((key) => zh[key] ?? `MISSING:${key}`)

const problems = []
const origError = console.error
console.error = (...args) => { problems.push(args.map(String).join(' ')) }
const tick = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))
const check = (condition, message) => { if (!condition) throw new Error(message) }

async function run() {
  // 先确认「官方清单」本身是这次的数据源（不是旧常量），否则 UI 断言只是自证。
  const official = {
    volc: voicesForResource(voiceOptionsFor('volc'), 'seed-tts-2.0'),
    baizhi: voiceOptionsFor('baizhi'),
    edge: voiceOptionsFor('edge'),
  }
  check(official.volc.length >= 140, `火山 2.0 清单只有 ${official.volc.length} 条，官方表应 ≥140`)
  check(official.baizhi.length === 10, `百智云清单应为 10 条（官方 voices 接口），实际 ${official.baizhi.length}`)
  check(official.edge.length === 14, `Edge 中文清单应为 14 条，实际 ${official.edge.length}`)
  origError(`  官方清单：火山 2.0 ${official.volc.length} / 百智云 ${official.baizhi.length} / Edge ${official.edge.length}`)

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
    onClose: () => {},
  }))
  await tick(400)

  const trigger = (label) => document.querySelector(`.xz-pillselect-trigger[aria-label="${label}"]`)
  const closeMenu = async () => {
    if (!document.querySelector('.xz-menu')) return
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick(120)
  }
  const openMenu = async (label) => {
    await closeMenu()
    const node = trigger(label)
    check(Boolean(node), `找不到下拉「${label}」`)
    node.click()
    await tick(150)
    return [...document.querySelectorAll('.xz-menu-item')].map((item) => item.textContent.trim())
  }
  const pick = async (label, optionText) => {
    const options = await openMenu(label)
    const target = [...document.querySelectorAll('.xz-menu-item')].find((item) => item.textContent.trim() === optionText)
    check(Boolean(target), `「${label}」里没有「${optionText}」（现有：${options.slice(0, 6).join(' / ')}…）`)
    target.click()
    await tick(250)
  }
  const labelOf = (label) => trigger(label)?.querySelector('.xz-pill-label')?.textContent ?? ''

  // 1) 服务商下拉：跟随全局 + 全局已配的主用/备用；没配的厂商（如讯飞）不许出现。
  const providerOptions = await openMenu(zh.ttsProvider)
  origError(`  服务商选项：${providerOptions.join(' / ')}`)
  check(providerOptions.includes(zh.ttsFollowGlobal), '缺少「跟随全局主用」')
  for (const expected of ['DeepSeek 语音合成', '火山引擎豆包', '百智云语音合成', '微软 Edge']) {
    check(providerOptions.includes(expected), `服务商下拉缺少「${expected}」`)
  }
  check(!providerOptions.some((label) => label.includes('讯飞')), '没配置的讯飞不该出现在服务商下拉里')

  // 2) 切火山 → 2.0 官方清单；1.x 的「湾湾小何」不许混进来。
  await pick(zh.ttsProvider, '火山引擎豆包')
  const volcVoices = await openMenu(zh.voice)
  origError(`  火山音色 ${volcVoices.length} 项，首项 = ${volcVoices[0]}，第二项 = ${volcVoices[1]}`)
  check(volcVoices.includes('Vivi 2.0'), '火山 2.0 音色「Vivi 2.0」不在列表里')
  check(volcVoices.includes('小何 2.0'), '火山 2.0 音色「小何 2.0」不在列表里')
  check(!volcVoices.some((label) => label.startsWith('湾湾小何')), '2.0 资源里混进了 1.x 音色「湾湾小何」')
  check(document.body.innerHTML.includes(zh.voiceCatalogBuiltin), '火山音色缺少「内置清单」提示')

  // 3) 切百智云 → 10 个官方音色；切 Edge → 14 个中文音色。
  await pick(zh.ttsProvider, '百智云语音合成')
  const baizhiVoices = await openMenu(zh.voice)
  origError(`  百智云音色 ${baizhiVoices.length} 项：${baizhiVoices.slice(0, 4).join(' / ')}…`)
  check(baizhiVoices.length === 11, `百智云音色应为 10 个 + 默认音色，实际 ${baizhiVoices.length}`)
  check(baizhiVoices.includes('微澜'), '百智云音色缺少「微澜」')
  check(baizhiVoices.includes('知夏'), '百智云音色缺少官方新增的「知夏」')

  await pick(zh.ttsProvider, '微软 Edge')
  const edgeVoices = await openMenu(zh.voice)
  origError(`  Edge 音色 ${edgeVoices.length} 项：${edgeVoices.slice(0, 3).join(' / ')}…`)
  check(edgeVoices.length === 15, `Edge 音色应为 14 个 + 默认音色，实际 ${edgeVoices.length}`)
  check(edgeVoices.includes('晓晓（女声，普通话）'), 'Edge 音色缺少「晓晓」')

  // 4) 换服务商重置音色：先选一个 Edge 音色，再切回火山，应回到「默认音色」。
  await pick(zh.voice, '晓晓（女声，普通话）')
  check(labelOf(zh.voice) === '晓晓（女声，普通话）', `选中后音色应显示「晓晓」，实际「${labelOf(zh.voice)}」`)
  await pick(zh.ttsProvider, '火山引擎豆包')
  check(labelOf(zh.voice) === zh.voiceDefault, `换服务商后音色应重置为「${zh.voiceDefault}」，实际「${labelOf(zh.voice)}」`)

  // 5) 保存：POST /agents/update 必须带 ttsProvider（空串 = 跟随全局）。
  const save = [...document.querySelectorAll('.xz-config-modal-foot .xz-btn.primary, .xz-modal-foot .xz-btn')]
    .find((button) => button.textContent.trim() === zh.save || button.textContent.includes(zh.save))
  check(Boolean(save), '找不到保存按钮')
  save.click()
  await tick(400)
  const last = posted.at(-1)
  check(Boolean(last), '保存没有发出 /agents/update')
  check(last.ttsProvider === 'volc', `保存的 ttsProvider 应为 volc，实际 ${JSON.stringify(last.ttsProvider)}`)
  check(last.voice === '', `换服务商后 voice 应为空串（用默认），实际 ${JSON.stringify(last.voice)}`)
  origError(`  保存请求：ttsProvider=${last.ttsProvider} voice=${JSON.stringify(last.voice)}`)

  check(!document.body.innerHTML.includes('MISSING:'), '有 i18n 缺键（页面里出现 MISSING:）')
  const reactErrors = problems.filter((line) => !line.includes('not wrapped in act'))
  check(reactErrors.length === 0, 'React 报错：' + reactErrors[0])
}

try {
  await run()
  console.error = origError
  console.log('智能体音色检查通过：4 家服务商 / 官方清单 / 换服务商重置 / 保存带 ttsProvider 都正常')
} catch (error) {
  console.error = origError
  console.error('智能体音色检查失败：' + error.message)
  process.exitCode = 1
}
