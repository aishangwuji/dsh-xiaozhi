/**
 * 主用 + 备用 的适配器包装（failover）。
 *
 * 契约见 `docs/backup-providers.md` 第 4.1 节。三段语义一致但可重试的粒度不同：
 *
 *   - LLM：**只在还没吐出任何事件之前**可换。已经出字再重试会把同一句话念两遍、
 *     还会错乱分句，所以直接抛给会话层的 `llm_failed` 路径。
 *   - TTS：每句话内部都可以换。候选音频先整句收进内存，失败换下一家从零重来，
 *     不产生半句幽灵音频（会话本来就是整句编码）。
 *   - ASR：整段 utterance 结束时换。写入的 PCM 记一份（上限 60s 上行音频），
 *     `finish()` 失败时把缓存回放给下一家；回放不推 partial（避免重复气泡）。
 *
 * 每个包装实例维护 `preferred` / `stickyAt`：切到备用并成功后先继续用备用，
 * 过了 `cooldownMs`（默认 5 分钟）再试探回主用。主动中断（signal 已 abort）
 * 不是失败，不触发切换。
 */

import { trace } from '../trace.js'

/** 切到备用后继续粘着多久，之后重新先试主用。 */
export const DEFAULT_COOLDOWN_MS = 300_000

/**
 * 厂商侧瞬时故障（5xx / 连接抖动）才值得原地重试一次。
 *
 * 2026-11-07 实测：本机到 `api.deepseek.com` 空闲一段时间后的**第一次**请求，常在
 * ~15s 后返回 HTTP 500；紧接着同参数重试就是 200（同进程内稳定复现）。语音每轮都是
 * 冷请求，所以一轮对话必哑。官方服务端也是「超时/失败重试」的做法，这里只对 5xx 和
 * 连接类错误补一次，不重试 4xx（参数/鉴权错误重试也没用）。
 */
function isTransientProviderError(error) {
  const message = String(error?.message ?? error ?? '')
  return /HTTP 5\d\d|\b5\d\d\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|timeout/i.test(
    message,
  )
}

/** ASR 回放缓存上限：60 秒上行音频。 */
const REPLAY_LIMIT_SECONDS = 60

const DEFAULT_UPLINK_RATE = 16_000

function errorText(error) {
  const message = error?.message ?? String(error ?? 'unknown error')
  return String(message).slice(0, 300)
}

function labelOf(candidates, labels, index) {
  const label = labels?.[index]
  if (typeof label === 'string' && label) return label
  return candidates[index]?.name ?? 'unknown'
}

/**
 * 每个实例一份的「下一次先试谁」状态。
 *
 * `order()` 返回本轮尝试顺序：从 preferred 开始，绕回 0 再补齐前面的候选。
 * 这样 sticky 到第 2 个备用时，先试它，失败了再按优先级试主用与更早的备用。
 */
function createSticky(candidates, { clock = () => Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
  const size = candidates.length
  let preferred = 0
  let stickyAt = 0
  return {
    get preferred() {
      return preferred
    },
    get stickyAt() {
      return stickyAt
    },
    order() {
      const now = clock()
      if (preferred > 0 && now - stickyAt > cooldownMs) {
        preferred = 0
        stickyAt = 0
      }
      const start = Math.min(Math.max(preferred, 0), size - 1)
      const order = []
      for (let index = start; index < size; index += 1) order.push(index)
      for (let index = 0; index < start; index += 1) order.push(index)
      return order
    },
    success(index) {
      if (index > 0) {
        preferred = index
        stickyAt = clock()
      } else {
        preferred = 0
        stickyAt = 0
      }
    },
  }
}

/** 失败链条只落 logger.warn + trace；配置错误（构建期）不在这里。 */
function createReporter({ kind, candidates, labels, logger, deviceId, clock }) {
  return function report(from, to, error, startedAt) {
    const provider = labelOf(candidates, labels, from)
    const ms = Math.max(0, clock() - startedAt)
    trace(`${kind}.failover`, {
      device: deviceId,
      from,
      to: to ?? null,
      provider,
      error: errorText(error),
      ms,
    })
    const target = to == null ? '没有更多备用' : `切换到 #${to}（${labelOf(candidates, labels, to)}）`
    logger?.warn?.(
      `dsh-xiaozhi: voice.${kind} 候选 #${from}（${provider}）失败，${target}: ${errorText(error)}`,
    )
  }
}

function assertCandidates(kind, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`failover ${kind}: candidates must be a non-empty array`)
  }
}

/** 没有 `streamWithTools` 的候选：把纯文本流转成会话层要的统一事件流。 */
function toolStreamOf(candidate, request) {
  if (typeof candidate?.streamWithTools === 'function') return candidate.streamWithTools(request)
  return (async function* textOnly() {
    for await (const text of candidate.stream(request)) yield { type: 'text', text }
  })()
}

/**
 * LLM failover 包装。
 *
 * @param {object[]} candidates 适配器数组，[0] 是主用；每个需提供 stream()，
 *   可选 streamWithTools() / systemPrompt。
 * @param {{ labels?: string[], logger?: object, deviceId?: string,
 *   clock?: () => number, cooldownMs?: number }} [options]
 */
