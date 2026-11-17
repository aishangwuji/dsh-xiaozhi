/**
 * Minimal Ogg Opus muxer/demuxer.
 *
 * Xiaozhi devices exchange *raw* Opus packets, one per WebSocket binary frame.
 * Every tool that can decode Opus (ffmpeg here, the reference implementation's
 * libopus bindings there) wants a container, and an Ogg page may legally carry a
 * single packet — so wrapping each incoming packet in its own page turns the
 * stream into something `ffmpeg -f ogg -i pipe:0` can consume packet by packet.
 *
 * Scoped deliberately: one logical stream, no chaining, no seeking, no
 * multiplexing. That is all a voice turn needs.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index << 24
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 0x8000_0000 ? ((value << 1) ^ 0x04c1_1db7) >>> 0 : (value << 1) >>> 0
    }
    table[index] = value >>> 0
  }
  return table
})()

function oggCrc(buffer) {
  let crc = 0
  for (let index = 0; index < buffer.length; index += 1) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) & 0xff) ^ buffer[index]]) >>> 0
  }
  return crc >>> 0
}

function buildPage({ packet, serial, sequence, granulePosition, headerType }) {
  const segments = []
  let remaining = packet.length
  while (remaining >= 255) {
    segments.push(255)
    remaining -= 255
  }
  segments.push(remaining)
  if (segments.length > 255) throw new Error('dsh-xiaozhi: opus packet exceeds one Ogg page')

  const header = Buffer.alloc(27 + segments.length)
  header.write('OggS', 0, 'latin1')
  header[4] = 0
  header[5] = headerType
  header.writeBigInt64LE(BigInt(granulePosition), 6)
  header.writeUInt32LE(serial >>> 0, 14)
  header.writeUInt32LE(sequence >>> 0, 18)
  header.writeUInt32LE(0, 22) // CRC placeholder
  header[26] = segments.length
  Buffer.from(segments).copy(header, 27)

  const page = Buffer.concat([header, packet])
  page.writeUInt32LE(oggCrc(page), 22)
  return page
}

function opusHead({ channels = 1, inputSampleRate = 16_000, preSkip = 312 }) {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'latin1')
  head[8] = 1 // version
  head[9] = channels
  head.writeUInt16LE(preSkip, 10)
  head.writeUInt32LE(inputSampleRate, 12)
  head.writeInt16LE(0, 16) // output gain
  head[18] = 0 // channel mapping family
  return head
}

function opusTags() {
  const vendor = Buffer.from('dsh-xiaozhi', 'utf8')
  const head = Buffer.alloc(8)
  head.write('OpusTags', 0, 'latin1')
  const length = Buffer.alloc(4)
  length.writeUInt32LE(vendor.length, 0)
  const comments = Buffer.alloc(4) // count = 0
  return Buffer.concat([head, length, vendor, comments])
}

/**
 * Wraps raw Opus packets into a streaming Ogg Opus bitstream.
 *
 * One instance per direction. `serial` only has to be unique within a stream;
 * the caller supplies it so a re-used decoder cannot mistake a new stream for
 * a continuation.
 */
export class OggOpusMuxer {
  constructor({ serial = 0x5a1_0001, channels = 1, inputSampleRate = 16_000, preSkip = 312 } = {}) {
    this.serial = serial
    this.sequence = 0
    this.granule = 0
    this.samplesPerMs = inputSampleRate / 1000
    this.started = false
    this.channels = channels
    this.inputSampleRate = inputSampleRate
    this.preSkip = preSkip
  }

  /** Header pages; emitted once, before the first audio page. */
  start() {
    if (this.started) return Buffer.alloc(0)
    this.started = true
    const head = buildPage({
      packet: opusHead({ channels: this.channels, inputSampleRate: this.inputSampleRate, preSkip: this.preSkip }),
      serial: this.serial,
      sequence: this.sequence++,
      granulePosition: 0,
      headerType: 0x02,
    })
    const tags = buildPage({
      packet: opusTags(),
      serial: this.serial,
      sequence: this.sequence++,
      granulePosition: 0,
      headerType: 0x00,
    })
    return Buffer.concat([head, tags])
  }

  /** Append one Opus packet (already encoded at `frameMs` of audio). */
  push(packet, frameMs = 60) {
    if (!this.started) this.start()
    this.granule += Math.round(frameMs * this.samplesPerMs)
    return buildPage({
      packet,
      serial: this.serial,
      sequence: this.sequence++,
      granulePosition: this.granule,
      headerType: 0x00,
    })
  }
}

