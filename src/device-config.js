/**
 * 设备级覆盖 → 生效配置。
 *
 * 一台设备的可改项只有这几个：人设、LLM 模型、TTS 音色/语种/语速、静音阈值。
 * 凭据、厂商地址、总开关永远来自全局设置，设备上改不到。
 *
 * 2026-11-07 修正：以前只要设备 overrides 里带 `hostProvider`，就把 provider 强切成
 * Harness 宿主 LLM（`provider: 'host'`）。这在实机上不成立——线上 voice.log 持续报
 * `llm.error: no adapter registered for provider "deepseek"`，设备只有「聆听中」、
 * 永远收不到回复。现在改用**插件自己的直连服务商**：provider / 凭据 / 端点一律由
 * 全局设置决定，设备只覆盖模型名。历史上存下来的 `hostProvider` 字段保留在
 * devices.json 里但不再参与合并（不回写、不生效），等控制台下次保存时自然清掉。
 */

import { normalizeOutputLanguage } from './voice/language.js'

/**
 * @param {{config: object}} defaults 全局默认（Loader 配置 + 运行时设置）
 * @param {object} overrides 设备记录里的 overrides
 * @param {{hasHostLlm?: boolean}} [options] 保留形参以兼容 index.js 的调用签名；
 *   设备级不再自动切 host，是否走宿主 LLM 只由全局 `voice.llm.provider` 决定。
 */
export function mergeDeviceConfig(defaults, overrides = {}, { hasHostLlm = false } = {}) {
  // 显式 void：参数保留只为不破坏调用方，避免「传了但没生效」被误读成漏改。
  void hasHostLlm
  const base = defaults.config ?? {}
  const patch = overrides ?? {}
  return {
    ...defaults,
    config: {
      ...base,
      systemPrompt: patch.systemPrompt || base.systemPrompt,
      llm: {
        ...base.llm,
        // 只改模型名：provider 仍是全局选定的直连厂商（deepseek / mimo / …），
        // 因此设备上填的模型必须与那把 Key 对应的厂商匹配，不再有「自动切 host」兜底。
        ...(patch.model ? { model: patch.model } : {}),
      },
      tts: {
        ...base.tts,
        ...(patch.voice ? { voice: patch.voice } : {}),
        ...(patch.language ? { language: normalizeOutputLanguage(patch.language) } : {}),
        ...(patch.speed != null ? { speed: patch.speed } : {}),
      },
      turn: { ...base.turn, ...(patch.silenceMs != null ? { silenceMs: patch.silenceMs } : {}) },
    },
  }
}
