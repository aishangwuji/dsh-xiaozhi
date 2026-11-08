import assert from 'node:assert/strict'
import test from 'node:test'
import { VoiceSession } from '../src/voice/session.js'
import { createMockAdapters } from '../src/voice/adapters/mock.js'

const RATE = 16_000

function tone(ms, amplitude = 12_000) {
  const samples = Math.floor((RATE * ms) / 1000)
  const buffer = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / RATE) * amplitude), index * 2)
  }
  return buffer
}

function silence(ms) {
  return Buffer.alloc(Math.floor((RATE * ms) / 1000) * 2)
}

function makeSession(overrides = {}, adapters = null) {
  const json = []
  let pcmSink = null
  const session = new VoiceSession({
    sink: { sendJson: (message) => json.push(message), sendBinary: () => {} },
    adapters: adapters ?? createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 1, chunkChars: 4 }),
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
    deviceId: 'TEST',
  })
  session.start()
  return { session, json, feed: (pcm) => pcmSink(pcm) }
}

const waitFor = async (predicate, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}

test('device mode waits for the firmware listen stop instead of the energy VAD', async () => {
  const { session, json, feed } = makeSession({ vadMode: 'device' })
  session.handleListen({ state: 'start' })

  feed(tone(240))
  feed(silence(600)) // 能量 VAD 早就会判“说完了”，但 device 模式下不许自己收口
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(json.some((message) => message.type === 'stt'), false, 'no stt before the device says stop')

  session.handleListen({ state: 'stop' })
  await waitFor(() => json.some((message) => message.type === 'stt' && message.text === '你好'))
  await waitFor(() => json.some((message) => message.type === 'tts' && message.state === 'start'))
  await session.close()
})

test('energy mode still finalizes on its own VAD silence (old firmware fallback)', async () => {
  const { session, json, feed } = makeSession({ vadMode: 'energy' })
  session.handleListen({ state: 'start' })

  feed(tone(240))
  feed(silence(600))
  await waitFor(() => json.some((message) => message.type === 'stt' && message.text === '你好'))
  await session.close()
})

test('an empty ASR turn does not synthesize speech (firmware re-listens on its own)', async () => {
  const adapters = createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 1, chunkChars: 4 })
  adapters.asr = {
    name: 'empty-asr',
    createStream: () => ({ failed: false, write() {}, async finish() { return { text: '' } }, abort() {} }),
  }
  const { session, json, feed } = makeSession({ vadMode: 'device' }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  feed(silence(600))
  session.handleListen({ state: 'stop' })

  // 空回合（有音频但没识别出内容）不再补 tts start/stop：固件每轮会自己发 listen start，
  // 服务端不需要靠 tts 控制帧把设备从 Speaking 拽回 Listening。
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(json.some((message) => message.type === 'tts'), false)
  assert.equal(json.some((message) => message.type === 'stt'), false)
  await session.close()
})

test('a stray listen stop without an active turn is ignored (no fake tts round)', async () => {
  const { session, json } = makeSession({ vadMode: 'device' })
  // 环境音会触发假的 listen stop，此时服务端没有进行中的 utterance：
  // 不回 tts，否则设备会被迫 speaking↔listening 弹一次，看起来像“自己触发了对话”。
  session.handleListen({ state: 'stop' })
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(json.some((message) => message.type === 'tts'), false)
  await session.close()
})

test('energy mode does not send an empty-turn closure (old firmware has no listen stop)', async () => {
  const adapters = createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 1, chunkChars: 4 })
  adapters.asr = {
    name: 'empty-asr',
    createStream: () => ({ failed: false, write() {}, async finish() { return { text: '' } }, abort() {} }),
  }
  const { session, json, feed } = makeSession({ vadMode: 'energy' }, adapters)
  session.handleListen({ state: 'start' })
  feed(tone(240))
  feed(silence(900))
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(json.some((message) => message.type === 'tts'), false)
  await session.close()
})
