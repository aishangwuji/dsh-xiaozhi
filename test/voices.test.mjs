import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_TTS_VOICES,
  VOICE_OPTIONS,
  defaultTtsVoice,
  resourceTierOf,
  voiceOptionsFor,
  voiceTierOf,
  voicesForResource,
} from '../src/voice/voices.js'

test('every provider ships a default voice inside its own catalog', () => {
  // 全局设置只存厂商+凭据，音色由设备选择；设备没选时必须能落到厂商默认音色。
  for (const [provider, voice] of Object.entries(DEFAULT_TTS_VOICES)) {
    const options = voiceOptionsFor(provider)
    assert.ok(options.some((option) => option.value === voice), `${provider} default ${voice} must be in its catalog`)
    assert.equal(defaultTtsVoice(provider), voice)
  }
  assert.equal(voiceTierOf(DEFAULT_TTS_VOICES.volc), '2.0', '火山默认音色必须与默认 Resource ID（seed-tts-2.0）同代')
  assert.equal(defaultTtsVoice('mock'), '', 'unknown providers have no default')
})

test('voice catalog mirrors the Go manager and covers our providers', () => {
  for (const provider of ['edge', 'xunfei', 'volc']) {
    const options = voiceOptionsFor(provider)
    assert.ok(options.length > 0, `${provider} must ship a catalog`)
    for (const option of options) {
      assert.equal(typeof option.value, 'string')
      assert.ok(option.value.length > 0)
      assert.equal(typeof option.label, 'string')
    }
  }
  assert.equal(voiceOptionsFor('mock').length, 0, 'unknown providers get no options')
  assert.ok(
    voiceOptionsFor('volc').some((option) => option.value === 'zh_female_vv_uranus_bigtts'),
    'the voice we actually run keeps existing in the catalog',
  )
  assert.ok(VOICE_OPTIONS.xunfei.some((option) => option.value === 'xiaoyan'))
})

test('every volc voice declares a resource tier, and the split matches the live API', () => {
  for (const voice of VOICE_OPTIONS.volc) {
    assert.ok(['2.0', '1.x'].includes(voice.tier), `${voice.value} needs a tier`)
  }
  // 实测：seed-tts-2.0 只接受 uranus / saturn；moon / mars / jupiter / multi_* 回 55000000。
  assert.equal(voiceTierOf('zh_female_vv_uranus_bigtts'), '2.0')
  assert.equal(voiceTierOf('saturn_zh_female_keainvsheng_tob'), '2.0')
  assert.equal(voiceTierOf('zh_female_wanwanxiaohe_moon_bigtts'), '1.x')
  assert.equal(voiceTierOf('zh_female_cancan_mars_bigtts'), '1.x')
  assert.equal(voiceTierOf('zh_female_vv_jupiter_bigtts'), '1.x')
  assert.equal(voiceTierOf('multi_female_gaolengyujie_moon_bigtts'), '1.x')
  assert.equal(voiceTierOf('not-a-voice'), '')
})

test('the resource tier defaults to 2.0 and filters mismatched voices out', () => {
  assert.equal(resourceTierOf(''), '2.0', 'an empty Resource ID uses the adapter default')
  assert.equal(resourceTierOf('seed-tts-2.0'), '2.0')
  assert.equal(resourceTierOf('seed-tts-1.0'), '1.x')
  assert.equal(resourceTierOf('seed-icl-2.0'), '2.0')
  assert.equal(resourceTierOf('whatever'), '')

  const for20 = voicesForResource(VOICE_OPTIONS.volc, 'seed-tts-2.0')
  assert.ok(for20.length > 0)
  assert.ok(for20.every((voice) => voice.tier === '2.0'))
  assert.ok(!for20.some((voice) => voice.value === 'zh_female_wanwanxiaohe_moon_bigtts'))
  assert.ok(for20.some((voice) => voice.value === 'zh_female_xiaohe_uranus_bigtts'))

  const for10 = voicesForResource(VOICE_OPTIONS.volc, 'seed-tts-1.0')
  assert.ok(for10.every((voice) => voice.tier === '1.x'))

  // 未知 provider（edge / 讯飞）的音色没有 tier，不能被过滤掉。
  assert.equal(voicesForResource(VOICE_OPTIONS.edge, 'seed-tts-2.0').length, VOICE_OPTIONS.edge.length)
})
