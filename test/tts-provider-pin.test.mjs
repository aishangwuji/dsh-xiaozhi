import test from 'node:test'
import assert from 'node:assert/strict'

import { prioritizeTtsProvider } from '../src/voice/adapters/index.js'

// 智能体级「TTS 服务商」（2026-11-14）：从已配置的主用/备用里挑一条优先。
// 关键点：整套凭据跟着条目走（不能只改 provider 字段），会话级字段仍用智能体/全局那份。

const primary = {
  provider: 'deepseek',
  apiKey: 'sk-deepseek',
  voice: '',
  language: 'zh',
  speed: '',
  resourceId: '',
  backups: [
    { id: 'b1', provider: 'volc', apiKey: 'volc-key', resourceId: 'seed-tts-2.0', voice: '' },
    { id: 'b2', provider: 'baizhi', apiKey: 'baizhi-key' },
    { id: 'b3', provider: 'edge' },
  ],
}

test('pinning a backup promotes its credentials and demotes the old primary in place', () => {
  const next = prioritizeTtsProvider(primary, 'volc')
  assert.equal(next.provider, 'volc')
  assert.equal(next.apiKey, 'volc-key', '凭据必须来自被提升的那条，否则 Key 会用错厂商')
  assert.equal(next.resourceId, 'seed-tts-2.0', '资源族跟着厂商条目走')
  // 原主用整条降为第一备用，其余备用顺序不变。
  assert.deepEqual(
    next.backups.map((entry) => entry.provider),
    ['deepseek', 'baizhi', 'edge'],
  )
  assert.equal(next.backups[0].apiKey, 'sk-deepseek')
  // 会话级字段（音色/语种/语速）保持调用方那份，不被备用条目覆盖。
  assert.equal(next.language, 'zh')
  assert.equal(next.voice, '')
  assert.equal(primary.provider, 'deepseek', '不得修改入参')
})

test('pinning the current primary keeps the spec untouched', () => {
  assert.equal(prioritizeTtsProvider(primary, 'deepseek'), primary)
})

test('pinning an unconfigured provider is a no-op (build-time failover reports it)', () => {
  assert.equal(prioritizeTtsProvider(primary, 'xunfei'), primary)
  assert.equal(prioritizeTtsProvider(primary, ''), primary)
})

test('an empty primary does not leave an empty backup entry', () => {
  const next = prioritizeTtsProvider(
    { provider: '', backups: [{ id: 'b1', provider: 'baizhi', apiKey: 'k' }] },
    'baizhi',
  )
  assert.equal(next.provider, 'baizhi')
  assert.deepEqual(next.backups, [], '原主用没配置过，不应生成 provider 为空的壳')
})

test('agent-level voice/speed survive the swap', () => {
  const next = prioritizeTtsProvider({ ...primary, voice: 'vivi', speed: 1.2 }, 'baizhi')
  assert.equal(next.provider, 'baizhi')
  assert.equal(next.voice, 'vivi')
  assert.equal(next.speed, 1.2)
})
