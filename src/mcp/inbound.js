/**
 * 入站 MCP 通道（`/mcp`）：游戏 / 外部 MCP server 连进来，**响应**服务端的 JSON-RPC。
 *
 * 与 `ws-endpoint-client.js`（出站接入点）方向相反：这里是服务端发
 * initialize(id=1) / notifications/initialized / tools/list(id=2) / tools/call(id>=3)，
 * 对端回 result。裸 JSON-RPC 2.0，不包 `type:'mcp'`。
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

export class InboundMcpChannel {
  constructor({ send, logger, initTimeoutMs = INIT_TIMEOUT_MS, callTimeoutMs = CALL_TIMEOUT_MS } = {}) {
    this.send = send
    this.logger = logger ?? {}
    this.initTimeoutMs = initTimeoutMs
    this.callTimeoutMs = callTimeoutMs
    this.pending = new Map()
    this.nextId = 3
    this.tools = new Map()
    this.closed = false
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: { name: 'dsh-xiaozhi', version: '1.0.0' },
    }, 1, this.initTimeoutMs)
    this.#write({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
    const result = await this.request('tools/list', {}, 2, this.initTimeoutMs)
    this.#ingest(result?.tools)
    return this.tools.size
  }

  #write(message) {
    if (this.closed) throw new Error('入站 MCP 通道已关闭')
    this.send(JSON.stringify(message))
  }

  request(method, params, id, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`入站 MCP ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.#write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  handleText(text) {
    let message
    try {
      message = JSON.parse(String(text))
    } catch {
      return false
    }
    if (!message || message.id === undefined) return false
    const pending = this.pending.get(message.id)
    if (!pending) return false
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(`入站 MCP 错误：${message.error?.message ?? '未知'}`))
    else pending.resolve(message.result)
    return true
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

  has(name) {
    return this.tools.has(name)
  }

  listTools() {
    return [...this.tools.values()].map((tool) => ({ ...tool }))
  }

  async callTool(name, args = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`入站 MCP 工具 ${name} 不存在`)
    const id = this.nextId
    this.nextId += 1
    const result = await this.request('tools/call', {
      name: tool.originalName,
      arguments: args && typeof args === 'object' ? args : {},
    }, id, this.callTimeoutMs)
    if (result && typeof result === 'object' && result.isError === true) {
      throw new Error(`入站 MCP 工具返回错误：${result.error ?? '未知'}`)
    }
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content.find((item) => item && typeof item.text === 'string')
    if (text) return text.text
    return typeof result === 'string' ? result : JSON.stringify(result ?? '')
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('入站 MCP 通道已关闭'))
    }
    this.pending.clear()
  }
}

/** 多个 `/mcp` 连接的工具聚合；同名工具用 agentId 前缀区分。 */
export class InboundMcpRegistry {
  constructor({ logger } = {}) {
    this.logger = logger ?? {}
    this.channels = new Map() // agentId -> channel
    this.tools = new Map() // exposed name -> { channel, localName, definition }
  }

  async add(agentId, channel) {
    const key = String(agentId || 'default')
    this.channels.set(key, channel)
    try {
      const count = await channel.initialize()
      const prefix = sanitizeToolName(key)
      for (const tool of channel.listTools()) {
        let exposed = tool.name
        if (this.tools.has(exposed)) exposed = `${prefix}_${tool.name}`
        let suffix = 2
        while (this.tools.has(exposed)) exposed = `${prefix}_${tool.name}_${suffix++}`
        this.tools.set(exposed, {
          channel,
          localName: tool.name,
          definition: {
            type: 'function',
            function: {
              name: exposed,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          },
        })
      }
      this.logger.info?.(`dsh-xiaozhi: 入站 MCP ${key} ready (${count} tools)`)
      return count
    } catch (error) {
      this.logger.warn?.(`dsh-xiaozhi: 入站 MCP ${key} 初始化失败: ${error.message}`)
      this.remove(key)
      return 0
    }
  }

  remove(agentId) {
    const key = String(agentId || 'default')
    const channel = this.channels.get(key)
    if (!channel) return
    channel.close()
    this.channels.delete(key)
    for (const [name, tool] of this.tools) {
      if (tool.channel === channel) this.tools.delete(name)
    }
  }

  has(name) {
    return this.tools.has(name)
  }

  definitions() {
    return [...this.tools.values()].map((tool) => tool.definition)
  }

  async execute(name, args = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`入站 MCP 工具 ${name} 不存在`)
    return tool.channel.callTool(tool.localName, args)
  }

  close() {
    for (const channel of this.channels.values()) channel.close()
    this.channels.clear()
    this.tools.clear()
  }
}
