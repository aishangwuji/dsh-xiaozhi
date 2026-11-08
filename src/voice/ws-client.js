/**
 * Minimal RFC 6455 *client*.
 *
 * Node ships a browser-shaped WebSocket (no custom headers), and both providers
 * this pipeline talks to require them: Edge TTS needs `Origin`,
 * `Sec-WebSocket-Protocol: synthesize` and a Chromium User-Agent to accept the
 * connection at all. So the client half is implemented here, mirroring the
 * server half in `../ws.js`.
 */

import { EventEmitter } from 'node:events'
import { connect as netConnect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import { createHash, randomBytes } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa }

export class ClientWebSocket extends EventEmitter {
  constructor(socket, { maxPayload = 8 * 1024 * 1024 } = {}) {
    super()
    this.socket = socket
    this.maxPayload = maxPayload
    this.buffer = Buffer.alloc(0)
    this.closed = false
    this.closeSent = false
    socket.on('data', (chunk) => this.#onData(chunk))
    socket.on('error', (error) => this.#fail(error))
    socket.on('close', () => this.#teardown(1006, 'socket closed'))
  }

  sendText(text) {
    this.#send(OPCODE.text, Buffer.from(String(text), 'utf8'))
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value))
  }

  /**
   * Text opcode carrying raw bytes. The Volcengine ASR client sends its binary
   * protocol frames as `websocket.TextMessage` (the Go reference does exactly
   * that), so the frame type — not the content — decides how it is delivered.
   */
  sendTextBytes(data) {
    this.#send(OPCODE.text, Buffer.isBuffer(data) ? data : Buffer.from(data))
  }

  sendBinary(data) {
    this.#send(OPCODE.binary, Buffer.isBuffer(data) ? data : Buffer.from(data))
  }

  close(code = 1000, reason = '') {
    if (this.closed || this.closeSent) return
    this.closeSent = true
    const reasonBuffer = Buffer.from(String(reason).slice(0, 120), 'utf8')
    const payload = Buffer.alloc(2 + reasonBuffer.length)
    payload.writeUInt16BE(code, 0)
    reasonBuffer.copy(payload, 2)
    this.#send(OPCODE.close, payload)
    const timer = setTimeout(() => this.#teardown(code, reason), 500)
    timer.unref?.()
    try {
      this.socket.end()
    } catch {
      this.#teardown(code, reason)
    }
  }

  #fail(error) {
    if (this.closed) return
    this.emit('socket-error', error)
    this.#teardown(1006, error.message)
  }

  #teardown(code, reason) {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.destroy()
    } catch {
      // Already gone.
    }
    this.emit('close', code, reason)
  }

  #send(opcode, payload) {
    if (this.closed) return
    const mask = randomBytes(4)
    const masked = Buffer.alloc(payload.length)
    for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index & 3]
    let header
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length])
    } else if (payload.length < 65_536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(payload.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(payload.length), 2)
    }
    try {
      this.socket.write(Buffer.concat([header, mask, masked]))
    } catch (error) {
      this.#fail(error)
    }
  }

  #onData(chunk) {
    if (this.closed) return
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > this.maxPayload * 4 + 1024) {
      this.close(1009, 'receive buffer overflow')
      return
    }
    while (!this.closed && this.#parseFrame()) {
      // drain
    }
  }

  #parseFrame() {
    const buffer = this.buffer
    if (buffer.length < 2) return false
    const first = buffer[0]
    const second = buffer[1]
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let offset = 2
    if (length === 126) {
      if (buffer.length < 4) return false
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return false
      const big = buffer.readBigUInt64BE(2)
      if (big > BigInt(this.maxPayload)) {
        this.close(1009, 'frame too large')
        return false
      }
      length = Number(big)
      offset = 10
    }
    const maskOffset = masked ? 4 : 0
    if (buffer.length < offset + maskOffset + length) return false
    let payload = buffer.subarray(offset + maskOffset, offset + maskOffset + length)
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4)
      const unmasked = Buffer.alloc(length)
      for (let index = 0; index < length; index += 1) unmasked[index] = payload[index] ^ mask[index & 3]
      payload = unmasked
    }
    this.buffer = buffer.subarray(offset + maskOffset + length)
    // Raw view for protocols carried as binary inside either frame type (the
    // Volcengine ws_binary protocol is documented as binary but arrives as text).
    if (fin && (opcode === OPCODE.text || opcode === OPCODE.binary)) {
      this.emit('frame', opcode, payload)
    }
    switch (opcode) {
      case OPCODE.text:
        if (fin) this.emit('text', payload.toString('utf8'))
        return true
      case OPCODE.binary:
        if (fin) this.emit('binary', payload)
        return true
      case OPCODE.ping:
        this.#send(OPCODE.pong, payload)
        return true
      case OPCODE.pong:
        return true
      case OPCODE.close: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
        if (!this.closeSent) {
          this.closeSent = true
          this.#send(OPCODE.close, payload.subarray(0, 125))
        }
        this.#teardown(code, reason)
        return false
      }
      default:
        return true
    }
  }
}

/**
 * Open a WebSocket connection and resolve once the handshake succeeds.
 * Rejects with the HTTP status when the server refuses.
 */
export function connectWebSocket(urlString, { headers = {}, timeoutMs = 10_000, protocols = '' } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const secure = url.protocol === 'wss:'
    const port = Number(url.port || (secure ? 443 : 80))
    const key = randomBytes(16).toString('base64')
    const socket = secure
      ? tlsConnect({ host: url.hostname, port, servername: url.hostname })
      : netConnect({ host: url.hostname, port })

    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error('websocket connect timeout')), timeoutMs)
    timer.unref?.()

    socket.once('error', fail)
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      const lines = [
        `GET ${url.pathname}${url.search} HTTP/1.1`,
        `Host: ${url.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        ...(protocols ? [`Sec-WebSocket-Protocol: ${protocols}`] : []),
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        '',
      ]
      socket.write(lines.join('\r\n'))
    })

    let buffer = Buffer.alloc(0)
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      socket.off('data', onData)
      clearTimeout(timer)
      const head = buffer.subarray(0, end).toString('utf8')
      const rest = buffer.subarray(end + 4)
      const status = Number(head.split(' ')[1])
      if (status !== 101) {
        settled = true
        socket.destroy()
        reject(new Error(`websocket handshake failed: ${head.split('\r\n')[0]}`))
        return
      }
      const expected = createHash('sha1').update(key + GUID).digest('base64')
      if (!head.toLowerCase().includes(`sec-websocket-accept: ${expected.toLowerCase()}`)) {
        settled = true
        socket.destroy()
        reject(new Error('websocket handshake returned an invalid Sec-WebSocket-Accept'))
        return
      }
      settled = true
      const client = new ClientWebSocket(socket)
      if (rest.length > 0) client.buffer = rest
      resolve(client)
    }
    socket.on('data', onData)
  })
}
