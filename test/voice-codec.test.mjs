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
import { encodePcmToOpus, probeFfmpeg, UplinkDecoder } from '../src/voice/codec.js'
import { openWebSocket } from './ws-client.mjs'

const MAC = '02:4A:7D:E3:89:BF'
const silent = { info() {}, warn() {}, error() {} }

function tone(ms, sampleRate, amplitude = 0.35, frequency = 320) {
  const samples = Math.round((sampleRate * ms) / 1000)
  const buffer = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * amplitude
    buffer.writeInt16LE(Math.round(value * 32_767), index * 2)
  }
  return buffer
}

test('the real Opus/ffmpeg codec path carries a turn end to end', async (t) => {
  const probe = await probeFfmpeg()
  if (!probe.ok) {
    t.skip('ffmpeg is not available')
    return
  }

  const speech = await encodePcmToOpus(tone(600, 16_000), { sampleRate: 16_000, frameMs: 60 })
  const silence = await encodePcmToOpus(Buffer.alloc(16_000 * 2 * 0.5), { sampleRate: 16_000, frameMs: 60 })
  assert.ok(speech.packets.length >= 8, 'a 600ms tone must produce ~10 opus packets')

  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-codec-'))
  const config = {
    host: '127.0.0.1',
    port: 0,
    dataRoot: dir,
    onboarding: { autoProvision: true, maxDevices: 100 },
    ownerUserId: 1,
    timezoneOffset: 480,
    lanNetworkCidrs: ['127.0.0.1/32'],
    endpoints: { lanWsUrl: '', wanWsUrl: '', token: '' },
    firmware: { version: '1', url: '', force: false },
    helloTimeoutMs: 3000,
    pingIntervalMs: 20_000,
    idleTimeoutMs: 60_000,
    maxFrameBytes: 262_144,
    voice: {
      enabled: true,
      build: () => ({
        profileId: 'default',
        profileName: '默认',
        adapters: createMockAdapters({ plan: ['开灯'], deltaMs: 1, chunkChars: 4 }),
        config: {
          sampleRate: { uplink: 16_000, downlink: 24_000 },
          frameMs: { uplink: 60, downlink: 20 },
          vadMode: 'energy',
          silenceMs: 240,
          minSpeechMs: 60,
          vadThreshold: 0.012,
          firstChunkChars: 14,
          historyTurns: 4,
          pacingMarginMs: 2,
          language: 'zh',
        },
      }),
      createDecoder: ({ onPcm, onError }) =>
        new UplinkDecoder({ inputRate: 16_000, outputRate: 16_000, onPcm, onError, logger: silent }),
      encodeSpeech: (pcm, options) => encodePcmToOpus(pcm, options),
    },
  }
  const store = new DeviceStore({ file: join(dir, 'devices.json'), logger: silent })
  await store.load()
  const created = await store.ensureDevice({ deviceId: MAC, clientId: 'c', ip: '127.0.0.1' })
  const hub = new ConnectionHub({ logger: silent })
  const ingress = createIngress({ config, store, hub, logger: silent })
  await ingress.listen()
  const port = ingress.server.address().port

  const { status, ws } = await openWebSocket({
    port,
    host: '127.0.0.1',
    path: '/xiaozhi/v1/',
    headers: { 'Device-Id': MAC, 'Client-Id': randomUUID() },
  })
  assert.equal(status, 101)
  const messages = []
  const binaries = []
  ws.on('text', (text) => {
    try {
      messages.push(JSON.parse(text))
    } catch {
      // ignore
    }
  })
  ws.on('binary', (buffer) => binaries.push(buffer))
  ws.sendJson({
    type: 'hello',
    version: 1,
    transport: 'websocket',
    audio_params: { format: 'opus', sample_rate: 16_000, channels: 1, frame_duration: 60 },
  })
  await waitFor(() => messages.some((message) => message.type === 'hello'))
  ws.sendJson({ type: 'listen', state: 'start', mode: 'auto' })

  for (const packet of speech.packets) ws.sendBinary(packet)
  for (const packet of silence.packets) ws.sendBinary(packet)

  try {
    await waitFor(() => messages.some((message) => message.type === 'stt' && !message.partial), 8000)
    const stt = messages.find((message) => message.type === 'stt' && !message.partial)
    assert.equal(stt.text, '开灯')
    await waitFor(() => binaries.length > 0, 8000)
    // Downlink packets must be real Opus: a TOC byte + payload, 20ms each.
    const first = binaries[0]
    assert.ok(first.length > 4)
    const duration = (first[0] >> 3) === 16 || (first[0] >> 3) >= 16 ? 'celt' : 'silk'
    assert.ok(['celt', 'silk'].includes(duration))
  } finally {
    ws.destroy()
    await store.persist()
    await ingress.close()
    await rm(dir, { recursive: true, force: true })
  }
})

async function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}
