import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PendingStore } from '../src/pending.js'

const silent = { info() {}, warn() {}, error() {} }

test('PendingStore queues, updates attempts, persists and removes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pending-'))
  const file = join(dir, 'pending.json')
  try {
    const store = new PendingStore({ file, logger: silent, clock: () => 1000 })
    await store.load()
    const first = await store.upsert({
      deviceId: '02:4A:7D:E3:89:BF',
      clientId: 'client-1',
      ip: '192.168.1.9',
      firmwareVersion: '1.0.0',
    })
    assert.equal(first.attempts, 1)
    await store.upsert({ deviceId: '02:4A:7D:E3:89:BF', ip: '192.168.1.10' })
    assert.equal(store.get('02:4A:7D:E3:89:BF').attempts, 2)
    assert.equal(store.get('02:4A:7D:E3:89:BF').lastIp, '192.168.1.10')

    const reloaded = new PendingStore({ file, logger: silent })
    await reloaded.load()
    assert.equal(reloaded.list().length, 1)
    assert.equal(reloaded.get('02:4A:7D:E3:89:BF').clientId, 'client-1')
    assert.equal(await reloaded.remove('02:4A:7D:E3:89:BF'), true)
    assert.equal(reloaded.list().length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
