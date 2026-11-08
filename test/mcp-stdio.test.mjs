import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpManager } from '../src/mcp/manager.js'

const silent = { info() {}, warn() {}, error() {} }

const SERVER_SCRIPT = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } });
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', description: 'echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
  } else if (message.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'echo:' + message.params.arguments.text }] } });
  }
});
`

test('external stdio MCP server: initialize, list tools, call tool', async () => {
  const manager = new McpManager({
    servers: {
      fake: { command: process.execPath, args: ['-e', SERVER_SCRIPT] },
    },
    logger: silent,
  })
  try {
    await manager.initialize()
    const definitions = manager.definitions()
    assert.equal(definitions.length, 1)
    assert.equal(definitions[0].function.name, 'echo')
    assert.equal(manager.has('echo'), true)
    assert.equal(await manager.execute('echo', { text: 'hello' }), 'echo:hello')
  } finally {
    manager.close()
  }
})
