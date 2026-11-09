import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  canonicalIp,
  clientIp,
  isPrivateAddress,
  normalizeClientId,
  normalizeDeviceId,
  readIdentity,
} from '../src/identity.js'
import { DeviceStore } from '../src/store.js'
import { ConnectionHub } from '../src/hub.js'

const MAC = '02:4A:7D:E3:89:BF'

function fakeRequest(headers = {}, remoteAddress = '192.168.1.50') {
  return {
    headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    socket: { remoteAddress },
  }
}

test('device ids converge on one canonical MAC spelling', () => {
  assert.equal(normalizeDeviceId('02-4a-7d-e3-89-bf'), MAC)
  assert.equal(normalizeDeviceId('02:4A:7D:E3:89:BF'), MAC)
  assert.equal(normalizeDeviceId(' 024A7DE389BF '), MAC)
  assert.equal(normalizeDeviceId('02_4A_7D_E3_89_BF'), '02_4A_7D_E3_89_BF')
  assert.equal(normalizeDeviceId('e3b0c442-98fc-4e1a-8c3d-6a5b6a5b6a5b'), 'e3b0c442-98fc-4e1a-8c3d-6a5b6a5b6a5b')
  assert.equal(normalizeDeviceId(''), '')
  assert.equal(normalizeDeviceId(undefined), '')
})

test('client ids are lower-cased only when they are UUIDs', () => {
  const uuid = 'E3B0C442-98FC-4E1A-8C3D-6A5B6A5B6A5B'
  assert.equal(normalizeClientId(uuid), uuid.toLowerCase())
  assert.equal(normalizeClientId('  abc-DEF '), 'abc-DEF')
})

test('identity is read from headers first, then the query string', () => {
  const url = new URL('http://x/xiaozhi/ota/?device_id=02-4a-7d-e3-89-bf&Client-Id=e3b0c442-98fc-4e1a-8c3d-6a5b6a5b6a5b')
  const fromQuery = readIdentity(fakeRequest(), url)
  assert.equal(fromQuery.deviceId, MAC)
  assert.equal(fromQuery.sources.deviceId, 'query')

  const fromHeader = readIdentity(fakeRequest({ 'Device-Id': 'aa-bb-cc-dd-ee-ff', 'Client-Id': 'abc' }), url)
  assert.equal(fromHeader.deviceId, 'AA:BB:CC:DD:EE:FF')
  assert.equal(fromHeader.clientId, 'abc')
  assert.equal(fromHeader.sources.deviceId, 'header')
})

test('peer address prefers proxy headers and strips ports', () => {
  assert.equal(canonicalIp('1.2.3.4:5678'), '1.2.3.4')
  assert.equal(canonicalIp('::ffff:192.168.1.7'), '192.168.1.7')
  assert.equal(canonicalIp('[::1]:8080'), '::1')
  const req = fakeRequest({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, '192.168.1.50')
  assert.equal(clientIp(req), '203.0.113.9')
})

test('private ranges decide LAN versus WAN, and unparseable addresses are WAN', () => {
  assert.equal(isPrivateAddress('192.168.1.20'), true)
  assert.equal(isPrivateAddress('10.2.3.4'), true)
  assert.equal(isPrivateAddress('172.16.5.5'), true)
  assert.equal(isPrivateAddress('172.32.5.5'), false)
  assert.equal(isPrivateAddress('127.0.0.1'), true)
  assert.equal(isPrivateAddress('203.0.113.9'), false)
  assert.equal(isPrivateAddress('fd00::1'), true)
  assert.equal(isPrivateAddress('not-an-ip'), false)
  assert.equal(isPrivateAddress('100.80.0.1'), true, 'carrier-grade NAT counts as local')
})

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-unit-'))
  const file = join(dir, 'devices.json')
  try {
    return await fn({ file, dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('first contact registers the device and persists it', async () => {
  await withStore(async ({ file }) => {
    const store = new DeviceStore({ file })
    await store.load()
    const { device, created } = await store.ensureDevice({ deviceId: MAC, clientId: 'c1', ip: '192.168.1.50' })
    assert.equal(created, true)
    assert.equal(device.deviceId, MAC)
    assert.equal('blocked' in device, false)

    const onDisk = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(onDisk.devices.length, 1)
    assert.equal(onDisk.devices[0].deviceId, MAC)

    const again = await store.ensureDevice({ deviceId: MAC, clientId: 'c2', ip: '192.168.1.51' })
    assert.equal(again.created, false)
    assert.equal(again.device.clientId, 'c2')
    assert.equal(again.device.lastIp, '192.168.1.51')
  })
})

test('autoProvision=false refuses an unknown device', async () => {
  await withStore(async ({ file }) => {
    const store = new DeviceStore({ file })
    await store.load()
    await assert.rejects(
      store.ensureDevice({ deviceId: MAC, autoProvision: false }),
      /设备未登记/,
    )
    assert.equal(store.size, 0)
  })
})

test('renaming survives a reload and is trimmed', async () => {
  await withStore(async ({ file }) => {
    const store = new DeviceStore({ file })
    await store.load()
    await store.ensureDevice({ deviceId: MAC })
    await store.rename({ deviceId: MAC, nickName: '  书房手表  ' })

    const reopened = new DeviceStore({ file })
    await reopened.load()
    const device = reopened.get(MAC)
    assert.equal(device.nickName, '书房手表')
    assert.equal('blocked' in device, false)
  })
})

test('a corrupt document is quarantined instead of blocking startup', async () => {
  await withStore(async ({ file, dir }) => {
    const { writeFile, readdir } = await import('node:fs/promises')
    await writeFile(file, '{ this is not json', 'utf8')
    const store = new DeviceStore({ file })
    await store.load()
    assert.equal(store.size, 0)
    const names = await readdir(dir)
    assert.ok(names.some((name) => name.startsWith('devices.json.corrupt-')), 'the broken file must be kept aside')
  })
})

test('removing a device forgets it', async () => {
  await withStore(async ({ file }) => {
    const store = new DeviceStore({ file })
    await store.load()
    await store.ensureDevice({ deviceId: MAC })
    await store.remove({ deviceId: MAC })
    assert.equal(store.size, 0)
    await assert.rejects(store.remove({ deviceId: MAC }), /设备不存在/)
  })
})

test('the hub keeps one session per device and never removes a replacement', () => {
  const hub = new ConnectionHub()
  const evicted = []
  const makeSession = (id) => ({
    id,
    deviceId: MAC,
    remoteIp: '192.168.1.50',
    lastSeenAt: Date.now(),
    evict: (reason) => evicted.push({ id, reason }),
  })
  const first = makeSession('s1')
  const second = makeSession('s2')
  hub.register(first)
  assert.equal(hub.get(MAC), first)
  hub.register(second)
  assert.equal(hub.get(MAC), second)
  assert.deepEqual(evicted, [{ id: 's1', reason: 'replaced by a newer connection' }])

  // A late close from the evicted socket must not delete its replacement.
  assert.equal(hub.unregister(MAC, first), false)
  assert.equal(hub.get(MAC), second)
  assert.equal(hub.unregister(MAC, second), true)
  assert.equal(hub.get(MAC), undefined)
})
