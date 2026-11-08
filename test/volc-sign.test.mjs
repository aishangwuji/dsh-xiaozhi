import { test } from 'node:test'
import assert from 'node:assert/strict'
import { signVolcRequest, volcDate } from '../src/voice/volc-sign.js'

// 官方签名文档里的两个固定向量（不是猜测：来自
// https://www.volcengine.com/docs/6369/67269 的示例值）。
const ACCESS_KEY = 'EXAMPLE_ACCESS_KEY_ID_REDACTED'
const SECRET_KEY = 'EXAMPLE_SECRET_KEY_REDACTED=='
const DATE = new Date('2025-03-29T18:09:37Z')

test('volcDate formats UTC seconds', () => {
  assert.equal(volcDate(DATE), '20250329T180937Z')
})

test('signVolcRequest matches the official POST example', () => {
  const signed = signVolcRequest({
    method: 'POST',
    host: 'billing.volcengineapi.com',
    path: '/',
    query: 'Action=ListBill&Version=2022-01-01',
    body: '{"Limit":10,"BillPeriod":"2023-08"}',
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    service: 'billing',
    region: 'cn-beijing',
    signedHeaders: ['host', 'x-date'],
    date: DATE,
  })
  assert.equal(signed.signature, '5e8480ceea12d0000a23c054151c50dd02c1a7dec835004057d19f13d53a7658')
})

test('signVolcRequest matches the official GET example', () => {
  const signed = signVolcRequest({
    method: 'GET',
    host: 'billing.volcengineapi.com',
    path: '/',
    query: 'Action=QueryBalanceAcct&Version=2022-01-01',
    body: '',
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    service: 'billing',
    region: 'cn-beijing',
    signedHeaders: ['host', 'x-date'],
    date: DATE,
  })
  assert.equal(signed.signature, '1eda9e7e6b1728151a8e8791fdaf67cfbd28bd5c80d0fce2eb208746cf483105')
})

test('ListSpeakers signs host/x-content-sha256/x-date', () => {
  const signed = signVolcRequest({
    method: 'POST',
    host: 'open.volcengineapi.com',
    query: 'Action=ListSpeakers&Version=2025-05-20',
    body: JSON.stringify({ ResourceIDs: ['seed-tts-2.0'], Page: 1, Limit: 100 }),
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    service: 'speech_saas_prod',
    signedHeaders: ['host', 'x-content-sha256', 'x-date'],
    date: DATE,
  })
  assert.match(signed.headers.authorization, /^HMAC-SHA256 Credential=AKLT/)
  assert.match(signed.headers.authorization, /SignedHeaders=host;x-content-sha256;x-date/)
  assert.match(signed.headers.authorization, /Signature=[0-9a-f]{64}$/)
})
