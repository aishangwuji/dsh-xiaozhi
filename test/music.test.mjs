import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeAudioToPcm } from '../src/voice/music.js'

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function wavBuffer(pcm, sampleRate = 24_000) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

test('decodeAudioToPcm turns a local wav into 24k mono PCM', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-music-decode-'))
  const file = join(dir, 'tone.wav')
  const pcm = Buffer.alloc(24_000 * 2 * 0.1)
  for (let index = 0; index < pcm.length / 2; index += 1) {
    pcm.writeInt16LE(Math.round(Math.sin((index / 24_000) * 2 * Math.PI * 440) * 8000), index * 2)
  }
  writeFileSync(file, wavBuffer(pcm))
  try {
    const decoded = await decodeAudioToPcm(file, { sampleRate: 24_000 })
    assert.ok(decoded.length > 0)
    assert.ok(decoded.length <= pcm.length + 4096)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
