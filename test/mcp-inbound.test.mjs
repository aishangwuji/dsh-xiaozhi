import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InboundMcpChannel, InboundMcpRegistry } from '../src/mcp/inbound.js'

const silent = { info() {}, warn() {}, error() {} }

function makeChannel(prefix = 'p') {
  let channel
  const sent = []
  const send = (text) => {
    const message = JSON.parse(text)
    sent.push(message)
    if (message.method === 'initialize') {
      channel.handleText(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { serverInfo: { name: prefix, version: '1' } } }))
    } else if (message.method === 'tools/list') {
      channel.handleText(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [{ name: 'echo', description: `${prefix} echo`, inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }],
        },
      }))
    } else if (message.method === 'tools/call') {
      channel.handleText(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: `${prefix}:${message.params.arguments.text}` }] },
      }))
    }
  }
  channel = new InboundMcpChannel({ send, logger: silent })
  return { channel, sent }
}

test('inbound MCP channel: server drives initialize/tools/list/tools/call', async () => {
  const { channel, sent } = makeChannel('game')
  const count = await channel.initialize()
  assert.equal(count, 1)
  assert.equal(channel.has('echo'), true)
  assert.equal(await channel.callTool('echo', { text: 'hi' }), 'game:hi')
  assert.equal(sent[0].id, 1)
  assert.equal(sent[0].method, 'initialize')
  assert.equal(sent[1].method, 'notifications/initialized')
  assert.equal(sent[2].id, 2)
  assert.equal(sent[3].id, 3)
  channel.close()
})

test('inbound MCP registry prefixes colliding tool names and dispatches to the right channel', async () => {
  const first = makeChannel('a')
  const second = makeChannel('b')
  const registry = new InboundMcpRegistry({ logger: silent })
  try {
    await registry.add('game', first.channel)
    await registry.add('other', second.channel)
    const names = registry.definitions().map((tool) => tool.function.name).sort()
    assert.deepEqual(names, ['echo', 'other_echo'])
    assert.equal(await registry.execute('echo', { text: '1' }), 'a:1')
    assert.equal(await registry.execute('other_echo', { text: '2' }), 'b:2')
  } finally {
    registry.close()
  }
})
