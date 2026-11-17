/**
 * DeepSeek 语音合成（`POST https://api.deepseek.com/v1/tools/tts`，2026-11-14）。
 *
 * 官方文档：<https://api-docs.deepseek.com/zh-cn/api/tts>（限制/计费见「语音合成指南」）。
 *
 * 请求：JSON `{ text, voice_id, format:'wav', filter_markdown:true }`
 * 响应：`audio/wav`（`format:'pcm'` 时是 24 kHz / 16-bit / 单声道裸 PCM），**边合成边返回**。
 *
 * 为什么这里**整段收完再吐**（与百智云 TTS 同样的选择）：
 * 本插件的会话侧（`src/voice/session.js` 的 `#speakSentence`）本来就要把一整句话的 PCM
 * 收齐后才做 Opus 编码并推给播放器，适配器边下边吐并不会让第一帧更早到设备，反而多一份
 * 流式解析的复杂度与失败面。首字延迟 = 该句的合成时间，只影响这一句的第一帧。
 *
 * 几个硬约束（都是官方明确的，违反会整句没声）：
 * - 音色只有 `stella`（女声，默认）/ `tide`（男声）；**没有语种参数**，语种按文本自动识别；
 * - **不支持调节语速**，所以 `voice.speed` / `voice.tts.rate` 一律不下发；
 * - 单次请求最多 10,000 个计费字符（汉字算 2、其他字符算 1），请求体最大 64 KiB；
 * - 错误码：400（无可朗读文本 / 内容审核 `Content Exists Risk`）、429（并发超限）、
 *   503（服务繁忙）、504（合成超时）；若音频已开始返回后失败，响应会**中途断开**——
 *   一次 `arrayBuffer()` 读不满就是失败，不能拿半段音频当成功。
 */

import { parseWav16, resamplePcm16 } from '../wav.js'
import { trace } from '../trace.js'

export const DEEPSEEK_TTS_DEFAULTS = {
  url: 'https://api.deepseek.com/v1/tools/tts',
  // 与 `src/voice/voices.js` 的 DEFAULT_TTS_VOICES.deepseek 保持一致。
  voice: 'stella',
  format: 'wav',
  sampleRate: 24_000,
  timeoutMs: 30_000,
  // 官方计费字符上限：汉字 2、英文字母/数字/空格等 1。
  maxBilledChars: 10_000,
  maxBodyBytes: 64 * 1024,
}

export const DEEPSEEK_TTS_VOICES = ['stella', 'tide']

/**
 * 官方计费字符数：只有**汉字**算 2，其余（英文字母/数字/空格，以及日文假名、谚文等）算 1。
 *
 * 只用于**上限判定**，不用于计费展示；CJK 标点/全角形式按宽字符算 2（保守，只会更早拦住）。
 */