/**
 * Extract audio packets from a complete Ogg Opus stream.
 *
 * Packets are delimited by the lacing values in each page: a value of 255 means
 * "the packet continues", any smaller value terminates it. A single page may
 * carry many packets, and a packet may span pages, so the demuxer assembles
 * rather than slicing one packet per page.
 * Header packets (OpusHead/OpusTags) are skipped.
 */
export function demuxOggOpus(buffer) {
  const packets = []
  let offset = 0
  let pending = []
  let pendingSize = 0
  let skipHeaders = 2
  while (offset + 27 <= buffer.length) {
    if (buffer.toString('latin1', offset, offset + 4) !== 'OggS') {
      const next = buffer.indexOf('OggS', offset + 1, 'latin1')
      if (next === -1) break
      offset = next
      continue
    }
    const segmentCount = buffer[offset + 26]
    const tableStart = offset + 27
    if (tableStart + segmentCount > buffer.length) break
    let payloadLength = 0
    for (let index = 0; index < segmentCount; index += 1) payloadLength += buffer[tableStart + index]
    const payloadStart = tableStart + segmentCount
    if (payloadStart + payloadLength > buffer.length) break

    let cursor = payloadStart
    for (let index = 0; index < segmentCount; index += 1) {
      const lace = buffer[tableStart + index]
      pending.push(buffer.subarray(cursor, cursor + lace))
      pendingSize += lace
      cursor += lace
      if (lace < 255) {
        const packet = pending.length === 1 ? Buffer.from(pending[0]) : Buffer.from(Buffer.concat(pending))
        pending = []
        pendingSize = 0
        if (skipHeaders > 0) skipHeaders -= 1
        else if (packet.length > 0) packets.push(packet)
      }
    }
    offset = payloadStart + payloadLength
  }
  return packets
}

/**
 * Incremental version of {@link demuxOggOpus}: feed arbitrary byte slices as
 * ffmpeg emits them and get back whatever complete packets became available.
 *
 * Streaming TTS needs the first Opus packet long before the encoder has finished
 * the sentence, so the demuxer keeps its own buffer/pending-packet state across
 * calls instead of requiring the whole Ogg stream up front. The lacing rules are
 * the same; header packets (OpusHead/OpusTags) are skipped.
 */
export function createOggOpusStreamDemuxer({ skipHeaders = 2 } = {}) {
  let buffer = Buffer.alloc(0)
  let pending = []
  let headersLeft = skipHeaders

  function drain() {
    const packets = []
    for (;;) {
      if (buffer.length < 27) return packets
      const captureAt = buffer.indexOf('OggS', 0, 'latin1')
      if (captureAt === -1) {
        // Keep the last three bytes: a capture pattern may be split across reads.
        if (buffer.length > 3) buffer = buffer.subarray(buffer.length - 3)
        return packets
      }
      if (captureAt > 0) buffer = buffer.subarray(captureAt)
      if (buffer.length < 27) return packets
      const segmentCount = buffer[26]
      if (buffer.length < 27 + segmentCount) return packets
      let payloadLength = 0
      for (let index = 0; index < segmentCount; index += 1) payloadLength += buffer[27 + index]
      if (buffer.length < 27 + segmentCount + payloadLength) return packets

      let cursor = 27 + segmentCount
      for (let index = 0; index < segmentCount; index += 1) {
        const lace = buffer[27 + index]
        pending.push(buffer.subarray(cursor, cursor + lace))
        cursor += lace
        if (lace < 255) {
          const packet = pending.length === 1 ? Buffer.from(pending[0]) : Buffer.from(Buffer.concat(pending))
          pending = []
          if (headersLeft > 0) headersLeft -= 1
          else if (packet.length > 0) packets.push(packet)
        }
      }
      buffer = buffer.subarray(27 + segmentCount + payloadLength)
    }
  }

  return {
    /** @returns {Buffer[]} packets completed by this chunk (may be empty). */
    push(chunk) {
      if (!chunk || chunk.length === 0) return []
      buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk)
      return drain()
    },
  }
}

/**
 * Duration of one Opus packet in milliseconds, read from its TOC byte.
 * Needed to pace frames that came from a provider rather than from our encoder:
 * a 60 ms frame must be sent every ~58 ms, a 20 ms frame every ~18 ms.
 */
export function opusPacketDurationMs(packet) {
  if (!packet || packet.length === 0) return 0
  const toc = packet[0]
  const config = toc >> 3
  let frameMs
  if (config < 12) frameMs = [10, 20, 40, 60][config & 0x03]
  else if (config < 16) frameMs = [10, 20][config & 0x03]
  else frameMs = [2.5, 5, 10, 20][config & 0x03]
  const code = toc & 0x03
  const frames = code === 0 ? 1 : code === 1 || code === 2 ? 2 : 3
  return frameMs * frames
}
