/**
 * 外部 MCP server 的 HTTP 传输：SSE（旧版默认）与 Streamable HTTP。
 *
 * 官方 Python 版用 `mcp` SDK 的 `sse_client` / `streamable_http_client`；这里用
 * fetch + 手写 JSON-RPC，避免给插件引入运行时依赖。
 *
 * - SSE：GET 打开事件流，等服务端下发 `event: endpoint`，之后把 JSON-RPC POST 到该地址，
 *   响应从事件流的 `event: message` 回来。
 * - Streamable HTTP：每个 JSON-RPC 直接 POST 到 url；响应可能是 JSON，也可能是 SSE。
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

function toolTable() {
  const tools = new Map()
  return {
    ingest(list) {
      for (const tool of Array.isArray(list) ? list : []) {
        if (!tool || typeof tool.name !== 'string' || !tool.name) continue
        const name = sanitizeToolName(tool.name)
        if (!name) continue
        tools.set(name, {
          name,
          originalName: tool.name,
          description: typeof tool.description === 'string' ? tool.description : '',
          inputSchema: normalizeSchema(tool.inputSchema),
        })
      }
    },
    list() {
      return [...tools.values()].map((tool) => ({ ...tool }))
    },
    has(name) {
      return tools.has(name)
    },
    get(name) {
      return tools.get(name)
    },
  }
}

function resultText(result) {
  if (result && typeof result === 'object' && result.isError === true) {
    throw new Error(`MCP 工具返回错误：${result.error ?? '未知'}`)
  }
  const content = Array.isArray(result?.content) ? result.content : []
  const text = content.find((item) => item && typeof item.text === 'string')
  if (text) return text.text
  return typeof result === 'string' ? result : JSON.stringify(result ?? '')
}

/** 极简 SSE 解析：按空行切事件，拼接 data 行。 */
async function* sseEvents(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      for (;;) {
        const index = buffer.indexOf('\n\n')
        if (index < 0) break
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        let event = 'message'
        const data = []
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        yield { event, data: data.join('\n') }
      }
    }
  } finally {
    reader.releaseLock?.()
  }
}

function headersWith(config, extra = {}) {
  const headers = { ...(config.headers && typeof config.headers === 'object' ? config.headers : {}) }
  return { ...headers, ...extra }
}

class BaseHttpClient {
  constructor({ name, config, logger, initTimeoutMs = INIT_TIMEOUT_MS, callTimeoutMs = CALL_TIMEOUT_MS }) {
    this.name = String(name ?? '')
    this.config = config ?? {}
    this.logger = logger ?? {}
    this.initTimeoutMs = initTimeoutMs
    this.callTimeoutMs = callTimeoutMs
    this.nextId = 1
    this.tools = toolTable()
    this.closed = false
  }

  listTools() {
    return this.tools.list()
  }

  has(name) {
    return this.tools.has(name)
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-xiaozhi', version: '1.0.0' },
    }, this.initTimeoutMs)
    await this.notify('notifications/initialized', {})
    const result = await this.request('tools/list', {}, this.initTimeoutMs)
    this.tools.ingest(result?.tools)
    return this.tools.list().length
  }

  async callTool(name, args = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`MCP 工具 ${name} 不存在`)
    const result = await this.request('tools/call', {
      name: tool.originalName,
      arguments: args && typeof args === 'object' ? args : {},
    }, this.callTimeoutMs)
    return resultText(result)
  }

  nextRequestId() {
    const id = this.nextId
    this.nextId += 1
    return id
  }
}

/** 传统 SSE：GET 事件流 + POST 到 endpoint。 */
export class SseMcpClient extends BaseHttpClient {
  constructor(options) {
    super(options)
    this.url = String(this.config.url ?? '')
    this.endpoint = ''
    this.abort = new AbortController()
    this.pending = new Map()
    this.endpointWaiters = []
  }

  async initialize() {
    if (!this.url) throw new Error('SSE MCP 缺少 url')
    await this.#connect()
    return super.initialize()
  }

