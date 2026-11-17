import assert from 'node:assert/strict'
import test from 'node:test'
import { VoiceSession } from '../src/voice/session.js'
import { createOggOpusStreamDemuxer } from '../src/voice/ogg.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(10)
  }
  throw new Error('timed out waiting for condition')
}

/** Build one Ogg page. `packets` are laced per the Ogg spec (255-byte runs). */
function oggPage({ headerType = 0, seq = 0, packets = [], truncateLast = false }) {
  const laces = []
  packets.forEach((packet, index) => {
    let remaining = packet.length
    while (remaining >= 255) {
      laces.push(255)
      remaining -= 255
    }
    // truncateLast: 最后一个包在本页以 255 结尾，表示它跨页继续（不带终止 0）。
    if (truncateLast && index === packets.length - 1) return
    laces.push(remaining)
  })
  const header = Buffer.alloc(27)
  header.write('OggS', 0, 'latin1')
  header[4] = 0
  header[5] = headerType
  header.writeBigInt64LE(0n, 6)
  header.writeUInt32LE(1, 14)
  header.writeUInt32LE(seq, 18)
  header.writeUInt32LE(0, 22)
  header[26] = laces.length
  return Buffer.concat([header, Buffer.from(laces), ...packets])
}

function makeSession({ tts, createStreamEncoder }) {
  const json = []
  const frames = []
  const session = new VoiceSession({
    sink: {
      sendJson: (message) => json.push({ ...message, at: Date.now() }),
      sendBinary: (data) => frames.push({ data, at: Date.now() }),
    },
    adapters: {
      asr: { name: 'mock-asr', createStream: () => ({ write() {}, async finish() { return { text: '' } }, abort() {} }) },
      tts,
      llm: {
        name: 'mock-llm',
        async *stream() {
          yield '好的。'
        },
      },
    },
    config: {
      sampleRate: { uplink: 16_000, downlink: 24_000 },
      frameMs: { uplink: 60, downlink: 20 },
      silenceMs: 60,
      minSpeechMs: 60,
      vadThreshold: 0.012,
      firstChunkChars: 14,
      historyTurns: 4,
      pacingMarginMs: 2,
      language: 'zh',
      ffmpegPath: 'ffmpeg',
      historyAudio: false,
    },
    createDecoder: () => ({ push() {}, close() {} }),
    encodeSpeech: async () => ({ packets: [Buffer.alloc(40)], frameMs: 20 }),
    createStreamEncoder,
    deviceId: 'TEST',
  })
  session.start()
  return { session, json, frames }
}

test('incremental Ogg demuxer reassembles packets across arbitrary byte boundaries', () => {
  const head = Buffer.from('OpusHead', 'latin1')
  const tags = Buffer.from('OpusTags', 'latin1')
  const audio1 = Buffer.from([1, 2, 3])
  const audio2 = Buffer.alloc(300, 7)
  const audio3 = Buffer.from([9])

  const split = 255
  const page1 = oggPage({ headerType: 0x02, seq: 0, packets: [head] })
  const page2 = oggPage({ seq: 1, packets: [tags] })
  // audio2 spans two pages: first page ends on a 255 lace, second continues it.
  const page3 = oggPage({
    seq: 2,
    packets: [audio1, audio2.subarray(0, split)],
    truncateLast: true,
  })
  const page4 = oggPage({
    headerType: 0x01,
    seq: 3,
    packets: [audio2.subarray(split), audio3],
  })

  const stream = Buffer.concat([page1, page2, page3, page4])
  const demuxer = createOggOpusStreamDemuxer()
  const packets = []
  for (let offset = 0; offset < stream.length; offset += 3) {
    packets.push(...demuxer.push(stream.subarray(offset, offset + 3)))
  }
  assert.deepEqual(packets, [audio1, audio2, audio3])
})

test('streaming TTS sends the first frame before synthesis finishes', async () => {
  let secondChunkAt = 0
  let firstFrameAt = 0
  const tts = {
    name: 'stream-tts',
    async *synthesize() {
      yield Buffer.alloc(960, 1)
      await sleep(120)
      secondChunkAt = Date.now()
      yield Buffer.alloc(960, 2)
    },
  }
  const { session, json, frames } = makeSession({
    tts,
    createStreamEncoder: (options) => ({
      frameMs: 20,
      write(pcm) {
        // 每个 chunk 立刻产出一个“已编码”的包，模拟流式编码器。
        if (pcm?.length) options.onPacket(Buffer.alloc(40, pcm[0]))
      },
      async end() {},
      close() {},
    }),
  })

  const speaking = session.speak('第一句流式测试。')
  await waitFor(() => frames.length > 0, 1_000)
  firstFrameAt = frames[0].at
  assert.equal(secondChunkAt, 0, 'first frame must leave before the second TTS chunk is produced')
  assert.ok(firstFrameAt > 0)
  await speaking
  assert.ok(secondChunkAt > 0)
  assert.ok(frames[0].at < secondChunkAt, 'first frame should be sent before synthesis finished')
  assert.equal(json.some((message) => message.type === 'tts' && message.state === 'sentence_start'), true)
  assert.equal(json.some((message) => message.type === 'tts' && message.state === 'sentence_end'), true)
  await session.close()
})

test('streaming TTS abort closes the encoder and stops pushing frames', async () => {
  let closed = 0
  const tts = {
    name: 'stream-tts',
    async *synthesize() {
      yield Buffer.alloc(960, 1)
      await sleep(200)
      yield Buffer.alloc(960, 2)
    },
  }
  const { session, json, frames } = makeSession({
    tts,
    createStreamEncoder: (options) => ({
      frameMs: 20,
      write(pcm) {
        if (pcm?.length) options.onPacket(Buffer.alloc(40))
      },
      async end() {},
      close() {
        closed += 1
      },
    }),
  })

  const speaking = session.speak('要被打断的句子。')
  await waitFor(() => frames.length > 0, 1_000)
  session.handleAbort()
  await speaking
  const framesAfterAbort = frames.length
  await sleep(150)
  assert.equal(frames.length, framesAfterAbort, 'no ghost frames after abort')
  assert.ok(closed >= 1, 'encoder must be closed on abort')
  assert.equal(json.some((message) => message.type === 'tts' && message.state === 'stop'), true)
  await session.close()
})

test('streaming TTS with no audio sends no sentence_start and does not throw', async () => {
  const tts = {
    name: 'empty-tts',
    async *synthesize() {
      yield Buffer.alloc(0)
    },
  }
  let closed = 0
  const { session, json } = makeSession({
    tts,
    createStreamEncoder: () => ({
      frameMs: 20,
      write() {},
      async end() {},
      close() {
        closed += 1
      },
    }),
  })
  await session.speak('没有声音的一句话。')
  assert.equal(json.some((message) => message.type === 'tts' && message.state === 'sentence_start'), false)
  await session.close()
})
