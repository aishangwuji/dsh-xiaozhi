/**
 * `provider: "host"` 时 `hostProvider` 的校验。
 *
 * 背景（2026-11-07 实测）：控制台选「Harness 厂商」保存的是 DSH 自己的 provider id
 * （如 `opencode-go`）。这个 id 必须与当前 profile 注册的 LLM 适配器一致，否则
 * `ctx.llm.stream()` 在真正发请求之前就抛
 * `no adapter registered for provider "..."`——**不会**有 HTTP 请求，也不会回
 * 503/超时。语音链路里这条错误发生在用户说完第一句话之后：服务端回了 `stt` +
 * 空的 `tts start/stop`，设备于是停在「聆听中」，看上去像模型没回。
 *
 * 这里把「取值是否可用」抽成两处共用：
 *   - 构建 adapter 时（`adapters/index.js`）：无效 → 该候选构建失败，能按 failover
 *     退到备用，且日志说明原因；
 *   - 控制台保存时（`src/control.js`）：无效 → 400 当场拒绝，不写进 settings.json。
 *
 * 没有宿主 llm 服务（桌面单测、或 Harness 未装配 llm）时 `listProviders` 不存在，
 * 无法校验可用集合：只校验「非空」，其余交给构建期/运行期。
 */

/**
 * 当前 Harness 注册的 provider id 列表（同步；拿不到就返回空数组）。
 *
 * @param {{listProviders?: () => unknown}} [llm]
 * @returns {string[]}
 */
export function hostProviderIds(llm) {
  try {
    const list = typeof llm?.listProviders === 'function' ? llm.listProviders() : null
    if (!Array.isArray(list)) return []
    const ids = []
    for (const item of list) {
      const id = typeof item === 'string' ? item : item?.id
      const text = String(id ?? '').trim()
      if (text && !ids.includes(text)) ids.push(text)
    }
    return ids
  } catch {
    // 校验是增强，不是主链路：宿主服务自己抛错时不要让语音构建跟着失败。
    return []
  }
}

/**
 * 判断一个 `hostProvider` 是否可用。
 *
 * @param {unknown} hostProvider 生效配置里的 `voice.llm.hostProvider`
 * @param {{listProviders?: () => unknown}} [llm] Harness 的 llm 服务
 * @returns {string | null} 不可用时返回面向操作者的说明，可用时返回 null
 */
export function hostProviderIssue(hostProvider, llm) {
  const wanted = String(hostProvider ?? '').trim()
  if (!wanted) {
    return 'voice.llm.hostProvider 为空：provider="host" 必须选一个 Harness 厂商（如 opencode-go）'
  }
  const available = hostProviderIds(llm)
  if (available.length > 0 && !available.includes(wanted)) {
    return `voice.llm.hostProvider "${wanted}" 未在当前 DSH profile 注册；可用厂商：${available.join(' / ')}`
  }
  return null
}
