import { h, useEffect, useState } from '../react.js'
import { t, stageProviderLabel, stageDescriptor, backupKeyState, backupSummaryText, backupTestText } from '../core.js'

/**
 * 一段能力的服务商管理区（主用 + 备用）。
 *
 * 2026-11-09 改版（用户反馈「按钮到处都是、整体很别扭」）：
 *
 * 1. **主用卡**：标题一行就够了——厂商名 + 「主用」徽标 + 状态点，右侧只放 `[编辑][测试识别]`；
 *    不再把按钮单独占一行压在左下角。
 * 2. **备用行**：单行三段式 —— `序号 + 厂商名 + 状态点` / `摘要` / 右侧 `[编辑][⋯]`。
 *    摘要为空（例如本地 SenseVoice 没有资源 ID）时**整段不渲染**，不再出现「ASR 地址: —」这种噪音。
 * 3. **⋯ 菜单**：从「在行内展开一排按钮」改成**贴着按钮的浮层菜单**（`position:fixed`、右侧对齐）。
 *    行内展开会把整行撑高、下面的行跟着跳，看起来最乱；浮层不参与布局，点空白 / Esc 关闭。
 *
 * 组件只负责展示与回调；状态（settings / dirty / 测试结果 / 删除确认）仍集中在 ConfigWizard。
 */
