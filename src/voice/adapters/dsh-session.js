/**
 * 「DSH 会话」LLM 适配器。
 *
 * 外观与 `host-llm.js` / `openai-llm.js` 完全一致（`stream()` 吐事件），
 * 内部换成的是一次会话轮次：把用户说的话 prompt 进绑定的 Session，只把**这一轮
 * 最终那条 assistant 消息**（没有 tool-call 的那条）念出来。
 *
 * 三件事刻意分开：
 *   1. **发送**与文本框一致——默认不再拼接「[语音通道]…」指令，会话看到的原话就是
 *      用户说的那句话；需要时可用 `instruction` 显式加一段前缀。
 *   2. **过程**用 `notice`（设备气泡，不朗读）与 `progress`（短句朗读）事件表达，
 *      让用户知道还在做事，而不是整轮静默。
 *   3. **最终结论**先尝试 `summarize()` 压成 2–3 句口语；摘要失败/超时/太短时
 *      回落到确定性的 `toSpeech()`（去 Markdown + 按句末截断）。
 *
 * 不实现 `streamWithTools`：会话自己拥有工具与权限，插件不再注入自己的工具表。
 */

import { randomUUID } from 'node:crypto'

/**
 * 可选的语音前缀。**默认不拼**：拼了会出现在 GUI 的聊天记录里，就不是「和文本框
 * 同一句话」了。保留常量供配置显式选用/文档引用。
 */
export const DEFAULT_SESSION_INSTRUCTION =
  '[语音通道] 你在和用户实时语音对话。请用口语回答：最多两句话、不超过 60 个汉字，' +
  '先给结论，不要寒暄、不要复述问题；不要使用 Markdown、列表或代码块。'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_CHARS = 600
const DEFAULT_SUMMARY_MIN_CHARS = 80
const DEFAULT_PROGRESS_INTERVAL_MS = 8_000
const DEFAULT_HEARTBEAT_MS = 20_000

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

/**
 * 工具名 → 一句适合朗读的进度话术。
 *
 * 会话里的工具名来自 DSH（bash / read / grep / web_search / subagent…），和插件内置
 * 工具不是同一套；这里只做「按前缀猜一个动词」，猜不到就用通用句。真正要精确的
 * 是设备气泡里的工具名（`notice`），那句话术不朗读、只显示。
 */
