import { h } from '../react.js'
import { t, stageProviderLabel, backupKeyState, backupSummaryText, backupTestText } from '../core.js'

    /**
     * 一段能力的服务商卡片区：最上面一张「主用」卡，下面按优先级排列备用卡，
     * 末尾是「+ 添加备用服务商」。
     *
     * 主用与备用用同一种卡片、同一个编辑弹窗——不再出现「上面一个 provider 下拉、
     * 下面又一个添加服务商」的两套入口。主用卡固定第一优先级、不可删除/移位；
     * 备用卡可编辑/上移/下移/删除。
     */
    function ProviderSection({
      stage, primary, entries, providersDirty, primaryTest, testingPrimary,
      testResults, testingId, confirmDelete,
      onEditPrimary, onAdd, onEdit, onMove, onDelete, onTest, onTestPrimary
    }) {
      const primaryKey = backupKeyState(stage, primary);
      const primaryTesting = testingPrimary === stage;
      const primaryTestDisabled = stage === 'asr' || primaryTesting || providersDirty;
      const primaryTestTitle = stage === 'asr'
        ? t('asrTestUnsupported')
        : providersDirty
          ? t('backupSaveFirst')
          : t('backupTest');
      // TTS 全局只配厂商 + 凭据（厂商已在卡片标题），所以没有摘要行。
      const summaryKey = stage === 'llm' ? t('model') : stage === 'asr' ? t('asrUrl') : '';
      return h('div', { className: 'xz-backup-section' },
        // 标题右侧不再挂「备用 N 个」提示：数量在卡片区里一眼能数，头部只留标题。
        h('div', { className: 'xz-row', style: { marginBottom: 10 } },
          h('h3', { style: { margin: 0 } }, t('providerSectionTitle'))
        ),
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
            summaryKey
              ? h('div', { className: 'xz-backup-fact' },
                  h('span', { className: 'k' }, summaryKey),
                  h('span', { className: 'v', title: backupSummaryText(stage, primary) }, backupSummaryText(stage, primary))
                )
              : null,
            h('div', { className: 'xz-backup-fact' },
              h('span', { className: 'k' }, t('backupSecret')),
              h('span', { className: 'v' }, primaryKey.text)
            )
          ),
          primaryTest ? h('div', { className: 'xz-backup-test' }, backupTestText(stage, primaryTest)) : null,
          h('div', { className: 'xz-backup-actions' },
            h('button', { type: 'button', className: 'xz-btn', onClick: onEditPrimary }, t('backupEdit')),
            stage === 'asr'
              ? null
              : h('button', {
                  type: 'button',
                  className: 'xz-btn',
                  disabled: primaryTestDisabled,
                  title: primaryTestTitle,
                  onClick: onTestPrimary
                }, primaryTesting ? t('backupTesting') : t('backupTest'))
          )
        ),
        h('div', { className: 'xz-card-grid xz-backup-grid' },
          entries.map((entry, index) => {
            const cardKey = entry.id || `draft-${index}`;
            const keyState = backupKeyState(stage, entry);
            const result = entry.id ? testResults[entry.id] : null;
            const isTesting = Boolean(entry.id) && testingId === entry.id;
            // ASR 没有在线测试；未保存（或本地改过顺序/内容）时也只提示「先保存再测试」，
            // 原因见 ConfigWizard 里 runBackupTest 的注释（index 是服务端顺序）。
            const testDisabled = stage === 'asr' || isTesting;
            const testTitle = stage === 'asr'
              ? t('asrTestUnsupported')
              : !entry.id || providersDirty
                ? t('backupSaveFirst')
                : t('backupTest');
            return h('div', {
              key: cardKey,
              className: `xz-devcard xz-backup-card${entry.id ? '' : ' is-draft'}`
            },
              h('div', { className: 'xz-devcard-head' },
                h('div', {
                  className: 'xz-devcard-ord',
                  title: t('backupSeq').replace('{n}', String(index + 1))
                }, String(index + 1)),
                h('div', { className: 'xz-devcard-title' },
                  h('strong', null, stageProviderLabel(stage, entry.provider)),
                  entry.id ? null : h('span', { className: 'xz-chip mute', style: { marginLeft: 8 } }, t('backupDraft'))
                ),
                h('span', { className: `xz-dot ${keyState.ok ? 'on' : ''}` })
              ),
              h('div', { className: 'xz-backup-facts' },
                summaryKey
                  ? h('div', { className: 'xz-backup-fact' },
                      h('span', { className: 'k' }, summaryKey),
                      h('span', { className: 'v', title: backupSummaryText(stage, entry) }, backupSummaryText(stage, entry))
                    )
                  : null,
                h('div', { className: 'xz-backup-fact' },
                  h('span', { className: 'k' }, t('backupSecret')),
                  h('span', { className: 'v' }, keyState.text)
                )
              ),
              result ? h('div', { className: 'xz-backup-test' }, backupTestText(stage, result)) : null,
              h('div', { className: 'xz-backup-actions' },
                h('button', { type: 'button', className: 'xz-btn', onClick: () => onEdit(index) }, t('backupEdit')),
                h('button', {
                  type: 'button',
                  className: 'xz-btn',
                  disabled: index === 0,
                  onClick: () => onMove(index, -1)
                }, t('backupMoveUp')),
                h('button', {
                  type: 'button',
                  className: 'xz-btn',
                  disabled: index === entries.length - 1,
                  onClick: () => onMove(index, 1)
                }, t('backupMoveDown')),
                h('button', {
                  type: 'button',
                  className: 'xz-btn',
                  disabled: testDisabled,
                  title: testTitle,
                  onClick: () => onTest(index)
                }, isTesting ? t('backupTesting') : t('backupTest')),
                h('button', {
                  type: 'button',
                  className: `xz-btn danger${confirmDelete === cardKey ? ' confirm' : ''}`,
                  onClick: () => onDelete(index, cardKey)
                }, confirmDelete === cardKey ? t('backupDeleteConfirm') : t('remove'))
              )
            );
          }),
          h('button', {
            type: 'button',
            className: 'xz-backup-add',
            title: t('backupAdd'),
            onClick: onAdd
          }, h('span', { 'aria-hidden': 'true', style: { fontSize: 16, lineHeight: 1 } }, '+'), t('backupAdd'))
        )
      );
    }

export { ProviderSection }
