/**
 * failover 包装与装配层（主用 + 备用）的单元测试。
 *
 * 全部用假适配器与假 clock：这里**不发任何真实网络请求**，也不读真实密钥。
 * 覆盖 `docs/backup-providers.md` 第 6 节的 failover 组：
 *   LLM 未出字前切换 / 出字后不切换 / sticky 与 5 分钟回落；
 *   TTS 整句重试；ASR 回放重试且不推 partial；abort 不触发切换；
 *   候选构建失败被跳过。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFailoverAsr, createFailoverLlm, createFailoverTts } from '../src/voice/adapters/failover.js'
import {
  AdapterConfigError,
  buildAsrAdapter,
  buildLlmAdapter,
  buildTtsAdapter,
  createVoiceAdapters,
} from '../src/voice/adapters/index.js'

// --------------------------------------------------------------------- helpers

function makeClock(start = 1_000) {
  let now = start
  return {
    clock: () => now,
    advance: (ms) => {
      now += ms
    },
    set: (value) => {
      now = value
    },
  }
}

function makeLogger() {
  const events = []
  return {
    events,
    warn(message) {
      events.push({ level: 'warn', message })
    },
    error(message) {
      events.push({ level: 'error', message })
    },
    info(message) {
      events.push({ level: 'info', message })
    },
    warnings() {
      return events.filter((event) => event.level === 'warn').map((event) => event.message)
    },
    errors() {
      return events.filter((event) => event.level === 'error').map((event) => event.message)
    },
  }
}

async function collect(iterable) {
  const items = []
  for await (const item of iterable) items.push(item)
  return items
}

const COOLDOWN_MS = 300_000

// ------------------------------------------------------------------------- LLM

test('LLM switches to a backup before any event and sticks to it', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  const calls = { primary: 0, backup: 0 }
  const primary = {
    name: 'deepseek',
    async *stream() {
      calls.primary += 1
      throw new Error('primary down')
    },
  }
  const backup = {
    name: 'volc',
    async *stream() {
      calls.backup += 1
      yield '你'
      yield '好'
    },
  }
  const llm = createFailoverLlm([primary, backup], {
    labels: ['deepseek', 'volc'],
    clock: clock.clock,
    cooldownMs: COOLDOWN_MS,
    logger,
  })

  assert.deepEqual(await collect(llm.stream({ messages: [] })), ['你', '好'])
  assert.equal(llm.candidateCount, 2)
  assert.equal(llm.preferred, 1, 'a successful backup becomes the preferred candidate')
  assert.equal(calls.primary, 1)
  assert.equal(calls.backup, 1)

  const warnings = logger.warnings()
  assert.equal(warnings.length, 1, 'the failure chain lands in logger.warn only')
  assert.match(warnings[0], /deepseek/)
  assert.match(warnings[0], /volc/)

  // Still sticky: the backup is tried first, the primary is not touched.
  assert.deepEqual(await collect(llm.stream({ messages: [] })), ['你', '好'])
  assert.equal(calls.primary, 1)
  assert.equal(calls.backup, 2)

  // Exactly cooldownMs after the last success is not yet expired (`>`), so it stays
  // on the backup — and succeeding again refreshes the sticky window.
  clock.advance(COOLDOWN_MS)
  assert.deepEqual(await collect(llm.stream({ messages: [] })), ['你', '好'])
  assert.equal(calls.primary, 1)
  assert.equal(calls.backup, 3)

  // Past the cooldown the primary is probed again (fails), then the backup takes over.
  clock.advance(COOLDOWN_MS + 1)
  assert.deepEqual(await collect(llm.stream({ messages: [] })), ['你', '好'])
  assert.equal(calls.primary, 2)
  assert.equal(calls.backup, 4)
})

test('LLM never switches once it has yielded an event', async () => {
  const logger = makeLogger()
  let backupCalls = 0
  const primary = {
    name: 'primary',
    async *stream() {
      yield '一'
      throw new Error('mid-stream boom')
    },
  }
  const backup = {
    name: 'backup',
    async *stream() {
      backupCalls += 1
      yield '备用'
    },
  }
  const llm = createFailoverLlm([primary, backup], { labels: ['deepseek', 'volc'], logger })

  await assert.rejects(collect(llm.stream({ messages: [] })), /mid-stream boom/)
  assert.equal(backupCalls, 0, 'retrying after output would speak the sentence twice')
  assert.equal(llm.preferred, 0)
  assert.equal(logger.warnings().length, 0, 'a post-output failure is not a failover event')
})

test('LLM walks the whole chain and prefers the sticky backup next time', async () => {
  const clock = makeClock()
  const calls = []
  const make = (name, ok) => ({
    name,
    async *stream() {
      calls.push(name)
      if (!ok) throw new Error(`${name} down`)
      yield name
    },
  })
  const llm = createFailoverLlm([make('primary', false), make('backup1', false), make('backup2', true)], {
    labels: ['deepseek', 'openai', 'volc'],
    clock: clock.clock,
    logger: makeLogger(),
  })
  assert.deepEqual(await collect(llm.stream({ messages: [] })), ['backup2'])
  assert.equal(llm.preferred, 2)

  calls.length = 0
  assert.deepEqual(await collect(llm.stream({ messages: [] })), ['backup2'])
  assert.deepEqual(calls, ['backup2'], 'the sticky candidate is tried first')
})

test('LLM throws the last error when every candidate fails', async () => {
  const llm = createFailoverLlm(
    [
      {
        name: 'primary',
        async *stream() {
          throw new Error('primary down')
        },
      },
      {
        name: 'backup',
        async *stream() {
          throw new Error('backup down')
        },
      },
    ],
    { labels: ['deepseek', 'volc'], logger: makeLogger() },
  )
  await assert.rejects(collect(llm.stream({ messages: [] })), /backup down/)
})

test('LLM systemPrompt is written through to every candidate', async () => {
  const primary = {
    name: 'primary',
    systemPrompt: '主用人设',
    async *stream() {
      yield 'x'
    },
  }
  const backup = {
    name: 'backup',
    systemPrompt: '备用的人设',
    async *stream() {
      yield 'x'
    },
  }
  const llm = createFailoverLlm([primary, backup], { labels: ['deepseek', 'volc'] })
  assert.equal(llm.systemPrompt, '主用人设')

  llm.systemPrompt = '你是测试角色'
  assert.equal(llm.systemPrompt, '你是测试角色')
  assert.equal(primary.systemPrompt, '你是测试角色')
  assert.equal(backup.systemPrompt, '你是测试角色')
})

test('LLM streamWithTools converts a candidate without tool support into text events', async () => {
  const primary = {
    name: 'primary',
    async *streamWithTools() {
      throw new Error('tools unavailable')
    },
  }
  const backup = {
    name: 'backup',
    async *stream() {
      yield '后备文本'
    },
  }
  const llm = createFailoverLlm([primary, backup], { labels: ['deepseek', 'volc'], logger: makeLogger() })
  const events = await collect(llm.streamWithTools({ messages: [], tools: [] }))
  assert.deepEqual(events, [{ type: 'text', text: '后备文本' }])
  assert.equal(llm.preferred, 1)
})

test('LLM streamWithTools keeps tool_calls events from a backup', async () => {
  const calls = [{ id: 'call_1', name: 'npc_status', arguments: '{}' }]
  const llm = createFailoverLlm(
    [
      {
        name: 'primary',
        async *streamWithTools() {
          throw new Error('primary down')
        },
      },
      {
        name: 'backup',
        async *streamWithTools() {
          yield { type: 'text', text: '查一下' }
          yield { type: 'tool_calls', calls }
        },
      },
    ],
    { labels: ['deepseek', 'volc'], logger: makeLogger() },
  )
  const events = await collect(llm.streamWithTools({ messages: [], tools: [{ type: 'function' }] }))
  assert.deepEqual(events, [
    { type: 'text', text: '查一下' },
    { type: 'tool_calls', calls },
  ])
})

test('LLM abort is not a failure and never triggers a switch', async () => {
  const logger = makeLogger()
  const controller = new AbortController()
  let backupCalls = 0
  const primary = {
    name: 'primary',
    async *stream() {
      throw new Error('network down')
    },
  }
  const backup = {
    name: 'backup',
    async *stream() {
      backupCalls += 1
      yield '不该出现'
    },
  }
  const llm = createFailoverLlm([primary, backup], { labels: ['deepseek', 'volc'], logger })

  controller.abort()
  assert.deepEqual(await collect(llm.stream({ messages: [], signal: controller.signal })), [])
  assert.equal(backupCalls, 0)
  assert.equal(llm.preferred, 0)
  assert.equal(logger.warnings().length, 0)

  // Abort while the stream is running: whatever was already yielded stays, no retry.
  const controller2 = new AbortController()
  const streaming = {
    name: 'streaming',
    async *stream() {
      yield 'a'
      controller2.abort()
      throw new Error('aborted')
    },
  }
  const llm2 = createFailoverLlm([streaming, backup], { labels: ['deepseek', 'volc'], logger: makeLogger() })
  assert.deepEqual(await collect(llm2.stream({ messages: [], signal: controller2.signal })), ['a'])
  assert.equal(backupCalls, 0)
  assert.equal(llm2.preferred, 0)
})

// ------------------------------------------------------------------------- TTS

test('TTS retries the whole sentence on the next candidate, leaking no partial audio', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  const primary = {
    name: 'xunfei',
    async *synthesize() {
      yield Buffer.from([1, 2])
      throw new Error('tts down')
    },
  }
  const backup = {
    name: 'volc',
    async *synthesize() {
      yield Buffer.from([9])
      yield Buffer.from([8, 7])
    },
  }
  const tts = createFailoverTts([primary, backup], {
    labels: ['xunfei', 'volc'],
    clock: clock.clock,
    logger,
  })

  const chunks = await collect(tts.synthesize('第一句。', { sampleRate: 24_000 }))
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([9, 8, 7]))
  assert.equal(tts.preferred, 1)
  assert.match(logger.warnings()[0], /xunfei/)

  // The next sentence starts on the sticky backup.
  const next = await collect(tts.synthesize('第二句。', {}))
  assert.deepEqual(Buffer.concat(next), Buffer.from([9, 8, 7]))
})

test('TTS abort yields nothing and never switches', async () => {
  const controller = new AbortController()
  let backupCalls = 0
  const primary = {
    name: 'xunfei',
    async *synthesize() {
      yield Buffer.from([1])
      controller.abort()
      throw new Error('aborted')
    },
  }
  const backup = {
    name: 'volc',
    async *synthesize() {
      backupCalls += 1
      yield Buffer.from([9])
    },
  }
  const tts = createFailoverTts([primary, backup], { labels: ['xunfei', 'volc'], logger: makeLogger() })
  const chunks = await collect(tts.synthesize('打断。', { signal: controller.signal }))
  assert.deepEqual(chunks, [])
  assert.equal(backupCalls, 0)
  assert.equal(tts.preferred, 0)
})

test('TTS keeps the primary preferred on success and passes options through', async () => {
  const seen = []
  const tts = createFailoverTts(
    [
      {
        name: 'xunfei',
        async *synthesize(text, options) {
          seen.push({ text, sampleRate: options?.sampleRate })
          yield Buffer.from([1])
        },
      },
      {
        name: 'volc',
        async *synthesize() {
          throw new Error('should not be reached')
        },
      },
    ],
    { labels: ['xunfei', 'volc'], logger: makeLogger() },
  )
  assert.deepEqual(await collect(tts.synthesize('你好', { sampleRate: 24_000 })), [Buffer.from([1])])
  assert.deepEqual(seen, [{ text: '你好', sampleRate: 24_000 }])
  assert.equal(tts.preferred, 0)
})

test('TTS walks the whole candidate chain before giving up', async () => {
  const calls = []
  const tts = createFailoverTts(
    [
      {
        name: 'a',
        async *synthesize() {
          calls.push('a')
          throw new Error('a down')
        },
      },
      {
        name: 'b',
        async *synthesize() {
          calls.push('b')
          throw new Error('b down')
        },
      },
      {
        name: 'c',
        async *synthesize() {
          calls.push('c')
          yield Buffer.from([7])
        },
      },
    ],
    { labels: ['xunfei', 'volc', 'edge'], logger: makeLogger() },
  )
  const chunks = await collect(tts.synthesize('你好', {}))
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([7]))
  assert.deepEqual(calls, ['a', 'b', 'c'])
  assert.equal(tts.preferred, 2)
})

test('TTS throws the last error when every candidate fails', async () => {
  const tts = createFailoverTts(
    [
      {
        name: 'xunfei',
        async *synthesize() {
          throw new Error('first down')
        },
      },
      {
        name: 'volc',
        async *synthesize() {
          throw new Error('second down')
        },
      },
    ],
    { labels: ['xunfei', 'volc'], logger: makeLogger() },
  )
  await assert.rejects(collect(tts.synthesize('你好', {})), /second down/)
})

// ------------------------------------------------------------------------- ASR

function makeFailingAsrHandle({ failWith = new Error('asr down'), onWrite } = {}) {
  return {
    failed: false,
    aborted: false,
    writes: [],
    write(pcm) {
      this.writes.push(Buffer.from(pcm))
      onWrite?.(pcm)
    },
    async finish() {
      throw failWith
    },
    abort() {
      this.aborted = true
    },
  }
}

test('ASR replays the buffered PCM to a backup without pushing partials', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  const primary = { name: 'volc', createStream: () => makeFailingAsrHandle() }
  const opened = []
  const backup = {
    name: 'xunfei',
    createStream(options) {
      const handle = {
        failed: false,
        writes: [],
        options,
        async write(pcm) {
          this.writes.push(Buffer.from(pcm))
        },
        async finish() {
          return { text: '回放识别' }
        },
        abort() {},
      }
      opened.push(handle)
      return handle
    },
  }
  const asr = createFailoverAsr([primary, backup], {
    labels: ['volc', 'xunfei'],
    clock: clock.clock,
    logger,
  })

  const partials = []
  const stream = asr.createStream({ onPartial: (text) => partials.push(text), sampleRate: 16_000 })
  const pcm1 = Buffer.from([1, 2, 3, 4])
  const pcm2 = Buffer.from([5, 6])
  stream.write(pcm1)
  stream.write(pcm2)
  assert.equal(stream.failed, false)

  const result = await stream.finish()
  assert.deepEqual(result, { text: '回放识别' })
  assert.equal(opened.length, 1, 'exactly one fallback stream was opened')
  assert.deepEqual(Buffer.concat(opened[0].writes), Buffer.concat([pcm1, pcm2]))
  assert.equal(opened[0].options.onPartial, undefined, 'replay must not push partials again')
  assert.deepEqual(partials, [])
  assert.equal(asr.preferred, 1)
  assert.match(logger.warnings()[0], /volc/)
})

test('ASR sticky order opens the backup first on the next utterance', async () => {
  const clock = makeClock()
  const counts = { primary: 0, backup: 0 }
  const primary = {
    name: 'volc',
    createStream() {
      counts.primary += 1
      return makeFailingAsrHandle()
    },
  }
  const backup = {
    name: 'xunfei',
    createStream() {
      counts.backup += 1
      return {
        failed: false,
        write() {},
        async finish() {
          return { text: 'ok' }
        },
        abort() {},
      }
    },
  }
  const asr = createFailoverAsr([primary, backup], {
    labels: ['volc', 'xunfei'],
    clock: clock.clock,
    logger: makeLogger(),
  })

  const first = asr.createStream({ sampleRate: 16_000 })
  first.write(Buffer.from([1, 2]))
  await first.finish()
  assert.equal(asr.preferred, 1)

  const second = asr.createStream({ sampleRate: 16_000 })
  await second.finish()
  assert.equal(counts.primary, 1, 'the primary is not retried while sticky')
  assert.equal(counts.backup, 2)
})

test('ASR walks the whole candidate chain, replaying the same buffer', async () => {
  const opened = []
  const failing = (name) => ({
    name,
    createStream() {
      const handle = makeFailingAsrHandle({ failWith: new Error(`${name} down`) })
      opened.push(handle)
      return handle
    },
  })
  const good = {
    name: 'third',
    createStream() {
      const handle = {
        failed: false,
        writes: [],
        async write(pcm) {
          this.writes.push(Buffer.from(pcm))
        },
        async finish() {
          return { text: '第三家' }
        },
        abort() {},
      }
      opened.push(handle)
      return handle
    },
  }
  const asr = createFailoverAsr([failing('a'), failing('b'), good], {
    labels: ['volc', 'xunfei', 'funasr'],
    logger: makeLogger(),
  })
  const stream = asr.createStream({ sampleRate: 16_000 })
  stream.write(Buffer.from([1, 2]))
  assert.deepEqual(await stream.finish(), { text: '第三家' })
  assert.equal(opened.length, 3)
  assert.deepEqual(Buffer.concat(opened[2].writes), Buffer.from([1, 2]))
  assert.equal(asr.preferred, 2)
})

test('ASR refuses to replay once the 60s buffer limit is exceeded', async () => {
  let backupOpened = 0
  const asr = createFailoverAsr(
    [
      { name: 'volc', createStream: () => makeFailingAsrHandle({ failWith: new Error('primary down') }) },
      {
        name: 'xunfei',
        createStream() {
          backupOpened += 1
          return {
            failed: false,
            write() {},
            async finish() {
              return { text: 'should not run' }
            },
            abort() {},
          }
        },
      },
    ],
    { labels: ['volc', 'xunfei'], logger: makeLogger() },
  )

  // sampleRate 1000 → 60s 上限 = 1000 * 2 * 60 = 120000 字节。
  const stream = asr.createStream({ sampleRate: 1_000 })
  stream.write(Buffer.alloc(120_001))
  await assert.rejects(stream.finish(), /primary down/)
  assert.equal(backupOpened, 0, 'without a replayable buffer there is nothing to retry with')
})

test('ASR abort forwards to the active stream and blocks switching', async () => {
  const primaryHandle = makeFailingAsrHandle({ failWith: new Error('finish after abort') })
  let backupOpened = 0
  const asr = createFailoverAsr(
    [
      { name: 'volc', createStream: () => primaryHandle },
      {
        name: 'xunfei',
        createStream() {
          backupOpened += 1
          return {
            failed: false,
            write() {},
            async finish() {
              return { text: '' }
            },
            abort() {},
          }
        },
      },
    ],
    { labels: ['volc', 'xunfei'], logger: makeLogger() },
  )

  const stream = asr.createStream({ sampleRate: 16_000 })
  stream.write(Buffer.from([1, 2]))
  stream.abort()
  assert.equal(primaryHandle.aborted, true)
  await assert.rejects(stream.finish(), /finish after abort/)
  assert.equal(backupOpened, 0)
})

test('ASR failed property mirrors the current stream and partials are forwarded', async () => {
  const handle = {
    failed: false,
    onPartial: null,
    write() {
      this.onPartial?.('你好')
    },
    async finish() {
      return { text: '你好' }
    },
    abort() {},
  }
  const asr = createFailoverAsr(
    [
      {
        name: 'volc',
        createStream(options) {
          handle.onPartial = options.onPartial
          return handle
        },
      },
    ],
    { labels: ['volc'], logger: makeLogger() },
  )
  const partials = []
  const stream = asr.createStream({ onPartial: (text) => partials.push(text), sampleRate: 16_000 })
  assert.equal(stream.failed, false)
  handle.failed = true
  assert.equal(stream.failed, true)
  stream.write(Buffer.from([1, 2]))
  assert.deepEqual(partials, ['你好'])
})

// ----------------------------------------------------------- adapter assembly

test('createVoiceAdapters leaves a single candidate unwrapped', () => {
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: { provider: 'deepseek', apiKey: 'test-key' },
    tts: { provider: 'xunfei', appId: 'a', apiKey: 'k', apiSecret: 's', voice: 'xiaoyan' },
    asr: { provider: 'volc', apiKey: 'k' },
  }
  const adapters = createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg' })
  assert.equal(adapters.llm.name, 'openai')
  assert.equal(adapters.tts.name, 'xunfei')
  assert.equal(adapters.asr.name, 'volc')
})

test('createVoiceAdapters wraps each stage when it has two or more candidates', () => {
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: { provider: 'deepseek', apiKey: 'k', backups: [{ provider: 'deepseek', apiKey: 'k' }] },
    tts: {
      provider: 'xunfei',
      appId: 'a',
      apiKey: 'k',
      apiSecret: 's',
      backups: [{ provider: 'volc', apiKey: 'k', voice: 'v' }],
    },
    asr: {
      provider: 'volc',
      apiKey: 'k',
      backups: [{ provider: 'xunfei', appId: 'a', apiKey: 'k', apiSecret: 's' }],
    },
  }
  const adapters = createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg' })
  for (const stage of ['llm', 'tts', 'asr']) {
    assert.equal(adapters[stage].name, 'failover', `${stage} is wrapped`)
    assert.equal(adapters[stage].candidateCount, 2)
  }
})

test('createVoiceAdapters skips unusable candidates and explains the primary failure', () => {
  const logger = makeLogger()
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: {
      // 主用缺 Key → 构建失败；备用一条能起来、一条未知 provider、一条 mock。
      provider: 'deepseek',
      backups: [
        { provider: 'mimo', model: 'mimo-v2', apiKey: 'k' },
        { provider: 'unknown-vendor', apiKey: 'k' },
        { provider: 'mock' },
      ],
    },
    tts: { provider: 'mock' },
    asr: { provider: 'mock' },
  }
  const adapters = createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg', logger })

  assert.equal(adapters.llm.name, 'openai', 'the one usable backup is returned as-is')
  const errors = logger.errors()
  assert.equal(errors.length, 1)
  assert.match(errors[0], /主用不可用/)
  assert.match(errors[0], /apiKey/)
  const warnings = logger.warnings()
  assert.ok(warnings.some((line) => /mock/.test(line)), 'mock is not allowed in the backup list')
  assert.ok(warnings.some((line) => /unknown-vendor/.test(line)))
})

test('createVoiceAdapters wraps when the primary fails but two backups build', () => {
  const logger = makeLogger()
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: {
      provider: 'deepseek', // 缺 Key
      backups: [
        { provider: 'deepseek', apiKey: 'k' },
        { provider: 'mimo', model: 'mimo-v2', apiKey: 'k' },
      ],
    },
    tts: { provider: 'mock' },
    asr: { provider: 'mock' },
  }
  const adapters = createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg', logger })
  assert.equal(adapters.llm.name, 'failover')
  assert.equal(adapters.llm.candidateCount, 2)
  assert.equal(logger.errors().length, 1)
})

test('createVoiceAdapters throws the primary original error when nothing builds', () => {
  const logger = makeLogger()
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: { provider: 'deepseek', backups: [{ provider: 'xunfei', appId: 'a' }] },
    tts: { provider: 'mock' },
    asr: { provider: 'mock' },
  }
  assert.throws(
    () => createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg', logger }),
    (error) => error instanceof AdapterConfigError && /apiKey is required for the deepseek provider/.test(error.message),
  )
})

test('createVoiceAdapters keeps a mock primary with a real backup off the network', async () => {
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: { provider: 'mock', reply: '本地', deltaMs: 0, backups: [{ provider: 'deepseek', apiKey: 'k' }] },
    tts: { provider: 'mock', backups: [{ provider: 'volc', apiKey: 'k', voice: 'v' }] },
    asr: { provider: 'mock', plan: ['本地识别'], backups: [{ provider: 'volc', apiKey: 'k' }] },
  }
  const adapters = createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg', logger: makeLogger() })
  assert.equal(adapters.llm.name, 'failover')
  assert.equal(adapters.tts.name, 'failover')
  assert.equal(adapters.asr.name, 'failover')

  assert.deepEqual(await collect(adapters.llm.stream({ messages: [] })), ['本地'])

  const audio = await collect(adapters.tts.synthesize('本地合成', { sampleRate: 24_000 }))
  assert.ok(audio.length > 0)
  assert.ok(Buffer.concat(audio).length > 0)

  const stream = adapters.asr.createStream({ sampleRate: 16_000 })
  stream.write(Buffer.from([1, 2, 3, 4]))
  assert.deepEqual(await stream.finish(), { text: '本地识别' })
})

test('the build helpers surface missing host services as configuration errors', () => {
  assert.throws(
    () => buildLlmAdapter({ provider: 'host', hostProvider: 'deepseek', model: 'x' }, {}),
    /未装配 llm 服务/,
  )
  assert.throws(() => buildTtsAdapter({ provider: 'edge' }, { ffmpegPath: '' }), /ffmpegPath/)
  assert.throws(() => buildAsrAdapter({ provider: 'local' }, {}), /speechToText/)
  assert.equal(buildLlmAdapter({ provider: 'mock' }).name, 'mock')
  assert.equal(buildAsrAdapter({ provider: 'mock' }).name, 'mock')
})

test('DSH-hosted LLM entries join the candidate chain like any other provider', () => {
  // 2026-11-10：主用/备用都可以是「复用 DSH 已配置的厂商」，failover 不应特殊对待。
  const llm = {
    listProviders: () => [{ id: 'deepseek' }, { id: 'mimo' }],
    stream: async function* () {},
  }
  const voice = {
    sampleRate: { uplink: 16_000, downlink: 24_000 },
    llm: {
      provider: 'host',
      hostProvider: 'deepseek',
      model: 'deepseek-chat',
      backups: [{ provider: 'host', hostProvider: 'mimo', model: 'mimo-v2' }],
    },
    tts: { provider: 'mock' },
    asr: { provider: 'mock' },
  }
  const adapters = createVoiceAdapters(voice, { ffmpegPath: 'ffmpeg', llm })
  assert.equal(adapters.llm.name, 'failover')
  assert.equal(adapters.llm.candidateCount, 2)

  // hostProvider 不在当前 profile 注册：构建期就明确失败（错误信息列出可用厂商），
  // 而不是等到用户说完第一句话才抛 NO_ADAPTER（设备会停在「聆听中」）。
  assert.throws(
    () => createVoiceAdapters(
      { ...voice, llm: { provider: 'host', hostProvider: 'gone', model: 'x' } },
      { ffmpegPath: 'ffmpeg', llm, logger: makeLogger() },
    ),
    /未在当前 DSH profile 注册/,
  )
})

// ---------------------------------------------------------------- ASR 失败形态

test('ASR treats a finish() result carrying error as a candidate failure', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  // 火山 ASR 不 throw：握手 403 / 服务端错误帧会得到 { text: '', error }。
  // 只看 text 为空会把它记成 asr.empty，备用永远不启用——线上“识别恒为空”就是这么来的。
  const primary = {
    name: 'volc',
    createStream: () => ({
      failed: true,
      async write() {},
      async finish() {
        return { text: '', error: 'websocket handshake failed: HTTP/1.1 403 Forbidden' }
      },
      abort() {},
    }),
  }
  let backupOpened = 0
  const backup = {
    name: 'local',
    createStream() {
      backupOpened += 1
      return {
        failed: false,
        async write() {},
        async finish() {
          return { text: '备用识别成功' }
        },
        abort() {},
      }
    },
  }
  const asr = createFailoverAsr([primary, backup], { labels: ['volc', 'local'], clock: clock.clock, logger })
  const stream = asr.createStream({ sampleRate: 16_000 })
  stream.write(Buffer.from([1, 2, 3, 4]))
  const result = await stream.finish()
  assert.deepEqual(result, { text: '备用识别成功' })
  assert.equal(backupOpened, 1, 'the backup must be opened after a result-level failure')
  assert.equal(asr.preferred, 1)
  assert.match(logger.warnings().join('\n'), /403/)
})

test('ASR keeps a partial text result even when the adapter also reports an error', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  const primary = {
    name: 'volc',
    createStream: () => ({
      failed: true,
      async write() {},
      async finish() {
        return { text: '已经听到一半', error: 'stream closed by server' }
      },
      abort() {},
    }),
  }
  let backupOpened = 0
  const backup = {
    name: 'local',
    createStream() {
      backupOpened += 1
      return { failed: false, async write() {}, async finish() { return { text: '不应使用' } }, abort() {} }
    },
  }
  const asr = createFailoverAsr([primary, backup], { labels: ['volc', 'local'], clock: clock.clock, logger })
  const stream = asr.createStream({ sampleRate: 16_000 })
  const result = await stream.finish()
  assert.deepEqual(result, { text: '已经听到一半', error: 'stream closed by server' })
  assert.equal(backupOpened, 0, 'partial text wins over the error field')
})

test('ASR rejects when every candidate reports result-level failure', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  const failing = {
    name: 'volc',
    createStream: () => ({
      failed: true,
      async write() {},
      async finish() {
        return { text: '', error: 'HTTP/1.1 403 Forbidden' }
      },
      abort() {},
    }),
  }
  const asr = createFailoverAsr([failing, failing], { labels: ['volc', 'volc2'], clock: clock.clock, logger })
  const stream = asr.createStream({ sampleRate: 16_000 })
  await assert.rejects(() => stream.finish(), /403/)
})

// ------------------------------------------------------- 厂商瞬时错误原地重试

test('LLM retries the same candidate once on a transient 5xx', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  let calls = 0
  const primary = {
    name: 'deepseek',
    async *stream() {
      calls += 1
      if (calls === 1) throw new Error('LLM HTTP 500: Internal Server Error')
      yield '你'
      yield '好'
    },
  }
  const llm = createFailoverLlm([primary], { labels: ['deepseek'], clock: clock.clock, logger })
  assert.deepEqual(await collect(llm.stream({ messages: [] })), ['你', '好'])
  assert.equal(calls, 2, 'the same candidate is tried again before failing the turn')
})

test('LLM does not retry a non-transient 4xx', async () => {
  const clock = makeClock()
  const logger = makeLogger()
  let calls = 0
  const primary = {
    name: 'deepseek',
    async *stream() {
      calls += 1
      throw new Error('LLM HTTP 400: bad request')
    },
  }
  const llm = createFailoverLlm([primary], { labels: ['deepseek'], clock: clock.clock, logger })
  await assert.rejects(() => collect(llm.stream({ messages: [] })), /400/)
  assert.equal(calls, 1)
})
