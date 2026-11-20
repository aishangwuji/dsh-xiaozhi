/**
 * 语音审批的契约测试。
 *
 * 两条底线：
 *   - 只有明确说「允许/拒绝」才回答；含糊或超时必须交回桌面，不能擅自放行；
 *   - 桥在语音不接/失败时必须调用 next()，不能把审批吞掉。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyApprovalAnswer } from '../src/voice/session.js'
import { createSessionBridge } from '../src/host-session.js'

const silent = { info() {}, warn() {}, error() {} }

test('审批意图：先判拒绝，再说允许，含糊返回空', () => {
  assert.equal(classifyApprovalAnswer('允许'), 'allowed-once')
  assert.equal(classifyApprovalAnswer('可以，没问题'), 'allowed-once')
  assert.equal(classifyApprovalAnswer('好'), 'allowed-once')
  assert.equal(classifyApprovalAnswer('不要'), 'rejected')
  assert.equal(classifyApprovalAnswer('不行'), 'rejected')
  assert.equal(classifyApprovalAnswer('不对'), 'rejected')
  assert.equal(classifyApprovalAnswer('不好'), 'rejected')
  assert.equal(classifyApprovalAnswer('取消吧'), 'rejected')
  assert.equal(classifyApprovalAnswer('今天天气不错'), '')
  assert.equal(classifyApprovalAnswer(''), '')
})

test('桥把审批交给语音应答器；不接/失败/含糊时 next() 交回桌面', async () => {
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
  const approval = handlers.get('approval/request')[0]
  assert.equal(typeof approval, 'function')

  bridge.setApprovalAnswerer(async () => 'allowed-once')
  assert.equal(
    await approval({ agent: { session: { id: 'session-a' } } }, async () => 'unavailable'),
    'allowed-once',
  )

  bridge.setApprovalAnswerer(async () => null)
  let delegated = 0
  assert.equal(
    await approval({ agent: { session: { id: 'session-a' } } }, async () => {
      delegated += 1
      return 'unavailable'
    }),
    'unavailable',
  )
  assert.equal(delegated, 1)

  bridge.setApprovalAnswerer(async () => {
    throw new Error('boom')
  })
  delegated = 0
  assert.equal(
    await approval({}, async () => {
      delegated += 1
      return 'cancelled'
    }),
    'cancelled',
  )
  assert.equal(delegated, 1)

  bridge.setApprovalAnswerer(null)
  delegated = 0
  assert.equal(
    await approval({}, async () => {
      delegated += 1
      return 'rejected'
    }),
    'rejected',
  )
  assert.equal(delegated, 1)

  bridge.dispose()
})
