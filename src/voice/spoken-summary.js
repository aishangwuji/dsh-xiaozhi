/**
 * 语音播报摘要：把会话的最终回复压缩成「值得念出来」的几句话。
 *
 * 为什么不在会话里让模型直接说短一点：
 *   - 同一个 Bot 的会话同时给 GUI 文本框和手表用，压短会损失文本侧的完整结论；
 *   - 会话自己的 system prompt 属于 Bot 的 preset，插件不该为了语音去改它；
 *   - 摘要失败必须能回落，不能因为多了一次模型调用就把整轮语音打死。
 *
 * 因此这里是「额外一次、无工具、有超时」的小调用：输入是最终回复，
 * 输出只用于 TTS；失败/超时/空结果一律返回 ''，调用方回落到 `toSpeech()`。
 */

import { toSpeech } from './adapters/dsh-session.js'

/** 摘要调用的系统提示词。只描述「怎么念」，不参与 Bot 的人格。 */
export const DEFAULT_SUMMARY_PROMPT = [
  '你是语音播报助手。把用户给你的这段助手回复压缩成适合朗读的中文口语，最多三句话。',
  '只保留结论、用户需要知道的下一步，以及必要的提醒；不要 Markdown、列表、代码、链接、表格。',
  '如果回复主要是代码、长文或表格，就说“详细内容在会话里”，再用一句话说结论。',
  '不要寒暄，不要复述问题，不要输出与回复无关的内容。',
].join('\n')

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, Math.round(number)))
}

/**
 * @param {object} options
 * @param {{ stream: Function }} options.adapter 已在构建期烘焙好 systemPrompt 的 LLM 适配器
 * @param {string} [options.prompt] 覆盖默认摘要提示词
 * @param {number} [options.timeoutMs] 一次摘要的总预算；超时中止并回落
 * @param {number} [options.maxChars] 念出来的最大字数（按句末截断）
 * @param {number} [options.minInputChars] 回复短于这个字数就不摘要，直接走 toSpeech
 * @param {{ warn?: Function }} [options.logger]
 * @returns {((text: string) => Promise<string>) | null} 摘要函数；适配器不可用时为 null
 */
export function createSpeechSummarizer({
  adapter,
  prompt = DEFAULT_SUMMARY_PROMPT,
  timeoutMs = 8_000,
  maxChars = 160,
  minInputChars = 80,
  logger = {},
} = {}) {
  if (!adapter || typeof adapter.stream !== 'function') return null
  const limit = clamp(maxChars, 40, 600)
  const minimum = clamp(minInputChars, 0, 400)
  const budget = clamp(timeoutMs, 100, 30_000)

  return async function summarize(text) {
    const source = String(text ?? '').trim()
    if (!source || source.length < minimum) return ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('summary timeout'), budget)
    try {
      // 摘要只看最终回复；截断输入防止把整篇会话日志再喂一遍模型。
      const messages = [{ role: 'user', content: source.slice(0, 12_000) }]
      let output = ''
      for await (const chunk of adapter.stream({ messages, signal: controller.signal })) {
        if (controller.signal.aborted) break
        if (typeof chunk === 'string') output += chunk
        else if (chunk?.type === 'text' && typeof chunk.text === 'string') output += chunk.text
        if (output.length >= 4_000) break
      }
      const spoken = toSpeech(output, { maxChars: limit })
      return spoken
    } catch (error) {
      // 摘要不是关键路径：失败只记一条 warn，让调用方用确定性截断兜底。
      logger.warn?.(`dsh-xiaozhi: 语音摘要失败，回落到截断：${error?.message ?? error}`)
      return ''
    } finally {
      clearTimeout(timer)
    }
  }
}
