import { h, useState, useEffect } from '../react.js'
import { t, callApi, stageProviders, stageProviderLabel, blankBackup, withBackups, backupTestText, PRIMARY_EDIT_FIELDS, OUTPUT_LANGUAGE_VALUES } from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'
import { ProviderSection } from './ProviderSection.js'
import { ProviderDialog } from './ProviderDialog.js'

    function ConfigWizard({ state, notify }) {
      const [settings, setSettings] = useState(null);
      // 插件配置里的原值：面板上「留空 = 沿用插件配置」要能告诉用户沿用的是哪份。
      const [defaults, setDefaults] = useState({ systemPrompt: '', silenceMs: null });
      const [error, setError] = useState('');
      const [saving, setSaving] = useState(false);
      // 服务商列表：编辑弹窗、逐条测试结果（按 id 存，上移/下移后不会错位）、删除二次确认。
      // 「未保存」时禁用测试：/test/provider 的 index 是服务端顺序，本地改过顺序后按本地
      // index 会测到另一条，所以统一要求先保存（与契约「只测已保存的配置」一致）。
      const [editor, setEditor] = useState(null);
      const [testResults, setTestResults] = useState({});
      const [testingId, setTestingId] = useState('');
      const [confirmDelete, setConfirmDelete] = useState('');
      const [providersDirty, setProvidersDirty] = useState(false);
      // 主用卡自己的测试结果与状态。primaryClear 记录「主用换了 provider 又没重新填密钥」，
      // 保存时补 clearApiKey/clearApiSecret——否则 settings.update 的「留空=保留」会把上一家
      // 的旧 Key 留在新厂商名下。
      const [primaryTests, setPrimaryTests] = useState({});
      const [testingPrimary, setTestingPrimary] = useState('');
      const [primaryClear, setPrimaryClear] = useState({});

      useEffect(() => {
        callApi('/settings')
          .then((data) => {
            // 旧版服务端没有 backups 字段：统一兜底成空数组，UI 不能因此白屏。
            setSettings(withBackups(data.settings));
            if (data.defaults) setDefaults(data.defaults);
          })
          .catch((err) => setError(err.message));
      }, []);

      if (!settings) return h('div', { className: 'xz-empty' }, error || '…');

      const patch = (group, values) => setSettings({ ...settings, [group]: { ...settings[group], ...values } });
      const nested = (group, key, values) =>
        setSettings({ ...settings, [group]: { ...settings[group], [key]: { ...settings[group][key], ...values } } });

      // 服务商区块（页面主体）：ASR → LLM → TTS，标题复用 step3/4/5。

      /** 区块标题旁的当前主用摘要：厂商 + 模型/地址（TTS 只显示厂商，音色在智能体级）+ 备用数量。 */
      const stageSummary = (stage) => {
        const primary = settings.voice?.[stage] || {};
        const label = stageProviderLabel(stage, primary.provider);
        const detail = stage === 'llm'
          ? primary.model || ''
          : stage === 'tts'
            ? ''
            : primary.url || primary.resourceId || '';
        const backups = backupsOf(stage).length;
        const parts = [label && detail ? `${label} / ${detail}` : label || detail];
        if (backups > 0) parts.push(t('configBackupCount').replace('{n}', String(backups)));
        return parts.filter(Boolean).join(' · ') || '—';
      };

      /** ProviderSection 的 props 统一在这里给：组件本身与回调逻辑保持不变。 */
      const providerSectionProps = (stage) => ({
        stage,
        primary: settings.voice?.[stage] || {},
        entries: backupsOf(stage),
        providersDirty,
        primaryTest: primaryTests[stage],
        testingPrimary,
        testResults,
        testingId,
        confirmDelete,
        onEditPrimary: () => openEditPrimary(stage),
        onAdd: () => openAddBackup(stage),
        onEdit: (index) => openEditBackup(stage, index),
        onMove: (index, delta) => moveBackup(stage, index, delta),
        onDelete: (index, key) => removeBackup(stage, index, key),
        onTest: (index) => runBackupTest(stage, index),
        onTestPrimary: () => runPrimaryTest(stage)
      });

      // ------------------------------------------------------------ 服务商（主用 + 备用）
      const backupsOf = (stage) => {
        // 旧版服务端没有 backups：`|| []` 兜底，UI 不能因为字段缺失而白屏。
        const list = settings.voice?.[stage]?.backups || [];
        return Array.isArray(list) ? list : [];
      };
      const setBackups = (stage, next) => {
        setProvidersDirty(true);
        setSettings((previous) => withBackups({
          ...previous,
          voice: {
            ...previous.voice,
            [stage]: { ...previous.voice?.[stage], backups: next }
          }
        }));
      };
      const openAddBackup = (stage) => {
        const provider = stageProviders(stage)[0];
        setEditor({ stage, mode: 'backup', index: null, draft: blankBackup(stage, provider) });
      };
      const openEditBackup = (stage, index) => {
        const entry = backupsOf(stage)[index];
        if (!entry) return;
        setEditor({ stage, mode: 'backup', index, draft: { ...blankBackup(stage, entry.provider || ''), ...entry } });
      };
      const openEditPrimary = (stage) => {
        const current = settings.voice?.[stage] || {};
        const provider = current.provider || stageProviders(stage)[0];
        setEditor({ stage, mode: 'primary', index: null, draft: { ...blankBackup(stage, provider), ...current, providerChanged: false } });
      };
      const commitEditor = () => {
        if (!editor) return;
        const { stage, mode, index, draft } = editor;
        const next = { ...draft };
        if (!next.provider) next.provider = stageProviders(stage)[0];
        setProvidersDirty(true);
        if (mode === 'primary') {
          const stageSettings = { ...(settings.voice?.[stage] || {}) };
          for (const key of PRIMARY_EDIT_FIELDS[stage]) stageSettings[key] = next[key] ?? '';
          stageSettings.provider = next.provider;
          // 全局 TTS 不再拥有音色/模型：主用保存时把这三项清空（服务端按厂商默认音色兜底），
          // `url` 保留原值不动（界面不展示，避免把用户手填的自建端点丢掉）。
          if (stage === 'tts') {
            stageSettings.voice = '';
            stageSettings.model = '';
            stageSettings.resourceId = '';
          }
          stageSettings.hasApiKey = Boolean(next.apiKey);
          stageSettings.hasApiSecret = Boolean(next.apiSecret);
          // 换过厂商且没重新填密钥：保存时显式清空，绝不把上一家的 Key 留在新厂商名下。
          setPrimaryClear((previous) => ({
            ...previous,
            [stage]: {
              apiKey: next.providerChanged === true && !next.apiKey,
              apiSecret: next.providerChanged === true && !next.apiSecret
            }
          }));
          setSettings((previous) => withBackups({
            ...previous,
            voice: { ...previous.voice, [stage]: stageSettings }
          }));
        } else {
          const list = [...backupsOf(stage)];
          if (index === null) list.push(next);
          else list[index] = { ...list[index], ...next };
          setBackups(stage, list);
        }
        setEditor(null);
      };
      const moveBackup = (stage, index, delta) => {
        const list = [...backupsOf(stage)];
        const target = index + delta;
        if (target < 0 || target >= list.length) return;
        [list[index], list[target]] = [list[target], list[index]];
        setBackups(stage, list);
      };
      const removeBackup = (stage, index, cardKey) => {
        if (confirmDelete !== cardKey) {
          setConfirmDelete(cardKey);
          window.setTimeout(() => {
            setConfirmDelete((current) => (current === cardKey ? '' : current));
          }, 4000);
          return;
        }
        setConfirmDelete('');
        setBackups(stage, backupsOf(stage).filter((_, position) => position !== index));
      };
      const runBackupTest = async (stage, index) => {
        const entry = backupsOf(stage)[index];
        if (!entry) return;
        if (stage === 'asr') {
          notify(t('asrTestUnsupported'), 'bad');
          return;
        }
        if (!entry.id) {
          notify(t('backupSaveFirst'), 'bad');
          return;
        }
        if (providersDirty) {
          notify(t('backupSaveFirst'), 'bad');
          return;
        }
        setTestingId(entry.id);
        try {
          const result = await callApi('/test/provider', {
            method: 'POST',
            body: { kind: stage === 'llm' ? 'llm' : 'tts', source: 'backup', index }
          });
          setTestResults((previous) => ({ ...previous, [entry.id]: result }));
          notify(
            result.ok ? `${t('backupTestOk')} · ${backupTestText(stage, result)}` : String(result.error || t('backupTestFail')),
            result.ok ? 'ok' : 'bad'
          );
        } catch (err) {
          notify(`${t('actionFailed')}${err.message}`, 'bad');
        } finally {
          setTestingId('');
        }
      };
      const runPrimaryTest = async (stage) => {
        if (stage === 'asr') {
          notify(t('asrTestUnsupported'), 'bad');
          return;
        }
        if (providersDirty) {
          notify(t('backupSaveFirst'), 'bad');
          return;
        }
        setTestingPrimary(stage);
        try {
          // 主用 LLM 走老的 /test/llm（只测主用，不会静默测到备用）；TTS 走统一的 /test/provider。
          const result = stage === 'llm'
            ? await callApi('/test/llm', { method: 'POST' })
            : await callApi('/test/provider', { method: 'POST', body: { kind: 'tts', source: 'primary' } });
          setPrimaryTests((previous) => ({ ...previous, [stage]: result }));
          notify(
            result.ok ? `${t('backupTestOk')} · ${backupTestText(stage, result)}` : String(result.error || t('backupTestFail')),
            result.ok ? 'ok' : 'bad'
          );
        } catch (err) {
          notify(`${t('actionFailed')}${err.message}`, 'bad');
        } finally {
          setTestingPrimary('');
        }
      };

      const save = async () => {
        setSaving(true);
        try {
          // A masked value is a placeholder, never a credential: sending it back
          // would overwrite the stored secret with bullets, so strip it to "".
          const secret = (value) => (typeof value === 'string' && value.includes('•') ? '' : value || '');
          // 三条备用列表按契约的字段集提交；掩码同样清成空串，服务端按 id 保留旧密钥。
          const backupBody = (stage) => backupsOf(stage).map((entry) => {
            const base = { provider: entry.provider };
            if (entry.id) base.id = entry.id;
            if (stage === 'llm') {
              return {
                ...base,
                model: entry.model || '',
                baseUrl: entry.baseUrl || '',
                appId: entry.appId || '',
                apiKey: secret(entry.apiKey)
              };
            }
            if (stage === 'tts') {
              // 全局 TTS 只提交「厂商 + 凭据」：voice/model/resourceId/url/rate/speed 由
              // 服务端归零（音色在智能体级选；这些字段界面已经不展示了）。
              return {
                ...base,
                appId: entry.appId || '',
                apiKey: secret(entry.apiKey),
                apiSecret: secret(entry.apiSecret)
              };
            }
            return {
              ...base,
              url: entry.url || '',
              language: entry.language || '',
              accent: entry.accent || '',
              resourceId: entry.resourceId || '',
              appId: entry.appId || '',
              apiKey: secret(entry.apiKey),
              apiSecret: secret(entry.apiSecret)
            };
          });
          const clearFlags = (stage) => {
            // 主用换过 provider 且没重新填密钥：显式清空，避免 settings.update 的
            // 「留空=保留」把上一家的 Key 留在新厂商名下。
            const flags = primaryClear[stage] || {};
            const apiKey = settings.voice[stage]?.apiKey;
            const apiSecret = settings.voice[stage]?.apiSecret;
            const out = {};
            if (flags.apiKey && !apiKey) out.clearApiKey = true;
            if (flags.apiSecret && !apiSecret) out.clearApiSecret = true;
            return out;
          };
          const body = {
            endpoints: {
              lanWsUrl: settings.endpoints.lanWsUrl,
              wanWsUrl: settings.endpoints.wanWsUrl,
              token: secret(settings.endpoints.token)
            },
            firmware: settings.firmware,
            gateway: {
              token: secret(settings.gateway.token)
            },
            voice: {
              // 全局人设编辑已删除（人设只在「智能体 → 配置 → 角色」按智能体配置）；
              // 这里把 GET 回来的原值原样传回，绝不能写成空串/undefined 把已存人设清掉。
              systemPrompt: settings.voice.systemPrompt,
              silenceMs: settings.voice.silenceMs,
              llm: {
                provider: settings.voice.llm.provider,
                model: settings.voice.llm.model,
                baseUrl: settings.voice.llm.baseUrl,
                appId: settings.voice.llm.appId,
                apiKey: secret(settings.voice.llm.apiKey),
                maxTokens: settings.voice.llm.maxTokens,
                ...clearFlags('llm'),
                backups: backupBody('llm')
              },
              tts: {
                provider: settings.voice.tts.provider,
                // 音色/模型/资源下放到智能体级：全局显式清空（服务端按厂商默认音色兜底）。
                voice: '',
                model: '',
                resourceId: '',
                rate: settings.voice.tts.rate,
                speed: settings.voice.tts.speed,
                // url 不在界面展示，但原值要原样传回，避免把用户手填的自建端点清掉。
                url: settings.voice.tts.url,
                language: settings.voice.tts.language,
                appId: settings.voice.tts.appId,
                apiKey: secret(settings.voice.tts.apiKey),
                apiSecret: secret(settings.voice.tts.apiSecret),
                ...clearFlags('tts'),
                backups: backupBody('tts')
              },
              asr: {
                provider: settings.voice.asr.provider,
                url: settings.voice.asr.url,
                language: settings.voice.asr.language,
                accent: settings.voice.asr.accent,
                resourceId: settings.voice.asr.resourceId,
                appId: settings.voice.asr.appId,
                apiKey: secret(settings.voice.asr.apiKey),
                apiSecret: secret(settings.voice.asr.apiSecret),
                ...clearFlags('asr'),
                backups: backupBody('asr')
              }
            }
          };
          const result = await callApi('/settings', { method: 'POST', body });
          // 保存后服务端会补 id / 掩码，本地顺序与服务端一致，测试恢复可用。
          setSettings(withBackups(result.settings));
          setProvidersDirty(false);
          setPrimaryClear({});
          setConfirmDelete('');
          if (result.defaults) setDefaults(result.defaults);
          notify(t('saved'));
        } catch (err) {
          notify(`${t('actionFailed')}${err.message}`, 'bad');
        } finally {
          setSaving(false);
        }
      };

      return h('div', { className: 'xz-config-page' },
        // ---------------------------------------------------------------- 服务商（页面主体）
        h('div', { className: 'xz-card' },
          h('h3', null, t('configProvidersTitle')),
          // 三个环节纵向堆叠：标题（复用 step3/4/5）+ 当前主用摘要 + 现有 ProviderSection。
          h('section', { className: 'xz-provider-stage' },
            h('div', { className: 'xz-provider-stage-head' },
              h('h4', { className: 'xz-provider-stage-title' }, t('step3')),
              h('span', { className: 'xz-provider-stage-summary', title: stageSummary('asr') }, stageSummary('asr'))
            ),
            h(ProviderSection, providerSectionProps('asr'))
          ),
          h('section', { className: 'xz-provider-stage' },
            h('div', { className: 'xz-provider-stage-head' },
              h('h4', { className: 'xz-provider-stage-title' }, t('step4')),
              h('span', { className: 'xz-provider-stage-summary', title: stageSummary('llm') }, stageSummary('llm'))
            ),
            h(ProviderSection, providerSectionProps('llm'))
          ),
          h('section', { className: 'xz-provider-stage' },
            h('div', { className: 'xz-provider-stage-head' },
              h('h4', { className: 'xz-provider-stage-title' }, t('step5')),
              h('span', { className: 'xz-provider-stage-summary', title: stageSummary('tts') }, stageSummary('tts'))
            ),
            h(ProviderSection, providerSectionProps('tts')),
            // 音色（= TTS 模型）不在全局选：只在智能体配置里按智能体覆盖。
            h('p', { className: 'xz-hint', style: { margin: '8px 0 0' } }, t('ttsVoicePerDevice'))
          )
        ),
        // ---------------------------------------------------------------- 语音默认参数
        h('div', { className: 'xz-card' },
          h('h3', null, t('configVoiceTitle')),
          h('div', { className: 'xz-grid' },
            h('div', { className: 'xz-field' },
              h('label', null, t('silence')),
              h('input', {
                className: 'xz-input',
                type: 'number',
                min: 100,
                max: 3000,
                step: 50,
                value: settings.voice.silenceMs ?? '',
                placeholder: String(defaults.silenceMs ?? 400),
                onChange: (e) => patch('voice', { silenceMs: e.target.value === '' ? null : Number(e.target.value) })
              }),
              h('span', { className: 'note' },
                settings.voice.silenceMs == null
                  ? `${t('inheritHint')}（${defaults.silenceMs ?? 400} ms）`
                  : `${defaults.silenceMs ?? 400} ms`)
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('replyMaxTokens')),
              h('input', {
                className: 'xz-input',
                type: 'number',
                min: 32,
                max: 2048,
                step: 8,
                value: settings.voice.llm.maxTokens ?? '',
                placeholder: '120',
                onChange: (e) => {
                  const raw = e.target.value.trim();
                  nested('voice', 'llm', { maxTokens: raw === '' ? null : Number(raw) });
                }
              }),
              h('span', { className: 'note' }, t('replyMaxTokensHint'))
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('outputLanguage')),
              h(PillSelect, {
                value: settings.voice.tts.language || '',
                ariaLabel: t('outputLanguage'),
                options: [{ value: '', label: t('languageFollow') }].concat(
                  OUTPUT_LANGUAGE_VALUES.map((value) => ({ value, label: value }))
                ),
                onChange: (value) => nested('voice', 'tts', { language: value })
              })
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('replySpeed')),
              h('input', {
                className: 'xz-input',
                type: 'number',
                min: 0.5,
                max: 2,
                step: 0.05,
                value: settings.voice.tts.speed,
                placeholder: '1',
                onChange: (e) => nested('voice', 'tts', { speed: e.target.value })
              }),
              h('span', { className: 'note' }, settings.voice.tts.speed ? '' : `${t('inheritHint')}（1）`)
            )
          )
        ),
        // ---------------------------------------------------------------- 接入与网关（默认折叠）
        h('details', { className: 'xz-card xz-config-access' },
          h('summary', null, t('configAccessTitle')),
          h('div', { className: 'xz-grid' },
            h('div', { className: 'xz-field' },
              h('label', null, t('lanWsUrl')),
              h('input', { className: 'xz-input', value: settings.endpoints.lanWsUrl, placeholder: 'ws://192.168.1.10:8989/xiaozhi/v1/', onChange: (e) => patch('endpoints', { lanWsUrl: e.target.value }) })
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('wanWsUrl')),
              h('input', { className: 'xz-input', value: settings.endpoints.wanWsUrl, placeholder: 'wss://example.com/xiaozhi/v1/', onChange: (e) => patch('endpoints', { wanWsUrl: e.target.value }) })
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('otaToken')),
              h('input', { className: 'xz-input', type: 'password', value: settings.endpoints.token, placeholder: t('tokenKeep'), onChange: (e) => patch('endpoints', { token: e.target.value }) }),
              h('span', { className: 'note' }, settings.endpoints.hasToken ? t('apiKeyKeep') : t('tokenKeep'))
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('firmwareVersion')),
              h('input', { className: 'xz-input', value: settings.firmware.version, onChange: (e) => patch('firmware', { version: e.target.value }) })
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('firmwareUrl')),
              h('input', { className: 'xz-input', value: settings.firmware.url, onChange: (e) => patch('firmware', { url: e.target.value }) })
            ),
            h('div', { className: 'xz-field' },
              h('label', null, t('gatewayToken')),
              h('input', { className: 'xz-input', type: 'password', value: settings.gateway.token, placeholder: t('tokenKeep'), onChange: (e) => patch('gateway', { token: e.target.value }) })
            )
          ),
          h('label', { className: 'xz-row', style: { fontSize: 12, color: 'var(--xz-text-2)', marginTop: 4 } },
            h('input', { type: 'checkbox', checked: settings.firmware.force, onChange: (e) => patch('firmware', { force: e.target.checked }) }),
            t('forceUpdate')
          )
        ),
        // ---------------------------------------------------------------- 底部：提示 + 唯一保存入口
        h('div', { className: 'xz-config-footer' },
          h('span', { className: 'xz-hint' }, t('configSaveHint')),
          h('button', { className: 'xz-btn primary', disabled: saving, onClick: save }, saving ? '…' : t('saveConfig'))
        ),
        // 服务商编辑弹窗（主用/备用共用）：确定只改本地状态，统一走页面底部「保存配置」。
        editor
          ? h(ProviderDialog, {
              stage: editor.stage,
              mode: editor.mode,
              index: editor.index,
              draft: editor.draft,
              isNew: editor.index === null,
              onDraft: (draft) => setEditor({ ...editor, draft }),
              onConfirm: commitEditor,
              onCancel: () => setEditor(null)
            })
          : null
      );
    }
export { ConfigWizard }
