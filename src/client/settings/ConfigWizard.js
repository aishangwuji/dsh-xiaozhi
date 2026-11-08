import { h, useState, useEffect } from '../react.js'
import {
  t, callApi, stageProviders, stageProviderLabel, stageDescriptor, blankBackup, withBackups,
  backupKeyState, backupTestText, primaryEditFields, OUTPUT_LANGUAGE_VALUES
} from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'
import { ProviderSection } from './ProviderSection.js'
import { ProviderDialog } from './ProviderDialog.js'

const STAGES = ['asr', 'llm', 'tts']
const STEP_KEY = { asr: 'step3', llm: 'step4', tts: 'step5' }
const DESC_KEY = { asr: 'configStageAsrDesc', llm: 'configStageLlmDesc', tts: 'configStageTtsDesc' }
const ICON_TEXT = { asr: 'A', llm: 'L', tts: 'T' }

    function ConfigWizard({ state, notify }) {
      const [settings, setSettings] = useState(null);
      // 插件配置里的原值：面板上「留空 = 沿用插件配置」要能告诉用户沿用的是哪份。
      const [defaults, setDefaults] = useState({ systemPrompt: '', silenceMs: null });
      const [error, setError] = useState('');
      const [saving, setSaving] = useState(false);
      // 一级页是三个概览卡；点「管理」打开这个环节的二级弹窗（null | 'asr' | 'llm' | 'tts'）。
      const [openStage, setOpenStage] = useState(null);
      // 服务商列表：编辑弹窗、逐条测试结果（按 id 存，上移/下移后不会错位）、删除二次确认。
      // dirty 时不再禁用测试：按钮变「保存并测试」，runBackupTest / runPrimaryTest 会先保存
      // 再按服务端顺序测（契约仍是「只测已保存的配置」，只是把两步合成一次点击）。
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

      // ------------------------------------------------------------ 服务商（主用 + 备用）
      const backupsOf = (stage) => {
        // 旧版服务端没有 backups：`|| []` 兜底，UI 不能因为字段缺失而白屏。
        const list = settings.voice?.[stage]?.backups || [];
        return Array.isArray(list) ? list : [];
      };

      /** 概览卡里的主用摘要：LLM=模型名、ASR=地址/资源、TTS 留空（音色在智能体级）。 */
      const stageDetail = (stage) => {
        const primary = settings.voice?.[stage] || {};
        if (stage === 'llm') return primary.model || '';
        if (stage === 'tts') return '';
        return primary.url || primary.resourceId || '';
      };

      /** 降级链：主用 → 备用 1 → 备用 2；没有备用时不显示。 */
      const stageChain = (stage) => {
        const list = [settings.voice?.[stage]?.provider, ...backupsOf(stage).map((entry) => entry.provider)]
          .filter(Boolean);
        if (list.length <= 1) return '';
        return list.map((provider) => stageProviderLabel(stage, provider)).join(' → ');
      };

      /** 概览卡状态点：dirty 优先（黄），其次主用密钥是否就绪（绿/黄）。 */
      const stageHealth = (stage) => {
        if (providersDirty) return { kind: 'warn', text: t('stageHealthDirty') };
        const key = backupKeyState(stage, settings.voice?.[stage] || {});
        return key.ok
          ? { kind: 'ok', text: t('stageHealthOk') }
          : { kind: 'warn', text: t('stageHealthWarn') };
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
          for (const key of primaryEditFields(stage)) stageSettings[key] = next[key] ?? '';
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
        // 能不能测由描述符的 probe.kind 决定（ASR = none），不在前端写 `stage === 'asr'`。
        const providerId = backupsOf(stage)[index]?.provider;
        if (stageDescriptor(providerId, stage)?.probe?.kind === 'none') {
          notify(t('probeUnsupported'), 'bad');
          return;
        }
        // dirty 时先保存再测：/test/provider 的 index 是服务端顺序，本地改过顺序/内容
        // 必须先落盘；保存失败（save 返回 null）就不测，错误已经 notify 过。
        let current = settings;
        if (providersDirty) {
          current = await save();
          if (!current) return;
        }
        const entry = (current.voice?.[stage]?.backups || [])[index];
        if (!entry?.id) {
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
        if (stageDescriptor(settings.voice?.[stage]?.provider, stage)?.probe?.kind === 'none') {
          notify(t('probeUnsupported'), 'bad');
          return;
        }
        if (providersDirty) {
          const saved = await save();
          if (!saved) return;
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

      /**
       * 保存（页面底部 / 二级弹窗 / 「保存并测试」共用）。
       * 成功返回服务端回写的 settings（带 id / 掩码），失败返回 null——调用方据此决定
       * 要不要继续测试，且能拿到保存后的顺序，不会用旧闭包里的 index。
       */
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
          return withBackups(result.settings);
        } catch (err) {
          notify(`${t('actionFailed')}${err.message}`, 'bad');
          return null;
        } finally {
          setSaving(false);
        }
      };

      // ---------------------------------------------------------------- 一级：三个概览卡
      const stageCard = (stage) => {
        const primary = settings.voice?.[stage] || {};
        const health = stageHealth(stage);
        const backups = backupsOf(stage);
        const detail = stageDetail(stage);
        const chain = stageChain(stage);
        const key = backupKeyState(stage, primary);
        return h('button', {
          key: stage,
          type: 'button',
          className: `xz-stage-card${health.kind === 'warn' ? ' is-warn' : ''}`,
          onClick: () => setOpenStage(stage)
        },
          h('div', { className: 'xz-stage-card-head' },
            h('div', { className: 'xz-stage-icon', 'aria-hidden': 'true' }, ICON_TEXT[stage]),
            h('div', { className: 'xz-stage-card-heading' },
              h('strong', null, t(STEP_KEY[stage])),
              h('span', { className: 'xz-stage-card-desc' }, t(DESC_KEY[stage]))
            ),
            h('span', { className: `xz-dot ${health.kind === 'ok' ? 'on' : ''}` })
          ),
          h('div', { className: 'xz-stage-card-primary' },
            h('strong', null, stageProviderLabel(stage, primary.provider)),
            detail ? h('span', { className: 'xz-stage-card-detail', title: detail }, detail) : null
          ),
          h('div', { className: 'xz-stage-card-facts' },
            h('span', null, `${t('backupSecret')}: ${key.text}`),
            h('span', null, t('configBackupCount').replace('{n}', String(backups.length))),
            chain ? h('span', { className: 'xz-stage-card-chain', title: chain }, `${t('backupChain')}: ${chain}`) : null
          ),
          h('div', { className: 'xz-stage-card-foot' },
            h('span', { className: `xz-stage-card-health ${health.kind}` }, health.text),
            h('span', { className: 'xz-stage-card-manage' }, `${t('stageManage')} ›`)
          )
        );
      };

      // ---------------------------------------------------------------- 二级：stage 管理弹窗
      const stageModal = openStage
        ? h('div', { className: 'xz-modal-mask', onClick: () => setOpenStage(null) },
            h('div', {
              className: 'xz-modal xz-stage-modal',
              role: 'dialog',
              'aria-modal': 'true',
              onClick: (event) => event.stopPropagation()
            },
              h('div', { className: 'xz-modal-head' },
                h('div', { className: 'xz-row', style: { gap: 10, alignItems: 'center' } },
                  h('button', { type: 'button', className: 'xz-btn ghost', onClick: () => setOpenStage(null) }, '‹ ' + t('back')),
                  h('h3', { style: { margin: 0 } }, t(STEP_KEY[openStage])),
                  h('span', { className: `xz-dot ${stageHealth(openStage).kind === 'ok' ? 'on' : ''}` }),
                  h('span', { className: 'xz-hint', style: { margin: 0 } }, stageHealth(openStage).text)
                ),
                h('p', { className: 'xz-hint', style: { margin: '6px 0 0' } }, t(DESC_KEY[openStage]))
              ),
              h('div', { className: 'xz-modal-body' },
                h(ProviderSection, providerSectionProps(openStage)),
                openStage === 'tts'
                  ? h('p', { className: 'xz-hint', style: { margin: '10px 0 0' } }, t('ttsVoicePerDevice'))
                  : null
              ),
              h('div', { className: 'xz-modal-foot' },
                h('button', { type: 'button', className: 'xz-btn', onClick: () => setOpenStage(null) }, t('close')),
                h('button', {
                  type: 'button',
                  className: 'xz-btn primary',
                  disabled: saving,
                  onClick: async () => {
                    const saved = await save();
                    if (saved) setOpenStage(null);
                  }
                }, saving ? '…' : t('saveConfig'))
              )
            )
          )
        : null;

      return h('div', { className: 'xz-config-page' },
        // ---------------------------------------------------------------- 服务商（概览卡）
        h('div', { className: 'xz-card' },
          h('h3', null, t('configProvidersTitle')),
          h('div', { className: 'xz-stage-cards' }, STAGES.map(stageCard)),
          providersDirty
            ? h('p', { className: 'xz-hint', style: { margin: '10px 0 0' } }, t('stageHealthDirty'))
            : null
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
        // ---------------------------------------------------------------- 底部：sticky 保存条
        h('div', { className: 'xz-config-footer' },
          h('span', { className: 'xz-hint' }, t('configSaveHint')),
          h('button', { className: 'xz-btn primary', disabled: saving, onClick: () => save() }, saving ? '…' : t('saveConfig'))
        ),
        // 服务商编辑弹窗（主用/备用共用）：确定只改本地状态，统一走页面底部「保存配置」。
        // 放在 stageModal 之后渲染：两者都是 z-index 40 的 fixed 遮罩，后挂的在上面。
        stageModal,
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
