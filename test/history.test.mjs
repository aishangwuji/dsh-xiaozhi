import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createHistoryStore,
  deriveTitle,
  isAudioId,
  LEGACY_SESSION_GAP_MS,
  pcmToWav,
} from '../src/history.js'

const silent = { info() {}, warn() {}, error() {} }
const DEVICE = '02:DE:AD:BE:EF:01'
const MINUTE = 60_000
const DAY = 24 * 60 * 60 * 1000
const T0 = 1_700_000_000_000

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'xz-history-'))
}

function deviceFile(dir, deviceId = DEVICE) {
  return join(dir, `${String(deviceId).replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`)
}

test('deriveTitle strips whitespace and punctuation, then caps at 20 chars', () => {
  assert.equal(deriveTitle('你好，世界！'), '你好世界')
  assert.equal(deriveTitle('  今天 天气\n怎么样？ '), '今天天气怎么样')
  assert.equal(deriveTitle('一二三四五六七八九十一二三四五六七八九十超出'), '一二三四五六七八九十一二三四五六七八九十')
  assert.equal(deriveTitle('😄☕…'), '', 'emoji/symbol-only content leaves no title')
  assert.equal(deriveTitle(''), '')
  assert.equal(deriveTitle(undefined), '')
})

test('pcmToWav writes a mono PCM16 header and trims a half sample', () => {
  const wav = pcmToWav(Buffer.alloc(5), 16_000)
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF')
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE')
  assert.equal(wav.readUInt16LE(22), 1, 'mono')
  assert.equal(wav.readUInt32LE(24), 16_000, 'sample rate is carried through')
  assert.equal(wav.readUInt32LE(40), 4, 'odd trailing byte is dropped')
  assert.ok(isAudioId('deadbeefdeadbeefdeadbeefdeadbeef'))
  assert.equal(isAudioId('../evil'), false)
  assert.equal(isAudioId('a/b'), false)
})