export function createFailoverLlm(candidates, options = {}) {
  assertCandidates('llm', candidates)
  const { labels, logger, deviceId = '', clock = () => Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS } = options
  const sticky = createSticky(candidates, { clock, cooldownMs })
  const report = createReporter({ kind: 'llm', candidates, labels, logger, deviceId, clock })
  let activeSystemPrompt =
    typeof candidates[0]?.systemPrompt === 'string' ? candidates[0].systemPrompt : ''

  async function* run(request, { withTools }) {
    const order = sticky.order()
    let lastError = null
    for (let position = 0; position < order.length; position += 1) {
      const index = order[position]
      const candidate = candidates[index]
      const startedAt = clock()
      let events = 0
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (attempt > 0) {
            // 厂商 5xx / 连接抖动先原地重试一次：一次 DeepSeek 500 不该让整轮语音哑掉。
            await new Promise((resolve) => setTimeout(resolve, 400))
            if (request?.signal?.aborted) return
          }
          try {
            const stream = withTools ? toolStreamOf(candidate, request) : candidate.stream(request)
            for await (const event of stream) {
              // 主动中断不是失败：不换家、也不抛，让会话层的 abort 路径收尾。
              if (request?.signal?.aborted) return
              events += 1
              yield event
            }
            sticky.success(index)
            return
          } catch (error) {
            if (request?.signal?.aborted) return
            // 已经吐过事件再换家会把同一段话重念一遍，按契约直接抛（也不重试）。
            if (events > 0) {
              if (error && typeof error === 'object') error.dshNoSwitch = true
              throw error
            }
            if (attempt === 0 && isTransientProviderError(error)) {
              trace('llm.retry', {
                device: deviceId,
                provider: labels?.[index] ?? String(index),
                message: String(error?.message ?? error).slice(0, 160),
              })
              continue
            }
            throw error
          }
        }
      } catch (error) {
        if (request?.signal?.aborted) return
        if (error?.dshNoSwitch) throw error
        lastError = error
        report(index, order[position + 1], error, startedAt)
      }
    }
    throw lastError ?? new Error('failover llm: all candidates failed')
  }

  return {
    name: 'failover',
    get candidateCount() {
      return candidates.length
    },
    get preferred() {
      return sticky.preferred
    },
    get systemPrompt() {
      return activeSystemPrompt
    },
    set systemPrompt(value) {
      activeSystemPrompt = String(value ?? '')
      for (const candidate of candidates) {
        try {
          if (candidate && 'systemPrompt' in candidate) candidate.systemPrompt = activeSystemPrompt
        } catch {
          // 只读实现忽略即可，不能因为一次赋值把整轮对话打死。
        }
      }
    },
    stream(request = {}) {
      return run(request, { withTools: false })
    },
    streamWithTools(request = {}) {
      return run(request, { withTools: true })
    },
  }
}

/**
 * TTS failover 包装：每句话整句缓冲，成功才往下游吐；失败换下一家重来。
 *
 * @param {object[]} candidates [0] 是主用；每个需提供 synthesize(text, {signal, sampleRate})
 * @param {{ labels?: string[], logger?: object, deviceId?: string,
 *   clock?: () => number, cooldownMs?: number }} [options]
 */
