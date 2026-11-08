/**
 * Streaming sentence segmenter.
 *
 * Ported from the reference implementation's `internal/util/sentence.go`
 * (`ExtractSmartSentences` / `ContainsSentenceSeparator`), including its two
 * non-obvious guards: a `.` that belongs to an ordered-list marker (`1.`) and a
 * `:`/`：` sitting between digits (`3:30`) must not end a sentence. Losing those
 * guards is what makes a TTS engine read "three thirty" as two sentences.
 *
 * Added on top of the reference rules, both required by the latency budget:
 *   - a first-chunk hard cap: the reference waits for a comma, and a model that
 *     opens with a long clause would otherwise delay the first audio by seconds;
 *   - model-output cleanup (thinking blocks, code fences, markdown marks, emoji)
 *     so the segmenter never asks TTS to pronounce markup.
 */

/** End-of-sentence punctuation (never merged into the next sentence). */
const SENTENCE_END = new Set(['.', '。', '!', '！', '?', '？', '\n'])
/** Pause punctuation usable as a split point in a long sentence. Commas are
 * deliberately absent: the reference only allows them before the first sentence
 * went out, so a later sentence is not chopped into breath-sized fragments. */
const SENTENCE_PAUSE = new Set([';', '；', ':', '：'])

const BASE_SEPARATORS = new Set([...SENTENCE_END, ...SENTENCE_PAUSE])
/** First chunk may also split on a comma, which is what makes it early. */
const FIRST_SEPARATORS = new Set([...BASE_SEPARATORS, '，', ','])

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n'
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

/** `1.` / `12.` at the start of a line is a list marker, not a full stop. */
function isNumberPrefix(chars, position) {
  if (position <= 0 || chars[position] !== '.') return false
  let start = position - 1
  let digits = 0
  let found = false
  while (start >= 0 && (chars[start] === ' ' || chars[start] === '\t')) start -= 1
  while (start >= 0 && isDigit(chars[start])) {
    digits += 1
    found = true
    if (digits > 3) return false
    start -= 1
  }
  if (start >= 0 && chars[start] !== ' ' && chars[start] !== '\t' && chars[start] !== '\n') return false
  return found
}

/** `3:30` — a colon between digits never splits. */
function isDigitAdjacentColon(chars, position) {
  if (position < 0 || position >= chars.length) return false
  const colon = chars[position]
  if (colon !== ':' && colon !== '：') return false
  if (position === 0 || !isDigit(chars[position - 1])) return false
  if (position === chars.length - 1) return true
  return isDigit(chars[position + 1])
}

function trimBounds(chars, from, to) {
  let start = from
  let end = to
  while (start <= end && isSpace(chars[start])) start += 1
  while (end >= start && isSpace(chars[end])) end -= 1
  return [start, end]
}

function findNextSplitPoint(chars, startPos, maxLen, separators) {
  const endPos = Math.min(startPos + maxLen, chars.length)
  for (let index = startPos; index < endPos; index += 1) {
    if (chars[index] === '\n') {
      let next = index + 1
      while (next < endPos && (chars[next] === ' ' || chars[next] === '\t')) next += 1
      // A newline followed by a numbered item belongs to the list, not a split.
      if (next < endPos - 2 && isDigit(chars[next])) return index
      continue
    }
    if (separators.has(chars[index])) {
      if (isDigitAdjacentColon(chars, index)) continue
      return index
    }
  }
  if (endPos < chars.length) {
    for (let index = endPos; index < chars.length; index += 1) {
      if (chars[index] === '\n') return index
      if (separators.has(chars[index]) && !isDigitAdjacentColon(chars, index)) return index
    }
  }
  return -1
}

/**
 * Split one buffer into finished sentences plus the remainder.
 * Mirrors the reference signature so the ports stay comparable.
 */
