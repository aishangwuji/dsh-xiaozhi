import { h, useEffect } from '../react.js'
import { t, stageDescriptor, stageProviders, providerOptionsFor, blankBackup, stageLabel } from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'
import { SchemaForm } from './SchemaForm.js'

    /**
     * 编辑一条服务商配置：主用与备用共用同一个弹窗表单。
     *
     * 2026-11-08 起改成**描述符驱动**：字段列表来自 `GET /providers` 里该厂商该段的
     * `fields`，这里不再有 `if (stage === 'llm') … else if (provider === 'xunfei') …`。
     * 加厂商只改 `src/providers.js` + 适配器，前端零改动。
     *
     * 确定只写回本地状态，统一走弹窗底部或页面底部「保存配置」。主用模式（mode='primary'）
     * 写回该段的扁平字段，备用模式写回 backups[index]；换厂商会重置整张表并标记
     * providerChanged（保存时据此清掉上一家的旧密钥，避免旧 Key 跟着条目漂到另一家）。
     */
    function ProviderDialog({ stage, mode = 'backup', index = null, draft, isNew, onDraft, onConfirm, onCancel }) {
      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [onCancel]);

      const provider = draft.provider || stageProviders(stage)[0];
      const desc = stageDescriptor(provider, stage);
      const switchProvider = (nextProvider) => {
        if (nextProvider === provider) return;
        // 字段是服务商专属的（模型名、资源、地址、密钥都不一样），换厂商就重开一张空表，
        // 并标记 providerChanged（主用保存时据此清掉上一家的旧密钥）。
        onDraft({ ...blankBackup(stage, nextProvider), providerChanged: true });
      };

      const title = isNew
        ? `${t('backupAddTitle')} · ${stageLabel(stage)}`
        : mode === 'primary'
          ? `${t('providerEditPrimary')} · ${stageLabel(stage)}`
          : `${t('backupEditTitle')} · ${stageLabel(stage)}`;

      return h('div', { className: 'xz-modal-mask', onClick: onCancel },
        h('div', { className: 'xz-modal xz-modal-lg', onClick: (event) => event.stopPropagation() },
          h('div', { className: 'xz-modal-head' },
            h('h3', null, title)
          ),
          // 固定高度的表单区：换厂商时字段数量会变（Edge 0 个、火山 1 个、讯飞 3 个），
          // 这里用固定外框撑住，弹窗不会再跟着下拉选择忽长忽短。
          h('div', { className: 'xz-modal-body' },
            h('div', { className: 'xz-field' },
              h('label', null, t('provider')),
              h(PillSelect, {
                value: provider,
                ariaLabel: t('provider'),
                options: providerOptionsFor(stage),
                onChange: switchProvider
              })
            ),
            h('p', { className: 'xz-hint', style: { margin: '0 0 10px' } }, t('requiredHint')),
            desc
              ? h(SchemaForm, {
                  stage,
                  provider,
                  mode,
                  index,
                  fields: desc.fields || [],
                  value: draft,
                  onChange: onDraft,
                  baseUrlHint: desc.baseUrlHint || '',
                  modelHint: desc.modelHint || ''
                })
              : h('div', { className: 'xz-empty' }, t('providerUnsupported')),
            desc?.note ? h('div', { className: 'note' }, t(desc.note)) : null
          ),
          h('div', { className: 'xz-row xz-modal-foot', style: { justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'xz-btn', onClick: onCancel }, t('cancel')),
            h('button', { type: 'button', className: 'xz-btn primary', onClick: onConfirm }, t('save'))
          )
        )
      );
    }

export { ProviderDialog }
