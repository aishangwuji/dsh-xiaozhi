/**
 * Test-only WebSocket client.
 *
 * The plugin implements its own server endpoint, so the tests need an
 * independent client that speaks the wire format rather than sharing the
 * server's buffer code — otherwise a framing bug would agree with itself.
 */

import { EventEmitter } from 'node:events'
import { connect } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function encodeClientFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
  const mask = randomBytes(4)
  let header
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | body.length])
  } else if (body.length < 65_536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(body.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(body.length), 2)
  }
  const masked = Buffer.alloc(body.length)
  for (let index = 0; index < body.length; index += 1) masked[index] = body[index] ^ mask[index & 3]
  return Buffer.concat([header, mask, masked])
}

export class TestWebSocket extends EventEmitter {
  constructor(socket) {
    super()
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.pending = []
    this.closed = false
    this.closeInfo = null
    socket.on('data', (chunk) => this.#onData(chunk))
    socket.on('error', () => {})
    socket.on('close', () => {
      if (!this.closed) {
        this.closed = true
        this.closeInfo = this.closeInfo ?? { code: 1006, reason: 'socket closed' }
        this.emit('close', this.closeInfo)
      }
    })
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value))
  }

  sendText(text) {
    this.socket.write(encodeClientFrame(0x1, text))
  }

  sendBinary(data) {
    this.socket.write(encodeClientFrame(0x2, data))
  }

  ping() {
    this.socket.write(encodeClientFrame(0x9, Buffer.alloc(0)))
  }

  destroy() {
    this.socket.destroy()
  }

  /** Wait for the next text message (already accumulated ones win). */
  nextText(timeoutMs = 3000) {
    if (this.pending.length > 0) return Promise.resolve(this.pending.shift())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('text', onText)
        reject(new Error('timed out waiting for a text message'))
      }, timeoutMs)
      const onText = () => {
        clearTimeout(timer)
        resolve(this.pending.shift())
      }
      this.once('text', onText)
    })
  }

  waitClose(timeoutMs = 3000) {
    if (this.closeInfo) return Promise.resolve(this.closeInfo)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs)
      this.once('close', (info) => {
        clearTimeout(timer)
        resolve(info)
      })
    })
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.#parseFrame()) {
      // drain
    }
  }

  #parseFrame() {
    const buffer = this.buffer
    if (buffer.length < 2) return false
    const opcode = buffer[0] & 0x0f
    const masked = (buffer[1] & 0x80) !== 0
    let length = buffer[1] & 0x7f
    let offset = 2
    if (length === 126) {
      if (buffer.length < 4) return false
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return false
      length = Number(buffer.readBigUInt64BE(2))
      offset = 10
    }
    const maskOffset = masked ? 4 : 0
    if (buffer.length < offset + maskOffset + length) return false
    let payload = buffer.subarray(offset + maskOffset, offset + maskOffset + length)
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4)
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index & 3]))
    }
    this.buffer = buffer.subarray(offset + maskOffset + length)
    switch (opcode) {
      case 0x1: {
        const text = payload.toString('utf8')
        this.pending.push(text)
        this.emit('text', text)
        return true
      }
      case 0x2:
        this.emit('binary', payload)
        return true
      case 0x8: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
        this.closeInfo = { code, reason }
        this.closed = true
        this.emit('close', this.closeInfo)
        return true
      }
      case 0x9:
        this.socket.write(encodeClientFrame(0xa, payload))
        return true
      case 0xa:
        this.emit('pong')
        return true
      default:
        return true
    }
  }
}

/**
 * Attempt an upgrade.
 * @returns {Promise<{ status: number, body: any, ws?: TestWebSocket }>}
 */
export async function openWebSocket({ port, host = '127.0.0.1', path = '/xiaozhi/v1/', headers = {} }) {
  const socket = connect({ host, port })
  await once(socket, 'connect')
  const key = randomBytes(16).toString('base64')
  const lines = [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ]
  socket.write(lines.join('\r\n'))

  let buffer = Buffer.alloc(0)
  const headerEnd = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('handshake timed out')), 3000)
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      const index = buffer.indexOf('\r\n\r\n')
      if (index < 0) return
      clearTimeout(timer)
      socket.off('data', onData)
      resolve(index)
    }
    socket.on('data', onData)
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  const head = buffer.subarray(0, headerEnd).toString('utf8')
  const rest = buffer.subarray(headerEnd + 4)
  const status = Number(head.split(' ')[1])
  if (status !== 101) {
    const contentLength = /content-length:\s*(\d+)/i.exec(head)
    const expected = contentLength ? Number(contentLength[1]) : 0
    let body = rest
    while (body.length < expected) {
      const [chunk] = await once(socket, 'data')
      body = Buffer.concat([body, chunk])
    }
    socket.destroy()
    const text = body.toString('utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return { status, body: parsed }
  }

  const expectedAccept = createHash('sha1').update(key + GUID).digest('base64')
  if (!head.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)) {
    socket.destroy()
    throw new Error(`handshake returned an invalid Sec-WebSocket-Accept: ${head}`)
  }

  const client = new TestWebSocket(socket)
  if (rest.length > 0) client.buffer = rest
  return { status, ws: client, body: null }
}