test('appendMessages groups by session, newest first, with title/preview/count', async () => {
  const dir = await tempDir()
  try {
    const history = createHistoryStore({ dir, clock: () => T0, logger: silent })
    await history.appendMessages(DEVICE, 'sess-a', [
      { role: 'user', content: '你好。', at: 1000 },
      { role: 'assistant', content: '你好呀！', at: 1001 },
    ])
    await history.appendMessages(DEVICE, 'sess-a', [
      { role: 'user', content: '今天天气怎么样？', at: 2000 },
      { role: 'assistant', content: '晴。', at: 2001 },
    ])
    await history.appendMessages(DEVICE, 'sess-b', [
      { role: 'user', content: '另一段', at: 3000 },
      { role: 'assistant', content: '好', at: 3001 },
    ])

    const conversations = await history.listConversations(DEVICE)
    assert.equal(conversations.length, 2)
    assert.equal(conversations[0].sessionId, 'sess-b', 'newest conversation first')
    assert.deepEqual(
      conversations.map((entry) => entry.sessionId).sort(),
      ['sess-a', 'sess-b'],
    )

    const a = conversations.find((entry) => entry.sessionId === 'sess-a')
    assert.equal(a.messages, 4)
    assert.equal(a.title, '你好')
    assert.equal(a.startedAt, 1000)
    assert.equal(a.endedAt, 2001)
    assert.equal(a.preview, '晴。')
    assert.equal(a.hasAudio, false)

    assert.equal((await history.listConversations(DEVICE, 1)).length, 1)

    const detail = await history.getConversation(DEVICE, 'sess-a')
    assert.equal(detail.sessionId, 'sess-a')
    assert.equal(detail.messages.length, 4)
    assert.deepEqual(detail.messages[0], { role: 'user', content: '你好。', at: 1000, audioId: null })
    assert.deepEqual(detail.messages[3], { role: 'assistant', content: '晴。', at: 2001, audioId: null })
    assert.equal(await history.getConversation(DEVICE, 'missing'), null)
    assert.equal(await history.getConversation(DEVICE, ''), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('legacy rows are aggregated into sessions by a 10 minute gap', async () => {
  const dir = await tempDir()
  try {
    // 真实数据就是这种扁平格式（~/.dsh-xiaozhi/history/*.jsonl 里 48 行）。
    // 3 行：第 1/2 行相隔 1 分钟 → 同一会话；第 3 行相隔 30 分钟 → 新会话。
    const rows = [
      { at: T0, user: '第一句', assistant: '第一答' },
      { at: T0 + MINUTE, user: '第二句', assistant: '第二答' },
      { at: T0 + 31 * MINUTE, user: '第三句', assistant: '第三答' },
    ]
    await writeFile(deviceFile(dir), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 })
    const history = createHistoryStore({ dir, clock: () => T0 + 60 * MINUTE, logger: silent })

    const conversations = await history.listConversations(DEVICE)
    assert.equal(conversations.length, 2, 'consecutive rows must not become one session per row')
    const newest = conversations[0]
    const oldest = conversations[1]
    assert.equal(newest.sessionId, `legacy-${T0 + 31 * MINUTE}`)
    assert.equal(newest.messages, 2)
    assert.equal(newest.title, '第三句')
    assert.equal(oldest.sessionId, `legacy-${T0}`)
    assert.equal(oldest.messages, 4)
    assert.equal(oldest.title, '第一句')
    assert.equal(oldest.startedAt, T0)
    assert.equal(oldest.endedAt, T0 + MINUTE)

    const detail = await history.getConversation(DEVICE, `legacy-${T0}`)
    assert.equal(detail.messages.length, 4)
    assert.deepEqual(
      detail.messages.map((message) => `${message.role}:${message.content}`),
      ['user:第一句', 'assistant:第一答', 'user:第二句', 'assistant:第二答'],
    )
    assert.equal(LEGACY_SESSION_GAP_MS, 10 * MINUTE)

    // 边界：间隔恰好 10 分钟仍算同一会话（契约是 ≤ 10 分钟）。
    const boundary = await tempDir()
    try {
      const twoRows = [
        { at: 5000, user: '甲', assistant: '乙' },
        { at: 5000 + 10 * MINUTE, user: '丙', assistant: '丁' },
      ]
      await writeFile(deviceFile(boundary), `${twoRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
      const store = createHistoryStore({ dir: boundary, clock: () => T0, logger: silent })
      assert.equal((await store.listConversations(DEVICE)).length, 1)
    } finally {
      await rm(boundary, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('new-format messages from a real session are not merged into legacy rows', async () => {
  const dir = await tempDir()
  try {
    await writeFile(
      deviceFile(dir),
      `${JSON.stringify({ at: T0, user: '旧问', assistant: '旧答' })}\n`,
      { mode: 0o600 },
    )
    const history = createHistoryStore({ dir, clock: () => T0, logger: silent })
    await history.appendMessages(DEVICE, 'conn-1', [
      { role: 'user', content: '新问', at: T0 + 1000 },
      { role: 'assistant', content: '新答', at: T0 + 1001 },
    ])
    const conversations = await history.listConversations(DEVICE)
    assert.equal(conversations.length, 2)
    assert.deepEqual(conversations.map((entry) => entry.sessionId), ['conn-1', `legacy-${T0}`])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('text retention trims each device to the newest maxMessages lines', async () => {
  const dir = await tempDir()
  try {
    const history = createHistoryStore({ dir, maxMessages: 5, clock: () => T0, logger: silent })
    for (let index = 1; index <= 4; index += 1) {
      await history.appendMessages(DEVICE, `sess-${index}`, [
        { role: 'user', content: `u${index}`, at: index * 10 },
        { role: 'assistant', content: `a${index}`, at: index * 10 + 1 },
      ])
    }
    const lines = (await readFile(deviceFile(dir), 'utf8')).split('\n').filter(Boolean)
    assert.equal(lines.length, 5, 'never more than maxMessages lines on disk')
    const entries = lines.map((line) => JSON.parse(line))
    assert.deepEqual(
      entries.map((entry) => entry.content),
      ['a2', 'u3', 'a3', 'u4', 'a4'],
      'oldest messages are dropped first',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('clearConversation wipes one session and its audio only', async () => {
  const dir = await tempDir()
  try {
    const history = createHistoryStore({ dir, clock: () => T0, logger: silent })
    const audioId = await history.saveAudio(DEVICE, Buffer.alloc(320), { sampleRate: 16_000 })
    assert.ok(audioId)
    await history.appendMessages(DEVICE, 'sess-a', [
      { role: 'user', content: '要清掉的', at: 1000, audioId },
      { role: 'assistant', content: '也是', at: 1001 },
    ])
    await history.appendMessages(DEVICE, 'sess-b', [
      { role: 'user', content: '要保留的', at: 2000 },
      { role: 'assistant', content: '保留', at: 2001 },
    ])

    const result = await history.clearConversation(DEVICE, 'sess-a')
    assert.equal(result.sessionId, 'sess-a')
    assert.equal(result.removedMessages, 2)
    assert.equal(result.removedAudio, 1)
    assert.equal(await history.getConversation(DEVICE, 'sess-a'), null)
    assert.ok(await history.getConversation(DEVICE, 'sess-b'))
    assert.equal(await history.readAudio(DEVICE, audioId), null, 'its audio file is gone')

    // 清一个不存在的会话是 no-op，不是错误。
    const noop = await history.clearConversation(DEVICE, 'nope')
    assert.equal(noop.removedMessages, 0)

    await history.clearDevice(DEVICE)
    assert.equal((await history.listConversations(DEVICE)).length, 0)
    assert.equal(await history.readAudio(DEVICE, audioId), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('saveAudio/readAudio round-trip, truncation, path traversal, missing files', async () => {
  const dir = await tempDir()
  try {
    const history = createHistoryStore({ dir, clock: () => T0, logger: silent })
    const pcm = Buffer.alloc(1600) // 50 ms @ 16 kHz PCM16
    const audioId = await history.saveAudio(DEVICE, pcm, { sampleRate: 16_000 })
    assert.match(audioId, /^[0-9a-f]{32}$/)
    const read = await history.readAudio(DEVICE, audioId)
    assert.ok(read)
    assert.equal(read.size, 44 + pcm.length)
    const wav = await readFile(read.file)
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF')
    assert.equal(wav.readUInt32LE(24), 16_000)
    assert.equal(wav.readUInt32LE(40), pcm.length)

    // 空音频不写。
    assert.equal(await history.saveAudio(DEVICE, Buffer.alloc(0), { sampleRate: 16_000 }), null)
    assert.equal(await history.saveAudio(DEVICE, null, { sampleRate: 16_000 }), null)

    // 路径穿越：audioId 不是 [A-Za-z0-9] 一律 null（永远拼不出 ../）。
    assert.equal(await history.readAudio(DEVICE, '../secret'), null)
    assert.equal(await history.readAudio(DEVICE, 'a/b'), null)
    assert.equal(await history.readAudio(DEVICE, '..'), null)
    assert.equal(await history.readAudio(DEVICE, 'deadbeefdeadbeefdeadbeefdeadbeef'), null)

    // 超过 120s 截断：8000 Hz * 2 bytes * 121 s 的数据只保留 120s。
    const long = Buffer.alloc(8000 * 2 * 121)
    const longId = await history.saveAudio(DEVICE, long, { sampleRate: 8000 })
    const clipped = await history.readAudio(DEVICE, longId)
    assert.equal(clipped.size, 44 + 8000 * 2 * 120)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cleanup removes audio past the retention window using the injected clock', async () => {
  const dir = await tempDir()
  try {
    let now = T0
    const history = createHistoryStore({ dir, clock: () => now, retentionDays: 30, logger: silent })
    const oldId = await history.saveAudio(DEVICE, Buffer.alloc(320), { sampleRate: 16_000 })
    const freshId = await history.saveAudio(DEVICE, Buffer.alloc(320), { sampleRate: 16_000 })
    const old = await history.readAudio(DEVICE, oldId)
    const stale = new Date(now - 31 * DAY)
    await utimes(old.file, stale, stale)

    const result = await history.cleanup()
    assert.equal(result.removedAudio, 1)
    assert.equal(await history.readAudio(DEVICE, oldId), null, '31 days old audio is gone')
    assert.ok(await history.readAudio(DEVICE, freshId), 'fresh audio stays')

    // 再往后推 30 天（相对新文件的真实 mtime 不会过期，改用超容量路径覆盖）：
    // 这里只验证 clock 注入生效——把 now 推到 31 天后再清一次，fresh 也会过期。
    const fresh = await history.readAudio(DEVICE, freshId)
    const freshTime = new Date(now + 31 * DAY)
    await utimes(fresh.file, freshTime, freshTime)
    now += 62 * DAY
    const second = await history.cleanup()
    assert.equal(second.removedAudio, 1)
    assert.equal(await history.readAudio(DEVICE, freshId), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cleanup enforces the total audio byte cap, oldest first', async () => {
  const dir = await tempDir()
  try {
    // 用注入 clock 把「过期」排除掉，只验证容量上限这条路径（否则这些 2023 年的
    // mtime 会先被 30 天保留策略清掉）。
    const history = createHistoryStore({
      dir,
      maxAudioBytes: 1000,
      retentionDays: 3650,
      clock: () => T0,
      logger: silent,
    })
    const ids = []
    for (let index = 0; index < 3; index += 1) {
      ids.push(await history.saveAudio(DEVICE, Buffer.alloc(600), { sampleRate: 16_000 }))
      const read = await history.readAudio(DEVICE, ids[index])
      const when = new Date(T0 + index * MINUTE)
      await utimes(read.file, when, when)
    }
    const result = await history.cleanup()
    assert.ok(result.removedAudio >= 2, `oldest files are dropped until under the cap (got ${result.removedAudio})`)
    assert.equal(await history.readAudio(DEVICE, ids[0]), null)
    assert.equal(await history.readAudio(DEVICE, ids[1]), null)
    assert.ok(await history.readAudio(DEVICE, ids[2]), 'newest file survives')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('append/list/clear keep the legacy shape working', async () => {
  const dir = await tempDir()
  try {
    const history = createHistoryStore({ dir, clock: () => T0, logger: silent })
    await history.append(DEVICE, { user: '问一句', assistant: '答一句' })
    await history.append(DEVICE, { user: '   ', assistant: '空问题不写' })

    const entries = await history.list(DEVICE, 10)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].user, '问一句')
    assert.equal(entries[0].assistant, '答一句')
    assert.ok(Number.isFinite(entries[0].at))

    const conversations = await history.listConversations(DEVICE)
    assert.equal(conversations.length, 1, 'one append = one legacy conversation')
    assert.equal(conversations[0].messages, 2)

    await history.clear(DEVICE)
    assert.deepEqual(await history.list(DEVICE), [])
    assert.deepEqual(await history.listConversations(DEVICE), [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('device ids are sanitized before becoming file names', async () => {
  const dir = await tempDir()
  try {
    const history = createHistoryStore({ dir, clock: () => T0, logger: silent })
    await history.appendMessages('../../evil', 'sess', [{ role: 'user', content: 'x', at: 1 }])
    const files = await readdir(dir)
    assert.equal(files.length, 1)
    assert.ok(files[0].endsWith('.jsonl'))
    assert.equal(files[0].includes('/'), false)
    assert.equal(files[0].includes('\\'), false)
    assert.equal((await history.listConversations('../../evil')).length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cleanup never throws and reports nothing when the data root is empty', async () => {
  const dir = await tempDir()
  try {
    const history = createHistoryStore({ dir: join(dir, 'missing'), logger: silent })
    const result = await history.cleanup()
    assert.deepEqual(result, { removedAudio: 0, removedBytes: 0, trimmedMessages: 0 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
