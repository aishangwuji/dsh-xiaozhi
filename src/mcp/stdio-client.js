/**
 * 外部 MCP server（stdio 传输）。
 *
 * 对齐官方 `core/providers/tools/server_mcp` 的 stdio 分支：
 * 子进程 stdin/stdout 走 **按行分隔的 JSON-RPC 2.0**，先 initialize，再
 * notifications/initialized，最后 tools/list；工具调用走 tools/call。
 *
 * SSE / streamable-http 分支还没实现（配置里带 url 的条目会被 manager 跳过并告警）。
 */
import { spawn } from 'node:child_process'
import { sanitizeToolName } from '../voice/device-mcp.js'

const PROTOCOL_VERSION = '2024-11-05'
const INIT_TIMEOUT_MS = 10_000
const CALL_TIMEOUT_MS = 30_000

export class StdioMcpClient {
  constructor({ name, config, logger, initTimeoutMs = INIT_TIMEOUT_MS, callTimeoutMs = CALL_TIMEOUT_MS } = {}) {
    this.name = String(name ?? '')
    this.config = config ?? {}
    this.logger = logger ?? {}
    this.initTimeoutMs = initTimeoutMs
    this.callTimeoutMs = callTimeoutMs
    this.child = null
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.tools = new Map() // sanitized -> { name, originalName, description, inputSchema }
    this.closed = false
  }

  async initialize() {
    const command = this.config.command
    if (!command) throw new Error('MCP server 缺少 command')
    const args = Array.isArray(this.config.args) ? this.config.args.map(String) : []
    const env = { ...process.env, ...(this.config.env && typeof this.config.env === 'object' ? this.config.env : {}) }
    this.child = spawn(command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows 上 npx 是 .cmd，需要 shell；其他命令保持直接 spawn。
      shell: process.platform === 'win32' && /^(npx|npm|node)$/i.test(command),
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this.#onData(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) this.logger.warn?.(`dsh-xiaozhi: MCP[${this.name}] ${text.slice(0, 300)}`)
    })
    this.child.on('error', (error) => this.#failAll(error))
    this.child.on('exit', (code, signal) => {
      if (!this.closed) this.logger.warn?.(`dsh-xiaozhi: MCP[${this.name}] exited (${code ?? signal})`)
      this.#failAll(new Error(`MCP server 已退出（${code ?? signal}）`))
    })

    await this.#request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-xiaozhi', version: '1.0.0' },
    }, this.initTimeoutMs)
    this.#notify('notifications/initialized', {})
    const result = await this.#request('tools/list', {}, this.initTimeoutMs)
    this.#ingestTools(result?.tools)
    return this.tools.size
  }

  #onData(chunk) {
    this.buffer += chunk
    for (;;) {
      const index = this.buffer.indexOf('\n')
      if (index < 0) break
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        this.logger.warn?.(`dsh-xiaozhi: MCP[${this.name}] 非 JSON 输出：${line.slice(0, 200)}`)
        continue
      }
      this.#handleMessage(message)
    }
  }

  #handleMessage(message) {
    if (!message || typeof message !== 'object') return
    if (message.id === undefined) return // notification
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(`MCP 错误：${message.error?.message ?? '未知'}`))
    else pending.resolve(message.result)
  }

  #request(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error('MCP 客户端已关闭'))
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.#write({ jsonrpc: '2.0', id, method, params })
    })
  }

  #notify(method, params) {
    this.#write({ jsonrpc: '2.0', method, params })
  }

  #write(message) {
    if (!this.child?.stdin?.writable) throw new Error('MCP stdin 不可写')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #ingestTools(list) {
    for (const tool of Array.isArray(list) ? list : []) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) continue
      const sanitized = sanitizeToolName(tool.name)
      if (!sanitized) continue
      this.tools.set(sanitized, {
        name: sanitized,
        originalName: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} },
      })
    }
  }

  listTools() {
    return [...this.tools.values()].map((tool) => ({ ...tool }))
  }

  has(name) {
    return this.tools.has(name)
  }

  async callTool(name, args = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`MCP 工具 ${name} 不存在`)
    const result = await this.#request('tools/call', {
      name: tool.originalName,
      arguments: args && typeof args === 'object' ? args : {},
    }, this.callTimeoutMs)
    if (result && typeof result === 'object' && result.isError === true) {
      throw new Error(`MCP 工具返回错误：${result.error ?? '未知'}`)
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
    this.#failAll(new Error('MCP 客户端已关闭'))
    try {
      this.child?.kill()
    } catch {
      // ignore
    }
    this.child = null
  }
}
