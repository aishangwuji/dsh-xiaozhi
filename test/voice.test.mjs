import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  containsSentenceSeparator,
  extractSmartSentences,
  OutputCleaner,
  OutputSegmenter,
  sanitizeForSpeech,
} from '../src/voice/segmenter.js'
import { EnergyVad, rms16 } from '../src/voice/vad.js'
import { demuxOggOpus, opusPacketDurationMs, OggOpusMuxer } from '../src/voice/ogg.js'

// ------------------------------------------------------------------ segmenter

test('the first sentence may split on a comma, later ones may not', () => {
  const first = extractSmartSentences('你好，今天天气不错。我们出去走走吧。', 2, 100, true)
  assert.deepEqual(first.sentences, ['你好，', '今天天气不错。', '我们出去走走吧。'])

  const later = extractSmartSentences('今天天气不错，适合出门。我们出发吧。', 2, 100, false)
  assert.deepEqual(later.sentences, ['今天天气不错，适合出门。', '我们出发吧。'])
})

test('a colon between digits never ends a sentence', () => {
  const { sentences, remaining } = extractSmartSentences('闹钟定在3:30吧。', 2, 100, true)
  assert.deepEqual(sentences, ['闹钟定在3:30吧。'])
  assert.equal(remaining, '')
  assert.equal(containsSentenceSeparator('3:30', true), false)
})

test('a numbered list marker is not a full stop', () => {
  const { sentences } = extractSmartSentences('第一个是1. 打开灯\n第二个是关灯。', 2, 100, true)
  // The newline before the next numbered item is the split point; the "1." is not.
  assert.equal(sentences.some((line) => line === '1.'), false)
  assert.ok(sentences.length >= 1)
})

test('model markup and pictographs never reach the speech layer', () => {
  assert.equal(sanitizeForSpeech('```js\nconst a = 1\n```'), '')
  assert.equal(sanitizeForSpeech('**你好** 😀 世界'), '你好 世界')
  assert.equal(sanitizeForSpeech('看这里 [链接](https://example.com)'), '看这里 链接')
  assert.equal(sanitizeForSpeech('。。。'), '')

  const cleaner = new OutputCleaner()
  assert.equal(cleaner.push('先说<thi'), '先说')
  assert.equal(cleaner.push('nk>内部推理'), '')
  assert.equal(cleaner.push('</think>正式回答。'), '正式回答。')
})

test('the first chunk leaves before the model finishes its clause', () => {
  const segmenter = new OutputSegmenter({ firstChunkChars: 10 })
  const out = []
  for (const delta of ['今天早上', '我去了一个', '很远的地方']) out.push(...segmenter.push(delta))
  assert.equal(out.length, 1, 'the first-chunk cap must fire without punctuation')
  assert.ok(Array.from(out[0]).length >= 8)
})

test('an emoji-only sentence does not become a TTS request', () => {
  const segmenter = new OutputSegmenter()
  const out = segmenter.push('😀😀😀。')
  assert.deepEqual(out, [])
})

// ------------------------------------------------------------------------- VAD

test('VAD opens on speech and closes only after the silence threshold', () => {
  const frameMs = 60
  const samples = (frameMs * 16_000) / 1000
  const tone = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index += 1) {
    tone.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 300 * index) / 16_000) * 0.4 * 32_767), index * 2)
  }
  const silence = Buffer.alloc(samples * 2)
  assert.ok(rms16(tone) > 0.1)
  assert.equal(rms16(silence), 0)

  const vad = new EnergyVad({ frameMs, silenceMs: 240, minSpeechMs: 120 })
  const events = []
  for (let index = 0; index < 3; index += 1) events.push(...vad.push(tone))
  assert.equal(vad.speaking, true)
  assert.equal(events.filter((event) => event.type === 'speech-start').length, 1)

  for (let index = 0; index < 4; index += 1) events.push(...vad.push(silence))
  assert.equal(vad.speaking, false, '240ms of silence must close the utterance')
  assert.equal(events.filter((event) => event.type === 'speech-end').length, 1)
})

// ------------------------------------------------------------------- ogg/opus

test('the Ogg muxer emits a stream the demuxer reads back packet for packet', () => {
  const muxer = new OggOpusMuxer({ serial: 1, inputSampleRate: 16_000 })
  const packets = [Buffer.from([0x01, 0x02, 0x03]), Buffer.alloc(300, 7), Buffer.from([0x09])]
  const pages = [muxer.start(), ...packets.map((packet) => muxer.push(packet, 60))]
  const stream = Buffer.concat(pages)
  const recovered = demuxOggOpus(stream)
  assert.equal(recovered.length, packets.length)
  recovered.forEach((packet, index) => assert.deepEqual(packet, packets[index]))
})

test('packet duration comes from the TOC byte', () => {
  // config 16 = CELT FB 2.5 ms, one frame.
  assert.equal(opusPacketDurationMs(Buffer.from([0x80, 0x00])), 2.5)
  // config 0 = SILK NB 10 ms, code 3 = three frames.
  assert.equal(opusPacketDurationMs(Buffer.from([0x03, 0x00])), 30)
  // config 10 = SILK WB 40 ms, code 1 = two frames.
  assert.equal(opusPacketDurationMs(Buffer.from([0x51, 0x00])), 80)
})
