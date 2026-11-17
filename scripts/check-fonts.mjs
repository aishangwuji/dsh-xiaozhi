/**
 * 字体回归检查（不进单测套件，改样式后手动跑）：
 *   把 `src/client/styles.js` 的真实 CSS 丢给真浏览器（Edge / Chrome），
 *   用 CDP 的 `CSS.getPlatformFontsForNode` 读出「这段文字实际由哪个字体渲染」，再断言。
 *
 * 为什么需要它（两次实测）：
 *   1) 2026-11-09 智能体卡片空态「还没有绑定设备」被塞进 `.xz-devcard-mac{font-family:ui-monospace,monospace}`，
 *      中文落到 **NSimSun（新宋体）**；
 *   2) 同一天 `.xz-hint`（「没有其他设备」）自己没有字体声明，继承到的栈以 `sans-serif` 结尾，
 *      而**这台机器的浏览器把 `sans-serif` 映射成 SimSun**，于是它变成 **SimSun（宋体）**。
 * 所以本脚本故意把浏览器的 sans-serif 预设改成 **SimSun**（恶意环境）再验：
 * **中文只许走 `--xz-font`（显式列出 CJK 家族），等宽只给 ASCII（MAC / IP / URL / JSON）**。
 * 任何依赖 bare `sans-serif` 的写法都会在这里红掉。
 *
 * 断言：
 *   1) 所有探针的中文都不许落到宋/明体族；
 *   2) 卡片空态 / 设备行 / 弹窗提示 / 等宽元素里的中文，字体必须与正文一致；
 *   3) MAC 仍用等宽（与中文不是同一个字体）。
 *
 * 运行：node scripts/check-fonts.mjs
 * 找浏览器顺序：$env:CHROME_PATH → Edge → Chrome；都找不到就报错退出（不静默跳过）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { CSS } from '../src/client/styles.js'

const SERIF_CJK = /^(NSimSun|SimSun|宋体|新宋体|SimSun-ExtB|MingLiU|MS Mincho|MS PMincho)/i

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
].filter(Boolean)

const browserPath = CANDIDATES.find((p) => existsSync(p))
if (!browserPath) {
  console.error('找不到 Edge / Chrome，无法验字体。设 CHROME_PATH 指向可执行文件后再跑。')
  process.exit(1)
}

// 恶意环境：sans-serif / standard 都指向 SimSun（复现用户机器上的字体设置）
const HOSTILE_PREFS = JSON.stringify({
  webkit: {
    webprefs: {
      fonts: {
        standard: { Zyyy: 'SimSun', Hans: 'SimSun' },
        sansserif: { Zyyy: 'SimSun', Hans: 'SimSun' },
        serif: { Zyyy: 'SimSun', Hans: 'SimSun' }
      },
      default_font_size: 16
    }
  }
})

// 扁平探针：[id, className, 文本, 说明]
const FLAT = [
  ['ref', 'xz-devcard-title', '智能体', '正文参照'],
  ['empty', 'xz-devcard-devices', '还没有绑定设备', '卡片空态'],
  ['list', 'xz-devcard-devices', '手表已绑定', '卡片设备行'],
  ['mono-cn', 'xz-device-row-mac', '设备已离线', '等宽元素里的中文'],
  ['mac', 'xz-device-row-mac', '02:de:ad:be:ef:01', '等宽元素里的 MAC']
]

const MODAL = `
  <div class="xz-modal-mask" style="position:static;background:none;backdrop-filter:none">
    <div class="xz-modal xz-devices-modal">
      <div class="xz-modal-body">
        <div class="xz-device-section-title">其他设备（可移入本智能体）（0）</div>
        <div id="hint" class="xz-hint">没有其他设备</div>
      </div>
    </div>
  </div>`

const HTML = '<!doctype html><meta charset="utf-8"><title>fonts</title><style>' + CSS + '</style>' +
  '<div class="xz-app" style="height:auto;max-height:none">' +
  FLAT.map(([id, cls, text]) => `<div id="${id}" class="${cls}">${text}</div>`).join('') +
  MODAL +
  '</div>'

const PROBES = [...FLAT.map(([id, , text, desc]) => [id, text, desc]), ['hint', '没有其他设备', '弹窗空态 xz-hint']]

const PORT = 9341
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-xiaozhi-fonts-'))
  mkdirSync(join(profile, 'Default'), { recursive: true })
  writeFileSync(join(profile, 'Default', 'Preferences'), HOSTILE_PREFS)

  const browser = spawn(browserPath, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ], { stdio: 'ignore' })

  const cleanup = () => {
    try { browser.kill() } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* windows lock */ }
  }

  try {
    let targets = null
    for (let i = 0; i < 80 && !targets; i++) {
      await wait(250)
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
        if (list.some((t) => t.type === 'page')) targets = list
      } catch { /* 还没起来 */ }
    }
    assert.ok(targets, '浏览器没有在 20s 内暴露 CDP 端口')

    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      const slot = pending.get(msg.id)
      if (!slot) return
      pending.delete(msg.id)
      msg.error ? slot.reject(new Error(JSON.stringify(msg.error))) : slot.resolve(msg.result)
    })
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', () => reject(new Error('CDP 连接失败')))
    })
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

    await send('Page.enable')
    await send('DOM.enable')
    await send('CSS.enable')
    await send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML) })
    await wait(900)
    const doc = await send('DOM.getDocument', { depth: -1 })

    const actual = new Map()
    for (const [id, text, desc] of PROBES) {
      const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `#${id}` })
      assert.ok(node.nodeId, `DOM 里找不到 #${id}（${desc}）`)
      const { fonts = [] } = await send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })
      assert.ok(fonts.length, `#${id}（${text}）没有拿到任何字体`)
      const families = fonts.map((f) => f.familyName)
      actual.set(id, families)
      console.log(`  ${id.padEnd(7)} ${text.padEnd(12)} -> ${fonts.map((f) => `${f.familyName}×${f.glyphCount}`).join(' + ')}`)
    }

    ws.close()

    // 1) 任何探针都不许是宋/明体族（sans-serif 已被改成 SimSun，裸 sans-serif 必红）
    for (const [id, families] of actual) {
      for (const family of families) {
        assert.ok(!SERIF_CJK.test(family), `#${id} 落到了衬线宋体族「${family}」，中文必须走 --xz-font（显式 CJK 家族）`)
      }
    }
    // 2) 各处中文必须与正文同字体
    for (const id of ['empty', 'list', 'mono-cn', 'hint']) {
      assert.deepEqual(actual.get(id), actual.get('ref'), `#${id} 字体 ${actual.get(id)} 与正文 ${actual.get('ref')} 不一致`)
    }
    // 3) MAC 仍是等宽
    const mono = actual.get('mac')[0]
    const sans = actual.get('ref')[0]
    assert.notEqual(mono, sans, `MAC 与中文用了同一个字体「${mono}」，等宽栈被破坏`)

    console.log('\n字体检查通过（sans-serif 已强制映射 SimSun）：中文 =' + sans + '，等宽 =' + mono)
  } finally {
    cleanup()
  }
}

main().catch((err) => {
  console.error('\n字体检查失败：' + err.message)
  process.exitCode = 1
})
