/**
 * MCP 接入点（出站 WebSocket JSON-RPC）。
 *
 * 对齐官方 `core/providers/tools/mcp_endpoint`：连接 `ws(s)://.../mcp/...`，
 * 发 initialize(id=1) / notifications/initialized / tools/list(id=2)；
 * 工具调用从 id=3 起。消息就是裸 JSON-RPC，不像设备侧 MCP 那样包一层 `type:'mcp'`。
 */
import { sanitizeToolName } from '../voice/device-mcp.js'

const PROTOCOL_VERSION = '2024-11-05'
const INIT_TIMEOUT_MS = 10_000
const CALL_TIMEOUT_MS = 30_000

function normalizeSchema(schema) {
  const source = schema && typeof schema === 'object' ? schema : {}
  return {
    type: typeof source.type === 'string' ? source.type : 'object',
    properties: source.properties && typeof source.properties === 'object' ? source.properties : {},
    required: Array.isArray(source.required) ? source.required.filter((item) => typeof item === 'string') : [],
  }
}

export class WsMcpEndpointClient {
  constructor({
    url,
    WebSocketImpl = globalThis.WebSocket,
    logger,
    initTimeoutMs = INIT_TIMEOUT_MS,
    callTimeoutMs = CALL_TIMEOUT_MS,
  } = {}) {
    this.url = String(url ?? '')
    this.WebSocketImpl = WebSocketImpl
    this.logger = logger ?? {}
    this.initTimeoutMs = initTimeoutMs
    this.callTimeoutMs = callTimeoutMs
    this.ws = null
    this.pending = new Map()
    this.nextId = 3
    this.tools = new Map()
    this.closed = false
  }

  async initialize() {
    if (!this.url) throw new Error('MCP 接入点缺少 url')
    if (typeof this.WebSocketImpl !== 'function') throw new Error('当前运行环境没有 WebSocket')
    this.ws = new this.WebSocketImpl(this.url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP 接入点连接超时')), this.initTimeoutMs)
      const done = (fn) => (value) => {
        clearTimeout(timer)
        fn(value)
      }
      this.ws.addEventListener?.('open', done(resolve), { once: true })
      this.ws.addEventListener?.('error', done(() => reject(new Error('MCP 接入点连接失败'))), { once: true })
    })
    this.ws.addEventListener?.('message', (event) => this.#onMessage(event?.data))
    this.ws.addEventListener?.('close', () => this.#failAll(new Error('MCP 接入点已关闭')))

    await this.#request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: { name: 'XiaozhiMCPEndpointClient', version: '1.0.0' },
    }, 1, this.initTimeoutMs)
    this.#send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
    const result = await this.#request('tools/list', {}, 2, this.initTimeoutMs)
    this.#ingest(result?.tools)
    return this.tools.size
  }

  #onMessage(data) {
    let text = data
    if (typeof text !== 'string') {
      try {
        text = Buffer.isBuffer(text) ? text.toString('utf8') : String(text)
      } catch {
        return
      }
    }
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (!message || message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(`MCP 接入点错误：${message.error?.message ?? '未知'}`))
    else pending.resolve(message.result)
  }

  #ingest(list) {
    for (const tool of Array.isArray(list) ? list : []) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) continue
      const name = sanitizeToolName(tool.name)
      if (!name) continue
      this.tools.set(name, {
        name,
        originalName: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema: normalizeSchema(tool.inputSchema),
      })
    }
  }

  #send(message) {
    if (!this.ws) throw new Error('MCP 接入点未连接')
    this.ws.send(JSON.stringify(message))
  }

  #request(method, params, id, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP 接入点 ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.#send({ jsonrpc: '2.0', id, method, params })
    })
  }

  has(name) {
    return this.tools.has(name)
  }

  listTools() {
    return [...this.tools.values()].map((tool) => ({ ...tool }))
  }

  async callTool(name, args = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`MCP 接入点工具 ${name} 不存在`)
    const id = this.nextId
    this.nextId += 1
    const result = await this.#request('tools/call', {
      name: tool.originalName,
      arguments: args && typeof args === 'object' ? args : {},
    }, id, this.callTimeoutMs)
    if (result && typeof result === 'object' && result.isError === true) {
      throw new Error(`MCP 接入点工具返回错误：${result.error ?? '未知'}`)
    }
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content.find((item) => item && typeof item.text === 'string')
    if (text) return text.text
    return typeof result === 'string' ? result : JSON.stringify(result ?? '')
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.#failAll(new Error('MCP 接入点已关闭'))
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    this.ws = null
  }
}
