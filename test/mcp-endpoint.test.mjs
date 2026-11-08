import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WsMcpEndpointClient } from '../src/mcp/ws-endpoint-client.js'

const silent = { info() {}, warn() {}, error() {} }

class FakeWebSocket {
  constructor(url) {
    this.url = url
    this.sent = []
    this.listeners = new Map()
    queueMicrotask(() => this.emit('open', {}))
  }

  addEventListener(name, fn) {
    const list = this.listeners.get(name) ?? []
    list.push(fn)
    this.listeners.set(name, list)
  }

  emit(name, event) {
    for (const fn of this.listeners.get(name) ?? []) fn(event)
  }

  send(text) {
    const message = JSON.parse(text)
    this.sent.push(message)
    if (message.method === 'initialize') {
      this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: 'fake', version: '1' } } }) })
    } else if (message.method === 'tools/list') {
      this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] } }) })
    } else if (message.method === 'tools/call') {
      this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'pong' }] } }) })
    }
  }

  close() {
    this.emit('close', {})
  }
}

test('MCP endpoint: initialize, tools/list, tools/call over WebSocket', async () => {
  const client = new WsMcpEndpointClient({ url: 'ws://fake/mcp/test', WebSocketImpl: FakeWebSocket, logger: silent })
  try {
    const count = await client.initialize()
    assert.equal(count, 1)
    assert.equal(client.has('ping'), true)
    assert.equal(await client.callTool('ping', {}), 'pong')
    assert.equal(client.ws.sent[0].method, 'initialize')
    assert.equal(client.ws.sent[0].id, 1)
    assert.equal(client.ws.sent[1].method, 'notifications/initialized')
    assert.equal(client.ws.sent[2].method, 'tools/list')
    assert.equal(client.ws.sent[3].method, 'tools/call')
    assert.equal(client.ws.sent[3].id, 3)
  } finally {
    client.close()
  }
})
