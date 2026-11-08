import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  listVolcSpeakers,
  listVolcSpeakersCached,
  speakerOptions,
  clearVolcSpeakerCache,
} from '../src/voice/volc-speakers.js'

const DATE = new Date('2026-01-05T15:23:08Z')

function fakeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}

function speakersPage(total, speakers) {
  return { Result: { Total: total, Speakers: speakers } }
}

test('speakerOptions maps VoiceType/Name/Gender/Age', () => {
  const options = speakerOptions([
    { VoiceType: 'saturn_zh_female_cancan_tob', Name: '知性灿灿', Gender: '女', Age: '青年', ResourceID: 'seed-tts-2.0' },
    { VoiceType: '', Name: 'bad' },
  ])
  assert.deepEqual(options, [
    { value: 'saturn_zh_female_cancan_tob', label: '知性灿灿 · 女 · 青年', tier: 'seed-tts-2.0' },
  ])
})

test('listVolcSpeakers paginates until Total is reached', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), auth: options.headers.authorization })
    const page = JSON.parse(options.body).Page
    if (page === 1) {
      return fakeResponse(200, speakersPage(2, [
        { VoiceType: 'a', Name: 'A', Gender: '女', Age: '青年', ResourceID: 'seed-tts-2.0' },
      ]))
    }
    return fakeResponse(200, speakersPage(2, [
      { VoiceType: 'b', Name: 'B', Gender: '男', Age: '青年', ResourceID: 'seed-tts-2.0' },
    ]))
  }
  const speakers = await listVolcSpeakers({
    accessKey: 'AK', secretKey: 'SK', resourceId: 'seed-tts-2.0', fetchImpl, date: DATE, pageSize: 1,
  })
  assert.equal(speakers.length, 2)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].body.ResourceIDs[0], 'seed-tts-2.0')
  assert.match(requests[0].auth, /Credential=AK\//)
})

test('listVolcSpeakers surfaces the official error message', async () => {
  const fetchImpl = async () => fakeResponse(401, {
    ResponseMetadata: { Error: { Code: 'InvalidCredential', Message: 'invalid access key' } },
  })
  await assert.rejects(
    listVolcSpeakers({ accessKey: 'AK', secretKey: 'SK', fetchImpl, date: DATE }),
    /invalid access key/,
  )
})

test('listVolcSpeakersCached reuses the cached list', async () => {
  clearVolcSpeakerCache()
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return fakeResponse(200, speakersPage(1, [
      { VoiceType: 'a', Name: 'A', ResourceID: 'seed-tts-2.0' },
    ]))
  }
  const first = await listVolcSpeakersCached({ accessKey: 'AK', secretKey: 'SK', fetchImpl, now: 1000 })
  const second = await listVolcSpeakersCached({ accessKey: 'AK', secretKey: 'SK', fetchImpl, now: 2000 })
  assert.equal(calls, 1)
  assert.deepEqual(second, first)
  clearVolcSpeakerCache()
})