export function billedChars(text) {
  let total = 0
  for (const char of Array.from(String(text ?? ''))) {
    const code = char.codePointAt(0) ?? 0
    const wide =
      (code >= 0x3000 && code <= 0x303f) || // CJK 标点
      (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
      (code >= 0x4e00 && code <= 0x9fff) || // 基本区
      (code >= 0xf900 && code <= 0xfaff) || // 兼容表意文字
      (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式
      (code >= 0xff00 && code <= 0xffef) || // 全角形式
      (code >= 0x20000 && code <= 0x3ffff) // 扩展 B 及以后
    total += wide ? 2 : 1
  }
  return total
}

/** 请求体（导出给单测，避免把协议形状复制到测试里）。 */
export function buildTtsRequest({ text, voice = DEEPSEEK_TTS_DEFAULTS.voice, filterMarkdown = true } = {}) {
  return {
    text,
    voice_id: voice,
    // 要 WAV 而不是裸 PCM：带容器能直接验采样率/位深/声道，坏包在边界就暴露。
    format: DEEPSEEK_TTS_DEFAULTS.format,
    filter_markdown: filterMarkdown !== false,
  }
}

/** 官方错误码 → 一句能直接给用户看的原因（详情仍附在后面）。 */
export function describeTtsStatus(status) {
  switch (Number(status)) {
    case 400:
      return '文本为空或未通过内容审核（Content Exists Risk）'
    case 429:
      return '账号同时进行的合成请求数超过上限'
    case 503:
      return '服务繁忙，请稍后重试'
    case 504:
      return '合成超时'
    case 401:
    case 403:
      return 'API Key 无效或无权限'
    default:
      return '合成失败'
  }
}

export function createDeepseekTts({
  apiKey = '',
  url = DEEPSEEK_TTS_DEFAULTS.url,
  voice = DEEPSEEK_TTS_DEFAULTS.voice,
  sampleRate = DEEPSEEK_TTS_DEFAULTS.sampleRate,
  timeoutMs = DEEPSEEK_TTS_DEFAULTS.timeoutMs,
  filterMarkdown = true,
  // 仅单测注入；运行时用全局 fetch。
  fetchImpl = null,
} = {}) {
  if (!apiKey) throw new Error('deepseek tts: missing apiKey（配置 → TTS 里填 DeepSeek API Key）')
  const resolvedVoice = String(voice ?? '').trim() || DEEPSEEK_TTS_DEFAULTS.voice
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('deepseek tts: 当前运行环境没有 fetch')

  return {
    name: 'deepseek',
    async *synthesize(text, { signal, sampleRate: requestedRate } = {}) {
      const sentence = String(text ?? '').trim()
      if (!sentence) return
      // 已经打断（用户插话）就别再发请求：合成一整句也要计费，且结果没人听。
      if (signal?.aborted) return
      if (billedChars(sentence) > DEEPSEEK_TTS_DEFAULTS.maxBilledChars) {
        throw new Error(`deepseek tts: 单次合成超过 ${DEEPSEEK_TTS_DEFAULTS.maxBilledChars} 个计费字符上限`)
      }
      const body = JSON.stringify(buildTtsRequest({ text: sentence, voice: resolvedVoice, filterMarkdown }))
      if (Buffer.byteLength(body) > DEEPSEEK_TTS_DEFAULTS.maxBodyBytes) {
        throw new Error(`deepseek tts: 请求体超过 ${DEEPSEEK_TTS_DEFAULTS.maxBodyBytes} 字节上限`)
      }
      const rate = Number(requestedRate) > 0 ? Number(requestedRate) : sampleRate
      const startedAt = Date.now()

      // 会话打断（signal）与超时都要能中止请求：合成一段长文本时用户随时可能插话。
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      timer.unref?.()
      const onAbort = () => controller.abort()
      if (signal) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      try {
        const response = await doFetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'audio/wav',
          },
          body,
          signal: controller.signal,
        })
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          trace('deepseek.tts.error', { status: response.status, detail: String(detail).slice(0, 300) })
          throw new Error(
            `deepseek tts http ${response.status}: ${describeTtsStatus(response.status)}` +
              (detail ? `（${String(detail).slice(0, 160)}）` : ''),
          )
        }
        let bytes
        try {
          bytes = Buffer.from(await response.arrayBuffer())
        } catch (error) {
          // 官方明确：音频已开始返回后合成失败会中途断开，提前结束的响应必须当失败。
          throw new Error(`deepseek tts: 响应中途断开（${error.message}），按合成失败处理`)
        }
        const wav = parseWav16(bytes)
        const pcm = wav.sampleRate === rate ? wav.pcm : resamplePcm16(wav.pcm, wav.sampleRate, rate)
        trace('deepseek.tts.done', {
          voice: resolvedVoice,
          chars: Array.from(sentence).length,
          billed: billedChars(sentence),
          wavSampleRate: wav.sampleRate,
          outSampleRate: rate,
          bytes: pcm.length,
          ms: Date.now() - startedAt,
        })
        // 按 100ms 一块吐出，与其它适配器的下游节奏一致（会话侧反正会整句收齐）。
        const chunkBytes = Math.max(2, Math.round((rate * 100) / 1000) * 2)
        for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
          if (signal?.aborted) return
          yield pcm.subarray(offset, offset + chunkBytes)
        }
      } catch (error) {
        // 超时与“用户打断”都是 AbortError：超时要给出能看懂的原因，打断按静默结束处理。
        if (controller.signal.aborted && !signal?.aborted) {
          throw new Error(`deepseek tts: 合成超时（${Math.round(timeoutMs / 1000)}s）`)
        }
        throw error
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
      }
    },
  }
}
