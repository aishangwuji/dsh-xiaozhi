import { h } from '../react.js'
import { t } from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'
import { ModelField } from './ModelField.js'

/**
 * 描述符驱动的表单：字段列表来自 `GET /providers` 的 `fields`，这里只负责把
 * `type` 映射到具体控件。加一个新厂商只要描述符里写字段，**不要在这里加 provider 分支**。
 *
 * 字段类型注册表（未知 type 降级为 text，保证后端先发描述符、前端后升级不会白屏）：
 *   text / url / secret / number / checkbox / select / model
 *
 * `model` 类型复用 ModelField：LLM 模型清单从厂商 `/v1/models` 拉，ASR 的 Resource ID
 * 走 `kind: 'asrResource'`（同样是后端动态枚举）。`showWhen` 支持同表单字段的条件显示。
 */

const isMasked = (value) => typeof value === 'string' && value.includes('•')

const FIELD_RENDERERS = {
  text: (field, value, onChange) => h('input', {
    className: 'xz-input',
    value: value ?? '',
    placeholder: field.placeholder || '',
    onChange: (event) => onChange(event.target.value)
  }),
  url: (field, value, onChange) => h('input', {
    className: 'xz-input',
    type: 'url',
    value: value ?? '',
    placeholder: field.placeholder || '',
    onChange: (event) => onChange(event.target.value)
  }),
  number: (field, value, onChange) => h('input', {
    className: 'xz-input',
    type: 'number',
    min: field.min,
    max: field.max,
    step: field.step,
    value: value ?? '',
    onChange: (event) => onChange(event.target.value)
  }),
  checkbox: (field, value, onChange) => h('input', {
    type: 'checkbox',
    checked: Boolean(value),
    onChange: (event) => onChange(event.target.checked)
  }),
  secret: (field, value, onChange) => h('input', {
    className: 'xz-input',
    type: 'password',
    autoComplete: 'new-password',
    value: value || '',
    // 掩码是占位符不是密钥：回显时清空输入框，提示「留空 = 保留」。
    placeholder: isMasked(value) ? '' : t('tokenKeep'),
    onChange: (event) => onChange(event.target.value)
  }),
  select: (field, value, onChange) => h(PillSelect, {
    value: value ?? '',
    options: field.options || [],
    ariaLabel: t(field.label),
    onChange
  }),
  model: (field, value, onChange, context) => h(ModelField, {
    kind: field.modelKind || 'llm',
    provider: context.provider,
    source: context.mode === 'primary' ? 'primary' : 'backup',
    index: context.mode === 'primary' ? undefined : (Number.isInteger(context.index) ? context.index : undefined),
    value: value || '',
    // 空值时给一个厂商常见的模型名做占位（描述符的 modelHint），比「未选择」有信息量；
    // 真正选过/存过的值由 ModelField 自己回显，不靠占位。
    placeholder: field.placeholderKey ? (context.modelHint || t(field.placeholderKey)) : (field.placeholder || ''),
    baseUrl: context.draft.baseUrl || context.baseUrlHint || '',
    probeKey: context.draft.apiKey || '',
    onChange
  })
}

/** 一个 secret 字段的说明文字：掩码 / 已保存 → 「留空 = 保留」；新填 → 「只保存在本机」。 */
function secretNote(field, draft) {
  if (field.note) return t(field.note)
  if (isMasked(draft[field.key]) || draft.hasApiKey || draft.hasApiSecret) return t('apiKeyKeep')
  return t('backupKeyHint')
}

function SchemaForm({ stage, provider, mode, index, fields, value, onChange, baseUrlHint, modelHint }) {
  const context = { stage, provider, mode, index, draft: value, baseUrlHint, modelHint }
  return h('div', { className: 'xz-grid xz-dialog-grid' },
    (fields || []).map((field, position) => {
      if (field.showWhen && value[field.showWhen.key] !== field.showWhen.equals) return null
      // 主用专属字段（如火山 AK/SK 只用于全局拉音色）不出现在备用条目编辑里。
      if (field.primaryOnly && context.mode !== 'primary') return null
      const render = FIELD_RENDERERS[field.type] || FIELD_RENDERERS.text
      const note = field.type === 'secret' ? secretNote(field, value) : (field.note ? t(field.note) : '')
      return h('div', { key: field.key || `field-${position}`, className: 'xz-field' },
        h('label', null, t(field.label)),
        render(field, value[field.key], (next) => onChange({ ...value, [field.key]: next }), context),
        note ? h('span', { className: 'note' }, note) : null
      )
    })
  )
}

export { SchemaForm }
