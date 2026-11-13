import { h, useState, useEffect } from '../react.js'
import { t } from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'

/**
 * DSH 厂商选择器（`provider: 'host'` 专用）。
 *
 * 选项来自 Host 的 `ctx.llm.listProviders()`，控制台经 `GET /llm/providers` 拿到；
 * 拿不到（旧服务端 / 宿主没装配 llm）时退回文本框手填 provider id —— 不内置任何厂商名，
 * 否则 DSH 换 profile 后清单就对不上了。
 */
function HostProviderField({ value, onChange, placeholder }) {
  const [options, setOptions] = useState([])

  useEffect(() => {
    let alive = true
    fetch('dsh-xiaozhi-7c3a/llm/providers')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!alive) return
        const list = Array.isArray(data?.providers) ? data.providers : []
        setOptions(list.map((item) => ({ value: item.id, label: item.name || item.id })))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (options.length === 0) {
    return h('input', {
      className: 'xz-input',
      value: value || '',
      placeholder,
      onChange: (event) => onChange(event.target.value)
    })
  }

  // 已保存的值可能已从 DSH 里删掉：补进选项，保证回显而不是显示「未选择」。
  const text = typeof value === 'string' ? value : ''
  const merged = text.trim() && !options.some((option) => option.value === value)
    ? [{ value, label: text }, ...options]
    : options
  return h(PillSelect, {
    value,
    options: merged,
    ariaLabel: t('hostProvider'),
    placeholder,
    onChange
  })
}

export { HostProviderField }
