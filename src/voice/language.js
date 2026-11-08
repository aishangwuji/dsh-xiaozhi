/**
 * 输出语种（模型说什么话），与 ASR 的「识别语言」是两件事。
 *
 * 对应官方 Java 分支的两处实现：
 *   1. `agent-base-prompt.txt` 的 `<output_language_directive>`：把语种写进系统
 *      提示词，强制模型用该语种回答（官方的主路径，TTS 只负责读出来）；
 *   2. `ConfigServiceImpl` 把 `agent.tts_language`（默认取音色语种的第一项）
 *      写进 TTS 的 `language`，供需要显式语种的厂商使用。
 *
 * 这里只保留固定白名单：语种值会被拼进系统提示词，外部输入不能自由发挥。
 */

/** 与官方控制台的「交互语种」取值保持一致；空串 = 不干预，跟随音色。 */
export const OUTPUT_LANGUAGES = [
  { value: '', label: '跟随音色', code: '' },
  { value: '普通话', label: '普通话', code: 'zh' },
  { value: '英语', label: '英语', code: 'en' },
  { value: '日语', label: '日语', code: 'ja' },
  { value: '粤语', label: '粤语', code: '' },
  { value: '韩语', label: '韩语', code: 'ko' },
]

const BY_VALUE = new Map(OUTPUT_LANGUAGES.map((item) => [item.value, item]))

/** 只认白名单内的值，其余一律当“不干预”，避免任何字符串被拼进提示词。 */
export function normalizeOutputLanguage(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return BY_VALUE.has(trimmed) ? trimmed : ''
}

/** 豆包 `explicit_language` 用的语种码；返回空串表示不传该参数。 */
export function outputLanguageCode(value) {
  return BY_VALUE.get(normalizeOutputLanguage(value))?.code ?? ''
}

/**
 * 官方音色表的 `languages` 写法并不统一（「中文」「普通话、英语」「中文-四川口音」…），
 * 所以按关键词匹配而不是精确相等。音色没标语种时返回 true：未知不等于不支持。
 */
export function voiceSupportsLanguage(languages, value) {
  const language = normalizeOutputLanguage(value)
  if (!language) return true
  const raw = String(languages ?? '').trim()
  if (!raw) return true
  if (language === '普通话') return /中文|普通话|国语/.test(raw)
  if (language === '英语') return /英语|英文/.test(raw)
  if (language === '粤语') return /粤语|广东话/.test(raw)
  return raw.includes(language)
}

/**
 * 拼在系统提示词末尾的语种指令。带 `<output_language_directive>` 标签是为了和
 * 官方模板同形，便于以后整段替换官方版本。
 */
export function languageDirective(value) {
  const language = normalizeOutputLanguage(value)
  if (!language) return ''
  return [
    '<output_language_directive>',
    `输出语种：${language}。`,
    `1. 无论用户说什么语言，你都必须用${language}回答。`,
    `2. 用户说其他语言时，先在心里翻译成${language}再作答，不要跟着用户换语种。`,
    `3. 只有用户明确要求换语种（例如“请说中文”）时才切换。`,
    `4. 问候、确认、回答、追问、调用工具后的回复，全部使用${language}。`,
    '</output_language_directive>',
  ].join('\n')
}

/** 把语种指令叠到人设之后；没选语种时原样返回。 */
export function withOutputLanguage(prompt, value) {
  const directive = languageDirective(value)
  const base = String(prompt ?? '')
  if (!directive) return base
  return `${base}\n${directive}`
}
