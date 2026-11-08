import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeAsr } from '../src/voice/asr-probe.js'

/** 假 TTS：按给定 chunk 列表 yield PCM。 */
function fakeTts(chunks = [Buffer.alloc(640, 1), Buffer.alloc(640, 2)]) {
  return () => ({
    synthesize: async function* () {
      for (const chunk of chunks) yield chunk
    },
  })
}

/** 假 ASR：记录每次 write 的字节数，finish 返回固定文本。 */
function fakeAsr(text = '你好小智') {
  const writes = []
  return {
    writes,
    build: () => ({
      createStream: () => ({
        write: async (buffer) => { writes.push(buffer.length) },
        finish: async () => ({ text }),
        abort: () => {},
      }),
    }),
  }
}

test('probeAsr synthesizes speech then feeds the ASR stream', async () => {
  const asr = fakeAsr('你好小智')
  const result = await probeAsr({
    spec: { provider: 'volc' },
    ttsSpec: { provider: 'volc' },
    buildTts: fakeTts(),
    buildAsr: asr.build,
  })
  assert.equal(result.text, '你好小智')
  assert.equal(result.bytes, 1280)
  assert.equal(asr.writes.reduce((sum, size) => sum + size, 0), 1280)
  // 16k × 100ms × 2 bytes = 3200 字节一块；1280 字节只需一次 write。
  assert.equal(asr.writes.length, 1)
})

test('probeAsr refuses a missing or mock TTS', async () => {
  await assert.rejects(
    probeAsr({ spec: { provider: 'volc' }, ttsSpec: { provider: 'mock' }, buildTts: fakeTts(), buildAsr: () => ({}) }),
    /TTS/,
  )
  await assert.rejects(
    probeAsr({ spec: { provider: 'volc' }, buildTts: fakeTts(), buildAsr: () => ({}) }),
    /TTS/,
  )
})

test('probeAsr refuses when TTS returns no audio', async () => {
  await assert.rejects(
    probeAsr({ spec: { provider: 'volc' }, ttsSpec: { provider: 'volc' }, buildTts: fakeTts([]), buildAsr: () => ({}) }),
    /没有返回音频/,
  )
})

test('probeAsr surfaces ASR result.error', async () => {
  const buildAsr = () => ({
    createStream: () => ({
      write: async () => {},
      finish: async () => ({ text: '', error: '401 unauthorized' }),
      abort: () => {},
    }),
  })
  await assert.rejects(
    probeAsr({ spec: { provider: 'volc' }, ttsSpec: { provider: 'volc' }, buildTts: fakeTts(), buildAsr }),
    /401 unauthorized/,
  )
})

test('probeAsr wraps TTS failures with context', async () => {
  const buildTts = () => ({
    synthesize: async function* () {
      throw new Error('boom')
    },
  })
  await assert.rejects(
    probeAsr({ spec: { provider: 'volc' }, ttsSpec: { provider: 'volc' }, buildTts, buildAsr: () => ({}) }),
    /ASR 测试需要可用的 TTS：boom/,
  )
})
