import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMOTION_EMOJI,
  EMOJI_TO_EMOTION,
  EmotionFilter,
  emotionOfEmoji,
  stripEmoji,
} from '../src/voice/emotion.js'
import { VoiceSession } from '../src/voice/session.js'
import { createMockAdapters } from '../src/voice/adapters/mock.js'

// 固件 21 个表情名（custom/emoji/chibi-maid_240/*.png 的文件名）。
const FIRMWARE_EMOTIONS = [
  'angry', 'confident', 'confused', 'cool', 'crying', 'delicious', 'embarrassed',
  'funny', 'happy', 'kissy', 'laughing', 'loving', 'neutral', 'relaxed', 'sad',
  'shocked', 'silly', 'sleepy', 'surprised', 'thinking', 'winking',
]

const RATE = 16_000
function tone(ms, amplitude = 12_000) {
  const samples = Math.floor((RATE * ms) / 1000)
  const buffer = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / RATE) * amplitude), index * 2)
  }
  return buffer
}
const silence = (ms) => Buffer.alloc(Math.floor((RATE * ms) / 1000) * 2)

const waitFor = async (predicate, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}

function makeSession(reply, overrides = {}) {
  const json = []
  let pcmSink = null
  const session = new VoiceSession({
    sink: { sendJson: (message) => json.push(message), sendBinary: () => {} },
    adapters: createMockAdapters({ plan: ['你好'], reply, deltaMs: 0, chunkChars: 2 }),
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

test('表情名表与固件 21 个资源一一对应', () => {
  assert.deepEqual(Object.keys(EMOTION_EMOJI).sort(), [...FIRMWARE_EMOTIONS].sort())
  assert.equal(new Set(Object.values(EMOTION_EMOJI)).size, 21)
  for (const [name, emoji] of Object.entries(EMOTION_EMOJI)) {
    assert.equal(EMOJI_TO_EMOTION[emoji], name)
    assert.equal(emotionOfEmoji(emoji), name)
  }
  // 同义写法归到规范名
  assert.equal(emotionOfEmoji('😊'), 'happy')
  assert.equal(emotionOfEmoji('🤖'), '')
})

test('EmotionFilter 取出开头 emoji，正文 emoji 全部清掉', () => {
  const filter = new EmotionFilter()
  const first = filter.push('😠 你怎么又迟到了。')
  assert.equal(first.emotion, 'angry')
  assert.equal(first.text, ' 你怎么又迟到了。')
  const second = filter.push('真的😤生气。')
  assert.equal(second.emotion, '')
  assert.equal(second.text, '真的生气。')
  assert.equal(stripEmoji('好🙂的。'), '好的。')
})

test('EmotionFilter 能接住被 SSE 拆成两半的 emoji', () => {
  const filter = new EmotionFilter()
  assert.deepEqual(filter.push('\uD83D'), { text: '', emotion: '' })
  const rest = filter.push('\uDE42好的。')
  assert.equal(rest.emotion, 'happy')
  assert.equal(rest.text, '好的。')
  assert.equal(filter.flush(), '')
})

test('EmotionFilter 对没按约定开头的回复原样放行', () => {
  const filter = new EmotionFilter()
  const out = filter.push('今天天气不错。')
  assert.equal(out.emotion, '')
  assert.equal(out.text, '今天天气不错。')
})

test('会话把开头 emoji 作为 emotion 下发给设备，TTS 文本里没有 emoji', async () => {
  const { session, json, feed } = makeSession('🙂 好的。')
  session.handleListen({ state: 'start' })
  feed(tone(240))
  feed(silence(600))
  session.handleListen({ state: 'stop' })

  await waitFor(() => json.some((message) => message.type === 'llm' && message.emotion === 'happy'))
  await waitFor(() => json.some((message) => message.type === 'tts' && message.state === 'sentence_start'))
  const sentences = json.filter((message) => message.type === 'tts' && message.state === 'sentence_start')
  assert.equal(sentences.some((message) => /🙂/u.test(message.text)), false, 'emoji must not be spoken')
  // 每轮只发一次 emotion，避免一句话内反复切表情
  assert.equal(json.filter((message) => message.type === 'llm').length, 1)
  await session.close()
})

test('回复没有 emoji 时不发 emotion（保持设备当前表情）', async () => {
  const { session, json, feed } = makeSession('好的。')
  session.handleListen({ state: 'start' })
  feed(tone(240))
  feed(silence(600))
  session.handleListen({ state: 'stop' })

  await waitFor(() => json.some((message) => message.type === 'tts' && message.state === 'sentence_start'))
  assert.equal(json.some((message) => message.type === 'llm'), false)
  await session.close()
})
