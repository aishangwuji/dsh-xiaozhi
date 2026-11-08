/**
 * 外部 MCP server 管理器（当前支持 stdio；SSE / streamable-http 留待下一阶段）。
 *
 * 配置文件默认 `~/.dsh-xiaozhi/mcp_servers.json`，格式与官方
 * `data/.mcp_server_settings.json` 一致：
 * {
 *   "mcpServers": {
 *     "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
 *   }
 * }
 */
import { readFile } from 'node:fs/promises'
import { sanitizeToolName } from '../voice/device-mcp.js'
import { StdioMcpClient } from './stdio-client.js'

export class McpManager {
  constructor({ file = '', servers = null, logger } = {}) {
    this.file = file
    this.servers = servers
    this.logger = logger ?? {}
    this.clients = new Map() // server name -> client
    this.tools = new Map() // exposed tool name -> { client, localName, definition }
    this.ready = false
    this.initialized = false
  }

  async loadConfig() {
    if (this.servers) return this.servers
    if (!this.file) return {}
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'))
      return raw?.mcpServers && typeof raw.mcpServers === 'object' ? raw.mcpServers : {}
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn?.(`dsh-xiaozhi: 读取 MCP 配置失败 ${this.file}: ${error.message}`)
      }
      return {}
    }
  }

  async initialize() {
    if (this.initialized) return this
    this.initialized = true
    const servers = await this.loadConfig()
    const jobs = []
    for (const [name, config] of Object.entries(servers)) {
      if (!config || typeof config !== 'object') continue
      if (!config.command && !config.url) {
        this.logger.warn?.(`dsh-xiaozhi: MCP server ${name} 缺少 command/url，跳过`)
        continue
      }
      if (!config.command) {
        this.logger.warn?.(`dsh-xiaozhi: MCP server ${name} 使用 url（SSE/streamable-http），当前版本暂不支持，跳过`)
        continue
      }
      jobs.push(this.#initOne(name, config))
    }
    await Promise.allSettled(jobs)
    this.ready = true
    this.logger.info?.(`dsh-xiaozhi: external MCP tools = ${this.tools.size}`)
    return this
  }

  async #initOne(name, config) {
    const client = new StdioMcpClient({ name, config, logger: this.logger })
    try {
      const count = await client.initialize()
      this.clients.set(name, client)
      this.#collect(name, client)
      this.logger.info?.(`dsh-xiaozhi: MCP server ${name} ready (${count} tools)`)
    } catch (error) {
      client.close()
      this.logger.warn?.(`dsh-xiaozhi: MCP server ${name} 初始化失败: ${error.message}`)
    }
  }

  #collect(serverName, client) {
    const prefix = sanitizeToolName(serverName)
    for (const tool of client.listTools()) {
      let exposed = tool.name
      if (this.tools.has(exposed)) exposed = `${prefix}_${tool.name}`
      let suffix = 2
      while (this.tools.has(exposed)) exposed = `${prefix}_${tool.name}_${suffix++}`
      this.tools.set(exposed, {
        client,
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
  }

  has(name) {
    return this.tools.has(name)
  }

  definitions() {
    return [...this.tools.values()].map((tool) => tool.definition)
  }

  async execute(name, args = {}) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`MCP 工具 ${name} 不存在`)
    return tool.client.callTool(tool.localName, args)
  }

  close() {
    for (const client of this.clients.values()) client.close()
    this.clients.clear()
    this.tools.clear()
  }
}

export function createMcpManager(options) {
  return new McpManager(options)
}
