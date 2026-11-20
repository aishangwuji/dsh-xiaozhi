/**
 * 「DSH 会话」回答来源的契约测试。
 *
 * 覆盖的是最容易踩坏的语义：
 *   - 只念这一轮**最终**那条 assistant 消息（工具步骤里的「我先查一下」不念）；
 *   - 事件按 sessionId 分发，别的会话的字不能混进来；
 *   - 用 `source.rpcId` 把「我这句话」和「它这一轮」对上（队列模式下尤其重要）；
 *   - 打断 = 取消该会话当前 turn；超时也要取消，不能把下一句排到长任务后面；
 *   - 绑定是按智能体存的，重启后仍然复用同一个会话。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionBridge } from '../src/host-session.js'
import { SessionBindingStore } from '../src/session-bindings.js'
import {
  createDshSessionLlm,
  lastUserText,
  toSpeech,
} from '../src/voice/adapters/dsh-session.js'

const silent = { info() {}, warn() {}, error() {} }
const tick = () => new Promise((resolve) => setImmediate(resolve))

function harness({ sessionId = 'session-aaaa' } = {}) {
  const bus = new Map()
  const prompts = []
  const cancels = []
  const controller = {
    async list() {
      return { items: [] }
    },
    async create() {
      return { sessionId: 'session-created' }
    },
    async prompt(request) {
      prompts.push(request)
    },
    cancel(request) {
      cancels.push(request.sessionId)
    },
  }
  const bridge = createSessionBridge({
    sessionController: controller,
    on: (name, listener) => {
      const set = bus.get(name) ?? new Set()
      set.add(listener)
      bus.set(name, set)
      return () => set.delete(listener)
    },
    logger: silent,
  })
  return {
    bridge,
    prompts,
    cancels,
    sessionId,
    emit(id, event) {
      for (const listener of [...(bus.get('session/event') ?? [])]) listener({ id }, event)
    },
  }
}

async function collect(iterator) {
  const chunks = []
  for await (const chunk of iterator) chunks.push(chunk)
  return chunks
}

test('toSpeech 去掉 Markdown、按句末截断', () => {
  const text = '## 结论\n\n**可以**，先把 `config.js` 改掉。\n\n- 第一点\n- 第二点\n\n```js\nconsole.log(1)\n```'
  assert.equal(toSpeech(text), '结论 可以，先把 config.js 改掉。 第一点 第二点')
  const long = `${'一'.repeat(30)}。${'二'.repeat(30)}。${'三'.repeat(30)}。`
  assert.equal(toSpeech(long, { maxChars: 40 }), `${'一'.repeat(30)}。……`)
})

test('lastUserText 读字符串与多段内容里的文本', () => {
  assert.equal(lastUserText([{ role: 'user', content: '你好' }]), '你好')
  assert.equal(
    lastUserText([
      { role: 'assistant', content: '在' },
      { role: 'user', content: [{ type: 'text', text: '查一下' }, { type: 'image' }] },
    ]),
    '查一下',
  )
  assert.equal(lastUserText([]), '')
})

test('会话桥按 sessionId 分发，退订后不再回调', () => {
  const h = harness()
  const seen = []
  const off = h.bridge.subscribe('session-aaaa', (event) => seen.push(event.type))
  h.emit('session-bbbb', { type: 'turn/start', data: { turn: 1 } })
  h.emit('session-aaaa', { type: 'turn/start', data: { turn: 1 } })
  off()
  h.emit('session-aaaa', { type: 'turn/end', data: { turn: 1 } })
  assert.deepEqual(seen, ['turn/start'])
})

test('只念最终结论：工具步骤的文字被丢掉，别的会话不串台', async () => {
  const h = harness()
  const adapter = createDshSessionLlm({ bridge: h.bridge, sessionId: 'session-aaaa', timeoutMs: 5_000, logger: silent })
  const pending = collect(adapter.stream({ messages: [{ role: 'user', content: '客厅灯开了吗' }] }))
  await tick()
  assert.equal(h.prompts.length, 1)
  const requestId = h.prompts[0].requestId
  h.emit('session-bbbb', { type: 'turn/start', data: { turn: 9 } })
  h.emit('session-bbbb', { type: 'assistant/message', data: { turn: 9, message: { content: [{ type: 'text', text: '别人家的话' }] } } })
  h.emit('session-aaaa', { type: 'turn/start', data: { turn: 3 } })
  h.emit('session-aaaa', { type: 'user/message', data: { source: { rpcId: requestId } } })
  h.emit('session-aaaa', {
    type: 'assistant/message',
    data: { turn: 3, message: { content: [{ type: 'text', text: '我先查一下。' }, { type: 'tool-call', name: 'hass_get_state' }] } },
  })
  h.emit('session-aaaa', {
    type: 'assistant/message',
    data: { turn: 3, message: { content: [{ type: 'text', text: '**开着**，客厅灯现在是亮的。' }] } },
  })
  h.emit('session-aaaa', { type: 'turn/end', data: { turn: 3 } })
  assert.deepEqual(await pending, ['开着，客厅灯现在是亮的。'])
})

test('默认原话直送（与文本框一致），显式 instruction 才加前缀', async () => {
  const h = harness()
  const adapter = createDshSessionLlm({ bridge: h.bridge, sessionId: 'session-aaaa', timeoutMs: 5_000, logger: silent })
  const pending = collect(adapter.stream({ messages: [{ role: 'user', content: '今天几号' }] }))
  await tick()
  assert.equal(h.prompts[0].content[0].text, '今天几号')
  assert.equal(h.prompts[0].mode, 'queue')
  h.emit('session-aaaa', { type: 'turn/start', data: { turn: 1 } })
  h.emit('session-aaaa', { type: 'user/message', data: { source: { rpcId: h.prompts[0].requestId } } })
  h.emit('session-aaaa', { type: 'turn/end', data: { turn: 1 } })
  await pending

  const h2 = harness()
  const withPrefix = createDshSessionLlm({
    bridge: h2.bridge,
    sessionId: 'session-aaaa',
    instruction: '用一句话回答。',
    timeoutMs: 5_000,
    logger: silent,
  })
  const pending2 = collect(withPrefix.stream({ messages: [{ role: 'user', content: '今天几号' }] }))
  await tick()
  assert.equal(h2.prompts[0].content[0].text, '用一句话回答。\n今天几号')
  h2.emit('session-aaaa', { type: 'turn/start', data: { turn: 1 } })
  h2.emit('session-aaaa', { type: 'user/message', data: { source: { rpcId: h2.prompts[0].requestId } } })
  h2.emit('session-aaaa', { type: 'turn/end', data: { turn: 1 } })
  await pending2
})

test('打断会取消会话当前 turn，且不再吐字', async () => {
  const h = harness()
  const adapter = createDshSessionLlm({ bridge: h.bridge, sessionId: 'session-aaaa', timeoutMs: 5_000, logger: silent })
  const controller = new AbortController()
  const pending = collect(adapter.stream({ messages: [{ role: 'user', content: '讲个故事' }], signal: controller.signal }))
  await tick()
  controller.abort()
  assert.deepEqual(await pending, [])
  assert.deepEqual(h.cancels, ['session-aaaa'])
})

test('超时会取消会话并抛错（不让下一句排在长任务后面）', async () => {
  const h = harness()
  const adapter = createDshSessionLlm({ bridge: h.bridge, sessionId: 'session-aaaa', timeoutMs: 120, logger: silent })
  const pending = collect(adapter.stream({ messages: [{ role: 'user', content: '跑个长任务' }] }))
  await assert.rejects(pending, /会话超时/)
  assert.deepEqual(h.cancels, ['session-aaaa'])
})

test('已中止的信号不会发 prompt，也不会挂着等', async () => {
  const h = harness()
  const adapter = createDshSessionLlm({ bridge: h.bridge, sessionId: 'session-aaaa', timeoutMs: 5_000, logger: silent })
  const controller = new AbortController()
  controller.abort()
  const chunks = await collect(
    adapter.stream({ messages: [{ role: 'user', content: '在吗' }], signal: controller.signal }),
  )
  assert.deepEqual(chunks, [])
  assert.equal(h.prompts.length, 0)
})

test('会话 id 缺失时给出明确错误，而不是静默无声', async () => {
  const h = harness()
  const adapter = createDshSessionLlm({ bridge: h.bridge, sessionId: () => '', timeoutMs: 5_000, logger: silent })
  await assert.rejects(
    collect(adapter.stream({ messages: [{ role: 'user', content: '你好' }] })),
    /语音会话未绑定/,
  )
})

test('工具调用播报进度并发布设备气泡，最终仍只念结论', async () => {
  const h = harness()
  const adapter = createDshSessionLlm({
    bridge: h.bridge,
    sessionId: 'session-aaaa',
    timeoutMs: 5_000,
    progress: true,
    progressMinIntervalMs: 0,
    heartbeatMs: 0,
    logger: silent,
  })
  const pending = collect(adapter.stream({ messages: [{ role: 'user', content: '查一下天气' }] }))
  await tick()
  h.emit('session-aaaa', { type: 'turn/start', data: { turn: 1 } })
  h.emit('session-aaaa', { type: 'user/message', data: { source: { rpcId: h.prompts[0].requestId } } })
  h.emit('session-aaaa', {
    type: 'tool/call',
    data: { turn: 1, step: 1, callId: 'call-1', name: 'web_search', arguments: '{}' },
  })
  h.emit('session-aaaa', {
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { content: [{ type: 'tool-call', name: 'web_search' }] } },
  })
  h.emit('session-aaaa', {
    type: 'assistant/message',
    data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: '今天晴，26 度。' }] } },
  })
  h.emit('session-aaaa', { type: 'turn/end', data: { turn: 1 } })
  const out = await pending
  assert.deepEqual(out[0], { type: 'notice', text: 'web_search' })
  assert.deepEqual(out[1], { type: 'progress', text: '我正在联网查。' })
  assert.equal(out[out.length - 1], '今天晴，26 度。')
})

test('最终回复先做语音摘要；摘要为空时回落到 toSpeech', async () => {
  const h = harness()
  const seen = []
  const adapter = createDshSessionLlm({
    bridge: h.bridge,
    sessionId: 'session-aaaa',
    timeoutMs: 5_000,
    summarize: async (text) => {
      seen.push(text)
      return '都办好了，文件在会话里。'
    },
    summaryMinChars: 10,
    progressMinIntervalMs: 0,
    heartbeatMs: 0,
    logger: silent,
  })
  const pending = collect(adapter.stream({ messages: [{ role: 'user', content: '整理一下' }] }))
  await tick()
  h.emit('session-aaaa', { type: 'turn/start', data: { turn: 1 } })
  h.emit('session-aaaa', { type: 'user/message', data: { source: { rpcId: h.prompts[0].requestId } } })
  h.emit('session-aaaa', {
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '**已经整理完**，三个文件都改好了，详细内容见附件。' }] } },
  })
  h.emit('session-aaaa', { type: 'turn/end', data: { turn: 1 } })
  const out = await pending
  assert.equal(seen.length, 1)
  assert.match(seen[0], /已经整理完/)
  assert.deepEqual(out[0], { type: 'progress', text: '我整理一下，马上说。' })
  assert.equal(out[1], '都办好了，文件在会话里。')

  const h2 = harness()
  const fallback = createDshSessionLlm({
    bridge: h2.bridge,
    sessionId: 'session-aaaa',
    timeoutMs: 5_000,
    summarize: async () => '',
    summaryMinChars: 10,
    heartbeatMs: 0,
    logger: silent,
  })
  const pending2 = collect(fallback.stream({ messages: [{ role: 'user', content: '整理一下' }] }))
  await tick()
  h2.emit('session-aaaa', { type: 'turn/start', data: { turn: 1 } })
  h2.emit('session-aaaa', { type: 'user/message', data: { source: { rpcId: h2.prompts[0].requestId } } })
  h2.emit('session-aaaa', {
    type: 'assistant/message',
    data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '**已经整理完**，三个文件都改好了。' }] } },
  })
  h2.emit('session-aaaa', { type: 'turn/end', data: { turn: 1 } })
  const out2 = await pending2
  assert.equal(out2[out2.length - 1], '已经整理完，三个文件都改好了。')
})

test('绑定按智能体持久化，重载后复用同一会话', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-sessions-'))
  try {
    const file = join(dir, 'voice-sessions.json')
    const store = new SessionBindingStore({ file, logger: silent })
    await store.load()
    assert.equal(store.get('agent-1'), '')
    await store.set('agent-1', 'session-bbbb')
    const reloaded = new SessionBindingStore({ file, logger: silent })
    await reloaded.load()
    assert.equal(reloaded.get('agent-1'), 'session-bbbb')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.version, 1)
    assert.equal(saved.agents['agent-1'], 'session-bbbb')
    await assert.rejects(store.set('agent-1', 'not-a-session'), /invalid sessionId/)
    await store.remove('agent-1')
    assert.equal(store.get('agent-1'), '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
