/**
 * `ask_user_question` 语音回答的契约测试。
 *
 * 底线：能明确映射到选项才回答；多个选项同时命中、说不清、超时都返回 null，
 * 由桥 next() 交回桌面卡片，不能猜一个答案。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuestionAnswer } from '../src/voice/session.js'
import { createSessionBridge } from '../src/host-session.js'

const silent = { info() {}, warn() {}, error() {} }

test('单选题：标签、序号、自由回答', () => {
  const question = {
    options: [{ label: '红色' }, { label: '蓝色' }, { label: '绿色' }],
  }
  assert.deepEqual(parseQuestionAnswer('蓝色', question), { selected: ['蓝色'] })
  assert.deepEqual(parseQuestionAnswer('选第二个', question), { selected: ['蓝色'] })
  assert.deepEqual(parseQuestionAnswer('2', question), { selected: ['蓝色'] })
  assert.deepEqual(parseQuestionAnswer('第三个吧', question), { selected: ['绿色'] })
  assert.deepEqual(parseQuestionAnswer('我喜欢深蓝色', question), { selected: ['蓝色'] })
  assert.deepEqual(parseQuestionAnswer('紫色', question), { selected: [], custom: '紫色' })
  assert.equal(parseQuestionAnswer('红色还是蓝色', question), null, '多个选项命中 → 交回桌面')
  assert.equal(parseQuestionAnswer('', question), null)
})

test('多选题：顿号/逗号/和 拆分后逐项映射', () => {
  const question = {
    multiSelect: true,
    options: [{ label: '红色' }, { label: '蓝色' }, { label: '绿色' }],
  }
  assert.deepEqual(parseQuestionAnswer('红色、绿色', question), { selected: ['红色', '绿色'] })
  assert.deepEqual(parseQuestionAnswer('蓝色和绿色', question), { selected: ['蓝色', '绿色'] })
  assert.deepEqual(parseQuestionAnswer('第一个和第三个', question), { selected: ['红色', '绿色'] })
  assert.deepEqual(parseQuestionAnswer('都要', question), { selected: [], custom: '都要' })
})

test('带 intent 的计划/权限确认按「同意/拒绝」映射选项', () => {
  const plan = {
    options: [{ label: '批准计划' }, { label: '拒绝计划' }],
    intent: { kind: 'plan-review', approve: '批准计划' },
  }
  assert.deepEqual(parseQuestionAnswer('同意', plan), { selected: ['批准计划'] })
  assert.deepEqual(parseQuestionAnswer('不行', plan), { selected: ['拒绝计划'] })
  const approval = {
    options: [{ label: '允许本次' }, { label: '拒绝' }],
    intent: { kind: 'approval', approve: '允许本次', reject: '拒绝' },
  }
  assert.deepEqual(parseQuestionAnswer('可以', approval), { selected: ['允许本次'] })
  assert.deepEqual(parseQuestionAnswer('不要', approval), { selected: ['拒绝'] })
})

test('没有选项的问题按自由文本回答', () => {
  assert.deepEqual(parseQuestionAnswer('下周三下午', { options: [] }), {
    selected: [],
    custom: '下周三下午',
  })
})

test('桥把结构化提问交给语音应答器；空答案/异常时 next() 交回桌面', async () => {
  const handlers = new Map()
  const bridge = createSessionBridge({
    sessionController: { prompt() {} },
    on: (name, listener) => {
      const list = handlers.get(name) ?? []
      list.push(listener)
      handlers.set(name, list)
      return () => {}
    },
    logger: silent,
  })
  const question = handlers.get('user-questions/request')[0]
  assert.equal(typeof question, 'function')
  const request = { agent: { session: { id: 'session-a' } }, questions: [{ id: 'q1', question: '选哪个' }] }

  bridge.setQuestionAnswerer(async () => ({ answers: [{ id: 'q1', selected: ['红色'] }] }))
  assert.deepEqual(
    await question(request, async () => ({ answers: [] })),
    { answers: [{ id: 'q1', selected: ['红色'] }] },
  )

  bridge.setQuestionAnswerer(async () => null)
  let delegated = 0
  assert.deepEqual(
    await question(request, async () => {
      delegated += 1
      return { answers: [{ id: 'q1', selected: ['桌面'] }] }
    }),
    { answers: [{ id: 'q1', selected: ['桌面'] }] },
  )
  assert.equal(delegated, 1)

  bridge.setQuestionAnswerer(async () => {
    throw new Error('boom')
  })
  delegated = 0
  await question(request, async () => {
    delegated += 1
    return { answers: [] }
  })
  assert.equal(delegated, 1)
  bridge.dispose()
})
