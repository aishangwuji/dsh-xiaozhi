/**
 * A minimal RFC 6455 server endpoint.
 *
 * The gateway needs exactly four things from the socket layer: a correct
 * handshake, text/binary frames, ping/pong, and a close handshake that tells the
 * evicted device *why* it was dropped. Node ships no WebSocket server, and the
 * plugin is installed as a plain package directory with no dependency tree, so
 * the protocol surface is implemented here instead of pulling in `ws`.
 *
 * Deliberately unsupported: extensions (permessage-deflate), subprotocols, and
 * continuation of control frames. A firmware client uses none of them, and
 * refusing to negotiate extensions is what the handshake below already does.
 */

import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa }

/** Application close codes used by the gateway. 4000–4999 are private use. */
export const CLOSE_CODE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  policyViolation: 1008,
  tooLarge: 1009,
  internalError: 1011,
  replaced: 4001,
  unauthenticated: 4003,
}

export class UpgradeRejection extends Error {
  constructor(status, body) {
    super(typeof body === 'string' ? body : body?.error ?? 'upgrade rejected')
    this.name = 'UpgradeRejection'
    this.status = status
    this.body = body
  }
}

/** Answer an upgrade attempt with plain HTTP before any protocol switch. */
export function rejectUpgrade(socket, status, body, extraHeaders = {}) {
  const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}), 'utf8')
  const reason = STATUS_TEXT[status] ?? 'Error'
  const lines = [
    `HTTP/1.1 ${status} ${reason}`,
    'content-type: application/json; charset=utf-8',
    `content-length: ${payload.length}`,
    'connection: close',
    'cache-control: no-store',
    ...Object.entries(extraHeaders).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ]
  try {
    socket.write(lines.join('\r\n'))
    socket.end(payload)
  } catch {
    socket.destroy?.()
  }
}

const STATUS_TEXT = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 426: 'Upgrade Required' }

function headerOf(req, name) {
  const value = req.headers?.[name]
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] ?? '' : ''
}

/**
 * Validate an upgrade request and switch the socket to the WebSocket protocol.
 * Throws `UpgradeRejection` for anything malformed; the caller answers with
 * `rejectUpgrade` so a failed handshake never leaves a half-open socket.
 */
