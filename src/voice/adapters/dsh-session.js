/**
 * 「DSH 会话」LLM 适配器。
 *
 * 外观与 `host-llm.js` / `openai-llm.js` 完全一致（`stream()` 吐文本增量），
 * 内部换成的是一次会话轮次：把用户说的话 prompt 进绑定的 Session，只把**这一轮
 * 最终那条 assistant 消息**（没有 tool-call 的那条）念出来。
 *
 * 为什么只念最终结论：
 *   - DSH 的 agent 会在工具步骤里输出「我先查一下」这类过程文字，念出来又吵又慢；
 *   - 语音场景要的是结论，过程留在屏幕上；
 *   - 代价是首句要等这一轮生成完（不是逐 token），换来的是内容完整、不打断。
 *
 * 不实现 `streamWithTools`：会话自己拥有工具与权限，插件不再注入自己的工具表。
 */

import { randomUUID } from 'node:crypto'

/** 默认语音指令。跟用户说的话拼在一起发进会话，告诉它这是语音回合。 */
export const DEFAULT_SESSION_INSTRUCTION =
  '[语音通道] 你在和用户实时语音对话。请用口语回答：最多两句话、不超过 60 个汉字，' +
  '先给结论，不要寒暄、不要复述问题；不要使用 Markdown、列表或代码块。'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_CHARS = 600

/** 最后一条 user 消息的纯文本（`#answer` 每轮只会追加一条）。 */
export function lastUserText(messages) {
  const rows = Array.isArray(messages) ? messages : []
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index]
    if (message?.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
    }
    return ''
  }
  return ''
}

/**
 * 把一段「给人看」的回复改成「能给 TTS 念」的口语文本。
 *
 * 只做确定性、可回滚的清理：代码块整段丢弃、行内代码去反引号、链接留文字、
 * 标题/列表去符号、加粗/斜体去星号；超长按句末截断。**不调用模型改写**——
 * 那会多一次请求、多一份钱，而且改写结果不可预测。
 */
