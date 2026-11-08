/**
 * `applyRuntimeVoiceSettings()` 的回归测试。
 *
 * 这段逻辑在 2026-11-07 出过一次线上事故：控制台保存了 `hostProvider`，但运行时
 * 叠加设置时漏了它，`provider: "host"` 的会话拿到 `undefined`，host adapter 兜底成
 * `deepseek`，于是每轮都在第一句回 `no adapter registered for provider "deepseek"`，
 * 设备停在「聆听中」。症状落在别处，所以必须用纯函数单测钉住。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { applyRuntimeVoiceSettings } from '../index.js'

const loaderVoice = () => ({
  systemPrompt: 'Loader 人设',
  silenceMs: 400,
  llm: { provider: 'mock', hostProvider: '', model: '', baseUrl: '', apiKey: '', maxTokens: 120 },
  tts: { provider: 'mock', voice: 'zh-CN-XiaoxiaoNeural', language: '', resourceId: '' },
  asr: { provider: 'mock', language: 'zh_cn', plan: ['你好'] },
})

test('hostProvider 必须从运行时设置叠上去（2026-11-07 事故根因）', () => {
  const voice = loaderVoice()
  applyRuntimeVoiceSettings(voice, {
    llm: { provider: 'host', hostProvider: 'opencode-go', model: 'deepseek-v4.1-flash' },
  })
  assert.equal(voice.llm.provider, 'host')
  assert.equal(voice.llm.hostProvider, 'opencode-go', '漏了它 host adapter 会兜底成 deepseek，运行期 NO_ADAPTER')
  assert.equal(voice.llm.model, 'deepseek-v4.1-flash')
})

test('空值 / null 表示沿用 Loader 配置，不清空已有值', () => {
  const voice = loaderVoice()
  voice.llm.apiKey = 'sk-loader'
  applyRuntimeVoiceSettings(voice, {
    systemPrompt: '',
    silenceMs: null,
    llm: { provider: '', hostProvider: '', model: '', baseUrl: '', apiKey: '', maxTokens: null },
    tts: { provider: '', voice: '', rate: '' },
    asr: { provider: '', language: '' },
  })
  assert.equal(voice.systemPrompt, 'Loader 人设')
  assert.equal(voice.silenceMs, 400)
  assert.equal(voice.llm.provider, 'mock')
  assert.equal(voice.llm.apiKey, 'sk-loader')
  assert.equal(voice.llm.maxTokens, 120)
  assert.equal(voice.tts.voice, 'zh-CN-XiaoxiaoNeural')
  assert.equal(voice.asr.language, 'zh_cn')
})

test('maxTokens 只接受正整数；0 / 负数 / 非整数沿用 Loader', () => {
  const voice = loaderVoice()
  voice.llm.maxTokens = 120
  applyRuntimeVoiceSettings(voice, { llm: { maxTokens: 0 } })
  assert.equal(voice.llm.maxTokens, 120)
  applyRuntimeVoiceSettings(voice, { llm: { maxTokens: 64 } })
  assert.equal(voice.llm.maxTokens, 64)
})

test('backups 永远是覆盖式：删光备用必须真的清空', () => {
  const voice = loaderVoice()
  voice.llm.backups = [{ provider: 'volc', apiKey: 'x' }]
  applyRuntimeVoiceSettings(voice, { llm: { backups: [] }, tts: { backups: [] }, asr: { backups: [] } })
  assert.deepEqual(voice.llm.backups, [])
  assert.deepEqual(voice.tts.backups, [])
  assert.deepEqual(voice.asr.backups, [])

  applyRuntimeVoiceSettings(voice, {
    llm: { backups: [{ provider: 'mimo', model: 'mimo-v2.6-flash' }] },
  })
  assert.equal(voice.llm.backups.length, 1)
  assert.equal(voice.llm.backups[0].provider, 'mimo')
})

test('没有 state.voice 时不炸，保持 Loader 配置', () => {
  const voice = loaderVoice()
  applyRuntimeVoiceSettings(voice, undefined)
  assert.equal(voice.llm.provider, 'mock')
  assert.equal(voice.tts.voice, 'zh-CN-XiaoxiaoNeural')
})