export function acceptUpgrade(req, socket, head, { maxPayload = 256 * 1024 } = {}) {
  if (req.method !== 'GET') throw new UpgradeRejection(400, { error: 'websocket upgrade must use GET' })
  if (headerOf(req, 'upgrade').toLowerCase() !== 'websocket') {
    throw new UpgradeRejection(400, { error: 'missing Upgrade: websocket' })
  }
  if (!headerOf(req, 'connection').toLowerCase().split(/\s*,\s*/).includes('upgrade')) {
    throw new UpgradeRejection(400, { error: 'missing Connection: Upgrade' })
  }
  const key = headerOf(req, 'sec-websocket-key').trim()
  if (!/^[A-Za-z0-9+/]{22}==$/.test(key)) throw new UpgradeRejection(400, { error: 'invalid Sec-WebSocket-Key' })
  if (headerOf(req, 'sec-websocket-version').trim() !== '13') {
    throw new UpgradeRejection(426, { error: 'only Sec-WebSocket-Version 13 is supported' }, { 'sec-websocket-version': '13' })
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'),
  )
  socket.setNoDelay?.(true)
  return new WebSocketConnection(socket, { maxPayload, head })
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, { maxPayload = 256 * 1024, head } = {}) {
    super()
    this.socket = socket
    this.maxPayload = maxPayload
    this.buffer = Buffer.alloc(0)
    this.fragments = []
    this.fragmentOpcode = 0
    this.fragmentSize = 0
    this.closed = false
    this.closeSent = false
    this.lastPongAt = Date.now()
    this.openedAt = Date.now()
    socket.on('data', (chunk) => this.#onData(chunk))
    socket.on('error', (error) => this.emit('socket-error', error))
    socket.on('close', () => this.#teardown(1006, 'socket closed'))
    socket.on('end', () => this.#teardown(1006, 'socket ended'))
    if (head && head.length > 0) this.#onData(head)
  }

  get remoteAddress() {
    return this.socket.remoteAddress ?? ''
  }

  get isOpen() {
    return !this.closed && !this.closeSent
  }

  sendText(text) {
    this.#writeFrame(OPCODE.text, Buffer.from(String(text), 'utf8'))
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value))
  }

  sendBinary(data) {
    this.#writeFrame(OPCODE.binary, Buffer.isBuffer(data) ? data : Buffer.from(data))
  }

  ping(payload = Buffer.alloc(0)) {
    this.#writeFrame(OPCODE.ping, Buffer.from(payload).subarray(0, 125))
  }

  /** Start the close handshake. `code`/`reason` reach the device verbatim. */
  close(code = CLOSE_CODE.normal, reason = '') {
    if (this.closed || this.closeSent) return
    this.closeSent = true
    const reasonBuffer = Buffer.from(String(reason).slice(0, 120), 'utf8')
    const payload = Buffer.alloc(2 + reasonBuffer.length)
    payload.writeUInt16BE(code, 0)
    reasonBuffer.copy(payload, 2)
    this.#writeFrame(OPCODE.close, payload)
    const timer = setTimeout(() => this.#teardown(code, String(reason)), 1000)
    timer.unref?.()
    try {
      this.socket.end()
    } catch {
      this.#teardown(code, String(reason))
    }
  }

  destroy(code = 1006, reason = 'destroyed') {
    this.#teardown(code, reason)
  }

  #teardown(code, reason) {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.destroy()
    } catch {
      // Already gone; the state transition below is what matters.
    }
    this.emit('close', code, reason)
  }

  #onData(chunk) {
    if (this.closed) return
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > this.maxPayload * 4 + 1024) {
      this.#teardown(CLOSE_CODE.tooLarge, 'receive buffer overflow')
      return
    }
    while (!this.closed && this.#parseFrame()) {
      // Keep draining complete frames from the buffer.
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
    if (first & 0x70) {
      this.close(CLOSE_CODE.protocolError, 'reserved bits set')
      return false
    }
    if (length === 126) {
      if (buffer.length < 4) return false
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return false
      const big = buffer.readBigUInt64BE(2)
      if (big > BigInt(this.maxPayload)) {
        this.close(CLOSE_CODE.tooLarge, 'frame too large')
        return false
      }
      length = Number(big)
      offset = 10
    }
    const isControl = opcode >= 0x8
    if (isControl && (!fin || length > 125)) {
      this.close(CLOSE_CODE.protocolError, 'invalid control frame')
      return false
    }
    if (length > this.maxPayload) {
      this.close(CLOSE_CODE.tooLarge, 'frame too large')
      return false
    }
    if (!masked) {
      this.close(CLOSE_CODE.protocolError, 'client frames must be masked')
      return false
    }
    if (buffer.length < offset + 4 + length) return false
    const mask = buffer.subarray(offset, offset + 4)
    const payload = Buffer.allocUnsafe(length)
    const start = offset + 4
    for (let index = 0; index < length; index += 1) {
      payload[index] = buffer[start + index] ^ mask[index & 3]
    }
    this.buffer = buffer.subarray(start + length)
    this.#dispatch(opcode, fin, payload)
    return true
  }

  #dispatch(opcode, fin, payload) {
    switch (opcode) {
      case OPCODE.ping:
        this.#writeFrame(OPCODE.pong, payload)
        this.emit('ping', payload)
        return
      case OPCODE.pong:
        this.lastPongAt = Date.now()
        this.emit('pong', payload)
        return
      case OPCODE.close: {
        let code = 1005
        let reason = ''
        if (payload.length >= 2) {
          code = payload.readUInt16BE(0)
          reason = payload.subarray(2).toString('utf8')
        }
        if (!this.closeSent) {
          this.closeSent = true
          const echo = payload.length >= 2 ? payload.subarray(0, 125) : Buffer.alloc(0)
          this.#writeFrame(OPCODE.close, echo)
        }
        this.#teardown(code, reason || 'peer closed')
        return
      }
      case OPCODE.text:
      case OPCODE.binary: {
        if (!fin) {
          this.fragments = [payload]
          this.fragmentOpcode = opcode
          this.fragmentSize = payload.length
          return
        }
        this.emit('message', opcode === OPCODE.text ? payload.toString('utf8') : payload, opcode === OPCODE.binary)
        return
      }
      case OPCODE.continuation: {
        if (this.fragmentOpcode === 0) {
          this.close(CLOSE_CODE.protocolError, 'unexpected continuation frame')
          return
        }
        this.fragmentSize += payload.length
        if (this.fragmentSize > this.maxPayload) {
          this.close(CLOSE_CODE.tooLarge, 'fragmented message too large')
          return
        }
        this.fragments.push(payload)
        if (!fin) return
        const complete = Buffer.concat(this.fragments)
        const opcodeOfMessage = this.fragmentOpcode
        this.fragments = []
        this.fragmentOpcode = 0
        this.fragmentSize = 0
        this.emit(
          'message',
          opcodeOfMessage === OPCODE.text ? complete.toString('utf8') : complete,
          opcodeOfMessage === OPCODE.binary,
        )
        return
      }
      default:
        this.close(CLOSE_CODE.protocolError, `unknown opcode ${opcode}`)
    }
  }

  #writeFrame(opcode, payload) {
    if (this.closed) return
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '')
    let header
    if (body.length < 126) {
      header = Buffer.from([0x80 | opcode, body.length])
    } else if (body.length < 65_536) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 126
      header.writeUInt16BE(body.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 127
      header.writeBigUInt64BE(BigInt(body.length), 2)
    }
    try {
      this.socket.write(Buffer.concat([header, body]))
    } catch {
      this.#teardown(1006, 'write failed')
    }
  }
}