export function progressPhraseFor(toolName) {
  const name = String(toolName ?? '').trim()
  if (!name) return '我正在处理，稍等。'
  const table = [
    [/^(web_search|web_fetch|fetch|search)/i, '我正在联网查。'],
    [/^(bash|exec|run_command|shell|terminal)/i, '我正在执行命令，稍等。'],
    [/^(read|view|cat|open)/i, '我正在看文件。'],
    [/^(write|edit|apply|patch)/i, '我正在改文件。'],
    [/^(grep|glob|find)/i, '我正在查找。'],
    [/^(todo|plan)/i, '我正在整理步骤。'],
    [/^(subagent|task|agent)/i, '我正在安排子任务。'],
    [/^(music|play)/i, '我正在准备播放。'],
  ]
  for (const [pattern, phrase] of table) {
    if (pattern.test(name)) return phrase
  }
  return '我正在处理，稍等。'
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

function positive(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * @param {object} options
 * @param {object} options.bridge `createSessionBridge()` 的返回值
 * @param {string | (() => string | Promise<string>)} options.sessionId
 *   固定会话 id，或一个「首次使用时解析/创建」的函数
 * @param {string} [options.instruction] 可选：拼在用户话前面的前缀；默认空 = 原话直送
 * @param {number} [options.timeoutMs] 一轮的总预算，超时取消该会话当前 turn
 * @param {number} [options.maxChars] 念出来的最大字数（摘要与回落截断共用）
 * @param {((text: string) => Promise<string>) | null} [options.summarize]
 *   可选：把最终回复压成口语摘要；返回空串表示回落
 * @param {number} [options.summaryMinChars] 短于这个字数不摘要，直接 toSpeech
 * @param {boolean} [options.progress] 是否在工具调用/长等待时播报进度
 * @param {number} [options.progressMinIntervalMs] 两条进度话术的最小间隔
 * @param {number} [options.heartbeatMs] 长时间无事件时的心跳话术间隔；0 = 关闭
 */
export function createDshSessionLlm({
  bridge,
  sessionId,
  instruction = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxChars = DEFAULT_MAX_CHARS,
  summarize = null,
  summaryMinChars = DEFAULT_SUMMARY_MIN_CHARS,
  progress = true,
  progressMinIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  logger = {},
} = {}) {
  if (!bridge) {
    throw new Error('DSH 会话后端不可用：没有会话桥')
  }
  if (!sessionId) throw new Error('DSH 会话后端：没有绑定会话')

  const resolveSessionId = typeof sessionId === 'function'
    ? async () => String((await sessionId()) ?? '')
    : async () => String(sessionId)
  const budget = positive(timeoutMs, DEFAULT_TIMEOUT_MS, 100, 600_000)
  const limit = positive(maxChars, DEFAULT_MAX_CHARS, 40, 4_000)
  const summaryMinimum = positive(summaryMinChars, DEFAULT_SUMMARY_MIN_CHARS, 0, 4_000)
  const progressInterval = positive(progressMinIntervalMs, DEFAULT_PROGRESS_INTERVAL_MS, 0, 60_000)
  const heartbeatEvery = positive(heartbeatMs, DEFAULT_HEARTBEAT_MS, 0, 120_000)
  const progressEnabled = progress !== false
  const summarizeFn = typeof summarize === 'function' ? summarize : null

  async function* turn(messages, signal) {
    const userText = lastUserText(messages).trim()
    if (!userText) return
    if (signal?.aborted) return
    // 服务可能晚于插件 apply 挂载；真正要发 prompt 时再判断，避免建连期误判。
    if (bridge.available !== true) {
      throw new Error('DSH 会话后端不可用：宿主没有装配 sessionController')
    }

    const target = await resolveSessionId()
    if (!target) throw new Error('语音会话未绑定：请先在 Bot 配置里选择会话')
    if (signal?.aborted) return

    const requestId = randomUUID()
    const queue = createQueue()
    let lastTurn = 0
    let admitted = false
    let ourTurn = null
    let settled = false
    let timer = null
    let heartbeat = null
    let finalAnswer = ''
    let lastProgressAt = 0
    let progressCount = 0

    const pushProgress = (text, { force = false } = {}) => {
      if (!progressEnabled || settled) return
      const value = String(text ?? '').trim()
      if (!value) return
      const now = Date.now()
      if (!force && now - lastProgressAt < progressInterval) return
      lastProgressAt = now
      progressCount += 1
      queue.push({ type: 'progress', text: value })
    }

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
        case 'step/start': {
          // 只在「已经对上本轮、但还没有任何事件」时提示，避免每一步都念。
          if (admitted) pushProgress('我正在想。', { force: progressCount === 0 })
          break
        }
        case 'user/message': {
          if (admitted) break
          if (String(data.source?.rpcId ?? '') !== requestId) break
          admitted = true
          ourTurn = lastTurn || null
          break
        }
        case 'tool/call': {
          if (!admitted) break
          const name = String(data.name ?? '').trim()
          if (name) queue.push({ type: 'notice', text: name })
          pushProgress(progressPhraseFor(name), { force: progressCount === 0 })
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
          if (answer.trim()) finalAnswer = answer
          break
        }
        case 'turn/end': {
          if (!admitted) break
          const turnNo = Number(data.turn)
          if (ourTurn !== null && Number.isInteger(turnNo) && turnNo !== ourTurn) break
          settled = true
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
          queue.push({ type: 'end' })
          break
        }
        case 'agent/error': {
          const message = data.error?.message ?? data.message ?? '会话执行失败'
          settled = true
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
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
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
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
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      queue.push({ type: 'error', message: `会话超时（${Math.round(budget / 1000)}s）` })
    }, budget)
    // 长任务心跳：让用户知道还活着，而不是以为断线了。
    if (progressEnabled && heartbeatEvery > 0) {
      heartbeat = setInterval(() => pushProgress('还在处理，马上就好。'), heartbeatEvery)
      heartbeat.unref?.()
    }

    try {
      const prefix = String(instruction ?? '').trim()
      // 默认原话直送（与文本框一致）；只有显式配置了 instruction 才加前缀。
      const text = prefix ? `${prefix}\n${userText}` : userText
      await bridge.prompt({ sessionId: target, text, requestId, mode: 'queue' })
      for (;;) {
        const item = await queue.next()
        if (item.type === 'text') {
          yield item.text
          continue
        }
        if (item.type === 'notice' || item.type === 'progress') {
          yield item
          continue
        }
        if (item.type === 'end') {
          if (finalAnswer) {
            let spoken = ''
            if (summarizeFn && finalAnswer.length >= summaryMinimum) {
              // 摘要是额外一次模型调用；先说一句，别让设备误以为卡住了。
              yield { type: 'progress', text: '我整理一下，马上说。' }
              spoken = String((await summarizeFn(finalAnswer)) ?? '').trim()
            }
            if (!spoken) spoken = toSpeech(finalAnswer, { maxChars: limit })
            if (spoken) yield spoken
          }
          return
        }
        if (item.type === 'error') {
          logger.warn?.(`dsh-xiaozhi: session turn failed: ${item.message}`)
          throw new Error(item.message)
        }
      }
    } finally {
      if (timer) clearTimeout(timer)
      if (heartbeat) clearInterval(heartbeat)
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
