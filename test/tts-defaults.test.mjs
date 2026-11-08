/**
 * TTS 默认音色回归。
 *
 * 归属约定（2026-11-08）：全局设置只配置「厂商 + 凭据」，音色（= TTS 模型）是设备级
 * 配置。因此主用/备用条目都可能**没有 voice**，适配器必须落到厂商默认音色，否则运行时
 * 会抛「missing voice」，表现成整条语音链路没有声音。
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTtsAdapter, createVoiceAdapters } from '../src/voice/adapters/index.js'
import { DEFAULT_TTS_VOICES, defaultTtsVoice, resolveTtsVoice } from '../src/voice/voices.js'

const baseVoice = {
  sampleRate: { uplink: 16_000, downlink: 24_000 },
  llm: { provider: 'mock' },
  asr: { provider: 'mock' }
}

test('a credentials-only TTS entry builds on every real provider', () => {
  // 只有 provider + 凭据：没有任何音色字段。构建期不能报错。
  assert.equal(buildTtsAdapter({ provider: 'volc', apiKey: 'k' }).name, 'volc')
  assert.equal(buildTtsAdapter({ provider: 'xunfei', appId: 'a', apiKey: 'k', apiSecret: 's' }).name, 'xunfei')
  assert.equal(buildTtsAdapter({ provider: 'edge' }, { ffmpegPath: 'ffmpeg' }).name, 'edge')
})

test('the primary and its backups may all omit the voice', () => {
  const adapters = createVoiceAdapters({
    ...baseVoice,
    tts: {
      provider: 'volc',
      apiKey: 'primary-key',
      backups: [
        { provider: 'xunfei', appId: 'a', apiKey: 'k', apiSecret: 's' },
        { provider: 'edge' }
      ]
    }
  }, { ffmpegPath: 'ffmpeg' })
  assert.equal(adapters.tts.name, 'failover', 'two usable candidates get the failover wrapper')
})

test('the volc default voice is a 2.0 voice so the default resource accepts it', () => {
  assert.equal(defaultTtsVoice('volc'), DEFAULT_TTS_VOICES.volc)
  assert.match(DEFAULT_TTS_VOICES.volc, /_uranus_bigtts$/)
})

test('a voice left over from another provider falls back, a custom id is kept', () => {
  // 全局换了 TTS 厂商、设备还留着上一家音色：不能把它原样透传给新厂商。
  assert.equal(resolveTtsVoice('xunfei', DEFAULT_TTS_VOICES.volc), defaultTtsVoice('xunfei'))
  assert.equal(resolveTtsVoice('volc', DEFAULT_TTS_VOICES.edge), defaultTtsVoice('volc'))
  // 本厂商目录里的音色原样保留；空串用默认。
  assert.equal(resolveTtsVoice('volc', 'zh_female_xiaohe_uranus_bigtts'), 'zh_female_xiaohe_uranus_bigtts')
  assert.equal(resolveTtsVoice('volc', ''), defaultTtsVoice('volc'))
  // 目录里没有、也不属于任何厂商的 ID 可能是自定义音色，不擅自替换。
  assert.equal(resolveTtsVoice('volc', 'custom-voice-id'), 'custom-voice-id')
  assert.equal(resolveTtsVoice('mock', 'anything'), 'anything')
})