export function extractSmartSentences(text, minLen, maxLen, isFirst) {
  const separators = isFirst ? FIRST_SEPARATORS : BASE_SEPARATORS
  const chars = Array.from(text)
  const sentences = []
  let remaining = ''
  let startPos = 0
  while (startPos < chars.length) {
    while (startPos < chars.length && isSpace(chars[startPos])) startPos += 1
    if (startPos >= chars.length) break
    const splitPos = findNextSplitPoint(chars, startPos, maxLen, separators)
    if (splitPos === -1) {
      const [from, to] = trimBounds(chars, startPos, chars.length - 1)
      if (to >= from) remaining = chars.slice(from, to + 1).join('')
      break
    }
    const [from, to] = trimBounds(chars, startPos, splitPos)
    const segment = to >= from ? chars.slice(from, to + 1).join('') : ''
    const endsWithSeparator = segment.length > 0 && separators.has(segment[segment.length - 1])
    if (Array.from(segment).length >= minLen && endsWithSeparator) {
      sentences.push(segment)
    } else if (segment.length > 0) {
      remaining = remaining.length > 0 ? `${remaining} ${segment}` : segment
    }
    startPos = splitPos + 1
  }
  return { sentences, remaining }
}

/** Whether a delta contains a separator the current phase may split on. */
export function containsSentenceSeparator(text, isFirst) {
  const separators = isFirst ? FIRST_SEPARATORS : BASE_SEPARATORS
  const chars = Array.from(text)
  for (let index = 0; index < chars.length; index += 1) {
    if (!separators.has(chars[index])) continue
    if (isDigitAdjacentColon(chars, index)) continue
    return true
  }
  return false
}

const EMOJI = /\p{Extended_Pictographic}\uFE0F?|\u200D/gu;
const MARKDOWN_MARKS = /[*_`#>|]/g
const LINK = /\[([^\]]*)\]\(([^)]*)\)/g
const CODE_FENCE = /```[\s\S]*?```/g

/**
 * Incremental cleanup of model output.
 *
 * Streaming-safe by construction: a `think` block opened in one delta and closed
 * in another is dropped in both, and an unterminated code fence swallows the
 * rest of the turn instead of leaking code into speech.
 */
export class OutputCleaner {
  constructor() {
    this.inThink = false
    this.inFence = false
    this.pending = ''
  }

  push(delta) {
    if (!delta) return ''
    const text = this.pending + delta
    this.pending = ''
    return this.#holdTail(this.#consume(text))
  }

  flush() {
    const rest = this.pending
    this.pending = ''
    return rest
  }

  /**
   * Hold back a trailing fragment that may be the start of `<think` or a code
   * fence, so a tag split across two deltas is still recognised as a tag.
   */
  #holdTail(out) {
    if (!out) return out
    const markers = ['<think', '```']
    for (const marker of markers) {
      for (let size = Math.min(marker.length - 1, out.length); size > 0; size -= 1) {
        if (out.endsWith(marker.slice(0, size))) {
          this.pending = out.slice(-size) + this.pending
          return out.slice(0, -size)
        }
      }
    }
    return out
  }

  #consume(input) {
    let text = input
    let out = ''
    while (text.length > 0) {
      if (this.inThink) {
        const end = text.indexOf('</think')
        if (end === -1) {
          // Keep a tail in case the closing tag straddles the next delta.
          this.pending = text.slice(-8)
          return out
        }
        const close = text.indexOf('>', end)
        text = close === -1 ? '' : text.slice(close + 1)
        this.inThink = false
        continue
      }
      if (this.inFence) {
        const end = text.indexOf('```')
        if (end === -1) {
          this.pending += text.slice(-2)
          return out
        }
        text = text.slice(end + 3)
        this.inFence = false
        continue
      }
      const thinkAt = text.indexOf('<think')
      const fenceAt = text.indexOf('```')
      if (thinkAt === -1 && fenceAt === -1) {
        out += text
        return out
      }
      const next = thinkAt === -1 ? fenceAt : fenceAt === -1 ? thinkAt : Math.min(thinkAt, fenceAt)
      out += text.slice(0, next)
      if (next === thinkAt) {
        this.inThink = true
        const close = text.indexOf('>', next)
        if (close === -1) return out
        text = text.slice(close + 1)
      } else {
        this.inFence = true
        text = text.slice(next + 3)
      }
    }
    return out
  }
}

