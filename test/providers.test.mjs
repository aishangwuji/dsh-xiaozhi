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

test('endpoint URLs are built into the adapters and never rendered in the console', () => {
  // 2026-11-09：厂商端点几乎不变，露在表单里只会让人以为必须填。地址一律内置在适配器里，
  // 控制台的任何一个 stage/provider 组合都不许出现 `url` 字段。
  for (const stage of STAGES) {
    for (const id of providersForStage(stage)) {
      for (const field of stageDescriptor(id, stage).fields || []) {
        assert.notEqual(field.key, 'url', `${id}/${stage} 不应暴露端点地址字段`)
      }
    }
  }
  // 存储白名单仍保留 url（手写 settings 的自建/代理端点继续生效），但主用保存不写它——
  // 写它就是「把已有端点覆盖成空串」，属于静默删除配置。
  assert.ok(STAGE_META.asr.storageFields.includes('url'))
  assert.ok(!STAGE_META.asr.editFields.includes('url'))
  assert.ok(!STAGE_META.tts.editFields.includes('url'))
  assert.ok(!STAGE_META.llm.editFields.includes('url'))
})

test('stage-level display name overrides work (xunfei TTS vs ASR)', () => {
  assert.equal(stageProviderLabel('tts', 'xunfei'), '讯飞语音合成')
  assert.equal(stageProviderLabel('asr', 'xunfei'), '讯飞语音听写')
  assert.equal(stageProviderLabel('tts', 'volc'), '火山引擎豆包')
})

test('the LLM stage offers DSH-hosted plus direct DeepSeek and Xiaomi MiMo', () => {
  // 2026-11-09 只留 DeepSeek / MiMo；2026-11-10 加入 host（复用 DSH 已配置的厂商）。
  assert.deepEqual([...providersForStage('llm')].sort(), ['deepseek', 'host', 'mimo'])
  assert.ok(!allProvidersForStage('llm').includes('openai'))
  assert.ok(!allProvidersForStage('llm').includes('spark'))
  assert.ok(providersForStage('tts').includes('volc'), '火山 TTS 仍在')
  assert.ok(providersForStage('asr').includes('volc'), '火山 ASR 仍在')
  assert.ok(providersForStage('tts').includes('xunfei'), '讯飞 TTS 仍在')
  assert.equal(stageDescriptor('volc', 'tts').name, undefined, '火山 TTS 沿用厂商名')
})

test('the host provider reuses DSH credentials: no secret field, hostProvider + model only', () => {
  const desc = stageDescriptor('host', 'llm')
  assert.ok(desc, 'host has an llm stage')
  assert.equal(desc.keyless, true, 'the LLM card shows 无需密钥 instead of a missing key')
  assert.deepEqual(desc.secretFields, [], 'nothing secret is stored for host entries')
  assert.deepEqual(desc.fields.map((field) => field.key), ['hostProvider', 'model'])
  assert.deepEqual(desc.summary, ['model'])
  // 备用条目也要能表达 host（failover 逐条装配），所以存储白名单必须包含 hostProvider。
  assert.ok(BACKUP_SPEC.llm.fields.some(([key]) => key === 'hostProvider'))
  assert.ok(allProvidersForStage('llm').includes('host'), 'backups accept provider="host"')
})

test('providersPayload is JSON-serializable and versioned', () => {
  const payload = providersPayload()
  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.providers.length, PROVIDERS.length)
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload)
  // 一个 provider 可以同时覆盖多个 stage（火山 = TTS + ASR；LLM 段 2026-11-09 已移除）。
  const volc = payload.providers.find((provider) => provider.id === 'volc')
  assert.ok(volc.stages.tts && volc.stages.asr)
  assert.equal(volc.stages.llm, undefined)
  // 免密钥与整段提示是 stage 级声明，不靠前端写死。
  const edge = payload.providers.find((provider) => provider.id === 'edge')
  assert.equal(edge.stages.tts.keyless, true)
  assert.equal(edge.stages.tts.note, 'ttsEdgeKeyless')
})
