import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ConnectionHub } from '../src/hub.js'
import { createIngress } from '../src/ingress.js'
import { DeviceStore } from '../src/store.js'
import { createMockAdapters } from '../src/voice/adapters/mock.js'
import { openWebSocket } from './ws-client.mjs'

const MAC = '02:4A:7D:E3:89:BF'
const silent = { info() {}, warn() {}, error() {} }
const UPLINK = 16_000
const DOWNLINK = 24_000
const FRAME_MS = 60

/** One uplink frame of PCM: silence or a 300 Hz tone at `amplitude`. */
function pcmFrame(ms = FRAME_MS, amplitude = 0) {
  const samples = Math.round((UPLINK * ms) / 1000)
  const buffer = Buffer.alloc(samples * 2)
  if (amplitude > 0) {
    for (let index = 0; index < samples; index += 1) {
      buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 300 * index) / UPLINK) * amplitude * 32_767), index * 2)
    }
  }
  return buffer
}

const SILENCE = pcmFrame(FRAME_MS)
const VOICE_FRAME = pcmFrame(FRAME_MS, 0.35)

const fakeDecoder = ({ onPcm }) => ({
  push(packet) {
    onPcm(packet)
  },
  close() {},
})

const fakeEncoder = async (pcm, { frameMs = 20 } = {}) => {
  const bytesPerFrame = Math.floor((DOWNLINK * frameMs) / 1000) * 2
  const packets = []
  for (let offset = 0; offset < pcm.length; offset += bytesPerFrame) {
    packets.push(Buffer.from(pcm.subarray(offset, Math.min(offset + bytesPerFrame, pcm.length))))
  }
  return { packets, frameMs }
}

