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

  function requireController() {
    if (!available) throw new Error('DSH 会话服务未装配（ctx.sessionController 不可用）')
    return sessionController
  }

  return {
    available,

    /** 最近会话，供控制台「绑定会话」下拉使用。失败只返回空数组。 */
    async list({ signal } = {}) {
      if (!available) return []
      try {
        const value = await requireController().list({}, signal ?? AbortSignal.timeout(5_000))
        return Array.isArray(value?.items) ? value.items : []
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
      try {
        off?.()
      } catch {
        // 退订失败不影响进程退出。
      }
    },
  }
}
