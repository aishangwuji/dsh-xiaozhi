/**
 * 语音回复的情绪（= 设备端表情）。
 *
 * 固件里能显示的表情是 21 个规范名（`chibi-maid_240/*.png`，与
 * `managed_components/78__xiaozhi-fonts/include/noto_emoji.h` 一一对应）：
 *
 *   angry confident confused cool crying delicious embarrassed funny happy
 *   kissy laughing loving neutral relaxed sad shocked silly sleepy surprised
 *   thinking winking
 *
 * 这套「emoji → 表情名」的对照来自原服务端
 * `xiaozhi-esp32-server/main/xiaozhi-server/core/utils/textUtils.py` 的 `EMOJI_MAP`：
 * 模型在回复开头给一个 emoji，服务端取出它、映射成表情名，再用
 * `{"type":"llm","emotion":...}` 下发给设备（固件 `application.cc` 收到后 SetEmotion）。
 *
 * 这里只做两件事：从流式文本里**取出开头那个 emoji**（它可能被 SSE 拆成两段），
 * 以及把正文里的 emoji 清掉——emoji 不该进 TTS，也不该进对话历史。
 */

/** 规范名 → emoji（顺序与固件 21 个名字一致）。 */
export const EMOTION_EMOJI = Object.freeze({
  angry: '😠',
  confident: '😏',
  confused: '🙄',
  cool: '😎',
  crying: '😭',
  delicious: '🤤',
  embarrassed: '😳',
  funny: '😂',
  happy: '🙂',
  kissy: '😘',
  laughing: '😆',
  loving: '😍',
  neutral: '😶',
  relaxed: '😌',
  sad: '😔',
  shocked: '😱',
  silly: '😜',
  sleepy: '😴',
  surprised: '😲',
  thinking: '🤔',
  winking: '😉',
})

/** emoji → 规范名（把上面的表倒过来；不带变体选择符，查表前会先清掉 \uFE0F）。 */
export const EMOJI_TO_EMOTION = Object.freeze({
  ...Object.fromEntries(Object.entries(EMOTION_EMOJI).map(([name, emoji]) => [emoji, name])),
  // 模型偶尔不用表里那个同义写法：都归到同一个规范名，避免白白丢一次表情。
  '😊': 'happy',
  '😀': 'happy',
  '😁': 'happy',
})

/** 一个 emoji（可带变体选择符 / ZWJ 组合）。 */
const EMOJI_ATOM = String.raw`\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*`
const EMOJI_LEADING = new RegExp(`^(${EMOJI_ATOM})`, 'u')
const EMOJI_ANY = new RegExp(EMOJI_ATOM, 'gu')

export function stripEmoji(text) {
  return String(text ?? '').replace(EMOJI_ANY, '')
}

/** emoji → 21 个规范名之一；不认识的返回 ''（调用方据此保持当前表情）。 */
export function emotionOfEmoji(emoji) {
  const key = String(emoji ?? '').replace(/\uFE0F/g, '')
  return EMOJI_TO_EMOTION[key] ?? ''
}

/**
 * 流式过滤器：按约定，模型回复的第一个字符就是情绪 emoji。
 *
 * `push(chunk)` 返回 `{ text, emotion }`：
 * - `text` 已去掉 emoji，可以直接进分句/TTS/历史；
 * - `emotion` 只在**第一次**识别到开头 emoji 时非空，之后都为 ''。
 *
 * 为什么要有状态：LLM 是按 token 流式回来的，emoji 是 2 个 UTF-16 单元，
 * 可能正好被切在 `\uD83D` / `\uDE42` 之间；没看到完整 emoji 之前必须缓冲，
 * 否则会把半个 emoji 送进 TTS。没按约定以 emoji 开头时，看到第一个普通字符就
 * 原样放行（不做猜测，情绪保持设备当前表情）。
 */
export class EmotionFilter {
  constructor() {
    this.buffer = ''
    this.resolved = false
  }

  reset() {
    this.buffer = ''
    this.resolved = false
  }

  push(chunk) {
    const text = String(chunk ?? '')
    if (this.resolved) {
      return { text: stripEmoji(text), emotion: '' }
    }

    this.buffer += text
    // 末尾是高位代理（emoji 只到了一半）：等下一段，别急着判定“没有 emoji”。
    if (/[\uD800-\uDBFF]$/.test(this.buffer)) {
      return { text: '', emotion: '' }
    }

    const trimmed = this.buffer.replace(/^\s+/, '')
    if (trimmed === '') {
      return { text: '', emotion: '' }
    }

    const leading = trimmed.match(EMOJI_LEADING)
    if (leading) {
      this.resolved = true
      this.buffer = ''
      return {
        text: stripEmoji(trimmed.slice(leading[1].length)),
        emotion: emotionOfEmoji(leading[1]),
      }
    }

    // 开头不是 emoji（模型没遵守约定）：整段放行，情绪交给设备当前表情。
    this.resolved = true
    this.buffer = ''
    return { text: stripEmoji(trimmed), emotion: '' }
  }

  /** 流结束：把还压着的缓冲吐出来（正常情况只有 emoji、返回空串）。 */
  flush() {
    const rest = this.buffer
    this.buffer = ''
    this.resolved = true
    return stripEmoji(rest)
  }
}
