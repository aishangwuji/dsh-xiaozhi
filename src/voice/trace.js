/**
 * 语音链路的落盘日志（JSONL）。
 *
 * 为什么不用 logger：出问题时最需要的是「一次真实对话里，每一段到底走到哪、带了多少字节」，
 * 而 Harness 的控制台日志只留在启动它的那个终端里，用户复制不出来。这里把关键节点写到
 * `~/.dsh-xiaozhi/voice.log`，一条一行，`Get-Content -Tail` 就能看。
 *
 * 只在关键节点写（每句、每次错误、每个 VAD 事件），不在音频帧热路径上写。
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

let target = ''

/** 由插件装配时调用；不调用则所有 trace 都是空操作（测试里就是这样）。 */
export function initTrace(file) {
  target = typeof file === 'string' ? file : ''
  if (!target) return ''
  try {
    mkdirSync(dirname(target), { recursive: true })
  } catch {
    // 目录不可写时静默降级：日志不能影响语音链路。
  }
  trace('trace.boot', { pid: process.pid })
  return target
}

export function tracePath() {
  return target
}

export function trace(event, data = {}) {
  if (!target) return
  const line = { t: new Date().toISOString(), event }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    line[key] = value
  }
  try {
    appendFileSync(target, `${JSON.stringify(line)}\n`, { mode: 0o600 })
  } catch {
    // 写失败就算了，绝不因为日志把会话带崩。
  }
}
