/**
 * OpenAI-compatible chat completions, streamed.
 *
 * This is the "real LLM" adapter for every provider that speaks the same SSE
 * dialect (DeepSeek, SiliconFlow, vLLM, Ollama's /v1, …). It yields text deltas as
 * they arrive — never a completed string — because the segmenter upstream needs
 * the partial stream to meet the first-audio budget.
 *
 * `streamWithTools()` 是同一份传输加工具支持：yield 文本增量与最终的工具调用。
 * 会话层拿到工具调用后执行、把结果回灌，再开下一轮 —— 对应 Go 服务端的
 * `handleToolCallResponse` 循环。
 */

export function createOpenAiLlm({
  baseUrl = 'https://api.deepseek.com/v1',
  apiKey = '',
  model = 'deepseek-chat',
  systemPrompt = '',
  temperature = 0.7,
  maxTokens = 300,
  timeoutMs = 30_000,
  extraHeaders = {},
  // 认证头风格：绝大多数厂商是 `Authorization: Bearer`，小米 MiMo 只认 `api-key`。
  // 做成通用开关而不是在这里判断厂商名——厂商差异由 adapters/index.js 的 preset 决定，
  // 否则每加一家不按 OpenAI 默认头认证的厂商都要改这份传输代码。
  authStyle = 'bearer',
  // 思维链开关（'enabled' / 'disabled'；空串 = 请求体不带 thinking 字段）。
  // MiMo 默认 thinking=enabled，会先吐一段思维链再吐可见文本，语音首字预算扛不住；
  // 是否发、发什么由 preset 给，客户端不做厂商判断。
  thinking = '',
} = {}) {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  // Mutable on purpose: the session rewrites it every turn with the memory block
  // ("用户个性化信息: …") before streaming, which is cheaper than rebuilding the
  // adapter and keeps one HTTP client per profile.
  let activeSystemPrompt = systemPrompt

  /** 单次请求的 SSE 流（不做重试）。 */
  async function* requestOnce({ messages, tools, signal }) {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    try {
      const body = {
        model,
        stream: true,
        temperature,
        max_tokens: maxTokens,
        messages: activeSystemPrompt ? [{ role: 'system', content: activeSystemPrompt }, ...messages] : messages,
      }
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools
        body.tool_choice = 'auto'
      }
      if (thinking) body.thinking = { type: thinking }
      const headers = { 'content-type': 'application/json' }
      if (authStyle === 'api-key') {
        // MiMo 文档给的是“两种认证方式选一种”，本实现固定用 api-key 头；
        // 此时绝不能同时发 authorization（Bearer 会让同一请求被按另一种凭据解析）。
        headers['api-key'] = apiKey
      } else {
        headers.authorization = `Bearer ${apiKey}`
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...headers,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`)
      }
      if (!response.body) throw new Error('LLM response has no body')
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf8')
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const choice = parseSseChoice(event)
          if (choice === DONE) return
          if (choice) yield choice
          boundary = buffer.indexOf('\n\n')
        }
      }
      const tail = parseSseChoice(buffer)
      if (tail && tail !== DONE) yield tail
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * 外层重试：厂商 5xx / 连接抖动且**尚未吐字**时原地重试一次。
   *
   * 2026-11-07 实测：本机到 `api.deepseek.com` 空闲后的第一次请求常在 ~15s 后返回 500，
   * 紧接着同参数重试就是 200。语音每轮都是冷请求，不重试就每轮必哑。
   * 已吐过字再重试会把同一段话重念一遍，所以只在 emitted === 0 时重试。
   */
  async function* rawDeltas(request) {
    for (let attempt = 0; ; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        if (request.signal?.aborted) return
      }
      let emitted = 0
      try {
        for await (const choice of requestOnce(request)) {
          emitted += 1
          yield choice
        }
        return
      } catch (error) {
        if (request.signal?.aborted) return
        if (emitted === 0 && attempt === 0 && isTransientLlmError(error)) continue
        throw error
      }
    }
  }

  return {
    name: 'openai',
    model,
    get systemPrompt() {
      return activeSystemPrompt
    },
    set systemPrompt(value) {
      activeSystemPrompt = String(value ?? '')
    },

    /** 纯文本流（无工具）：保持原有行为，未启用工具时走这条路径。 */
    async *stream({ messages = [], signal } = {}) {
      for await (const choice of rawDeltas({ messages, signal })) {
        const text = choice?.delta?.content ?? choice?.message?.content ?? ''
        if (text) yield text
      }
    },

    /**
     * 带工具的流：先吐 `{type:'text'}`，最后吐一次 `{type:'tool_calls'}`（若模型要用工具）。
     * 工具参数是分片下发的，按 `index` 累积后再解析。
     */
    async *streamWithTools({ messages = [], tools = [], signal } = {}) {
      const calls = new Map()
      for await (const choice of rawDeltas({ messages, tools, signal })) {
        const text = choice?.delta?.content ?? choice?.message?.content ?? ''
        if (text) yield { type: 'text', text }
        const deltas = choice?.delta?.tool_calls ?? choice?.message?.tool_calls ?? []
        for (const delta of deltas) {
          const index = delta.index ?? calls.size
          const current = calls.get(index) ?? { id: '', name: '', arguments: '' }
          if (delta.id) current.id = delta.id
          if (delta.function?.name) current.name = delta.function.name
          if (delta.function?.arguments) current.arguments += delta.function.arguments
          calls.set(index, current)
        }
      }
      const calls_ = [...calls.values()].filter((call) => call.name)
      if (calls_.length > 0) yield { type: 'tool_calls', calls: calls_ }
    },
  }
}

const DONE = Symbol('done')

/** 厂商侧瞬时故障（5xx / 连接抖动）才值得原地补一次。 */
function isTransientLlmError(error) {
  const message = String(error?.message ?? error ?? '')
  return /HTTP 5\d\d|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network/i.test(
    message,
  )
}

function parseSseChoice(event) {
  for (const line of event.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return DONE
    if (!payload) continue
    try {
      const parsed = JSON.parse(payload)
      const choice = parsed?.choices?.[0]
      if (choice) return choice
    } catch {
      // Keep-alive or vendor-specific frame; ignoring it is correct.
    }
  }
  return null
}
