/**
 * 复用 Harness 自己的 `llm` 服务。
 *
 * 好处是配置不再重复：用户在 DSH 里已经配好的模型厂商（DeepSeek / OpenCode / OpenRouter…）
 * 直接可用，本插件不再自己存 API Key、也不再维护 provider 列表 —— 那些都是 DSH 的事。
 *
 * 映射关系：
 *   Host 的 `llm.stream(options)` 产出 StreamChunk（text-delta / tool-call-delta / finish），
 *   本适配器把它压成语音链路需要的两种事件：文本增量、以及整轮结束后的工具调用集合，
 *   与 openai-llm.js 的 streamWithTools 完全同构，session 侧不用区分。
 */

export function createHostLlm({ llm, provider, model = '', systemPrompt = '', temperature, maxTokens } = {}) {
  if (!llm?.stream) throw new Error('host llm: Harness 未装配 llm 服务')
  // 不要给 provider 兜底默认值（历史上默认过 deepseek）：当前 profile 未必注册这个
  // 名字，兜底只会把「配置漏了」伪装成一句运行期 NO_ADAPTER。缺了就在这里显式失败。
  if (!provider) throw new Error('host llm: 未选择厂商（voice.llm.hostProvider 为空）')
  if (!model) throw new Error('host llm: 未选择模型')

  let activeSystemPrompt = String(systemPrompt ?? '')
  let activeModel = model

  /** 把 Host 的 StreamChunk 转成本插件内部的事件流。 */
  async function* chunks({ messages, tools, signal }) {
    const calls = new Map()
    const request = {
      provider,
      model: activeModel,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      })),
      signal,
      ...(activeSystemPrompt ? { system: activeSystemPrompt } : {}),
      ...(Array.isArray(tools) && tools.length > 0
        ? { tools: tools.map((tool) => tool.function ?? tool) }
        : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(maxTokens != null ? { maxTokens } : {}),
    }

    for await (const chunk of llm.stream(request)) {
      if (chunk?.type === 'text-delta' && chunk.text) {
        yield { type: 'text', text: chunk.text }
      } else if (chunk?.type === 'tool-call-delta') {
        const key = chunk.index ?? calls.size
        const current = calls.get(key) ?? { id: chunk.id ?? '', name: chunk.name ?? '', arguments: '' }
        if (chunk.id) current.id = chunk.id
        if (chunk.name) current.name = chunk.name
        if (chunk.argumentsDelta) current.arguments += chunk.argumentsDelta
        calls.set(key, current)
      } else if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
        throw new Error(chunk.reason.failure?.message ?? 'LLM 调用失败')
      }
    }
    const collected = [...calls.values()].filter((call) => call.name)
    if (collected.length > 0) yield { type: 'tool_calls', calls: collected }
  }

  return {
    name: 'host',
    get model() {
      return activeModel
    },
    set model(value) {
      activeModel = String(value ?? '')
    },
    get provider() {
      return provider
    },
    get systemPrompt() {
      return activeSystemPrompt
    },
    set systemPrompt(value) {
      activeSystemPrompt = String(value ?? '')
    },

    /** 纯文本流，行为与 openai-llm 的 stream() 一致。 */
    async *stream({ messages = [], signal } = {}) {
      for await (const event of chunks({ messages, signal })) {
        if (event.type === 'text' && event.text) yield event.text
      }
    },

    /** 带工具的流：先文本，最后（如有）一轮工具调用。 */
    async *streamWithTools({ messages = [], tools = [], signal } = {}) {
      yield* chunks({ messages, tools, signal })
    },
  }
}
