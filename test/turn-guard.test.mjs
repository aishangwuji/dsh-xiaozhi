import assert from 'node:assert/strict'
import test from 'node:test'
import { VoiceSession } from '../src/voice/session.js'
import { createMockAdapters } from '../src/voice/adapters/mock.js'

const RATE = 16_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function tone(ms, amplitude = 12_000) {
  const samples = Math.floor((RATE * ms) / 1000)
  const buffer = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / RATE) * amplitude), index * 2)
  }
  return buffer
}

const silence = (ms) => Buffer.alloc(Math.floor((RATE * ms) / 1000) * 2)

const waitFor = async (predicate, timeoutMs = 1_500) => {  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(10)
  }
  throw new Error('timed out waiting for condition')
}

function makeSession(overrides = {}, adapters = null, options = {}) {
  const json = []
  let pcmSink = null
  const session = new VoiceSession({
    sink: { sendJson: (message) => json.push(message), sendBinary: () => {} },
    adapters: adapters ?? createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 0, chunkChars: 4 }),
    config: {
      sampleRate: { uplink: RATE, downlink: 24_000 },
      frameMs: { uplink: 60, downlink: 20 },
      silenceMs: 60,
      minSpeechMs: 60,
      vadThreshold: 0.012,
      firstChunkChars: 14,
      historyTurns: 4,
      pacingMarginMs: 2,
      language: 'zh',
      ...overrides,
    },
    createDecoder: ({ onPcm }) => {
      pcmSink = onPcm
      return { push() {}, close() {} }
    },
    encodeSpeech: async () => ({ packets: [Buffer.alloc(40)], frameMs: 20 }),
    sessionId: options.sessionId ?? '',
    deviceId: 'TEST',
  })
  session.start()
  return { session, json, feed: (pcm) => pcmSink(pcm) }
}

test('设备 listen stop 后留续话窗口：窗口内继续说就不收口', async () => {
  const { session, json, feed } = makeSession({ continuationMs: 80 })
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })
  await sleep(25)
  assert.equal(json.some((message) => message.type === 'stt'), false, 'grace 窗口内不应马上收口')

  feed(tone(120)) // 用户其实还在说
  await sleep(120)
  assert.equal(json.some((message) => message.type === 'stt'), false, '续话后应收口取消，同一段话继续')

  session.handleListen({ state: 'stop' })
  await waitFor(() => json.some((message) => message.type === 'stt' && message.text === '你好'))
  await session.close()
})

test('续话窗口内没有新语音就正常收口（不引入额外长等待）', async () => {
  const { session, json, feed } = makeSession({ continuationMs: 60 })
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })
  await waitFor(() => json.some((message) => message.type === 'stt' && message.text === '你好'), 800)
  await session.close()
})

test('工具调用前下发 % 提示，设备端显示“正在搜索/处理中”', async () => {
  const adapters = createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 0, chunkChars: 4 })
  let round = 0
  adapters.llm = {
    name: 'tool-llm',
    async *streamWithTools() {
      round += 1
      if (round === 1) {
        yield { type: 'tool_calls', calls: [{ id: 'c1', name: 'web_search', arguments: '{"query":"新闻"}' }] }
        return
      }
      yield { type: 'text', text: '🙂 查到了。' }
    },
    async *stream() {
      yield '🙂 查到了。'
    },
  }
  adapters.tools = {
    definitions: () => [{ type: 'function', function: { name: 'web_search', parameters: {} } }],
    invoke: async () => ({ output: 'ok' }),
  }
  const { session, json, feed } = makeSession({ continuationMs: 0 }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })

  await waitFor(() =>
    json.some((message) => message.type === 'tts' && message.state === 'sentence_start' && message.text === '% web_search'),
  )
  await waitFor(() => json.some((message) => message.type === 'tts' && message.state === 'sentence_start' && message.text === '查到了。'))
  await session.close()
})

test('模型只回一个表情时用兜底话术收尾，不能静默', async () => {
  const { session, json, feed } = makeSession({ continuationMs: 0 }, createMockAdapters({ plan: ['你好'], reply: '🙂', deltaMs: 0, chunkChars: 1 }))
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })

  await waitFor(() =>
    json.some((message) => message.type === 'tts' && message.state === 'sentence_start' && message.text.includes('我在呢')),
  )
  assert.equal(json.some((message) => message.type === 'llm' && message.emotion === 'happy'), true)
  await session.close()
})

test('工具报错不再让整轮哑掉：错误回灌给模型并继续下一轮', async () => {
  const adapters = createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 0, chunkChars: 4 })
  let round = 0
  adapters.llm = {
    name: 'tool-llm',
    async *streamWithTools() {
      round += 1
      if (round === 1) {
        yield { type: 'tool_calls', calls: [{ id: 'c1', name: 'web_search', arguments: '{}' }] }
        return
      }
      yield { type: 'text', text: '🙂 刚才没查到，换个说法再试。' }
    },
    async *stream() {
      yield '🙂 刚才没查到，换个说法再试。'
    },
  }
  adapters.tools = {
    definitions: () => [{ type: 'function', function: { name: 'web_search', parameters: {} } }],
    invoke: async () => {
      throw new Error('Missing required argument: query')
    },
  }
  const { session, json, feed } = makeSession({ continuationMs: 0 }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })

  await waitFor(() =>
    json.some((message) => message.type === 'tts' && message.state === 'sentence_start' && message.text.includes('刚才没查到')),
  )
  assert.equal(json.some((message) => message.type === 'stt' && message.error === 'llm_failed'), false)
  await session.close()
})

