import { h, useState, useEffect } from '../react.js'
import {
  t, callApi, VOICES, voiceLabel, voicesForResource, OUTPUT_LANGUAGE_VALUES, toolLabel,
  stageProviderLabel
} from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'
import { ROLE_PRESETS, rolePresetPrompt, matchRolePreset } from './rolePresets.js'

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
      // 智能体级 TTS 服务商（2026-11-14）：空 = 跟随全局主用；否则从「已配置的主用/备用」
      // 里挑一条，音色下拉随之切到该厂商的清单。
      const [draftTtsProvider, setDraftTtsProvider] = useState(agent.overrides?.ttsProvider ?? '');
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
      // 全局已配置的 TTS 条目（主用 + 备用，按厂商去重）：智能体级「TTS 服务商」下拉的来源。
      // 只列这些，是因为凭据在全局设置里——选了没配凭据的厂商会在建连时失败。
      const [ttsEntries, setTtsEntries] = useState([]);
      // 音色清单：后端 `/voices` 只回内置目录（2026-11-13 起不再调官方 ListSpeakers）。
      // 这里仍保留「列表可被后端覆盖」的形状，便于以后换来源。
      const [voiceCatalog, setVoiceCatalog] = useState(null);
      // 对话模型：只覆盖「模型名」，provider / Key / 端点仍来自全局 LLM。
      // 下拉选项来自全局 LLM 已保存配置的 `/models`；拉不到就退回手填。
      const [llmGlobal, setLlmGlobal] = useState({ provider: '', model: '' });
      const [modelOptions, setModelOptions] = useState(null);

      useEffect(() => {
        let alive = true;
        callApi('/settings')
          .then((data) => {
            if (!alive) return;
            const globalTts = data?.settings?.voice?.tts || {};
            const globalLlm = data?.settings?.voice?.llm || {};
            setTtsGlobal({
              provider: globalTts.provider || 'volc',
              resourceId: globalTts.resourceId || ''
            });
            // 主用 + 备用（按厂商去重，保留最靠前的那条）——智能体级「TTS 服务商」只在这份
            // 清单里选，否则会选中一个没有凭据的厂商。
            const entries = [globalTts, ...(Array.isArray(globalTts.backups) ? globalTts.backups : [])]
              .filter((entryItem) => entryItem && entryItem.provider)
              .map((entryItem) => ({
                provider: String(entryItem.provider),
                resourceId: String(entryItem.resourceId || '')
              }));
            const seen = new Set();
            const unique = [];
            for (const entryItem of entries) {
              if (seen.has(entryItem.provider)) continue;
              seen.add(entryItem.provider);
              unique.push(entryItem);
            }
            setTtsEntries(unique);
            setLlmGlobal({ provider: globalLlm.provider || '', model: globalLlm.model || '' });
            callApi('/models?kind=llm&source=primary')
              .then((models) => {
                if (alive) setModelOptions(Array.isArray(models?.options) ? models.options : []);
              })
              .catch(() => {});
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, []);

      // 生效的 TTS 厂商：智能体指定优先，否则跟随全局主用；资源族跟着**该厂商的条目**走
      // （火山 1.x / 2.0 混选会回 55000000「有字没声」）。
      const activeTtsProvider = draftTtsProvider || ttsGlobal.provider || '';
      const activeEntry = ttsEntries.find((item) => item.provider === activeTtsProvider);
      const activeResourceId = activeEntry
        ? activeEntry.resourceId
        : (activeTtsProvider === ttsGlobal.provider ? ttsGlobal.resourceId : '');

      // 音色清单随「生效的 TTS 厂商」变化重新拉取：切换服务商后下拉立刻换成该厂商的音色。
      useEffect(() => {
        if (!activeTtsProvider) {
          setVoiceCatalog(null);
          return undefined;
        }
        let alive = true;
        setVoiceCatalog(null);
        callApi(
          `/voices?provider=${encodeURIComponent(activeTtsProvider)}&resourceId=${encodeURIComponent(activeResourceId)}`
        )
          .then((voices) => {
            if (!alive) return;
            const list = voices?.options?.[activeTtsProvider];
            setVoiceCatalog(Array.isArray(list) ? list : null);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [activeTtsProvider, activeResourceId]);

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
              // 空 = 跟随全局主用；非空 = 从全局已配置的主用/备用里挑一条（服务端校验）。
              ttsProvider: draftTtsProvider,
              language: draftLanguage,
              model: draftModel
            }
          });
          await onSaved();
        } finally {
          setSaving(false);
        }
      };

      // 第一项「默认音色」= 不覆盖（保存时 voice 传空串，服务端删掉该智能体的音色覆盖）。
      // 音色清单跟着**生效的 TTS 服务商**走：后端 `/voices` 回内置目录（2026-11-13 起不再调
      // 官方 ListSpeakers），按该厂商的资源族过滤（1.x / 2.0 混选会 55000000「有字没声」）。
      const catalog = voiceCatalog ?? (VOICES[activeTtsProvider] || []);
      const voices = voicesForResource(catalog, activeResourceId);
      const voiceOptions = [{ value: '', label: t('voiceDefault') }].concat(
        voices.map((voice) => ({ value: voice.value, label: voice.label }))
      );
      // 已存的音色不在当前厂商/资源族的列表里（典型：刚换过 TTS 服务商）时仍回显，
      // 否则下拉显示「未选择」，看起来像音色丢了；保存也不会丢值。
      if (draftVoice && !voiceOptions.some((option) => option.value === draftVoice)) {
        const known = voices.find((voice) => voice.value === draftVoice);
        voiceOptions.push({ value: draftVoice, label: known?.label || voiceLabel(draftVoice, activeTtsProvider) });
      }
      // 服务商下拉：只列全局已配置的主用/备用（凭据在那边），空 = 跟随全局主用。
      const providerOptions = [{ value: '', label: t('ttsFollowGlobal') }].concat(
        ttsEntries.map((entryItem) => ({
          value: entryItem.provider,
          label: stageProviderLabel('tts', entryItem.provider)
        }))
      );
      if (draftTtsProvider && !providerOptions.some((option) => option.value === draftTtsProvider)) {
        providerOptions.push({ value: draftTtsProvider, label: stageProviderLabel('tts', draftTtsProvider) });
      }
      // 火山音色是内置清单（不代表账号已开通），提示语要说清楚。
      const voiceHint = activeTtsProvider === 'volc' ? t('voiceCatalogBuiltin') : '';
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
            h('label', null, t('ttsProvider')),
            h(PillSelect, {
              value: draftTtsProvider,
              ariaLabel: t('ttsProvider'),
              options: providerOptions,
              onChange: (value) => {
                // 换服务商 = 换音色库：先把音色落回「默认」，避免把上一家的音色带过去
                // （resolveTtsVoice 会跨厂商回落成默认，但下拉里显示另一个厂商的 id 更让人困惑）。
                setDraftTtsProvider(value);
                setDraftVoice('');
              }
            }),
            h('span', { className: 'note' }, t('ttsProviderHint'))
          ),
          h('div', { className: 'xz-field' },
            h('label', null, t('voice')),
            h(PillSelect, { value: draftVoice, ariaLabel: t('voice'), options: voiceOptions, onChange: setDraftVoice }),
            voiceHint ? h('span', { className: 'note' }, voiceHint) : null
          ),
          h('div', { className: 'xz-field' },
            h('label', null, t('outputLanguage')),
            languageSelect
          )
        ),
        h('div', { className: 'xz-field' },
          // 角色模板 = 纯前端便利：选中后把人设整段替换成模板文本（{{assistant_name}} 换成
          // 智能体自己的名字），之后仍可手改。人设文本与某个模板完全一致时才回显该模板，
          // 手改过就回落「自定义」，不会假装还是那个模板。
          h('div', { className: 'xz-row', style: { justifyContent: 'space-between', alignItems: 'center' } },
            h('label', null, t('persona')),
            h('div', { style: { width: 200, flex: 'none' } },
              h(PillSelect, {
                value: matchRolePreset(draftPrompt, agent.name),
                ariaLabel: t('rolePreset'),
                options: [{ value: '', label: t('rolePresetCustom') }].concat(
                  ROLE_PRESETS.map((preset) => ({ value: preset.id, label: t(preset.labelKey) }))
                ),
                onChange: (id) => {
                  const preset = ROLE_PRESETS.find((item) => item.id === id);
                  if (preset) setDraftPrompt(rolePresetPrompt(preset.prompt, agent.name));
                }
              })
            )
          ),
          h('span', { className: 'note' }, t('rolePresetHint')),
          h('textarea', {
            className: 'xz-textarea',
            rows: 8,
            value: draftPrompt,
            placeholder: t('personaPlaceholder'),
            onChange: (e) => setDraftPrompt(e.target.value)
          })
        ),
      );

      const globalModel = llmGlobal.model || '';
      const modelOptionList = Array.isArray(modelOptions) ? modelOptions : null;
      const modelSelectOptions = [{
        value: '',
        label: globalModel ? `${t('agentModelDefault')}（${globalModel}）` : t('agentModelDefault')
      }].concat((modelOptionList || []).map((option) => ({ value: option.value, label: option.label })));
      // 已保存的模型不在清单里（自定义 id / 厂商清单没返回）时仍回显，不能显示成空。
      if (draftModel && !modelSelectOptions.some((option) => option.value === draftModel)) {
        modelSelectOptions.push({ value: draftModel, label: draftModel });
      }

      const modelPane = h('div', { key: 'model', className: 'xz-pane' },
        // 直连语义：provider / Base URL / API Key 都在「全局设置 → LLM」里，
        // 这里只覆盖模型名；留空 = 用全局默认模型。模型清单来自全局 LLM 的 /models，
        // 拉不到时退回手填（各厂商模型 id 命名差异大，不硬编码）。
        h('div', { className: 'xz-field' },
          h('label', null, t('agentModelLabel')),
          modelOptionList && modelOptionList.length
            ? h(PillSelect, {
                value: draftModel,
                ariaLabel: t('agentModelLabel'),
                options: modelSelectOptions,
                onChange: setDraftModel
              })
            : h('input', {
                className: 'xz-input',
                value: draftModel,
                placeholder: t('agentModelPlaceholder'),
                onChange: (e) => setDraftModel(e.target.value)
              }),
          h('span', { className: 'note' },
            `${t('agentModelHint')}${globalModel ? `（${globalModel}）` : ''}` +
              (modelOptionList && modelOptionList.length === 0 ? `；${t('agentModelManual')}` : ''))
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
