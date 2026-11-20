/**
 * 宿主 DSH 会话桥。
 *
 * 语音链路原来只认「一次 LLM 流」；这个桥把「给某条 DSH Session 发一句话、
 * 把它这一轮的回答取回来」包成同样的形状，供 `src/voice/adapters/dsh-session.js` 使用。
 * 它刻意不碰 DS-Bot：DS-Bot 的 Bot 也是一条普通 DSH Session，绑同一个 sessionId
 * 就能对话；本插件不 import 任何 DS-Bot 模块，也不读它的 state.json。
 *
 * 为什么不做成 Service：DSH 已经提供了 `ctx.sessionController`（创建/列出/发送/
 * 取消）和 `ctx.on('session/event')`（落库事件），我们再包一层没有意义。这里只是
 * 按 sessionId 做一次事件分发，并吞掉「服务未装配」的情况，让插件在没有会话服务的
 * 旧环境里仍然启动，只是该后端不可用。
 *
 * 语义要点：
 *   - `prompt` 的 `requestId` 会以 `source.rpcId` 落进 `user/message`，这是把
 *     「我这句话」与「它这一轮」对上的唯一可靠凭据（队列模式下尤其重要）；
 *   - 事件是按 sessionId 分发的，别把别的会话的字念出来；
 *   - `cancel` 停的是该会话当前活跃的 turn，不排队、不影响别的会话。
 */

/** 事件里的 Session 对象只保证有 `id`（DS-Bot 同样用 `session.id`）。 */
function sessionIdOf(session) {
  const id = session?.id ?? session?.sessionId
  return typeof id === 'string' ? id : ''
}

/**
 * @param {object} options
 * @param {object} [options.sessionController] 宿主 `ctx.sessionController`
 * @param {(event: string, listener: Function) => (() => void) | void} [options.on]
 *   宿主 `ctx.on`，用于订阅 `session/event`
 * @param {{ warn?: Function, error?: Function, info?: Function }} [options.logger]
 */
