/**
 * 「dsh-family」LLM 适配器（M1 会话层融合）。
 *
 * 外观与 `dsh-session.js` 完全一致：`stream({ messages, signal, session })` 吐事件
 * （`text` / `notice` / `progress`）。内部换成一次 family 语音轮次：把用户这句话交给
 * 该设备绑定的成员，只把**这一轮最终的助手纯文本**念出来。
 *
 * 与 DSH 会话后端的差别（契约 `dsh-family/docs/voice-fusion.md`）：
 *   1. 会话、成员、工作区、角色卡、记忆、用量都在 family 侧；本插件不建 DSH 会话，
 *      `memoryEnabled` / `sessionPrompt` / 工具开关全部让路。
 *   2. 成员由设备记录上的 `familyMemberId` 决定，**每轮重新解析**（切换成员下一轮生效，
 *      不需要设备重连）。
 *   3. 审批/提问优先交给语音：适配器把 family 的 `onApproval` / `onQuestion` 回调接到
 *      `VoiceSession.askApproval()` / `askUserQuestions()`；说不清、超时或异常一律返回
 *      `null`，由 family 把这张卡放行到 PWA（手表/手机谁先答谁生效）。
 *   4. 摘要仍由本插件做（family 回的是完整纯文本），与 DSH 会话后端同一套
 *      `summarize` + `toSpeech` 回落。
 *
 * 失败语义（契约 §4）：
 *   - `familyVoice` 不存在 / 没有 `ask` → 「家庭服务未就绪」；
 *   - 设备没绑成员 → 「还没绑定家庭成员」；
 *   - 409 busy → 「上一条还在想，稍等再说」；
 *   - 成员不存在（404 / `member-not-found`）→ 「成员已失效，请在控制台重新绑定」；
 *   - 其它错误（family 内部超时、服务故障）→ 抛给会话层，播通用失败话术。
 *
 * 这些提示既上屏（`notice` 气泡）也念出来（`text`）：手表常常不看屏，只留气泡会让
 * 用户以为设备死机。`text` 就是这一轮的回复，会被记进设备历史。
 */

import { lastUserText, toSpeech } from './dsh-session.js'

const DEFAULT_MAX_CHARS = 600
const DEFAULT_SUMMARY_MIN_CHARS = 80
const DEFAULT_APPROVAL_TIMEOUT_MS = 12_000
const DEFAULT_QUESTION_TIMEOUT_MS = 15_000

/** 设备上看到的短提示（中文，一句话）。 */
export const FAMILY_NOTICES = {
  unavailable: '家庭服务未就绪',
  noMember: '还没绑定家庭成员，请在控制台绑定',
  memberMissing: '成员已失效，请在控制台重新绑定',
  noWorkspace: '这个成员还没有工作区，请先在家庭里打开一次',
  busy: '上一条还在想，稍等再说',
  textRequired: '没听清你说什么',
}

/**
 * 同一条失败既上屏（`notice` 气泡）也念出来（`text`）：手表常常不看屏，
 * 只留气泡会让用户以为设备死机。`text` 就是这一轮的回复，会被记进设备历史。
 */
export const SPOKEN_NOTICES = {
  [FAMILY_NOTICES.unavailable]: '家庭服务还没就绪，请稍后再试。',
  [FAMILY_NOTICES.noMember]: '这台设备还没绑定家庭成员，请先在控制台绑定。',
  [FAMILY_NOTICES.memberMissing]: '这台设备绑定的成员已经不在了，请在控制台重新绑定。',
  [FAMILY_NOTICES.noWorkspace]: '这个成员还没有工作区，请先在家庭页面里打开一次。',
  [FAMILY_NOTICES.busy]: '上一条还在想，你稍等一下再说。',
  [FAMILY_NOTICES.textRequired]: '我没听清，你再说一遍？',
}