export function createFailoverTts(candidates, options = {}) {
  assertCandidates('tts', candidates)
  const { labels, logger, deviceId = '', clock = () => Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS } = options
  const sticky = createSticky(candidates, { clock, cooldownMs })
  const report = createReporter({ kind: 'tts', candidates, labels, logger, deviceId, clock })

  async function* run(text, request = {}) {
    const order = sticky.order()
    let lastError = null
    for (let position = 0; position < order.length; position += 1) {
      const index = order[position]
      const startedAt = clock()
      const chunks = []
      try {
        for await (const chunk of candidates[index].synthesize(text, request)) {
          if (request?.signal?.aborted) return
          if (chunk?.length) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        sticky.success(index)
        // 整句收齐后才放行：换家时旧候选的半个句子不会漏进播放队列。
        for (const chunk of chunks) {
          if (request?.signal?.aborted) return
          yield chunk
        }
        return
      } catch (error) {
        lastError = error
        if (request?.signal?.aborted) return
        report(index, order[position + 1], error, startedAt)
      }
    }
    throw lastError ?? new Error('failover tts: all candidates failed')
  }

  return {
    name: 'failover',
    get candidateCount() {
      return candidates.length
    },
    get preferred() {
      return sticky.preferred
    },
    synthesize(text, request = {}) {
      return run(text, request)
    },
  }
}

/**
 * ASR 的「失败」判定。
 *
 * 有的适配器不 throw，而是把错误塞在 `finish()` 的返回值里：火山 ASR 握手 403、
 * 服务端错误帧都会得到 `{ text: '', error }`。只看 text 为空只能记成 asr.empty，
 * 备选永远不会被启用——这正是「识别恒为空、手表卡在聆听中」的根因。
 * 已经识别出文字的部分结果不算失败（文字优先）。
 */
function asrFailureOf(stream, result) {
  const text = String(result?.text ?? '').trim()
  if (text) return null
  if (result?.error) return Object.assign(new Error(String(result.error)), { candidateFailure: true })
  if (stream?.failed === true) return Object.assign(new Error('asr stream failed'), { candidateFailure: true })
  return null
}

/**
 * ASR failover 包装：一段 utterance 结束时换家，回放已写入的 PCM。
 *
 * @param {object[]} candidates [0] 是主用；每个需提供 createStream({onPartial, ...})
 * @param {{ labels?: string[], logger?: object, deviceId?: string,
 *   clock?: () => number, cooldownMs?: number }} [options]
 */
export function createFailoverAsr(candidates, options = {}) {
  assertCandidates('asr', candidates)
  const { labels, logger, deviceId = '', clock = () => Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS } = options
  const sticky = createSticky(candidates, { clock, cooldownMs })
  const report = createReporter({ kind: 'asr', candidates, labels, logger, deviceId, clock })

  return {
    name: 'failover',
    get candidateCount() {
      return candidates.length
    },
    get preferred() {
      return sticky.preferred
    },
    createStream(streamOptions = {}) {
      const { onPartial, ...rest } = streamOptions
      const requestedRate = Number(rest.sampleRate)
      const sampleRate = requestedRate > 0 ? requestedRate : DEFAULT_UPLINK_RATE
      // 60s 上行 PCM 上限（16-bit 单声道）。超过就不缓存，失败时也不回放。
      const maxReplayBytes = sampleRate * 2 * REPLAY_LIMIT_SECONDS
      const order = sticky.order()
      let position = 0
      let currentIndex = order[0]
      let current = null
      let aborted = false
      let finished = false
      let replayable = true
      let buffered = []
      let bufferedBytes = 0
      let lastError = null

      const writeToCurrent = (chunk) => {
        try {
          const pending = current?.write?.(chunk)
          if (pending && typeof pending.catch === 'function') pending.catch(() => {})
        } catch (error) {
          lastError = error
        }
      }

      const open = (index, { replay }) => {
        currentIndex = index
        // 回放时不能推 partial：重放的是上一家已经识别过的音频，再推一遍会出重复气泡。
        current = candidates[index].createStream({ ...rest, onPartial: replay ? undefined : onPartial })
        if (replay) {
          for (const chunk of buffered) writeToCurrent(chunk)
        }
      }
      // 建流本身失败（极少数同步抛错的实现）也按候选失败处理，继续试下一个。
      for (let index = 0; index < order.length; index += 1) {
        try {
          position = index
          open(order[index], { replay: false })
          break
        } catch (error) {
          lastError = error
          report(order[index], order[index + 1], error, clock())
          current = null
        }
      }
      if (!current) throw lastError ?? new Error('failover asr: no candidate could open a stream')

      return {
        get failed() {
          return Boolean(current?.failed)
        },
        write(pcm) {
          if (aborted || finished) return
          // 必须存副本：解码器/调用方之后可能复用同一块内存，回放时要的是当时的音频。
          const chunk = Buffer.from(pcm)
          if (replayable) {
            if (bufferedBytes + chunk.length > maxReplayBytes) {
              replayable = false
              buffered = []
              bufferedBytes = 0
            } else {
              buffered.push(chunk)
              bufferedBytes += chunk.length
            }
          }
          writeToCurrent(chunk)
        },
        async finish() {
          if (finished) return { text: '' }
          finished = true
          const startedAt = clock()
          try {
            const result = await current.finish()
            const candidateFailure = asrFailureOf(current, result)
            if (candidateFailure) throw candidateFailure
            sticky.success(currentIndex)
            return result
          } catch (error) {
            lastError = error
            // 主动 abort 不是失败：不换家，把错误原样交给会话层。
            if (aborted) throw error
            report(currentIndex, order[position + 1], error, startedAt)
            try {
              current?.abort?.()
            } catch {
              // 已经断开就算了。
            }
            // 缓存不可回放（超过 60s）时没有重试的意义，直接抛。
            if (!replayable) throw error
          }

          for (let index = position + 1; index < order.length; index += 1) {
            const candidateIndex = order[index]
            const attemptStartedAt = clock()
            try {
              position = index
              open(candidateIndex, { replay: true })
              const result = await current.finish()
              const candidateFailure = asrFailureOf(current, result)
              if (candidateFailure) throw candidateFailure
              sticky.success(candidateIndex)
              return result
            } catch (error) {
              lastError = error
              if (aborted) throw error
              report(candidateIndex, order[index + 1], error, attemptStartedAt)
              try {
                current?.abort?.()
              } catch {
                // 已经断开就算了。
              }
            }
          }
          throw lastError ?? new Error('failover asr: all candidates failed')
        },
        abort() {
          aborted = true
          buffered = []
          bufferedBytes = 0
          try {
            current?.abort?.()
          } catch {
            // 已经断开就算了。
          }
        },
      }
    },
  }
}