function ProviderSection({
  stage, primary, entries, providersDirty, primaryTest, testingPrimary,
  testResults, testingId, confirmDelete,
  onEditPrimary, onAdd, onEdit, onMove, onDelete, onTest, onTestPrimary, onPromote,
  // 2026-11-14：全局 TTS 改成「服务商池」——只添加/编辑/删除，不再分主用/备用、不排顺序；
  // 用哪家由「智能体 → 配置 → 角色」选，其余按本列表顺序自动降级。
  pool = false,
}) {
  // 浮层菜单：{ index, top, right }。关闭时 null。
  const [menu, setMenu] = useState(null)
  const primaryKey = backupKeyState(stage, primary)
  const primaryTesting = testingPrimary === stage
  // 能不能在线测试由描述符的 probe 决定（kind=none 不显示；ASR 用 kind=asr + 自己的按钮文案）。
  const primaryProbe = stageDescriptor(primary.provider, stage)?.probe || { kind: 'none' }
  const primaryTestDisabled = primaryProbe.kind === 'none' || primaryTesting
  const testLabel = providersDirty
    ? t('saveAndTest')
    : (primaryProbe.labelKey ? t(primaryProbe.labelKey) : t('backupTest'))
  // 摘要行只在「该段有意义上的摘要」时才出现，**标签跟着描述符的 summary 字段走**：
  // 火山 ASR 摘要是 resourceId（资源 ID），百智云/本地摘要是 language（识别语种），
  // LLM 是 model（模型），TTS 全局条目只有凭据、没有摘要。
  const summaryLabelOf = (entry) => {
    const field = (stageDescriptor(entry?.provider, stage)?.summary || [])[0]
    if (field === 'model') return t('model')
    if (field === 'resourceId') return t('resourceId')
    if (field === 'language') return t('asrLanguage')
    if (field === 'url') return t('asrUrl')
    return ''
  }
  const summaryOf = (entry) => {
    const label = summaryLabelOf(entry)
    const value = label ? backupSummaryText(stage, entry) : ''
    return label && value && value !== '—' ? { label, value } : null
  }
  const fact = (key, value) => h('div', { className: 'xz-backup-fact' },
    h('span', { className: 'k' }, key),
    h('span', { className: 'v', title: value }, value)
  )

  useEffect(() => {
    if (!menu) return undefined
    const onPointerDown = (event) => {
      // 点菜单内部或那个 ⋯ 按钮本身都不关（按钮的 onClick 自己会 toggle）。
      if (event.target?.closest?.('.xz-provider-row-menu, .xz-provider-more')) return
      setMenu(null)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menu])

  /** 点 ⋯：贴着按钮下沿打开，向右对齐（列表靠弹窗右边缘，这样不会溢出）。 */
  const toggleMenu = (event, index) => {
    if (menu && menu.index === index) {
      setMenu(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({
      index,
      top: Math.round(rect.bottom + 6),
      right: Math.max(8, Math.round(window.innerWidth - rect.right)),
    })
  }

  const menuItem = (label, onClick, { disabled = false, danger = false, confirm = false, title = '' } = {}) =>
    h('button', {
      type: 'button',
      role: 'menuitem',
      disabled: disabled || undefined,
      title: title || undefined,
      className: `xz-provider-menu-item${danger ? ' is-danger' : ''}${confirm ? ' confirm' : ''}`,
      onClick: disabled ? undefined : onClick,
    }, label)

  const openEntry = menu ? entries[menu.index] : null
  const openKey = openEntry ? (openEntry.id || `draft-${menu.index}`) : ''
  const openProbe = openEntry ? (stageDescriptor(openEntry.provider, stage)?.probe || { kind: 'none' }) : null

  // ---------------------------------------------------------------- 服务商池（TTS）
  // 每行都是平等的「一家服务商」：没有主用/备用徽标、没有序号、没有上移/下移/设为主用。
  // 行序仍决定降级顺序（智能体没选时用第一家），但那是列表的自然顺序，不是需要用户维护的排序。
  if (pool) {
    // 第一行 = 主用位（智能体没选时的默认），其余是普通条目；主用位没配置过时不渲染空行。
    // 回调统一换算成「服务端扁平列表下标」（0 = 主用位，1.. = 备用），与 remove() 对齐。
    const hasPrimary = Boolean(primary?.provider)
    const rows = [
      ...(hasPrimary ? [{ ...primary, __poolPrimary: true }] : []),
      ...entries,
    ]
    const entriesIndex = (index) => index - (hasPrimary ? 1 : 0)
    const serverIndex = (index) => (hasPrimary ? index : index + 1)
    const isPrimaryRow = (index) => hasPrimary && index === 0
    // 首字徽标：沿用智能体卡片的语言（一块浅色圆角方块 + 首字），比纯文字行更有层次。
    const avatarOf = (provider) => {
      const label = stageProviderLabel(stage, provider || '').trim()
      return (label[0] || '?').toUpperCase()
    }
    return h('div', { className: 'xz-backup-section xz-provider-pool' },
      h('p', { className: 'xz-pool-hint' }, t('ttsPoolHint')),
      h('div', { className: 'xz-pool-list' },
        rows.length === 0
          ? h('p', { className: 'xz-pool-empty' }, t('ttsPoolEmpty'))
          : rows.map((entry, index) => {
              const rowKey = isPrimaryRow(index) ? 'pool-primary' : (entry.id || `pool-draft-${index}`)
              const keyState = backupKeyState(stage, entry)
              const probe = stageDescriptor(entry.provider, stage)?.probe || { kind: 'none' }
              const result = isPrimaryRow(index) ? primaryTest : (entry.id ? testResults[entry.id] : null)
              const isTesting = isPrimaryRow(index) ? primaryTesting : isTestingId(entry.id, testingId)
              const testLabel = providersDirty
                ? t('saveAndTest')
                : (probe.labelKey ? t(probe.labelKey) : t('backupTest'))
              const confirm = confirmDelete === rowKey
              // 掩码前面补「密钥」二字；「无需密钥 / 未配置」这类状态原样显示，不然会读成「密钥 无需密钥」。
              const keyText = keyState.text.includes('•') ? `${t('backupSecret')} ${keyState.text}` : keyState.text
              return h('div', { key: rowKey, className: 'xz-pool-row' },
                h('span', { className: 'xz-pool-avatar', 'aria-hidden': 'true' }, avatarOf(entry.provider)),
                h('div', { className: 'xz-pool-title' },
                  h('div', { className: 'xz-pool-name' },
                    h('strong', null, stageProviderLabel(stage, entry.provider || '')),
                    h('span', { className: `xz-dot ${keyState.ok ? 'on' : ''}`, title: keyState.text }),
                    providersDirty && isPrimaryRow(index) ? h('span', { className: 'xz-chip mute' }, t('backupDraft')) : null
                  ),
                  h('div', { className: 'xz-pool-meta' },
                    h('span', { className: 'xz-pool-key', title: keyState.text }, keyText),
                    result
                      ? h('span', { className: 'xz-pool-meta-sep', 'aria-hidden': 'true' })
                      : null,
                    result ? h('span', { className: 'xz-pool-test' }, backupTestText(stage, result)) : null
                  )
                ),
                h('div', { className: 'xz-pool-actions' },
                  h('button', {
                    type: 'button',
                    className: 'xz-pool-link',
                    onClick: () => (isPrimaryRow(index) ? onEditPrimary() : onEdit(entriesIndex(index))),
                  }, t('backupEdit')),
                  probe.kind === 'none' ? null : h('button', {
                    type: 'button',
                    className: 'xz-pool-link',
                    disabled: isTesting,
                    onClick: () => (isPrimaryRow(index) ? onTestPrimary() : onTest(entriesIndex(index))),
                  }, isTesting ? t('backupTesting') : testLabel),
                  h('button', {
                    type: 'button',
                    className: `xz-pool-link danger${confirm ? ' is-confirm' : ''}`,
                    onClick: () => onDelete(serverIndex(index), rowKey),
                  }, confirm ? t('backupDeleteConfirm') : t('remove'))
                )
              )
            })
      ),
      h('button', { type: 'button', className: 'xz-pool-add', onClick: onAdd },
        h('span', { className: 'xz-pool-add-plus', 'aria-hidden': 'true' }, '+'),
        t('providerPoolAdd')
      )
    )
  }

  return h('div', { className: 'xz-backup-section' },
    // ---------------------------------------------------------------- 主用
    h('div', { className: `xz-devcard xz-backup-card xz-primary-card${providersDirty ? ' is-draft' : ''}` },
      h('div', { className: 'xz-devcard-head xz-provider-head' },
        h('span', { className: 'xz-chip primary' }, t('providerPrimary')),
        h('div', { className: 'xz-devcard-title' },
          h('strong', null, stageProviderLabel(stage, primary.provider)),
          providersDirty ? h('span', { className: 'xz-chip mute', style: { marginLeft: 8 } }, t('backupDraft')) : null
        ),
        // 状态 + 操作统一靠右，主用卡不再有第二行按钮。
        h('div', { className: 'xz-provider-head-actions' },
          h('span', { className: `xz-dot ${primaryKey.ok ? 'on' : ''}`, title: primaryKey.text }),
          h('button', { type: 'button', className: 'xz-btn sm', onClick: onEditPrimary }, t('backupEdit')),
          primaryProbe.kind === 'none'
            ? null
            : h('button', {
                type: 'button',
                className: 'xz-btn sm',
                disabled: primaryTestDisabled,
                title: testLabel,
                onClick: onTestPrimary,
              }, primaryTesting ? t('backupTesting') : testLabel)
        )
      ),
      h('div', { className: 'xz-backup-facts' },
        summaryOf(primary) ? fact(summaryOf(primary).label, summaryOf(primary).value) : null,
        fact(t('backupSecret'), primaryKey.text)
      ),
      // 「随时替换」的入口提示：主用/备用不是固定关系，备用行 ⋯ 里一键设为主用。
      entries.length > 0
        ? h('p', { className: 'xz-hint xz-provider-swap-hint' }, t('promoteHint'))
        : null,
      primaryTest ? h('div', { className: 'xz-backup-test' }, backupTestText(stage, primaryTest)) : null
    ),

    // ---------------------------------------------------------------- 备用
    h('div', { className: 'xz-provider-list' },
      entries.length === 0
        ? h('p', { className: 'xz-hint xz-provider-empty' }, t('backupEmpty'))
        : entries.map((entry, index) => {
            const cardKey = entry.id || `draft-${index}`
            const keyState = backupKeyState(stage, entry)
            const result = entry.id ? testResults[entry.id] : null
            const isTesting = Boolean(entry.id) && testingId === entry.id
            const probe = stageDescriptor(entry.provider, stage)?.probe || { kind: 'none' }
            const testDisabled = probe.kind === 'none' || isTesting
            const rowTestLabel = providersDirty
              ? t('saveAndTest')
              : (probe.labelKey ? t(probe.labelKey) : t('backupTest'))
            const summary = summaryOf(entry)
            return h('div', {
              key: cardKey,
              className: `xz-provider-row${entry.id ? '' : ' is-draft'}${menu?.index === index ? ' is-open' : ''}`
            },
              h('div', { className: 'xz-provider-row-main' },
                h('span', { className: 'xz-devcard-ord' }, String(index + 1)),
                h('strong', { className: 'xz-provider-name' }, stageProviderLabel(stage, entry.provider)),
                entry.id ? null : h('span', { className: 'xz-chip mute' }, t('backupDraft')),
                h('span', { className: `xz-dot ${keyState.ok ? 'on' : ''}`, title: keyState.text })
              ),
              h('div', { className: 'xz-provider-row-facts' },
                summary ? h('span', { className: 'xz-provider-fact' },
                  h('span', { className: 'k' }, summary.label),
                  h('span', { className: 'v', title: summary.value }, summary.value)
                ) : null,
                h('span', { className: 'xz-provider-fact' },
                  h('span', { className: 'k' }, t('backupSecret')),
                  h('span', { className: 'v' }, keyState.text)
                ),
                result ? h('span', { className: 'xz-provider-fact test' }, backupTestText(stage, result)) : null
              ),
              h('div', { className: 'xz-provider-row-actions' },
                h('button', { type: 'button', className: 'xz-btn sm', onClick: () => onEdit(index) }, t('backupEdit')),
                h('button', {
                  type: 'button',
                  className: 'xz-btn ghost sm xz-provider-more',
                  'aria-haspopup': 'menu',
                  'aria-expanded': menu?.index === index ? 'true' : 'false',
                  'aria-label': t('backupActions'),
                  title: t('backupActions'),
                  onClick: (event) => toggleMenu(event, index)
                }, '⋯')
              )
            )
          })
    ),

    // ---------------------------------------------------------------- 浮层菜单（不参与行布局）
    openEntry
      ? h('div', {
          className: 'xz-menu xz-provider-row-menu',
          role: 'menu',
          style: { top: `${menu.top}px`, right: `${menu.right}px`, left: 'auto' }
        },
          menuItem(t('promoteToPrimary'), () => { setMenu(null); onPromote(menu.index) },
            { title: t('promoteToPrimaryHint') }),
          menuItem(t('backupMoveUp'), () => { setMenu(null); onMove(menu.index, -1) }, { disabled: menu.index === 0 }),
          menuItem(t('backupMoveDown'), () => { setMenu(null); onMove(menu.index, 1) }, { disabled: menu.index === entries.length - 1 }),
          menuItem(isTestingId(openEntry.id, testingId) ? t('backupTesting') : (providersDirty ? t('saveAndTest') : (openProbe.labelKey ? t(openProbe.labelKey) : t('backupTest'))), () => {
            setMenu(null)
            onTest(menu.index)
          }, { disabled: openProbe.kind === 'none' || isTestingId(openEntry.id, testingId) }),
          menuItem(confirmDelete === openKey ? t('backupDeleteConfirm') : t('remove'), () => {
            // 第一次点击只进入确认态、菜单保持打开；第二次才真的删。
            if (confirmDelete === openKey) setMenu(null)
            onDelete(menu.index, openKey)
          }, { danger: true, confirm: confirmDelete === openKey })
        )
      : null,

    // ---------------------------------------------------------------- 添加
    h('button', { type: 'button', className: 'xz-backup-add-row', onClick: onAdd },
      h('span', { 'aria-hidden': 'true', style: { fontSize: 16, lineHeight: 1 } }, '+'),
      t('backupAdd')
    )
  )
}

/** 该行是否正在测试（简化浮层菜单里的判断，避免在 JSX 里重复写三目）。 */
function isTestingId(id, testingId) {
  return Boolean(id) && testingId === id
}

export { ProviderSection }