  async #connect() {
    const response = await fetch(this.url, {
      method: 'GET',
      headers: headersWith(this.config, { Accept: 'text/event-stream' }),
      signal: this.abort.signal,
    })
    if (!response.ok || !response.body) throw new Error(`SSE 连接失败：HTTP ${response.status}`)
    const endpoint = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SSE endpoint 超时')), this.initTimeoutMs)
      this.endpointWaiters.push({ resolve, reject, timer })
    })
    void (async () => {
      try {
        for await (const event of sseEvents(response)) {
          if (this.closed) break
          if (event.event === 'endpoint') {
            this.endpoint = new URL(event.data.trim(), this.url).toString()
            for (const waiter of this.endpointWaiters.splice(0)) {
              clearTimeout(waiter.timer)
              waiter.resolve(this.endpoint)
            }
          } else if (event.event === 'message' && event.data) {
            this.#handleMessage(event.data)
          }
        }
      } catch (error) {
        if (!this.closed) this.logger.warn?.(`dsh-xiaozhi: MCP[${this.name}] SSE 断开：${error.message}`)
        for (const waiter of this.endpointWaiters.splice(0)) {
          clearTimeout(waiter.timer)
          waiter.reject(error)
        }
        this.#failAll(error)
      }
    })()
    return endpoint
  }

  #handleMessage(text) {
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(`MCP 错误：${message.error?.message ?? '未知'}`))
    else pending.resolve(message.result)
  }

  async request(method, params, timeoutMs) {
    if (this.closed) throw new Error('MCP 客户端已关闭')
    if (!this.endpoint) throw new Error('SSE endpoint 未就绪')
    const id = this.nextRequestId()
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: headersWith(this.config, { 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: this.abort.signal,
    })
    if (!response.ok) {
      this.pending.delete(id)
      throw new Error(`MCP POST 失败：HTTP ${response.status}`)
    }
    return result
  }

  async notify(method, params) {
    if (!this.endpoint) return
    await fetch(this.endpoint, {
      method: 'POST',
      headers: headersWith(this.config, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: this.abort.signal,
    }).catch(() => {})
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
    this.abort.abort()
    this.#failAll(new Error('MCP 客户端已关闭'))
  }
}

/** Streamable HTTP：每个 JSON-RPC POST，响应 JSON 或 SSE。 */
export class StreamableHttpMcpClient extends BaseHttpClient {
  constructor(options) {
    super(options)
    this.url = String(this.config.url ?? '')
    this.sessionId = ''
    this.abort = new AbortController()
  }

  async request(method, params, timeoutMs) {
    if (this.closed) throw new Error('MCP 客户端已关闭')
    if (!this.url) throw new Error('Streamable HTTP MCP 缺少 url')
    const id = this.nextRequestId()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    this.abort.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: headersWith(this.config, {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        }),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      })
      const session = response.headers.get('mcp-session-id')
      if (session) this.sessionId = session
      if (!response.ok) throw new Error(`MCP POST 失败：HTTP ${response.status}`)
      const type = String(response.headers.get('content-type') ?? '')
      if (type.includes('text/event-stream') && response.body) {
        for await (const event of sseEvents(response)) {
          if (event.event !== 'message' || !event.data) continue
          const message = JSON.parse(event.data)
          if (message.id !== id) continue
          if (message.error) throw new Error(`MCP 错误：${message.error?.message ?? '未知'}`)
          return message.result
        }
        throw new Error(`MCP ${method} 没有返回结果`)
      }
      const message = await response.json()
      if (message?.error) throw new Error(`MCP 错误：${message.error?.message ?? '未知'}`)
      return message?.result
    } finally {
      clearTimeout(timer)
      this.abort.signal.removeEventListener('abort', onAbort)
    }
  }

  async notify(method, params) {
    await fetch(this.url, {
      method: 'POST',
      headers: headersWith(this.config, {
        'Content-Type': 'application/json',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      }),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: this.abort.signal,
    }).catch(() => {})
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
  }
}
