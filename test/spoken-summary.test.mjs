/**
 * 语音摘要与进度话术的契约测试。
 *
 * 摘要不是关键路径：任何失败都必须回落到 ''（调用方再用 toSpeech 截断），
 * 不能抛异常、不能把整轮语音打死。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSpeechSummarizer, DEFAULT_SUMMARY_PROMPT } from '../src/voice/spoken-summary.js'
import { progressPhraseFor } from '../src/voice/adapters/dsh-session.js'

const silent = { warn() {}, info() {}, error() {} }

function fakeAdapter(reply, { delayMs = 0, fail = null } = {}) {
  return {
    async *stream({ signal } = {}) {
      if (fail) throw fail
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (signal?.aborted) return
      yield reply
    },
  }
}

test('短回复不触发摘要调用', async () => {
  let called = 0
  const summarize = createSpeechSummarizer({
    adapter: {
      async *stream() {
        called += 1
        yield '不该被调用'
      },
    },
    minInputChars: 80,
    logger: silent,
  })
  assert.equal(await summarize('好的。'), '')
  assert.equal(called, 0)
})

test('摘要结果去 Markdown 并按字数截断', async () => {
  const summarize = createSpeechSummarizer({
    adapter: fakeAdapter('**结论**：文件都改好了。\n\n- 第一点\n- 第二点'),
    minInputChars: 10,
    maxChars: 40,
    logger: silent,
  })
  assert.equal(await summarize('这是一段足够长的最终回复，用来触发摘要调用。'), '结论：文件都改好了。 第一点 第二点')
})

test('摘要失败或超时返回空串，交给调用方回落', async () => {
  const failing = createSpeechSummarizer({
    adapter: fakeAdapter('', { fail: new Error('provider down') }),
    minInputChars: 10,
    logger: silent,
  })
  assert.equal(await failing('这是一段足够长的最终回复，用来触发摘要调用。'), '')

  const slow = createSpeechSummarizer({
    adapter: fakeAdapter('迟到的摘要', { delayMs: 200 }),
    minInputChars: 10,
    timeoutMs: 20,
    logger: silent,
  })
  assert.equal(await slow('这是一段足够长的最终回复，用来触发摘要调用。'), '')
})

test('摘要提示词只描述播报方式', () => {
  assert.match(DEFAULT_SUMMARY_PROMPT, /最多三句话/)
  assert.doesNotMatch(DEFAULT_SUMMARY_PROMPT, /人设|角色/)
})

test('工具名映射到可朗读的进度话术', () => {
  assert.equal(progressPhraseFor('web_search'), '我正在联网查。')
  assert.equal(progressPhraseFor('bash'), '我正在执行命令，稍等。')
  assert.equal(progressPhraseFor('read'), '我正在看文件。')
  assert.equal(progressPhraseFor('grep'), '我正在查找。')
  assert.equal(progressPhraseFor('mystery_tool'), '我正在处理，稍等。')
  assert.equal(progressPhraseFor(''), '我正在处理，稍等。')
})