export function createSessionBridge({ sessionController, on, logger = {} } = {}) {
  const listeners = new Map()
  // 会话运行态：控制台要显示「这条 Bot 的会话现在有没有在跑」。`api-session/status`
  // 是全局事件（sessionId + running），比逐个订阅 agent/status 便宜；`agent/status`
  // 作为补充，覆盖宿主只发后者的情况。
  const statuses = new Map()
  const available = Boolean(sessionController && typeof sessionController.prompt === 'function')
  let disposed = false

  function dispatch(sessionId, event) {
    if (disposed || !sessionId) return
    const set = listeners.get(sessionId)
    if (!set || set.size === 0) return
    // 复制一份再回调：监听器里 unsubscribe 自己不会破坏本次迭代。
    for (const listener of [...set]) {
      try {
        listener(event)
      } catch (error) {
        logger.warn?.(`dsh-xiaozhi: session listener failed: ${error?.message ?? error}`)
      }
    }
  }

  const off = available && typeof on === 'function'
    ? on('session/event', (session, event) => dispatch(sessionIdOf(session), event))
    : null
  const offStatus = available && typeof on === 'function'
    ? on('api-session/status', (sessionId, running) => {
        if (typeof sessionId === 'string' && sessionId) statuses.set(sessionId, running === true)
      })
    : null
  const offAgentStatus = available && typeof on === 'function'
    ? on('agent/status', (payload) => {
        const id = sessionIdOf(payload?.agent?.session)
        if (id) statuses.set(id, payload.status === 'running')
      })
    : null
  // 语音审批应答器：由插件装配层按「这条会话有没有在线的语音设备」决定要不要接。
  // 注册在宿主 UI 的审批卡之前（prepend）：谁先给出 outcome 谁生效；我们不接时
  // 必须调用 next()，把请求原样让给桌面卡片，不能吞掉。
  let approvalAnswerer = null
  const offApproval = available && typeof on === 'function'
    ? on('approval/request', async (request, next) => {
        const handler = approvalAnswerer
        if (typeof handler !== 'function') return next()
        try {
          const outcome = await handler(request)
          if (outcome === 'allowed-once' || outcome === 'rejected' || outcome === 'cancelled') return outcome
        } catch (error) {
          logger.warn?.(`dsh-xiaozhi: 语音审批失败，交回桌面：${error?.message ?? error}`)
        }
        return next()
      }, { prepend: true })
    : null
  // 语音结构化提问应答器：`ask_user_question`（选项/多选/计划确认）走同一套前置监听。
  // 只有插件装配层能找到「正在等这一轮的在线设备」时才接；否则把请求交给桌面卡片。
  let questionAnswerer = null
  const offQuestion = available && typeof on === 'function'
    ? on('user-questions/request', async (request, next) => {
        const handler = questionAnswerer
        if (typeof handler !== 'function') return next()
        try {
          const answer = await handler(request)
          if (answer && Array.isArray(answer.answers) && answer.answers.length > 0) return answer
        } catch (error) {
          logger.warn?.(`dsh-xiaozhi: 语音提问失败，交回桌面：${error?.message ?? error}`)
        }
        return next()
      }, { prepend: true })
    : null

  function requireController() {
    if (!available) throw new Error('DSH 会话服务未装配（ctx.sessionController 不可用）')
    return sessionController
  }

  return {
    available,

    /** 该会话当前是否有活跃 turn；未知/未跑 = false。 */
    statusOf(sessionId) {
      return statuses.get(String(sessionId ?? '')) === true
    },

    /**
     * 装配/撤销语音审批应答器。返回三值 outcome 之一表示语音已答复；
     * 返回空 = 不接，桥会把请求交给桌面审批卡。
     */
    setApprovalAnswerer(handler) {
      approvalAnswerer = typeof handler === 'function' ? handler : null
    },

    /**
     * 装配/撤销语音提问应答器。返回 `{ answers }` 表示语音已答复；
     * 返回空/空数组 = 不接，桥会把请求交给桌面卡片。
     */
    setQuestionAnswerer(handler) {
      questionAnswerer = typeof handler === 'function' ? handler : null
    },

    /** 最近会话，供控制台「绑定会话」下拉使用。失败只返回空数组。 */
    async list({ signal } = {}) {
      if (!available) return []
      try {
        const value = await requireController().list({}, signal ?? AbortSignal.timeout(5_000))
        const items = Array.isArray(value?.items) ? value.items : []
        // 列表行是「会话运行态」的权威快照：冷会话不会发 status 事件，靠这次刷新补上。
        for (const row of items) {
          if (row && typeof row.sessionId === 'string') statuses.set(row.sessionId, row.running === true)
        }
        return items
      } catch (error) {
        logger.warn?.(`dsh-xiaozhi: 列会话失败: ${error?.message ?? error}`)
        return []
      }
    },

    /** 新建一条会话（首次给某个智能体用），返回 sessionId。 */
    async create({ cwd } = {}) {
      const controller = requireController()
      const value = await controller.create(cwd ? { cwd } : {})
      const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : ''
      if (!sessionId) throw new Error('DSH 没有返回 sessionId')
      return sessionId
    },

    /** 把一句话送进会话。`mode` 只接受 queue / steer。 */
    async prompt({ sessionId, text, requestId, mode = 'queue' } = {}) {
      const controller = requireController()
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('会话未绑定')
      if (typeof text !== 'string' || !text.trim()) throw new Error('没有可发送的文本')
      await controller.prompt(
        {
          requestId: String(requestId ?? ''),
          sessionId,
          mode: mode === 'steer' ? 'steer' : 'queue',
          content: [{ type: 'text', text }],
        },
        AbortSignal.timeout(30_000),
      )
    },

    /** 停掉该会话当前这一轮。没有活跃 turn 时是 no-op。 */
    cancel(sessionId) {
      if (!available || typeof sessionId !== 'string' || !sessionId) return
      try {
        sessionController.cancel({ sessionId })
      } catch (error) {
        logger.warn?.(`dsh-xiaozhi: 取消会话失败: ${error?.message ?? error}`)
      }
    },

    /** 订阅一条会话的落库事件，返回退订函数。 */
    subscribe(sessionId, listener) {
      const key = String(sessionId ?? '')
      if (!key || typeof listener !== 'function') return () => {}
      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(key)
      }
    },

    dispose() {
      disposed = true
      listeners.clear()
      statuses.clear()
      for (const unsubscribe of [off, offStatus, offAgentStatus, offApproval, offQuestion]) {
        try {
          unsubscribe?.()
        } catch {
          // 退订失败不影响进程退出。
        }
      }
    },
  }
}
