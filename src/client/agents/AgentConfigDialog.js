import { h, useState, useEffect } from '../react.js'
import { t, callApi, VOICES, voiceLabel, voicesForResource, OUTPUT_LANGUAGE_VALUES, toolLabel } from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'

    function AgentConfigDialog({
      agent, tools, memory, memoryDraft,
      onMemoryDraft, onAddMemory, onRemoveMemory, onToggleTool,
      onToggleMemory, onSaved, onClose
    }) {
      const [tab, setTab] = useState('role');
      const tabs = [
        { id: 'role', label: t('tabRole') },
        { id: 'model', label: t('tabModel') },
        { id: 'ext', label: t('tabExt') }
      ];

      const [draftPrompt, setDraftPrompt] = useState(agent.overrides?.systemPrompt ?? '');
      const [draftVoice, setDraftVoice] = useState(agent.overrides?.voice ?? '');
      // 输出语种：空 = 跟随音色（用全局默认，不在这个智能体上覆盖）。
      const [draftLanguage, setDraftLanguage] = useState(agent.overrides?.language ?? '');
      const [saving, setSaving] = useState(false);
      const [draftModel, setDraftModel] = useState(agent.overrides?.model ?? '');
      // 智能体级只覆盖「模型名」：provider / Key / 端点都是全局设置的一部分，这里不再有
      // 「Harness 厂商 + hostProvider」二级下拉（2026-11-07 起主路径改回插件直连）。
      // 音色（= TTS 模型）是智能体级配置，但厂商与资源族来自全局 TTS：拉 /settings 而不是
      // 从 /state 猜（/state 里没有 voice.tts，早先取到 undefined 导致音色列表恒为火山）。
      // 资源族不匹配会回 55000000（有字没声），所以下拉要按资源族过滤。
      const [ttsGlobal, setTtsGlobal] = useState({ provider: 'volc', resourceId: '' });

      useEffect(() => {
        let alive = true;
        callApi('/settings')
          .then((data) => {
            if (!alive) return;
            const globalTts = data?.settings?.voice?.tts || {};
            setTtsGlobal({
              provider: globalTts.provider || 'volc',
              resourceId: globalTts.resourceId || ''
            });
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);

      // 三个页签共用一个保存：一次写入人设、音色、模型，避免"这页改了没保存"的坑。
      const saveAll = async () => {
        setSaving(true);
        try {
          await callApi('/agents/update', {
            method: 'POST',
            body: {
              agentId: agent.id,
              systemPrompt: draftPrompt,
              voice: draftVoice,
              language: draftLanguage,
              model: draftModel
            }
          });
          await onSaved();
        } finally {
          setSaving(false);
        }
      };

      // 第一项「默认音色」= 不覆盖（保存时 voice 传空串，服务端删掉该设备的音色覆盖）。
      const voiceOptions = [{ value: '', label: t('voiceDefault') }].concat(
        voicesForResource(VOICES[ttsGlobal.provider] || [], ttsGlobal.resourceId)
          .map((voice) => ({ value: voice.value, label: voice.label }))
      );
      // 设备已存的音色不在当前厂商/资源族的列表里（典型：全局刚换过 TTS 厂商）时，
      // 仍把当前值放进选项，否则下拉显示「未选择」，看起来像音色丢了；保存也不会丢值。
      if (draftVoice && !voiceOptions.some((option) => option.value === draftVoice)) {
        voiceOptions.push({ value: draftVoice, label: voiceLabel(draftVoice, ttsGlobal.provider) });
      }
      const languageSelect = h(PillSelect, {
        value: draftLanguage,
        ariaLabel: t('outputLanguage'),
        options: [{ value: '', label: t('languageFollow') }].concat(
          OUTPUT_LANGUAGE_VALUES.map((value) => ({ value, label: value }))
        ),
        onChange: setDraftLanguage
      });
      // key 让三个页签各自重建 DOM：否则 React 复用同一个 div，切页签时会带着上一页的
      // scrollTop，看起来像内容「跳了一下」。
      const rolePane = h('div', { key: 'role', className: 'xz-pane' },
        h('div', { className: 'xz-grid' },
          h('div', { className: 'xz-field' },
            h('label', null, t('voice')),
            h(PillSelect, { value: draftVoice, ariaLabel: t('voice'), options: voiceOptions, onChange: setDraftVoice })
          ),
          h('div', { className: 'xz-field' },
            h('label', null, t('outputLanguage')),
            languageSelect
          )
        ),
        h('div', { className: 'xz-field' },
          h('label', null, t('persona')),
          h('textarea', {
            className: 'xz-textarea',
            rows: 8,
            value: draftPrompt,
            placeholder: t('personaPlaceholder'),
            onChange: (e) => setDraftPrompt(e.target.value)
          })
        ),
      );

      const modelPane = h('div', { key: 'model', className: 'xz-pane' },
        // 直连语义：模型名手填（各厂商命名差异太大，不维护二级下拉），留空 = 全局默认。
        // provider / Base URL / API Key 都在「全局设置 → LLM」里，设备上只覆盖模型名。
        h('div', { className: 'xz-field' },
          h('label', null, t('model')),
          h('input', {
            className: 'xz-input',
            value: draftModel,
            placeholder: t('deviceModelPlaceholder'),
            onChange: (e) => setDraftModel(e.target.value)
          })
        ),
        h('div', { className: 'xz-row', style: { justifyContent: 'space-between', marginTop: 6 } },
          h('span', { className: 'xz-devcard-label' }, t('memory')),
          h('button', {
            type: 'button',
            className: `xz-switch ${agent.memoryEnabled === false ? '' : 'on'}`,
            role: 'switch',
            'aria-checked': agent.memoryEnabled === false ? 'false' : 'true',
            'aria-label': t('memory'),
            onClick: onToggleMemory
          }, h('span', null))
        ),
        memory.length === 0
          ? null
          : h('div', { className: 'xz-memory-list' },
              memory.map((item, index) =>
                h('div', { key: index, className: 'xz-memory-item' },
                  h('span', null, item.key ? `${item.key}: ${item.value}` : item.value),
                  h('button', { type: 'button', className: 'xz-btn danger', onClick: () => onRemoveMemory(index) }, t('remove'))
                )
              )
            ),
        h('div', { className: 'xz-row', style: { gap: 6 } },
          h('input', { className: 'xz-input', value: memoryDraft, placeholder: t('memoryPlaceholder'), onChange: (e) => onMemoryDraft(e.target.value) }),
          h('button', { className: 'xz-btn', onClick: onAddMemory }, t('add'))
        )
      );

      const extPane = h('div', { key: 'ext', className: 'xz-pane' },
        tools.length === 0
          ? h('div', { className: 'xz-hint' }, t('loading'))
          : h('div', { className: 'xz-capability-grid' },
              tools.map((tool) =>
                h('div', { key: tool.name, className: `xz-capability ${tool.enabled === false ? 'is-off' : 'is-on'}` },
                  h('span', { className: 'xz-capability-name' }, toolLabel(tool.name)),
                  h('button', {
                    type: 'button',
                    className: `xz-switch ${tool.enabled === false ? '' : 'on'}`,
                    role: 'switch',
                    'aria-checked': tool.enabled === false ? 'false' : 'true',
                    'aria-label': toolLabel(tool.name),
                    onClick: () => onToggleTool(tool)
                  }, h('span', null))
                )
              )
            )
      );

      // 配置表单改成**弹窗**（2026-11-07）：内联展开会把下面的设备卡片整体推下去，
      // 打开下拉时还会带着页面滚动位置一起变；浮层不参与设备列表布局。
      return h('div', { className: 'xz-modal-mask', onClick: onClose },
        h('div', {
          className: 'xz-modal xz-config-modal',
          role: 'dialog',
          'aria-modal': 'true',
          onClick: (event) => event.stopPropagation()
        },
          h('div', { className: 'xz-config-modal-head' },
            h('div', { className: 'xz-row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
              h('div', null,
                h('h3', null, `${agent.name || t('unnamed')} · ${t('configure')}`),
                h('p', null, t('deviceConfigHint'))
              ),
              h('button', { type: 'button', className: 'xz-btn', 'aria-label': t('close'), onClick: onClose }, '×')
            )
          ),
          h('div', { className: 'xz-config-modal-body' },
            h('div', { className: 'xz-tabs' },
              tabs.map((item) =>
                h('button', { key: item.id, type: 'button', className: `xz-tab ${tab === item.id ? 'active' : ''}`, onClick: () => setTab(item.id) }, item.label)
              )
            ),
            tab === 'role' ? rolePane : tab === 'model' ? modelPane : extPane
          ),
          h('div', { className: 'xz-config-modal-foot' },
            h('button', { className: 'xz-btn', onClick: onClose }, t('close')),
            h('button', { className: 'xz-btn primary', disabled: saving, onClick: saveAll }, saving ? '…' : t('save'))
          )
        )
      );
    }
export { AgentConfigDialog }