/** Strip markup and pictographs from a sentence that is about to be spoken. */
export function sanitizeForSpeech(text) {
  if (!text) return ''
  let out = String(text)
    .replace(CODE_FENCE, ' ')
    .replace(LINK, '$1')
    .replace(EMOJI, '')
    .replace(MARKDOWN_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()
  // A sentence of pure punctuation carries nothing to say.
  if (!/[\p{L}\p{N}]/u.test(out)) out = ''
  return out
}

/**
 * The streaming segmenter used by the pipeline.
 *
 * `firstChunkChars` bounds how long the model may speak before the first audio
 * leaves the box: the reference waits for punctuation, which is fine for a chat
 * UI but blows the 800–1000 ms first-audio budget when the model opens with a
 * long clause.
 */
export class OutputSegmenter {
  constructor({ minLen = 2, maxLen = 100, firstChunkChars = 14 } = {}) {
    this.minLen = minLen
    this.maxLen = maxLen
    this.firstChunkChars = Math.max(8, Math.min(30, firstChunkChars))
    this.buffer = ''
    this.isFirst = true
    this.cleaner = new OutputCleaner()
  }

  reset() {
    this.buffer = ''
    this.isFirst = true
    this.cleaner = new OutputCleaner()
  }

  /**
   * Feed one model delta.
   * @returns {string[]} finished sentences, already cleaned and non-empty
   */
  push(delta) {
    const clean = this.cleaner.push(delta)
    if (!clean) return this.#maybeForceFirst()
    this.buffer += clean
    const out = []
    if (containsSentenceSeparator(clean, this.isFirst)) {
      const { sentences, remaining } = extractSmartSentences(this.buffer, this.minLen, this.maxLen, this.isFirst)
      this.buffer = remaining
      for (const sentence of sentences) {
        const spoken = sanitizeForSpeech(sentence)
        if (!spoken) continue
        out.push(spoken)
        this.isFirst = false
      }
    }
    out.push(...this.#maybeForceFirst())
    return out
  }

  /** End of stream: flush whatever is left as one last sentence. */
  flush() {
    const tail = this.cleaner.flush()
    if (tail) this.buffer += tail
    const spoken = sanitizeForSpeech(this.buffer)
    this.buffer = ''
    this.isFirst = false
    return spoken ? [spoken] : []
  }

  /**
   * First-chunk safety valve. Only applies before the first sentence went out,
   * and only cuts at a character that cannot split a number or a time.
   */
  #maybeForceFirst() {
    if (!this.isFirst) return []
    const chars = Array.from(this.buffer)
    if (chars.length < this.firstChunkChars) return []
    let cut = -1
    for (let index = chars.length - 1; index > 0; index -= 1) {
      const ch = chars[index]
      if (isSpace(ch) || SENTENCE_PAUSE.has(ch) || SENTENCE_END.has(ch)) {
        if (isDigitAdjacentColon(chars, index)) continue
        cut = index
        break
      }
    }
    if (cut <= 0) {
      // No boundary at all (Chinese text has no spaces): hard-cut at the cap,
      // but never inside a run of digits, which would turn "1234" into "12"+"34".
      cut = Math.min(chars.length, this.firstChunkChars) - 1
      let guard = 0
      while (cut + 1 < chars.length && isDigit(chars[cut]) && isDigit(chars[cut + 1]) && guard < 4) {
        cut += 1
        guard += 1
      }
    }
    const head = chars.slice(0, cut + 1).join('')
    const rest = chars.slice(cut + 1).join('')
    const spoken = sanitizeForSpeech(head)
    if (!spoken) return []
    this.buffer = rest
    this.isFirst = false
    return [spoken]
  }
}
