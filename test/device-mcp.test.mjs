import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeviceMcpClient, sanitizeToolName } from '../src/voice/device-mcp.js'
import { VoiceSession } from '../src/voice/session.js'
import { createMockAdapters } from '../src/voice/adapters/mock.js'

test('sanitizeToolName keeps Chinese/alnum and replaces the rest', () => {
  assert.equal(sanitizeToolName('turn on/off'), 'turn_on_off')
  assert.equal(sanitizeToolName('开灯'), '开灯')
})

test('device MCP handshake sends initialize + tools/list and exposes tools', async () => {
  const sent = []
  const client = new DeviceMcpClient({ sendJson: (payload) => sent.push(payload) })
  client.initialize()
  assert.equal(sent.length, 2)
  assert.equal(sent[0].method, 'initialize')
  assert.equal(sent[0].id, 1)
  assert.equal(sent[1].method, 'tools/list')
  assert.equal(sent[1].id, 2)

  client.handlePayload({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'watch', version: '1' } } })
  const changed = client.handlePayload({
    jsonrpc: '2.0',
    id: 2,
    result: {
      tools: [
        {
          name: 'turn on/off',
          description: 'switch the light',
          inputSchema: {
            type: 'object',
            properties: { on: { type: 'boolean' } },
            required: ['on'],
          },
        },
      ],
    },
  })
  assert.equal(changed, true)
  assert.equal(client.has('turn_on_off'), true)
  assert.deepEqual(client.definitions(), [
    {
      type: 'function',
      function: {
        name: 'turn_on_off',
        description: 'switch the light',
        parameters: {
          type: 'object',
          properties: { on: { type: 'boolean' } },
          required: ['on'],
        },
      },
    },
  ])
  // 控制台只读目录：清洗名 + 原始名 + 描述 + 入参，执行仍用原始名。
  assert.deepEqual(client.catalog(), [
    {
      name: 'turn_on_off',
      originalName: 'turn on/off',
      description: 'switch the light',
      parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
    },
  ])
})

test('device MCP call uses the original tool name and resolves content text', async () => {
  const sent = []
  const client = new DeviceMcpClient({ sendJson: (payload) => sent.push(payload) })
  client.handlePayload({
    id: 2,
    result: { tools: [{ name: 'turn on/off', inputSchema: { type: 'object', properties: {} } }] },
  })
  const pending = client.callTool('turn_on_off', { on: true })
  const call = sent.at(-1)
  assert.equal(call.method, 'tools/call')
  assert.equal(call.id, 3)
  assert.equal(call.params.name, 'turn on/off')
  assert.deepEqual(call.params.arguments, { on: true })
  client.handlePayload({ id: 3, result: { content: [{ type: 'text', text: 'ok' }] } })
  assert.equal(await pending, 'ok')
})

test('device MCP rejects on error response and on close', async () => {
  const client = new DeviceMcpClient({ sendJson: () => {} })
  client.handlePayload({
    id: 2,
    result: { tools: [{ name: 'a', inputSchema: { type: 'object' } }] },
  })
  const failed = client.callTool('a', {})
  client.handlePayload({ id: 3, error: { message: 'boom' } })
  await assert.rejects(failed, /boom/)

  const waiting = client.callTool('a', {})
  client.close()
  await assert.rejects(waiting, /关闭/)
})

test('VoiceSession starts the device MCP handshake after hello', () => {
  const json = []
  const session = new VoiceSession({
    sink: { sendJson: (message) => json.push(message), sendBinary: () => {} },
    adapters: createMockAdapters({ plan: ['你好'], reply: '好的。', deltaMs: 1 }),
    config: {
      sampleRate: { uplink: 16_000, downlink: 24_000 },
      frameMs: { uplink: 60, downlink: 20 },
      silenceMs: 60,
      minSpeechMs: 60,
      vadThreshold: 0.012,
      historyTurns: 4,
      pacingMarginMs: 2,
      language: 'zh',
    },
    createDecoder: () => ({ push() {}, close() {} }),
    encodeSpeech: async () => ({ packets: [Buffer.alloc(40)], frameMs: 20 }),
    deviceId: 'TEST',
  })
  session.handleHello({ mcp: true })
  const mcp = json.filter((message) => message.type === 'mcp')
  assert.equal(mcp.length, 2)
  assert.equal(mcp[0].payload.method, 'initialize')
  assert.equal(mcp[1].payload.method, 'tools/list')
})