async function startVoiceHarness(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-voice-'))
  const voiceConfig = {
    sampleRate: { uplink: UPLINK, downlink: DOWNLINK },
    frameMs: { uplink: FRAME_MS, downlink: 20 },
    // 这些用例用假 PCM 自己造句子，靠能量 VAD 收口；真机走 device 模式（listen stop）。
    vadMode: 'energy',
    silenceMs: 240,
    minSpeechMs: 60,
    vadThreshold: 0.012,
    firstChunkChars: 14,
    historyTurns: 8,
    pacingMarginMs: 2,
    language: 'zh',
    ...overrides.voice,
  }
  const config = {
    host: '127.0.0.1',
    port: 0,
    dataRoot: dir,
    onboarding: { autoProvision: true, maxDevices: 100 },
    ownerUserId: 1,
    timezoneOffset: 480,
    lanNetworkCidrs: ['127.0.0.1/32'],
    endpoints: { lanWsUrl: '', wanWsUrl: '', token: '' },
    firmware: { version: '1.0.0', url: '', force: false },
    helloTimeoutMs: 3000,
    pingIntervalMs: 20_000,
    idleTimeoutMs: 60_000,
    maxFrameBytes: 262_144,
    voice: {
      enabled: true,
      build: () => ({
        profileId: 'default',
        profileName: '默认',
        adapters: overrides.adapters ?? createMockAdapters({ plan: ['打开客厅的灯'], deltaMs: 1, chunkChars: 4 }),
        config: voiceConfig,
      }),
      createDecoder: overrides.createDecoder ?? fakeDecoder,
      encodeSpeech: overrides.encodeSpeech ?? fakeEncoder,
    },
  }
  const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
  await store.load()
  const device = await store.ensureDevice({ deviceId: MAC, clientId: 'c1', ip: '127.0.0.1' })
  const hub = new ConnectionHub({ logger: silent })
  const ingress = createIngress({ config, store, hub, logger: silent })
  await ingress.listen()
  const port = ingress.server.address().port
  return {
    port,
    store,
    hub,
    ingress,
    voiceConfig,
    async connect() {
      const result = await openWebSocket({
        port,
        host: '127.0.0.1',
        path: '/xiaozhi/v1/',
        headers: { 'Device-Id': MAC, 'Client-Id': randomUUID() },
      })
      assert.equal(result.status, 101, 'activated device must be able to connect')
      const ws = result.ws
      const messages = []
      const binaries = []
      ws.on('text', (text) => {
        try {
          messages.push(JSON.parse(text))
        } catch {
          // ignore
        }
      })
      ws.on('binary', (buffer) => binaries.push({ at: Date.now(), buffer }))
      ws.sendJson({
        type: 'hello',
        version: 1,
        transport: 'websocket',
        audio_params: { format: 'opus', sample_rate: UPLINK, channels: 1, frame_duration: FRAME_MS },
      })
      await waitFor(() => messages.some((message) => message.type === 'hello'))
      ws.sendJson({ type: 'listen', state: 'start', mode: 'auto' })
      return { ws, messages, binaries }
    },
    async dispose() {
      await store.persist()
      await ingress.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for condition')
}

/** Speak one utterance: optional lead-in silence, voice, then trailing silence. */
async function speak(client, { leadMs = 240, voiceMs = 600, tailMs = 500 } = {}) {
  for (let elapsed = 0; elapsed < leadMs; elapsed += FRAME_MS) client.ws.sendBinary(SILENCE)
  for (let elapsed = 0; elapsed < voiceMs; elapsed += FRAME_MS) client.ws.sendBinary(VOICE_FRAME)
  const endedAt = Date.now()
  for (let elapsed = 0; elapsed < tailMs; elapsed += FRAME_MS) client.ws.sendBinary(SILENCE)
  return endedAt
}

test('a spoken turn produces recognized text and paced audio', async () => {
  const harness = await startVoiceHarness()
  try {
    const client = await harness.connect()
    await speak(client)

    await waitFor(() => client.messages.some((message) => message.type === 'stt' && !message.partial))
    const stt = client.messages.find((message) => message.type === 'stt' && !message.partial)
    assert.equal(stt.text, '打开客厅的灯')

    await waitFor(() => client.binaries.length > 0)
    const ttsStart = client.messages.findIndex((message) => message.type === 'tts' && message.state === 'start')
    const sentenceStart = client.messages.findIndex((message) => message.type === 'tts' && message.state === 'sentence_start')
    assert.ok(ttsStart >= 0, 'the device must be told that speech is starting')
    assert.ok(sentenceStart >= 0, 'the subtitle must arrive with the first sentence')

    const voice = harness.hub.get(MAC).voice
    await waitFor(() => voice.snapshot().state === 'speaking', 3000)
    const frames = client.binaries.length
    assert.ok(frames > 3, `expected several audio frames, got ${frames}`)
    // Pacing: at most the 120 ms look-ahead credit plus the frame that is due
    // exactly at the boundary may leave at once; after that frames are spaced by
    // their own duration.
    const burstWindow = client.binaries.filter((entry) => entry.at - client.binaries[0].at < 12).length
    assert.ok(burstWindow <= 7, `burst must stay within the look-ahead credit, saw ${burstWindow} frames in 12ms`)
    client.ws.destroy()
  } finally {
    await harness.dispose()
  }
})

test('the first audio frame meets the latency budget', async () => {
  const harness = await startVoiceHarness()
  try {
    const client = await harness.connect()
    const speechEndedAt = await speak(client)
    await waitFor(() => client.binaries.length > 0, 3000)
    const latency = client.binaries[0].at - speechEndedAt
    const voice = harness.hub.get(MAC).voice
    assert.ok(latency < 1200, `first audio after ${latency}ms, budget is 1200ms`)
    assert.ok(voice.snapshot().firstAudioLatencyMs, 'the session must record its own measurement')
    assert.equal(harness.voiceConfig.silenceMs, 240)
    client.ws.destroy()
  } finally {
    await harness.dispose()
  }
})

test('abort silences the device within 100ms and keeps the session usable', async () => {
  const harness = await startVoiceHarness()
  try {
    const client = await harness.connect()
    await speak(client, { leadMs: 240, voiceMs: 600, tailMs: 400 })
    await waitFor(() => client.binaries.length > 4, 4000)
    const voice = harness.hub.get(MAC).voice
    const generationBefore = voice.generation.current

    const abortAt = Date.now()
    client.ws.sendJson({ type: 'abort' })
    await waitFor(() => client.messages.some((message) => message.type === 'tts' && message.state === 'stop'), 1000)
    const stopAt = client.messages.find((message) => message.type === 'tts' && message.state === 'stop')
    assert.ok(stopAt, 'the device must receive tts stop')
    assert.ok(Date.now() - abortAt < 100, 'the stop signal must be prompt')

    // No audio may follow the stop: that would be ghost audio from the old epoch.
    const framesAtStop = client.binaries.length
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(client.binaries.length, framesAtStop, 'no frame may be sent after the stop')

    assert.ok(voice.generation.current > generationBefore, 'the epoch must advance')
    assert.equal(voice.snapshot().droppedFrames >= 0, true)

    // The session must still answer the next turn.
    client.messages.length = 0
    await speak(client, { leadMs: 200, voiceMs: 600, tailMs: 400 })
    await waitFor(() => client.messages.some((message) => message.type === 'stt' && !message.partial), 4000)
    await waitFor(() => client.binaries.length > framesAtStop, 4000)
    client.ws.destroy()
  } finally {
    await harness.dispose()
  }
})

test('barge-in while speaking interrupts and immediately listens again', async () => {
  const harness = await startVoiceHarness({
    adapters: createMockAdapters({ plan: ['讲个长一点的故事'], deltaMs: 1, chunkChars: 3 }),
  })
  try {
    const client = await harness.connect()
    await speak(client)
    await waitFor(() => client.binaries.length > 3, 4000)
    const before = client.binaries.length
    // New speech begins while the device is still playing.
    for (let index = 0; index < 6; index += 1) client.ws.sendBinary(VOICE_FRAME)
    await waitFor(() => client.messages.some((message) => message.type === 'tts' && message.state === 'stop'), 3000)
    const framesAtStop = client.binaries.length
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(client.binaries.length, framesAtStop, 'barge-in must not leak old audio')
    assert.ok(framesAtStop >= before)
    client.ws.destroy()
  } finally {
    await harness.dispose()
  }
})

test('twenty consecutive turns stay bounded (no queue growth, no leaked sessions)', async () => {
  const harness = await startVoiceHarness()
  try {
    const client = await harness.connect()
    for (let round = 1; round <= 20; round += 1) {
      const before = client.binaries.length
      await speak(client, { leadMs: 120, voiceMs: 360, tailMs: 360 })
      await waitFor(() => client.binaries.length > before, 5000)
      await waitFor(
        () => client.messages.filter((message) => message.type === 'tts' && message.state === 'stop').length >= round,
        5000,
      )
      const voice = harness.hub.get(MAC).voice
      assert.ok(voice.player.queue.size <= 8, `round ${round}: queue depth ${voice.player.queue.size}`)
    }
    const voice = harness.hub.get(MAC).voice
    assert.equal(voice.snapshot().turns, 20, 'every turn must complete')
    assert.equal(harness.hub.size, 1)
    assert.ok(voice.history.length <= harness.voiceConfig.historyTurns * 2)
    client.ws.destroy()
  } finally {
    await harness.dispose()
  }
})

test('device mode: an empty ASR turn is closed and the next spoken turn still works', async () => {
  const replies = ['打开客厅的灯', '', '关掉客厅的灯']
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
  const adapters = createMockAdapters({ plan: ['占位'], reply: '好的。', deltaMs: 1, chunkChars: 4 })
  adapters.asr = scriptedAsr
  const harness = await startVoiceHarness({ adapters, voice: { vadMode: 'device' } })
  try {
    const client = await harness.connect()

    // 第一轮：正常说话 + 固件 listen stop → 必须识别出文字。
    await speak(client)
    client.ws.sendJson({ type: 'listen', state: 'stop' })
    await waitFor(() => client.messages.some((message) => message.type === 'stt' && message.text === '打开客厅的灯'))

    // 等第一轮的 tts stop（设备从 Speaking 回到 Listening）。
    await waitFor(() => client.messages.filter((message) => message.type === 'tts' && message.state === 'stop').length >= 1)

    // 第二轮：只有静音 / 噪声，ASR 返回空 → 服务端不回 tts（固件自己会重发 listen start）。
    client.ws.sendJson({ type: 'listen', state: 'start', mode: 'auto' })
    for (let index = 0; index < 5; index += 1) client.ws.sendBinary(SILENCE)
    client.ws.sendJson({ type: 'listen', state: 'stop' })
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.equal(
      client.messages.filter((message) => message.type === 'tts' && message.state === 'stop').length,
      1,
      'an empty turn must not synthesize a second (silent) round',
    )

    // 第三轮：空回合之后还能继续正常对话（这就是「只能一轮」的回归用例）。
    client.ws.sendJson({ type: 'listen', state: 'start', mode: 'auto' })
    await speak(client)
    client.ws.sendJson({ type: 'listen', state: 'stop' })
    await waitFor(() => client.messages.some((message) => message.type === 'stt' && message.text === '关掉客厅的灯'))
  } finally {
    await harness.dispose()
  }
})

test('device mode: a stray listen stop without an active turn is ignored', async () => {
  const adapters = createMockAdapters({ plan: ['打开客厅的灯'], reply: '好的。', deltaMs: 1, chunkChars: 4 })
  const harness = await startVoiceHarness({ adapters, voice: { vadMode: 'device' } })
  try {
    const client = await harness.connect()
    // 先把当前在收的这条正常收掉，让 asrStream 变空；随后再发一次 listen stop。
    await speak(client)
    client.ws.sendJson({ type: 'listen', state: 'stop' })
    await waitFor(() => client.messages.filter((message) => message.type === 'tts' && message.state === 'stop').length >= 1)

    client.ws.sendJson({ type: 'listen', state: 'stop' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    // 只有第一轮回复；多余的 listen stop 不再产生 tts 回合。
    assert.equal(
      client.messages.filter((message) => message.type === 'tts' && message.state === 'stop').length,
      1,
      'a stray stop must not start another tts round',
    )
  } finally {
    await harness.dispose()
  }
})
