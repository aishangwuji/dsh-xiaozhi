/**
 * 语音结构化提问的端到端（进程内）测试：真的走 VoiceSession 的 TTS/player 与短捕获，
 * 而不是只测解析函数。
 */

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

async function waitFor(predicate, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(10)
  }
  throw new Error('timed out waiting for condition')
}

function makeSession(adapters) {
  const json = []
  let pcmSink = null
  const session = new VoiceSession({
    sink: { sendJson: (message) => json.push(message), sendBinary: () => {} },
    adapters,
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
      continuationMs: 0,
    },
    createDecoder: ({ onPcm }) => {
      pcmSink = onPcm
      return { push() {}, close() {} }
    },
    encodeSpeech: async () => ({ packets: [Buffer.alloc(40)], frameMs: 20 }),
    deviceId: 'TEST',
  })
  session.start()
  return { session, json, feed: (pcm) => pcmSink(pcm) }
}

test('askUserQuestions 真的念题、收两次回答并映射选项', async () => {
  const adapters = createMockAdapters({
    plan: ['红色', '第一个和第三个'],
    reply: '',
    deltaMs: 0,
    chunkChars: 4,
  })
  const { session, json, feed } = makeSession(adapters)
  try {
    const pending = session.askUserQuestions([
      { id: 'q1', question: '选哪个颜色', options: [{ label: '红色' }, { label: '蓝色' }, { label: '绿色' }] },
      {
        id: 'q2',
        question: '还要哪些',
        options: [{ label: '红色' }, { label: '蓝色' }, { label: '绿色' }],
        multiSelect: true,
      },
    ], { timeoutMs: 3_000 })

    await waitFor(() => json.some((message) => message.type === 'tts' && String(message.text || '').includes('选哪个颜色')))
    await waitFor(() => session.capturing === true)
    feed(tone(240))
    session.handleListen({ state: 'stop' })

    await waitFor(() => json.some((message) => message.type === 'tts' && String(message.text || '').includes('还要哪些')))
    await waitFor(() => session.capturing === true)
    feed(tone(240))
    session.handleListen({ state: 'stop' })

    const answers = await pending
    assert.deepEqual(answers, {
      answers: [
        { id: 'q1', selected: ['红色'] },
        { id: 'q2', selected: ['红色', '绿色'] },
      ],
    })
  } finally {
    await session.close()
  }
})
