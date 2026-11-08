import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAnnouncement,
  buildResponse,
  decodeName,
  encodeName,
  isLanAddress,
  parseMessage,
  SERVICE,
} from '../src/mdns.js'

const TYPE = { A: 1, PTR: 12, TXT: 16, SRV: 33 }

function buildQuery(name, type, { unicastResponse = false } = {}) {
  const header = Buffer.alloc(12)
  header.writeUInt16BE(0, 0)
  header.writeUInt16BE(0, 2)
  header.writeUInt16BE(1, 4)
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(type, 0)
  tail.writeUInt16BE(unicastResponse ? 0x8001 : 0x0001, 2)
  return Buffer.concat([header, encodeName(name), tail])
}

test('names survive the wire format', () => {
  const encoded = encodeName('xiaozhi._xiaozhi._tcp.local')
  const { name, offset } = decodeName(encoded, 0)
  assert.equal(name, 'xiaozhi._xiaozhi._tcp.local')
  assert.equal(offset, encoded.length)
})

test('compression pointers are followed', () => {
  // "xiaozhi.local" at offset 0, then a pointer back to it.
  const base = encodeName('xiaozhi.local')
  const packet = Buffer.concat([base, Buffer.from([0xc0, 0x00])])
  const { name, offset } = decodeName(packet, base.length)
  assert.equal(name, 'xiaozhi.local')
  assert.equal(offset, base.length + 2)
})

test('a PTR query is parsed with its unicast-response bit', () => {
  const message = parseMessage(buildQuery(SERVICE, TYPE.PTR, { unicastResponse: true }))
  assert.equal(message.questions.length, 1)
  assert.equal(message.questions[0].name, SERVICE)
  assert.equal(message.questions[0].type, TYPE.PTR)
  assert.equal(message.questions[0].unicastResponse, true)
})

test('a PTR query gets PTR + SRV/TXT/A glue so the client needs one round trip', () => {
  const query = parseMessage(buildQuery(SERVICE, TYPE.PTR))
  const response = buildResponse({ questions: query.questions, addresses: ['192.168.0.151'] })
  assert.ok(response)
  assert.equal(response.readUInt16BE(6), 1, 'one answer (PTR)')
  assert.equal(response.readUInt16BE(10), 3, 'SRV + TXT + A in the additional section')
  assert.ok(response.includes(encodeName('xiaozhi.local')))
  assert.ok(response.includes(Buffer.from('path=/xiaozhi/ota/', 'utf8')))
})

test('SRV answers carry the port and target host', () => {
  const query = parseMessage(buildQuery('xiaozhi._xiaozhi._tcp.local', TYPE.SRV))
  const response = buildResponse({ questions: query.questions, port: 8989, addresses: ['192.168.0.151'] })
  assert.ok(response.includes(encodeName('xiaozhi.local')), 'target host is in the SRV rdata')
  assert.ok(response.includes(Buffer.from([0x23, 0x1d])), 'port 8989 is big-endian in the rdata')
})

test('an A query for our host is answered, a foreign name is ignored', () => {
  const ours = parseMessage(buildQuery('xiaozhi.local', TYPE.A))
  assert.ok(buildResponse({ questions: ours.questions, addresses: ['10.0.0.7'] }))

  const theirs = parseMessage(buildQuery('printer.local', TYPE.A))
  assert.equal(buildResponse({ questions: theirs.questions, addresses: ['10.0.0.7'] }), null)
})

test('only routable LAN addresses are advertised', () => {
  assert.equal(isLanAddress('192.168.0.151'), true)
  assert.equal(isLanAddress('10.4.3.2'), true)
  assert.equal(isLanAddress('172.20.1.1'), true)
  assert.equal(isLanAddress('100.100.1.1'), true)
  // 虚拟网卡/链路本地：Clash TUN、公网段、169.254 自分配地址
  assert.equal(isLanAddress('198.18.0.0'), false)
  assert.equal(isLanAddress('2.0.1.9'), false)
  assert.equal(isLanAddress('169.254.61.148'), false)
})

test('the announcement advertises service, port, path and every address', () => {
  const packet = buildAnnouncement({ addresses: ['192.168.0.151', '10.0.0.7'] })
  assert.equal(packet.readUInt16BE(6), 5, 'PTR + SRV + TXT + two A records')
  assert.ok(packet.toString('latin1').includes('path=/xiaozhi/ota/'))
})
