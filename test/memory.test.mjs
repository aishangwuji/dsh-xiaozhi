import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { createMemoryStore, extractFact, withMemory } from '../src/memory.js'

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'xz-memory-'))
}

test('extractFact only fires on an explicit 记住 request', () => {
  assert.equal(extractFact('记住我喜欢喝冰美式'), '我喜欢喝冰美式')
  assert.equal(extractFact('帮我记一下：我对花生过敏'), '我对花生过敏')
  assert.equal(extractFact('今天天气不错'), '')
  assert.equal(extractFact('记住'), '')
})

test('memory keeps facts and the newest turns, then formats them', async () => {
  const dir = await tempDir()
  try {
    const memory = createMemoryStore({ dir, maxTurns: 2, now: () => 1700000000000 })

    assert.equal(await memory.contextFor('dev-1'), '', 'empty memory injects nothing')

    await memory.recordTurn('dev-1', { user: '我叫阿伟', assistant: '你好阿伟' })
    await memory.recordTurn('dev-1', { user: '今天好累', assistant: '早点睡' })
    await memory.recordTurn('dev-1', { user: '第三句', assistant: '第三答' })

    const record = await memory.load('dev-1')
    assert.equal(record.turns.length, 2, 'trimmed to maxTurns')
    assert.equal(record.turns[0].user, '今天好累')

    assert.equal(await memory.remember('dev-1', '我喜欢喝冰美式', 'drink'), true)
    assert.equal(await memory.remember('dev-1', '我喜欢喝冰美式', 'drink'), false, 'de-duplicated')

    const context = await memory.contextFor('dev-1')
    assert.match(context, /drink: 我喜欢喝冰美式/, 'facts render as key: value')
    assert.match(context, /用户: 第三句/, 'turns are plain lines')
    assert.doesNotMatch(context, /你记得这个人说过|你们最近聊过/, 'no invented headings')
    assert.ok(context.length <= 500, 'budget matches Go GetContext(…, 500)')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('memory is per device and survives a reload', async () => {
  const dir = await tempDir()
  try {
    const first = createMemoryStore({ dir })
    await first.remember('dev-a', '怕黑')
    await first.recordTurn('dev-a', { user: '晚安', assistant: '晚安呀' })

    const second = createMemoryStore({ dir })
    const contextA = await second.contextFor('dev-a')
    assert.match(contextA, /怕黑/)
    assert.equal(await second.contextFor('dev-b'), '', 'other devices see nothing')

    const file = second.file('dev-a')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(raw.facts[0].value, '怕黑', 'persisted as JSON on disk')
    assert.ok(dirname(file).length > 0)

    await second.forget('dev-a')
    assert.equal(await second.contextFor('dev-a'), '')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withMemory appends the Go-style block, sole owner of the prefix', () => {
  assert.equal(withMemory('人设', ''), '人设')
  assert.equal(withMemory('人设', '   '), '人设')
  assert.equal(withMemory('人设', '你记得：A'), '人设\n用户个性化信息: \n你记得：A')
})
