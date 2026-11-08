import { h, useState, useEffect } from '../react.js'
import { t, PROVIDER_CATALOG, stageProviders, stageProviderLabel, providerOptionsFor, blankBackup, stageLabel } from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'
import { ModelField } from './ModelField.js'

    /**
     * 编辑一条服务商配置：主用与备用共用同一个弹窗表单。
     *
     * 先选 provider，再按该 provider 只显示需要的字段（TTS 只剩凭据，音色在智能体级）；
     * 确定只写回本地状态，统一走页面底部「保存配置」。主用模式（mode='primary'）写回
     * 该段的扁平字段，备用模式写回 backups[index]；换厂商会重置整张表并标记
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
      const set = (values) => onDraft({ ...draft, ...values });
      const kept = (value) => typeof value === 'string' && value.includes('•');
      const field = (label, child, note) => h('div', { className: 'xz-field' },
        h('label', null, label),
        child,
        note ? h('span', { className: 'note' }, note) : null
      );
      const secretField = (key, label) => field(label,
        h('input', {
          className: 'xz-input',
          type: 'password',
          autoComplete: 'new-password',
          value: draft[key] || '',
          placeholder: kept(draft[key]) ? '' : t('tokenKeep'),
          onChange: (event) => set({ [key]: event.target.value })
        }),
        kept(draft[key]) || draft.hasApiKey || draft.hasApiSecret ? t('apiKeyKeep') : t('backupKeyHint')
      );
      const appIdField = () => field(t('appId'),
        h('input', {
          className: 'xz-input',
          value: draft.appId || '',
          placeholder: '5f1b…',
          onChange: (event) => set({ appId: event.target.value })
        })
      );

      let fields = [];
      if (stage === 'llm') {
        const meta = PROVIDER_CATALOG.llm[provider] || {};
        fields = [
          field(t('model'), h(ModelField, {
            kind: 'llm',
            provider,
            source: mode === 'primary' ? 'primary' : 'backup',
            index: mode === 'primary' ? undefined : (Number.isInteger(index) ? index : undefined),
            value: draft.model || '',
            // 占位提示不写具体模型 id：模型清单由厂商 /v1/models 提供，选到后面有下拉。
            placeholder: meta.modelHint || t('modelFromApi'),
            baseUrl: draft.baseUrl || meta.baseUrlHint || '',
            probeKey: draft.apiKey || '',
            onChange: (value) => set({ model: value })
          })),
          field(t('baseUrl'), h('input', {
            className: 'xz-input',
            value: draft.baseUrl || '',
            placeholder: meta.baseUrlHint || '',
            onChange: (event) => set({ baseUrl: event.target.value })
          })),
          secretField('apiKey', t('apiKey'))
        ];
      } else if (stage === 'tts') {
        // 全局只配「厂商 + 凭据」：音色（= TTS 模型）在「智能体 → 配置」里按智能体选，
        // 所以这里不再有音色 / model / Resource ID / API URL 字段。
        if (provider === 'xunfei') {
          fields = [
            appIdField(),
            secretField('apiKey', t('apiKey')),
            secretField('apiSecret', t('apiSecret'))
          ];
        } else if (provider === 'volc') {
          fields = [secretField('apiKey', t('apiKey'))];
        } else {
          // Edge：免密钥，没有需要填的凭据（MP3→PCM 由服务端 ffmpeg 处理）。
          fields = [h('div', { className: 'note' }, t('ttsEdgeKeyless'))];
        }
      } else if (provider === 'xunfei') {
        fields = [
          appIdField(),
          secretField('apiKey', t('apiKey')),
          secretField('apiSecret', t('apiSecret')),
          field(t('asrLanguage'), h('input', {
            className: 'xz-input',
            value: draft.language || '',
            placeholder: 'zh_cn',
            onChange: (event) => set({ language: event.target.value })
          }))
        ];
      } else if (provider === 'volc') {
        fields = [
          secretField('apiKey', t('apiKey')),
          field('Resource ID', h(ModelField, {
            kind: 'asrResource',
            provider: 'volc',
            value: draft.resourceId || '',
            placeholder: 'volc.seedasr.sauc.duration',
            onChange: (value) => set({ resourceId: value })
          })),
          field(t('asrUrl'), h('input', {
            className: 'xz-input',
            value: draft.url || '',
            placeholder: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
            onChange: (event) => set({ url: event.target.value })
          }))
        ];
      } else {
        // 本地 SenseVoice：使用 Harness 内置识别服务，不需要地址与密钥。
        fields = [
          field(t('asrLanguage'), h('input', {
            className: 'xz-input',
            value: draft.language || '',
            placeholder: 'zh_cn',
            onChange: (event) => set({ language: event.target.value })
          })),
          h('div', { className: 'note' }, t('localAsrNote'))
        ];
      }

      const switchProvider = (nextProvider) => {
        if (nextProvider === provider) return;
        // 字段是服务商专属的（模型名、音色、资源、地址、密钥都不一样），换厂商就重开一张
        // 空表，并标记 providerChanged（主用保存时据此清掉上一家的旧密钥）。
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
          // 固定高度的表单区：换厂商时字段数量会变（TTS 下 Edge 0 个、火山 1 个、讯飞 3 个，
          // ASR/LLM 更多），这里用 min-height 撑住，弹窗不会再跟着下拉选择忽长忽短。
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
            h('div', { className: 'xz-grid xz-dialog-grid' },
              fields.map((child, index) => h(React.Fragment, { key: index }, child))
            )
          ),
          h('div', { className: 'xz-row xz-modal-foot', style: { justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'xz-btn', onClick: onCancel }, t('cancel')),
            h('button', { type: 'button', className: 'xz-btn primary', onClick: onConfirm }, t('save'))
          )
        )
      );
    }

export { ProviderDialog }
