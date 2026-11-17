import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFirmwareStore, FirmwareError } from '../src/firmware.js'

const silent = { info() {}, warn() {}, error() {} }

async function withStore(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-xiaozhi-firmware-'))
  const store = createFirmwareStore({ dir, logger: silent, ...options })
  store.load()
  return { dir, store, dispose: () => rm(dir, { recursive: true, force: true }) }
}

test('firmware store saves, reports and reloads the active file', async () => {
  const { dir, store, dispose } = await withStore()
  try {
    const info = await store.save(Buffer.from('firmware'), { fileName: 'watch-1.bin', version: '1.2.3' })
    assert.equal(info.fileName, 'watch-1.bin')
    assert.equal(info.size, 8)
    assert.equal(info.version, '1.2.3')
    assert.equal(info.sha256.length, 64)
    assert.deepEqual(store.resolve('watch-1.bin').fileName, 'watch-1.bin')
    assert.equal(store.resolve('other.bin'), null)

    // 重新 load 从 index.json 恢复，不依赖内存状态。
    const reloaded = createFirmwareStore({ dir, logger: silent })
    reloaded.load()
    assert.equal(reloaded.info().fileName, 'watch-1.bin')
    assert.equal(reloaded.info().version, '1.2.3')
  } finally {
    await dispose()
  }
})

test('uploading a new file replaces the old one on disk', async () => {
  const { dir, store, dispose } = await withStore()
  try {
    await store.save(Buffer.from('one'), { fileName: 'a.bin' })
    await store.save(Buffer.from('two'), { fileName: 'b.bin' })
    const names = await readdir(dir)
    assert.deepEqual(names.sort(), ['b.bin', 'index.json'])
    assert.equal(store.info().fileName, 'b.bin')
  } finally {
    await dispose()
  }
})

test('firmware store rejects empty, oversized and unsafe names', async () => {
  const { store, dispose } = await withStore({ maxBytes: 4 })
  try {
    await assert.rejects(() => store.save(Buffer.alloc(0), { fileName: 'a.bin' }), (error) => error.code === 'empty')
    await assert.rejects(
      () => store.save(Buffer.from('12345'), { fileName: 'a.bin' }),
      (error) => error instanceof FirmwareError && error.code === 'too-large',
    )
    for (const name of ['../evil.bin', 'a.txt', '', 'a b.bin', 'x'.repeat(70) + '.bin']) {
      await assert.rejects(
        () => store.save(Buffer.from('x'), { fileName: name }),
        (error) => error.code === 'invalid-name',
        name,
      )
    }
  } finally {
    await dispose()
  }
})

test('remove deletes both the file and the index', async () => {
  const { dir, store, dispose } = await withStore()
  try {
    await store.save(Buffer.from('x'), { fileName: 'a.bin' })
    assert.equal(await store.remove(), true)
    assert.equal(store.info(), null)
    assert.deepEqual(await readdir(dir), [])
    assert.equal(await store.remove(), false)
    assert.equal(store.resolve('a.bin'), null)
  } finally {
    await dispose()
  }
})
