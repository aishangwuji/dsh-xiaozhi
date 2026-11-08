import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { McpManager } from '../src/mcp/manager.js'

const silent = { info() {}, warn() {}, error() {} }

function jsonResponse(res, value, headers = {}) {
  res.writeHead(200, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(value))
}

test('external MCP over Streamable HTTP and SSE', async () => {
  let sseRes = null
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      sseRes = res
      res.write('event: endpoint\ndata: /messages?session=s1\n\n')
      return
    }
    if (req.method === 'POST' && req.url === '/messages?session=s1') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(202)
      res.end()
      if (message.id !== undefined) {
        const result = message.method === 'initialize'
          ? { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'sse', version: '1' } }
          : message.method === 'tools/list'
            ? { tools: [{ name: 'echo_sse', description: 'sse echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
            : { content: [{ type: 'text', text: `sse:${message.params.arguments.text}` }] }
        sseRes.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`)
      }
      return
    }
    if (req.method === 'POST' && req.url === '/mcp') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (message.method === 'initialize') {
        jsonResponse(res, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'http', version: '1' } } }, { 'Mcp-Session-Id': 's1' })
      } else if (message.method === 'tools/list') {
        jsonResponse(res, { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo_http', description: 'http echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] } })
      } else if (message.method === 'tools/call') {
        jsonResponse(res, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `http:${message.params.arguments.text}` }] } })
      } else {
        res.writeHead(202)
        res.end()
      }
      return
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const manager = new McpManager({
    servers: {
      http: { url: `${base}/mcp`, transport: 'streamable-http' },
      sse: { url: `${base}/sse` },
    },
    logger: silent,
  })
  try {
    await manager.initialize()
    const names = manager.definitions().map((tool) => tool.function.name).sort()
    assert.deepEqual(names, ['echo_http', 'echo_sse'])
    assert.equal(await manager.execute('echo_http', { text: 'a' }), 'http:a')
    assert.equal(await manager.execute('echo_sse', { text: 'b' }), 'sse:b')
  } finally {
    manager.close()
    server.close()
    await once(server, 'close')
  }
})
