import { h, useState } from '../react.js'
import { t, stageProviderLabel, stageDescriptor, backupKeyState, backupSummaryText, backupTestText } from '../core.js'

/**
 * 一段能力的服务商管理区（主用 + 备用）。
 *
 * 2026-11-08 改版：从「主用卡 + 备用卡 grid + 5 个常驻按钮」改成
 * 「主用卡（一整行）+ 备用纵向列表 + 行内 ⋯ 操作区 + 底部一行添加」。
 * 这个组件只负责展示和回调，状态（settings / dirty / 测试结果 / 删除确认）仍集中在
 * ConfigWizard；它被放进 stage 弹窗里，弹窗只多一层外壳。
 */
function ProviderSection({
  stage, primary, entries, providersDirty, primaryTest, testingPrimary,
  testResults, testingId, confirmDelete,
  onEditPrimary, onAdd, onEdit, onMove, onDelete, onTest, onTestPrimary
}) {
  const [openRow, setOpenRow] = useState(null)
  const primaryKey = backupKeyState(stage, primary)
  const primaryTesting = testingPrimary === stage
  // 能不能在线测试由描述符的 probe.kind 决定（ASR = none），不在前端写 `stage === 'asr'`。
  const primaryProbe = stageDescriptor(primary.provider, stage)?.probe?.kind || 'none'
  const primaryTestDisabled = primaryProbe === 'none' || primaryTesting
  const testLabel = providersDirty ? t('saveAndTest') : t('backupTest')
  // TTS 全局只配厂商 + 凭据（厂商已在卡片标题），所以没有摘要行。
  const summaryKey = stage === 'llm' ? t('model') : stage === 'asr' ? t('asrUrl') : ''
  const fact = (key, value) => h('div', { className: 'xz-backup-fact' },
    h('span', { className: 'k' }, key),
    h('span', { className: 'v', title: value }, value)
  )

  return h('div', { className: 'xz-backup-section' },
    // ---------------------------------------------------------------- 主用：独占一行
    h('div', { className: `xz-devcard xz-backup-card xz-primary-card${providersDirty ? ' is-draft' : ''}` },
      h('div', { className: 'xz-devcard-head' },
        h('span', { className: 'xz-chip primary' }, t('providerPrimary')),
        h('div', { className: 'xz-devcard-title' },
          h('strong', null, stageProviderLabel(stage, primary.provider)),
          providersDirty ? h('span', { className: 'xz-chip mute', style: { marginLeft: 8 } }, t('backupDraft')) : null
        ),
        h('span', { className: `xz-dot ${primaryKey.ok ? 'on' : ''}` })
      ),
      h('div', { className: 'xz-backup-facts' },
        summaryKey ? fact(summaryKey, backupSummaryText(stage, primary)) : null,
        fact(t('backupSecret'), primaryKey.text)
      ),
      primaryTest ? h('div', { className: 'xz-backup-test' }, backupTestText(stage, primaryTest)) : null,
      h('div', { className: 'xz-backup-actions' },
        h('button', { type: 'button', className: 'xz-btn', onClick: onEditPrimary }, t('backupEdit')),
        primaryProbe === 'none'
          ? null
          : h('button', {
              type: 'button',
              className: 'xz-btn',
              disabled: primaryTestDisabled,
              title: testLabel,
              onClick: onTestPrimary
            }, primaryTesting ? t('backupTesting') : testLabel)
      )
    ),

    // ---------------------------------------------------------------- 备用：纵向列表
    h('div', { className: 'xz-provider-list' },
      entries.length === 0
        ? h('p', { className: 'xz-hint xz-provider-empty' }, t('backupEmpty'))
        : entries.map((entry, index) => {
            const cardKey = entry.id || `draft-${index}`
            const keyState = backupKeyState(stage, entry)
            const result = entry.id ? testResults[entry.id] : null
            const isTesting = Boolean(entry.id) && testingId === entry.id
            const expanded = openRow === index
            const probeKind = stageDescriptor(entry.provider, stage)?.probe?.kind || 'none'
            const testDisabled = probeKind === 'none' || isTesting
            const testTitle = probeKind === 'none' ? t('probeUnsupported') : testLabel
            const rowFacts = [
              summaryKey ? `${summaryKey}: ${backupSummaryText(stage, entry)}` : null,
              `${t('backupSecret')}: ${keyState.text}`,
              result ? backupTestText(stage, result) : null
            ].filter(Boolean)
            return h('div', {
              key: cardKey,
              className: `xz-provider-row${entry.id ? '' : ' is-draft'}${expanded ? ' is-open' : ''}`
            },
              h('div', { className: 'xz-provider-row-main' },
                h('div', { className: 'xz-provider-row-title' },
                  h('span', { className: 'xz-devcard-ord' }, String(index + 1)),
                  h('strong', null, stageProviderLabel(stage, entry.provider)),
                  entry.id ? null : h('span', { className: 'xz-chip mute' }, t('backupDraft')),
                  h('span', { className: `xz-dot ${keyState.ok ? 'on' : ''}` })
                ),
                h('div', { className: 'xz-provider-row-facts' },
                  rowFacts.map((text, position) => h('span', { key: position }, text))
                )
              ),
              h('div', { className: 'xz-provider-row-actions' },
                h('button', { type: 'button', className: 'xz-btn', onClick: () => onEdit(index) }, t('backupEdit')),
                h('button', {
                  type: 'button',
                  className: 'xz-btn ghost xz-provider-more',
                  'aria-expanded': expanded ? 'true' : 'false',
                  'aria-label': t('backupActions'),
                  title: t('backupActions'),
                  onClick: () => setOpenRow(expanded ? null : index)
                }, '⋯')
              ),
              expanded
                ? h('div', { className: 'xz-provider-row-menu' },
                    h('button', {
                      type: 'button', className: 'xz-btn',
                      disabled: index === 0,
                      onClick: () => { setOpenRow(null); onMove(index, -1) }
                    }, t('backupMoveUp')),
                    h('button', {
                      type: 'button', className: 'xz-btn',
                      disabled: index === entries.length - 1,
                      onClick: () => { setOpenRow(null); onMove(index, 1) }
                    }, t('backupMoveDown')),
                    h('button', {
                      type: 'button', className: 'xz-btn',
                      disabled: testDisabled,
                      title: testTitle,
                      onClick: () => { setOpenRow(null); onTest(index) }
                    }, isTesting ? t('backupTesting') : testLabel),
                    h('button', {
                      type: 'button',
                      className: `xz-btn danger${confirmDelete === cardKey ? ' confirm' : ''}`,
                      onClick: () => {
                        // 第一次点击只进入确认态，菜单保持展开；第二次才真的删。
                        if (confirmDelete === cardKey) setOpenRow(null)
                        onDelete(index, cardKey)
                      }
                    }, confirmDelete === cardKey ? t('backupDeleteConfirm') : t('remove'))
                  )
                : null
            )
          })
    ),

    // ---------------------------------------------------------------- 添加：列表底部一整行
    h('button', { type: 'button', className: 'xz-backup-add-row', onClick: onAdd },
      h('span', { 'aria-hidden': 'true', style: { fontSize: 16, lineHeight: 1 } }, '+'),
      t('backupAdd')
    )
  )
}

export { ProviderSection }
