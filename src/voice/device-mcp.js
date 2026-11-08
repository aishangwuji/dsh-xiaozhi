/**
 * 设备侧 MCP 客户端（对齐官方 `core/providers/tools/device_mcp`）。
 *
 * 协议：hello 里 `features.mcp === true` 时，服务端在 hello 之后通过同一条 WS 发
 * `{type:'mcp', payload:{jsonrpc:'2.0', id, method, params}}`；设备回同形状的
 * `result` / `error`。握手固定 id=1（initialize）、id=2（tools/list），工具调用从 id=3 起。
 *
 * 工具名会做 OpenAI 兼容清洗（保留中英文、数字、下划线、连字符），并在调用时映射回
 * 设备上报的原始名字。
 */

const INITIALIZE_ID = 1
const TOOLS_LIST_ID = 2
const FIRST_CALL_ID = 3
const CALL_TIMEOUT_MS = 30_000

/** 官方 `sanitize_tool_name` 的等价实现。 */
export function sanitizeToolName(name) {
  return String(name ?? '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_')
}

function normalizeSchema(schema) {
  const source = schema && typeof schema === 'object' ? schema : {}
  const properties = source.properties && typeof source.properties === 'object' ? source.properties : {}
  const required = Array.isArray(source.required)
    ? source.required.filter((item) => typeof item === 'string')
    : []
  return {
    type: typeof source.type === 'string' ? source.type : 'object',
    properties,
    required,
  }
}

export class DeviceMcpClient {
  constructor({ sendJson, timeoutMs = CALL_TIMEOUT_MS, logger } = {}) {
    this.sendJson = sendJson
    this.timeoutMs = timeoutMs
    this.logger = logger ?? {}
    this.tools = new Map() // sanitized -> { name, description, inputSchema, originalName }
    this.pending = new Map() // id -> { resolve, reject, timer }
    this.nextId = FIRST_CALL_ID
    this.ready = false
    this.cursor = ''
    this.sentInitialize = false
  }

  #send(payload) {
    this.sendJson?.(payload)
  }

  /** hello 之后调用：并发发 initialize 和 tools/list（官方也是并发预发）。 */
  initialize() {
    if (this.sentInitialize) return
    this.sentInitialize = true
    this.#send({
      jsonrpc: '2.0',
      id: INITIALIZE_ID,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
        },
        clientInfo: { name: 'XiaozhiClient', version: '1.0.0' },
      },
    })
    this.#send({ jsonrpc: '2.0', id: TOOLS_LIST_ID, method: 'tools/list' })
  }

  /** 处理设备回包；返回 true 表示工具列表有变化。 */
  handlePayload(payload) {
    if (!payload || typeof payload !== 'object') return false
    const id = Number(payload.id ?? 0)
    if (payload.error) {
      const pending = this.pending.get(id)
      if (pending) {
        this.pending.delete(id)
        clearTimeout(pending.timer)
        pending.reject(new Error(`MCP 错误：${payload.error?.message ?? '未知错误'}`))
      }
      return false
    }
    if (!('result' in payload)) return false
    const result = payload.result

    if (id === INITIALIZE_ID) {
      const server = result?.serverInfo
      if (server) this.logger.info?.(`dsh-xiaozhi: device MCP server ${server.name ?? '?'} ${server.version ?? ''}`.trim())
      return false
    }
    if (id === TOOLS_LIST_ID) {
      const changed = this.#ingestTools(result)
      const cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : ''
      if (cursor && cursor !== this.cursor) {
        this.cursor = cursor
        this.#send({ jsonrpc: '2.0', id: TOOLS_LIST_ID, method: 'tools/list', params: { cursor } })
      } else {
        this.ready = true
      }
      return changed
    }

    const pending = this.pending.get(id)
    if (pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.resolve(result)
      return false
    }
    return false
  }

  #ingestTools(result) {
    const list = Array.isArray(result?.tools) ? result.tools : []
    let changed = false
    for (const tool of list) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) continue
      const sanitized = sanitizeToolName(tool.name)
      if (!sanitized) continue
      const entry = {
        name: sanitized,
        originalName: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema: normalizeSchema(tool.inputSchema),
      }
      const previous = this.tools.get(sanitized)
      if (!previous || previous.originalName !== entry.originalName) changed = true
      this.tools.set(sanitized, entry)
    }
    return changed
  }

  has(name) {
    return this.tools.has(name)
  }

  /** 会话关闭时拒绝所有未完成的工具调用。 */
  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('MCP 会话已关闭'))
    }
    this.pending.clear()
  }

  definitions() {
    return [...this.tools.values()].map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: tool.inputSchema.type,
          properties: tool.inputSchema.properties,
          required: tool.inputSchema.required,
        },
      },
    }))
  }

  /** 调用设备工具；返回文本（官方优先取 content[0].text）。 */
  async callTool(name, args = {}, { signal } = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`设备 MCP 工具 ${name} 不存在`)
    if (signal?.aborted) throw new Error('MCP 调用已取消')
    const id = this.nextId
    this.nextId += 1
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`设备 MCP 工具 ${name} 超时`))
      }, this.timeoutMs)
      const onAbort = () => {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error('MCP 调用已取消'))
      }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener?.('abort', onAbort)
          resolve(value)
        },
        reject: (error) => {
          signal?.removeEventListener?.('abort', onAbort)
          reject(error)
        },
        timer,
      })
      this.#send({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: tool.originalName, arguments: args && typeof args === 'object' ? args : {} },
      })
    })
    if (result && typeof result === 'object' && result.isError === true) {
      throw new Error(`设备 MCP 工具返回错误：${result.error ?? '未知错误'}`)
    }
    const content = Array.isArray(result?.content) ? result.content : []
    const text = content.find((item) => item && typeof item.text === 'string')
    if (text) return text.text
    return typeof result === 'string' ? result : JSON.stringify(result ?? '')
  }
}