test('空回合后继续捕获：设备不重发 listen start 也能接住下一句', async () => {
  const replies = ['', '你好']
  const scriptedAsr = {
    name: 'scripted-asr',
    createStream: () => ({
      failed: false,
      write() {},
      async finish() {
        return { text: replies.shift() ?? '' }
      },
      abort() {},
    }),
  }
  const adapters = createMockAdapters({ plan: ['占位'], reply: '好的。', deltaMs: 0, chunkChars: 4 })
  adapters.asr = scriptedAsr
  const { session, json, feed } = makeSession({ continuationMs: 0 }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })
  await sleep(120)
  assert.equal(json.some((message) => message.type === 'stt'), false)

  // 关键：不再发 listen start，直接说下一句（设备仍停在 Listening 的真实情况）。
  feed(tone(240))
  session.handleListen({ state: 'stop' })
  await waitFor(() => json.some((message) => message.type === 'stt' && message.text === '你好'))
  await session.close()
})

test('唤醒词 detect 直接回一句开场白，不需要用户再说第二句', async () => {
  const adapters = createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 0, chunkChars: 4 })
  adapters.tts = {
    name: 'slow-tts',
    async *synthesize() {
      await sleep(300)
      yield Buffer.alloc(960)
    },
  }
  const { session, json } = makeSession({ continuationMs: 0 }, adapters)
  session.handleListen({ state: 'detect', text: '你好小智' })

  // 开场白期间设备会补发 listen start：这时不能开捕获（会把 TTS 回声当用户说话）
  session.handleListen({ state: 'start' })
  assert.equal(session.capturing, false)
  await waitFor(() => json.some((message) => message.type === 'tts' && message.state === 'sentence_start' && message.text === '好的。'))
  // 开场白结束后补上捕获，用户这时说话能被接住
  await waitFor(() => session.capturing === true, 2_000)
  await session.close()
})

test('播放中插话：打断后立即进入捕获，不丢用户的话', async () => {
  const adapters = createMockAdapters({ plan: ['你好'], reply: '这是一段比较长的回答。', deltaMs: 0, chunkChars: 4 })
  adapters.tts = {
    name: 'slow-tts',
    async *synthesize() {
      await sleep(1200)
      yield Buffer.alloc(960)
    },
  }
  const { session, json, feed } = makeSession({ continuationMs: 0 }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })

  await waitFor(() => json.some((message) => message.type === 'tts' && message.state === 'start'))
  await waitFor(() => session.state === 'speaking' || session.state === 'thinking')
  // 先给一段静音让能量 VAD 从「说话」回到「静音」，再模拟用户插话
  feed(silence(240))
  await sleep(30)
  feed(tone(300))
  await waitFor(() => session.state === 'listening' && session.capturing === true, 3_000)
  assert.notEqual(session.asrStream, null)
  await session.close()
})

test('ASR 失败用 alert 错误气泡收尾，不再发空气泡', async () => {
  const asr = {
    name: 'fail-asr',
    createStream: () => ({
      failed: false,
      write() {},
      async finish() {
        return { text: '', error: 'asr_failed' }
      },
      abort() {},
    }),
  }
  const adapters = createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 0, chunkChars: 4 })
  adapters.asr = asr
  const { session, json, feed } = makeSession({ continuationMs: 0 }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })

  await waitFor(() => json.some((message) => message.type === 'alert'))
  const alert = json.find((message) => message.type === 'alert')
  assert.equal(alert.status, '听不清')
  assert.match(alert.message, /没听清/)
  assert.equal(alert.emotion, 'sad')
  assert.equal(json.some((message) => message.type === 'stt' && message.error === 'asr_failed'), false)
  await session.close()
})

test('LLM 失败时发 alert 并播兜底话术，不再重复 stt', async () => {
  const adapters = createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 0, chunkChars: 4 })
  adapters.llm = {
    name: 'fail-llm',
    async *stream() {
      throw new Error('llm down')
    },
  }
  const { session, json, feed } = makeSession({ continuationMs: 0 }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  session.handleListen({ state: 'stop' })

  await waitFor(() => json.some((message) => message.type === 'alert'))
  const alert = json.find((message) => message.type === 'alert')
  assert.equal(alert.status, '出错了')
  assert.match(alert.message, /出了点问题/)
  await waitFor(() =>
    json.some((message) => message.type === 'tts' && message.state === 'sentence_start' && message.text.includes('出了点问题')),
  )
  assert.equal(json.some((message) => message.type === 'stt' && message.error === 'llm_failed'), false)
  await session.close()
})

test('下行业务消息都带 session_id', async () => {
  const { session, json } = makeSession({ continuationMs: 0 }, null, { sessionId: 'sess-test-1' })
  await session.speak('测试消息')
  assert.ok(json.length > 0)
  for (const message of json) {
    assert.equal(message.session_id, 'sess-test-1', `${message.type} 缺少 session_id`)
  }
  await session.close()
})