export function toSpeech(text, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  let value = String(text ?? '')
  if (!value.trim()) return ''
  value = value.replace(/```[\s\S]*?```/g, ' ')
  value = value.replace(/`([^`]+)`/g, '$1')
  value = value.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  value = value.replace(/^\s{0,3}#{1,6}\s*/gm, '')
  value = value.replace(/^\s{0,3}>\s?/gm, '')
  value = value.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '')
  value = value.replace(/\*\*([^*]+)\*\*/g, '$1')
  value = value.replace(/__([^_]+)__/g, '$1')
  value = value.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
  value = value.replace(/\s+/g, ' ').trim()
  if (value.length <= maxChars) return value
  // 截断尽量落在句末；找不到句末就硬截。
  const head = value.slice(0, maxChars)
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('.'))
  const kept = cut > maxChars * 0.5 ? head.slice(0, cut + 1) : head
  return `${kept}……`
}

/** 极简一次性的异步队列：适配器只做一个生产者、一个消费者。 */
function createQueue() {
  const items = []
  let waiter = null
  return {
    push(item) {
      if (waiter) {
        const resolve = waiter
        waiter = null
        resolve(item)
        return
      }
      items.push(item)
    },
    next() {
      if (items.length > 0) return Promise.resolve(items.shift())
      return new Promise((resolve) => {
        waiter = resolve
      })
    },
  }
}

/**
 * @param {object} options
 * @param {object} options.bridge `createSessionBridge()` 的返回值
 * @param {string | (() => string | Promise<string>)} options.sessionId
 *   固定会话 id，或一个「首次使用时解析/创建」的函数
 * @param {string} [options.instruction] 拼在用户话前面的语音指令
 * @param {number} [options.timeoutMs] 一轮的总预算，超时取消该会话当前 turn
 * @param {number} [options.maxChars] 念出来的最大字数
 */
export function createDshSessionLlm({
  bridge,
  sessionId,
  instruction = DEFAULT_SESSION_INSTRUCTION,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxChars = DEFAULT_MAX_CHARS,
  logger = {},
} = {}) {
  if (!bridge || bridge.available !== true) {
    throw new Error('DSH 会话后端不可用：宿主没有装配 sessionController')
  }
  if (!sessionId) throw new Error('DSH 会话后端：没有绑定会话')

  const resolveSessionId = typeof sessionId === 'function'
    ? async () => String((await sessionId()) ?? '')
    : async () => String(sessionId)
  const budget = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) >= 100
    ? Math.round(Number(timeoutMs))
    : DEFAULT_TIMEOUT_MS
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) >= 40
    ? Math.round(Number(maxChars))
    : DEFAULT_MAX_CHARS

  async function* turn(messages, signal) {
    const userText = lastUserText(messages).trim()
    if (!userText) return
    if (signal?.aborted) return

    const target = await resolveSessionId()
    if (!target) throw new Error('语音会话未绑定：请先在智能体配置里选择会话')
    if (signal?.aborted) return

    const requestId = randomUUID()
    const queue = createQueue()
    let lastTurn = 0
    let admitted = false
    let ourTurn = null
    let settled = false
    let timer = null

    // 先订阅再 prompt：队列模式下 turn/start 可能紧接着 prompt 就来了。
    const unsubscribe = bridge.subscribe(target, (event) => {
      if (settled) return
      const data = event?.data ?? {}
      switch (event?.type) {
        case 'turn/start': {
          const turnNo = Number(data.turn)
          if (Number.isInteger(turnNo) && turnNo > lastTurn) lastTurn = turnNo
          break
        }
        case 'user/message': {
          if (admitted) break
          if (String(data.source?.rpcId ?? '') !== requestId) break
          admitted = true
          ourTurn = lastTurn || null
          break
        }
        case 'assistant/message': {
          if (!admitted) break
          const turnNo = Number(data.turn)
          if (ourTurn !== null && Number.isInteger(turnNo) && turnNo < ourTurn) break
          if (data.interrupted === true) break
          const content = Array.isArray(data.message?.content) ? data.message.content : []
          // 带工具调用的那一步是过程，不是结论（只念最终结论）。
          if (content.some((block) => block?.type === 'tool-call')) break
          const answer = content
            .filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('')
          const spoken = toSpeech(answer, { maxChars: limit })
          if (spoken) queue.push({ type: 'text', text: spoken })
          break
        }
        case 'turn/end': {
          if (!admitted) break
          const turnNo = Number(data.turn)
          if (ourTurn !== null && Number.isInteger(turnNo) && turnNo !== ourTurn) break
          settled = true
          queue.push({ type: 'end' })
          break
        }
        case 'agent/error': {
          const message = data.error?.message ?? data.message ?? '会话执行失败'
          settled = true
          queue.push({ type: 'error', message: String(message) })
          break
        }
        default:
          break
      }
    })

    const onAbort = () => {
      bridge.cancel(target)
      if (!settled) {
        settled = true
        queue.push({ type: 'end' })
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // addEventListener 之前就 abort 的窗口：补一次，避免队列永远等下去。
    if (signal?.aborted) onAbort()
    // 超时也取消会话：不取消的话它会在后台继续跑，下一句话会排在一轮长任务后面。
    timer = setTimeout(() => {
      if (settled) return
      bridge.cancel(target)
      settled = true
      queue.push({ type: 'error', message: `会话超时（${Math.round(budget / 1000)}s）` })
    }, budget)

    try {
      const text = `${String(instruction ?? '').trim()}\n用户说：${userText}`
      await bridge.prompt({ sessionId: target, text, requestId, mode: 'queue' })
      for (;;) {
        const item = await queue.next()
        if (item.type === 'text') {
          yield item.text
          continue
        }
        if (item.type === 'end') return
        if (item.type === 'error') {
          logger.warn?.(`dsh-xiaozhi: session turn failed: ${item.message}`)
          throw new Error(item.message)
        }
      }
    } finally {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      unsubscribe()
    }
  }

  return {
    name: 'dsh-session',
    get model() {
      return 'dsh-session'
    },
    // 兼容 `#answer` 每轮写 systemPrompt 的旧契约：会话自己的提示词不由插件改。
    get systemPrompt() {
      return ''
    },
    set systemPrompt(_value) {},
    async *stream({ messages = [], signal } = {}) {
      yield* turn(messages, signal)
    },
  }
}
