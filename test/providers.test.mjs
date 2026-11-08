/**
 * 服务商描述符（`src/providers.js`）与控制台/存储契约的一致性测试。
 *
 * 目标：描述符是**唯一元数据来源**，但 settings.js 的 BACKUP_SPEC 仍是落盘白名单；
 * 两边漂移会出现「控制台能选、保存被拒」或「保存能过、运行时构建不出适配器」。
 * 这里把两份数据钉在一起：加厂商只改描述符，忘了改 BACKUP_SPEC 会在这里红。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROVIDERS,
  STAGE_META,
  STAGES,
  providersForStage,
  allProvidersForStage,
  stageDescriptor,
  stageProviderLabel,
  providersPayload,
} from '../src/providers.js'
import { BACKUP_SPEC } from '../src/settings.js'

test('descriptor providers match the settings whitelist for every stage', () => {
  for (const stage of STAGES) {
    const spec = BACKUP_SPEC[stage]
    assert.ok(spec, `${stage} 在 BACKUP_SPEC 里存在`)
    assert.deepEqual(
      [...allProvidersForStage(stage)].sort(),
      [...spec.providers].sort(),
      `${stage} 的描述符厂商（含 hidden）与 BACKUP_SPEC.providers 必须一致`,
    )
  }
})

test('hidden providers stay storable but are not offered to the console', () => {
  assert.ok(allProvidersForStage('asr').includes('funasr'), 'funasr 保留在存储白名单')
  assert.ok(!providersForStage('asr').includes('funasr'), 'funasr 不在控制台下拉里')
})

test('every descriptor field is storable by the settings whitelist', () => {
  for (const stage of STAGES) {
    const spec = BACKUP_SPEC[stage]
    const allowed = new Set([...spec.fields.map(([key]) => key), ...spec.secrets])
    for (const id of providersForStage(stage)) {
      const desc = stageDescriptor(id, stage)
      assert.ok(desc, `${id}/${stage} 有描述`)
      for (const field of desc.fields || []) {
        assert.ok(allowed.has(field.key), `${id}/${stage} 字段 ${field.key} 必须在 BACKUP_SPEC 白名单里`)
        assert.ok(field.type, `${id}/${stage} 字段 ${field.key} 有 type`)
        assert.ok(field.label, `${id}/${stage} 字段 ${field.key} 有 label`)
      }
      for (const key of desc.secretFields || []) {
        assert.ok(spec.secrets.includes(key), `${id}/${stage} secret ${key} 必须在 BACKUP_SPEC.secrets 里`)
      }
      for (const key of desc.summary || []) {
        assert.ok(allowed.has(key), `${id}/${stage} summary ${key} 必须是可存储字段`)
      }
      assert.ok(desc.probe && typeof desc.probe.kind === 'string', `${id}/${stage} 有 probe.kind`)
    }
  }
})

test('stage storage/edit fields cover the settings whitelist', () => {
  for (const stage of STAGES) {
    const spec = BACKUP_SPEC[stage]
    const storage = new Set(STAGE_META[stage].storageFields)
    for (const [key] of spec.fields) assert.ok(storage.has(key), `${stage} storage 缺 ${key}`)
    for (const key of spec.secrets) assert.ok(storage.has(key), `${stage} storage 缺 secret ${key}`)
    for (const key of STAGE_META[stage].editFields) assert.ok(storage.has(key), `${stage} edit 字段 ${key} 必须可存储`)
  }
})

test('stage-level display name overrides work (xunfei TTS vs ASR)', () => {
  assert.equal(stageProviderLabel('tts', 'xunfei'), '讯飞语音合成')
  assert.equal(stageProviderLabel('asr', 'xunfei'), '讯飞语音听写')
  assert.equal(stageProviderLabel('llm', 'volc'), '火山引擎豆包')
})

test('providersPayload is JSON-serializable and versioned', () => {
  const payload = providersPayload()
  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.providers.length, PROVIDERS.length)
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload)
  // 一个 provider 可以同时覆盖多个 stage（火山 = LLM + TTS + ASR）。
  const volc = payload.providers.find((provider) => provider.id === 'volc')
  assert.ok(volc.stages.llm && volc.stages.tts && volc.stages.asr)
  // 免密钥与整段提示是 stage 级声明，不靠前端写死。
  const edge = payload.providers.find((provider) => provider.id === 'edge')
  assert.equal(edge.stages.tts.keyless, true)
  assert.equal(edge.stages.tts.note, 'ttsEdgeKeyless')
})
