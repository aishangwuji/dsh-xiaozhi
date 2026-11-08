/**
 * 设备侧 IoT（对齐官方 `core/providers/tools/device_iot`）。
 *
 * 设备在 WS 上发 `{type:'iot', descriptors:[...]}` 注册能力，发
 * `{type:'iot', states:[...]}` 更新属性；服务端把每个属性/方法变成一个工具：
 *   - 查询：`get_<device>_<property>`，参数 response_success/response_failure；
 *   - 控制：`<device>_<method>`，参数 = 方法参数 + response_success/response_failure。
 * 执行控制时回 `{type:'iot', commands:[{name,method,parameters}]}`。
 */
import { sanitizeToolName } from './device-mcp.js'

function lower(value) {
  return String(value ?? '').toLowerCase()
}

function normalizeType(type) {
  return type === 'number' || type === 'boolean' || type === 'string' ? type : 'string'
}

export class DeviceIotRegistry {
  constructor({ sendJson, logger } = {}) {
    this.sendJson = sendJson
    this.logger = logger ?? {}
    this.devices = new Map() // original name -> descriptor
    this.tools = new Map() // sanitized tool name -> { kind, device, member, definition }
  }

  /** 处理 `{type:'iot', descriptors|states}`；返回工具列表是否变化。 */
  handleMessage(message) {
    if (!message || typeof message !== 'object') return false
    if (Array.isArray(message.descriptors)) {
      return this.#register(message.descriptors)
    }
    if (Array.isArray(message.states)) {
      this.#updateStates(message.states)
    }
    return false
  }

  #register(descriptors) {
    let changed = false
    for (const raw of descriptors) {
      if (!raw || typeof raw.name !== 'string' || !raw.name) continue
      const properties = raw.properties && typeof raw.properties === 'object' ? raw.properties : {}
      const methods = raw.methods && typeof raw.methods === 'object' ? raw.methods : {}
      if (Object.keys(properties).length === 0 && Object.keys(methods).length === 0) continue
      const device = {
        name: raw.name,
        description: typeof raw.description === 'string' ? raw.description : '',
        properties: new Map(),
        methods: new Map(),
      }
      for (const [name, info] of Object.entries(properties)) {
        if (!info || typeof info !== 'object') continue
        device.properties.set(name, {
          name,
          description: typeof info.description === 'string' ? info.description : '',
          type: normalizeType(info.type),
          value: info.type === 'number' ? 0 : info.type === 'boolean' ? false : '',
        })
      }
      for (const [name, info] of Object.entries(methods)) {
        if (!info || typeof info !== 'object') continue
        const parameters = {}
        if (info.parameters && typeof info.parameters === 'object') {
          for (const [param, meta] of Object.entries(info.parameters)) {
            if (!meta || typeof meta !== 'object') continue
            parameters[param] = {
              type: normalizeType(meta.type),
              description: typeof meta.description === 'string' ? meta.description : '',
            }
          }
        }
        device.methods.set(name, {
          name,
          description: typeof info.description === 'string' ? info.description : '',
          parameters,
        })
      }
      this.devices.set(raw.name, device)
      changed = true
    }
    if (changed) this.#rebuildTools()
    return changed
  }

  #updateStates(states) {
    for (const state of states) {
      if (!state || typeof state.name !== 'string' || !state.state || typeof state.state !== 'object') continue
      const device = this.devices.get(state.name)
      if (!device) continue
      for (const [name, value] of Object.entries(state.state)) {
        const property = device.properties.get(name)
        if (property && typeof value === typeof property.value) property.value = value
      }
    }
  }

  #rebuildTools() {
    this.tools.clear()
    for (const device of this.devices.values()) {
      for (const property of device.properties.values()) {
        const toolName = sanitizeToolName(`get_${lower(device.name)}_${lower(property.name)}`)
        this.tools.set(toolName, {
          kind: 'get',
          device,
          member: property,
          definition: {
            type: 'function',
            function: {
              name: toolName,
              description: `查询${device.description || device.name}的${property.description || property.name}`,
              parameters: {
                type: 'object',
                properties: {
                  response_success: {
                    type: 'string',
                    description: '查询成功时的友好回复，必须使用 {value} 作为占位符表示查询到的值',
                  },
                  response_failure: { type: 'string', description: '查询失败时的友好回复' },
                },
                required: ['response_success', 'response_failure'],
              },
            },
          },
        })
      }
      for (const method of device.methods.values()) {
        const toolName = sanitizeToolName(`${lower(device.name)}_${lower(method.name)}`)
        const properties = { ...method.parameters }
        properties.response_success = { type: 'string', description: '操作成功时的友好回复' }
        properties.response_failure = { type: 'string', description: '操作失败时的友好回复' }
        this.tools.set(toolName, {
          kind: 'method',
          device,
          member: method,
          definition: {
            type: 'function',
            function: {
              name: toolName,
              description: `${device.description || device.name} - ${method.description || method.name}`,
              parameters: {
                type: 'object',
                properties,
                required: [...Object.keys(method.parameters), 'response_success', 'response_failure'],
              },
            },
          },
        })
      }
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
    if (!tool) throw new Error(`IoT 工具 ${name} 不存在`)
    const success = typeof args.response_success === 'string' ? args.response_success : ''
    const failure = typeof args.response_failure === 'string' ? args.response_failure : '操作失败'
    if (tool.kind === 'get') {
      const value = tool.member.value
      if (value === undefined || value === null) return failure
      return (success || `查询成功：{value}`).replaceAll('{value}', String(value))
    }
    const parameters = {}
    for (const key of Object.keys(tool.member.parameters)) {
      if (args[key] !== undefined) parameters[key] = args[key]
    }
    this.sendJson?.({
      type: 'iot',
      commands: [{ name: tool.device.name, method: tool.member.name, ...(Object.keys(parameters).length ? { parameters } : {}) }],
    })
    let response = success || '操作成功'
    for (const [key, value] of Object.entries(parameters)) response = response.replaceAll(`{${key}}`, String(value))
    response = response.replaceAll('{value}', String(Object.values(parameters)[0] ?? ''))
    return response
  }
}