function* refuse(notice) {
  yield { type: 'notice', text: notice }
  yield { type: 'text', text: SPOKEN_NOTICES[notice] ?? notice }
}

function positive(value, fallback, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** family 抛出的错误 → 设备提示。返回空串表示「不是这几种可解释的失败」。 */
export function familyNoticeFor(error) {
  if (!error || typeof error !== 'object') return ''
  const code = String(error.code ?? '').trim()
  const status = Number(error.status)
  if (code === 'busy' || status === 409) return FAMILY_NOTICES.busy
  if (code === 'member-not-found') return FAMILY_NOTICES.memberMissing
  if (code === 'member-required') return FAMILY_NOTICES.noMember
  if (code === 'no-workspace') return FAMILY_NOTICES.noWorkspace
  if (code === 'service-unavailable' || code === 'unavailable') return FAMILY_NOTICES.unavailable
  if (code === 'text-required') return FAMILY_NOTICES.textRequired
  // 没带 code 的 404 仍按成员失效处理（防御性；带 code 的如 thread-not-found 交给兜底）。
  if (!code && status === 404) return FAMILY_NOTICES.memberMissing
  return ''
}

/**
 * @param {object} options
 * @param {object | (() => object | undefined)} options.familyVoice
 *   `familyVoice` 服务，或惰性 getter（服务可能晚于插件 `apply` 挂载，必须每轮取）
 * @param {string | (() => string | Promise<string>)} options.memberId
 *   该设备绑定的成员 id；getter 每轮重新解析（切成员下一轮生效）
 * @param {number} [options.maxChars] 念出来的最大字数（摘要与回落截断共用）
 * @param {((text: string) => Promise<string>) | null} [options.summarize]
 *   可选：把最终回复压成口语摘要；返回空串表示回落
 * @param {number} [options.summaryMinChars] 短于这个字数不摘要，直接 toSpeech
 * @param {number} [options.approvalTimeoutMs] 语音审批等一次「允许/拒绝」的时间
 * @param {number} [options.questionTimeoutMs] 语音提问每题等待时间
 */
export function createFamilyLlm({
  familyVoice,
  memberId = '',
  maxChars = DEFAULT_MAX_CHARS,
  summarize = null,
  summaryMinChars = DEFAULT_SUMMARY_MIN_CHARS,
  approvalTimeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
  questionTimeoutMs = DEFAULT_QUESTION_TIMEOUT_MS,
  logger = {},
} = {}) {
  if (!familyVoice) throw new Error('家庭会话后端：没有 familyVoice 服务')

  const limit = positive(maxChars, DEFAULT_MAX_CHARS, 40, 4_000)
  const summaryMinimum = positive(summaryMinChars, DEFAULT_SUMMARY_MIN_CHARS, 0, 4_000)
  const approvalBudget = positive(approvalTimeoutMs, DEFAULT_APPROVAL_TIMEOUT_MS, 1_000, 60_000)
  const questionBudget = positive(questionTimeoutMs, DEFAULT_QUESTION_TIMEOUT_MS, 1_000, 60_000)
  const summarizeFn = typeof summarize === 'function' ? summarize : null

  const serviceOf = () => {
    try {
      return typeof familyVoice === 'function' ? familyVoice() : familyVoice
    } catch (error) {
      logger.warn?.(`dsh-xiaozhi: familyVoice 解析失败: ${error.message}`)
      return undefined
    }
  }
  const resolveMemberId = async () => {
    if (typeof memberId === 'function') return String((await memberId()) ?? '').trim()
    return String(memberId ?? '').trim()
  }

  /**
   * family 的审批回调 → 语音审批。说得清就回 `allowed-once` / `rejected`，
   * 说不清/超时/异常回 `null`（family 会把卡放行到 PWA，不擅自放行）。
   */
  async function approvalFor(session, info) {
    if (!session || typeof session.askApproval !== 'function') return null
    const reason = String(info?.reason ?? '').trim()
    const tool = String(info?.tool ?? '').trim()
    const label = (reason || (tool ? `工具 ${tool}` : '')).slice(0, 120)
    const text = label ? `需要你确认：${label}。可以说允许，或者拒绝。` : '需要你确认一下，可以说允许，或者拒绝。'
    try {
      const outcome = await session.askApproval({ text, timeoutMs: approvalBudget })
      if (outcome === 'allowed-once' || outcome === 'rejected' || outcome === 'cancelled') return outcome
      return null
    } catch (error) {
      logger.warn?.(`dsh-xiaozhi: family approval voice failed: ${error.message}`)
      return null
    }
  }

  /**
   * family 的提问回调 → 语音逐题回答。任何一题说不清就整份 `null` 交回 PWA，
   * 绝不猜答案（与 DSH 会话后端的约定一致）。
   */
  async function questionFor(session, info) {
    if (!session || typeof session.askUserQuestions !== 'function') return null
    const questions = Array.isArray(info?.questions) ? info.questions : []
    if (questions.length === 0) return null
    try {
      const result = await session.askUserQuestions(questions, { timeoutMs: questionBudget })
      return result && Array.isArray(result.answers) ? result : null
    } catch (error) {
      logger.warn?.(`dsh-xiaozhi: family question voice failed: ${error.message}`)
      return null
    }
  }

  async function* turn({ messages, signal, session } = {}) {
    const userText = lastUserText(messages).trim()
    if (!userText) return
    if (signal?.aborted) return

    const service = serviceOf()
    if (!service || typeof service.ask !== 'function') {
      yield* refuse(FAMILY_NOTICES.unavailable)
      return
    }
    const member = await resolveMemberId()
    if (!member) {
      yield* refuse(FAMILY_NOTICES.noMember)
      return
    }
    if (signal?.aborted) return

    // 打断 = 取消 family 侧这一轮（审批等待按 cancelled 收口）。
    const onAbort = () => {
      try {
        const pending = service.cancel?.({ memberId: member })
        // cancel 是异步的：拒绝时只记日志，别变成 unhandled rejection。
        if (pending && typeof pending.catch === 'function') {
          pending.catch((error) => logger.warn?.(`dsh-xiaozhi: family cancel failed: ${error.message}`))
        }
      } catch (error) {
        logger.warn?.(`dsh-xiaozhi: family cancel failed: ${error.message}`)
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    let result
    try {
      result = await service.ask({
        memberId: member,
        text: userText,
        onApproval: (info) => approvalFor(session, info),
        onQuestion: (info) => questionFor(session, info),
      })
    } catch (error) {
      if (signal?.aborted) return
      const notice = familyNoticeFor(error)
      if (notice) {
        logger.warn?.(`dsh-xiaozhi: family ask failed (${error?.code ?? error?.status ?? 'unknown'}): ${error.message}`)
        yield* refuse(notice)
        return
      }
      // 其它错误交给会话层：它负责错误气泡 + 兜底语音。
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
    if (signal?.aborted) return

    const finalText = String(result?.text ?? '').trim()
    if (!finalText) return
    let spoken = ''
    if (summarizeFn && finalText.length >= summaryMinimum) {
      // 摘要是额外一次模型调用；先说一句，别让设备以为卡住了。
      yield { type: 'progress', text: '我整理一下，马上说。' }
      spoken = String((await summarizeFn(finalText)) ?? '').trim()
    }
    if (!spoken) spoken = toSpeech(finalText, { maxChars: limit })
    if (spoken) yield spoken
  }

  return {
    name: 'family',
    get model() {
      return 'family'
    },
    // 兼容 `#answer` 每轮写 systemPrompt 的旧契约：人设归 family 的角色卡，不由插件改。
    get systemPrompt() {
      return ''
    },
    set systemPrompt(_value) {},
    async *stream({ messages = [], signal, session } = {}) {
      yield* turn({ messages, signal, session })
    },
  }
}
