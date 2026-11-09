import { h, useState, useRef } from '../react.js'
import { t, callApi, formatAgo, voiceLabel } from '../core.js'
import { Icon } from '../ui/Icon.js'
import { PillSelect } from '../ui/PillSelect.js'
import { AgentConfigDialog } from './AgentConfigDialog.js'
import { AgentDevicesDialog } from './AgentDevicesDialog.js'
import { HistoryDialog } from './HistoryDialog.js'

    /**
     * 智能体页：卡片 = 智能体（配置单位），一台智能体可以绑定多台设备。
     *
     * 对齐参考服务端：人设/模型/音色/语种/记忆/工具都在智能体上（同一智能体的设备共用），
     * 设备只留物理属性与绑定关系。删除智能体级联删除它绑定的设备（与 deleteAgent 一致），
     * 所以按钮做成二次确认，并把「会一起删几台设备」写在提示里。
     */
    function AgentsView({ state, notify, onChanged }) {
      const [injecting, setInjecting] = useState(null);
      const [text, setText] = useState('');
      const [busyId, setBusyId] = useState('');
      const [configuring, setConfiguring] = useState('');
      const [managing, setManaging] = useState('');
      const [confirmDelete, setConfirmDelete] = useState('');
      const renameCancelled = useRef(false);
      const renameBusy = useRef(false);
      const [memory, setMemory] = useState([]);
      const [memoryDraft, setMemoryDraft] = useState('');
      const [toolCatalog, setToolCatalog] = useState([]);
      const [editing, setEditing] = useState('');
      const [editName, setEditName] = useState('');
      const [historyAgent, setHistoryAgent] = useState(null);
      const [pendingAgent, setPendingAgent] = useState({});
      const [pendingBusy, setPendingBusy] = useState('');
      const agents = state.agents || [];
      const devices = state.devices || [];
      const pending = state.pending || [];
      const errorText = (error) => error?.code === 'duplicate-name' ? t('agentNameDuplicate') : error.message;
      const nextDefaultName = () => {
        const used = new Set(agents.map((agent) => agent.name).filter(Boolean));
        let n = 1;
        while (used.has(t('agentDefaultName').replace('{n}', String(n)))) n += 1;
        return t('agentDefaultName').replace('{n}', String(n));
      };
      const configAgent = configuring ? agents.find((item) => item.id === configuring) || null : null;
      const manageAgent = managing ? agents.find((item) => item.id === managing) || null : null;

      const createAgent = async () => {
        setBusyId('new');
        try {
          const data = await callApi('/agents', {
            method: 'POST',
            body: { name: nextDefaultName() }
          });
          await onChanged();
          if (data?.agent?.id) await openConfig(data.agent.id);
        } catch (error) {
          notify(`${t('actionFailed')}${errorText(error)}`, 'bad');
        } finally {
          setBusyId('');
        }
      };

      const removeAgent = async (agent) => {
        // 第一次点击只进入「确认删除」，第二次才真的删：与备用服务商删除同一套交互。
        // 级联删除是破坏性操作，第一次点击顺手把后果说清楚（按钮上的 title 在移动端点不到）。
        if (confirmDelete !== agent.id) {
          setConfirmDelete(agent.id);
          notify(t('agentDeleteHint'), 'bad');
          return;
        }
        setConfirmDelete('');
        setBusyId(agent.id);
        try {
          await callApi('/agents/remove', { method: 'POST', body: { agentId: agent.id } });
          await onChanged();
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        } finally {
          setBusyId('');
        }
      };

      const openConfig = async (agentId) => {
        setConfiguring(agentId);
        // 切到另一个智能体时先把上一份记忆/草稿清掉，避免开着弹窗时串台。
        setMemory([]);
        setMemoryDraft('');
        try {
          const [toolsData, memoryData] = await Promise.all([
            callApi('/tools?agentId=' + encodeURIComponent(agentId)),
            callApi('/memory?agentId=' + encodeURIComponent(agentId))
          ]);
          setToolCatalog(Array.isArray(toolsData?.tools) ? toolsData.tools : []);
          setMemory(Array.isArray(memoryData?.facts) ? memoryData.facts : []);
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        }
      };

      const toggleToolFor = async (agentId, tool) => {
        try {
          const data = await callApi('/tools/toggle', {
            method: 'POST',
            admin: true,
            body: { agentId, name: tool.name, enabled: tool.enabled === false }
          });
          if (Array.isArray(data?.tools)) setToolCatalog(data.tools);
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        }
      };

      const addMemory = async (agentId) => {
        const value = memoryDraft.trim();
        if (!value) return;
        try {
          const data = await callApi('/memory/add', { method: 'POST', admin: true, body: { agentId, value } });
          setMemory(Array.isArray(data?.facts) ? data.facts : []);
          setMemoryDraft('');
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        }
      };

      const removeMemory = async (agentId, index) => {
        try {
          const data = await callApi('/memory/remove', { method: 'POST', admin: true, body: { agentId, index } });
          setMemory(Array.isArray(data?.facts) ? data.facts : []);
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        }
      };

      const toggleMemory = async (agent) => {
        try {
          await callApi('/memory/enabled', {
            method: 'POST',
            body: { agentId: agent.id, enabled: agent.memoryEnabled === false }
          });
          await onChanged();
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        }
      };

      const commitRename = async (agent) => {
        // 名字没改就只退出、不发请求（点一下名字再点别处也会走这里）。
        if ((agent.name || '') === editName) {
          setEditing('');
          return;
        }
        if (renameBusy.current) return;
        renameBusy.current = true;
        try {
          await callApi('/agents/update', { method: 'POST', body: { agentId: agent.id, name: editName } });
          setEditing('');
          await onChanged();
        } catch (error) {
          notify(`${t('actionFailed')}${errorText(error)}`, 'bad');
        } finally {
          renameBusy.current = false;
        }
      };

      const bindDevice = async (agent, device) => {
        setBusyId(device.deviceId);
        try {
          await callApi('/agents/bind', { method: 'POST', body: { agentId: agent.id, deviceId: device.deviceId } });
          await onChanged();
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        } finally {
          setBusyId('');
        }
      };

      const unbindDevice = async (agent, device) => {
        setBusyId(device.deviceId);
        try {
          await callApi('/agents/unbind', { method: 'POST', body: { agentId: agent.id, deviceId: device.deviceId } });
          await onChanged();
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        } finally {
          setBusyId('');
        }
      };

      const deviceAction = async (action, device, value) => {
        if (action === 'remove' && !window.confirm(t('remove') + '?')) return;
        if (action === 'rename' && (device.nickName || '') === String(value ?? '')) return;
        setBusyId(device.deviceId);
        try {
          if (action === 'rename') {
            await callApi('/devices/rename', { method: 'POST', body: { deviceId: device.deviceId, nickName: value } });
          } else if (action === 'ota') {
            await callApi('/devices/ota', { method: 'POST', body: { deviceId: device.deviceId, enabled: value === true } });
          } else if (action === 'block') {
            await callApi('/devices/block', { method: 'POST', body: { deviceId: device.deviceId, blocked: !device.blocked } });
          } else if (action === 'disconnect') {
            await callApi('/devices/disconnect', { method: 'POST', body: { deviceId: device.deviceId } });
          } else if (action === 'remove') {
            await callApi('/devices/remove', { method: 'POST', body: { deviceId: device.deviceId } });
          }
          await onChanged();
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        } finally {
          setBusyId('');
        }
      };

      const sendInject = async () => {
        if (!injecting || !text.trim()) return;
        const online = (injecting.devices || []).filter((device) => device.online);
        if (online.length === 0) {
          notify(t('agentOffline'), 'bad');
          return;
        }
        try {
          // 播报发给这个智能体所有在线的设备（同一人格在几块表上同时说话）。
          for (const device of online) {
            await callApi('/devices/inject', {
              method: 'POST',
              admin: true,
              body: { deviceId: device.deviceId, text: text.trim() }
            });
          }
          notify(t('injectOk'));
          setInjecting(null);
          setText('');
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        }
      };

      const approvePending = async (device) => {
        const agentId = pendingAgent[device.deviceId] ?? agents[0]?.id ?? '';
        setPendingBusy(device.deviceId);
        try {
          await callApi('/pending/approve', {
            method: 'POST',
            body: { deviceId: device.deviceId, ...(agentId ? { agentId } : {}) }
          });
          await onChanged();
          notify(t('pendingApproved'), 'ok');
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        } finally {
          setPendingBusy('');
        }
      };

      const rejectPending = async (device) => {
        setPendingBusy(device.deviceId);
        try {
          await callApi('/pending/reject', {
            method: 'POST',
            body: { deviceId: device.deviceId }
          });
          await onChanged();
          notify(t('pendingRejected'), 'ok');
        } catch (error) {
          notify(`${t('actionFailed')}${error.message}`, 'bad');
        } finally {
          setPendingBusy('');
        }
      };

      const pendingCard = pending.length === 0
        ? null
        : h('div', { className: 'xz-card xz-pending-card', style: { marginBottom: 14 } },
            h('div', { className: 'xz-row', style: { justifyContent: 'space-between', marginBottom: 6 } },
              h('h3', { style: { margin: 0 } }, `${t('pendingTitle')}（${pending.length}）`)
            ),
            h('p', { className: 'xz-hint', style: { marginTop: 0 } }, t('pendingHint')),
            pending.map((device) => {
              const agentOptions = agents.length === 0
                ? [{ value: '', label: t('pendingAutoAgent') }]
                : agents.map((agent) => ({ value: agent.id, label: agent.name || t('unnamed') }));
              const chosen = pendingAgent[device.deviceId] ?? agents[0]?.id ?? '';
              return h('div', { key: device.deviceId, className: 'xz-device-row' },
                h('div', { className: 'xz-device-row-main' },
                  h('span', { className: 'xz-devcard-value' }, device.deviceId),
                  h('span', { className: 'xz-device-row-mac' }, device.lastIp || ''),
                  h('span', { className: 'xz-devcard-state' },
                    `${t('pendingFirstSeen')} ${formatAgo(device.firstSeenAt)} · ${t('pendingAttempts')} ${device.attempts}`
                  )
                ),
                h('div', { className: 'xz-device-row-actions' },
                  h(PillSelect, {
                    value: chosen,
                    options: agentOptions,
                    onChange: (value) => setPendingAgent((current) => ({ ...current, [device.deviceId]: value })),
                    ariaLabel: t('pendingAgent'),
                    width: 160
                  }),
                  h('button', {
                    type: 'button',
                    className: 'xz-btn primary',
                    disabled: pendingBusy === device.deviceId,
                    onClick: () => approvePending(device)
                  }, t('pendingApprove')),
                  h('button', {
                    type: 'button',
                    className: 'xz-btn',
                    disabled: pendingBusy === device.deviceId,
                    onClick: () => rejectPending(device)
                  }, t('pendingReject'))
                )
              );
            })
          );

      return h('div', null,
        pendingCard,
        h('div', { className: 'xz-card' },
          h('div', { className: 'xz-row', style: { justifyContent: 'space-between', marginBottom: 10 } },
            h('h3', { style: { margin: 0 } }, t('devicesTitle')),
            h('button', {
              type: 'button',
              className: 'xz-btn',
              disabled: busyId === 'new',
              onClick: createAgent
            }, `+ ${t('agentsNew')}`)
          ),
          agents.length === 0
            ? h('div', { className: 'xz-empty' }, t('empty'))
            : h('div', { className: 'xz-card-grid' },
                agents.map((agent) =>
                  h('div', { key: agent.id, className: 'xz-devcard' },
                    h('div', { className: 'xz-devcard-head' },
                      h('div', { className: 'xz-devcard-mark' }, h(Icon, { name: 'devices', size: 16 })),
                      editing === agent.id
                        ? h('div', { className: 'xz-row', style: { flex: 1 } },
                            h('input', {
                              className: 'xz-input xz-devcard-rename',
                              autoFocus: true,
                              value: editName,
                              maxLength: 40,
                              placeholder: t('agentNamePlaceholder'),
                              'aria-label': t('rename'),
                              onChange: (e) => setEditName(e.target.value),
                              onKeyDown: (e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRename(agent);
                                }
                                if (e.key === 'Escape') {
                                  renameCancelled.current = true;
                                  setEditing('');
                                }
                              },
                              onBlur: () => {
                                if (renameCancelled.current) {
                                  renameCancelled.current = false;
                                  return;
                                }
                                commitRename(agent);
                              }
                            })
                          )
                        : h('div', { className: 'xz-devcard-title' },
                            h('strong', {
                              className: 'xz-devcard-name',
                              title: t('rename'),
                              onClick: () => {
                                setEditing(agent.id);
                                setEditName(agent.name || '');
                              }
                            }, agent.name || t('unnamed')),
                            h('span', { className: `xz-dot ${agent.online ? 'on' : ''}`, style: { marginLeft: 6 } }),
                            h('span', { className: 'xz-devcard-state' }, agent.online ? t('online') : t('offline'))
                          ),
                      editing === agent.id
                        ? null
                        : h('button', {
                            className: 'xz-btn',
                            disabled: busyId === agent.id,
                            onClick: () => {
                              setInjecting(agent);
                              setText('');
                            }
                          }, t('inject'))
                    ),
                    h('div', { className: 'xz-devcard-mac', style: { lineHeight: 1.8 } },
                      (agent.devices || []).length === 0
                        ? t('agentNoDevices')
                        : (agent.devices || []).map((device, index) =>
                            h('span', { key: device.deviceId, style: { marginRight: 10, whiteSpace: 'nowrap' } },
                              `${index + 1}. ${device.nickName || device.deviceId}${device.online ? ' ●' : ''}`)
                          )
                    ),
                    h('div', { className: 'xz-devcard-facts' },
                      h('div', null,
                        h('span', { className: 'xz-devcard-label' }, t('voice')),
                        h('span', {
                          className: 'xz-devcard-value',
                          title: agent.overrides?.voice || ''
                        }, agent.overrides?.voice
                          ? voiceLabel(agent.overrides?.voice, state.voice?.tts?.provider)
                          : t('voiceDefault'))
                      ),
                      h('div', null,
                        h('span', { className: 'xz-devcard-label' }, t('agentDevices')),
                        h('span', { className: 'xz-devcard-value' }, t('agentDeviceCount').replace('{n}', String(agent.deviceCount ?? 0)))
                      ),
                      h('div', null,
                        h('span', { className: 'xz-devcard-label' }, t('lastSeen')),
                        h('span', { className: 'xz-devcard-value' }, formatAgo(agent.lastSeenAt))
                      )
                    ),
                    h('div', { className: 'xz-devcard-foot' },
                      h('button', { className: 'xz-btn', onClick: () => openConfig(agent.id) }, t('configure')),
                      h('button', { className: 'xz-btn', onClick: () => setManaging(agent.id) },
                        `${t('agentDevices')}(${agent.deviceCount ?? 0})`),
                      h('button', {
                        className: 'xz-btn',
                        onClick: () => {
                          setConfiguring('');
                          setHistoryAgent(agent);
                        }
                      }, t('history')),
                      h('button', {
                        className: 'xz-btn danger',
                        disabled: busyId === agent.id,
                        title: t('agentDeleteHint'),
                        onClick: () => removeAgent(agent)
                      }, confirmDelete === agent.id ? t('agentDeleteConfirm') : t('remove'))
                    )
                  )
                )
              )
        ),
        injecting
          ? h('div', { className: 'xz-modal-mask', onClick: () => setInjecting(null) },
              h('div', { className: 'xz-modal xz-inject-modal', onClick: (event) => event.stopPropagation() },
                h('h3', null, `${t('injectTitle')} · ${injecting.name || t('unnamed')}`),
                h('div', { className: 'xz-field' },
                  h('label', null, t('injectText')),
                  h('textarea', {
                    className: 'xz-textarea',
                    value: text,
                    maxLength: 500,
                    autoFocus: true,
                    onChange: (event) => setText(event.target.value)
                  })
                ),
                h('div', { className: 'xz-row', style: { justifyContent: 'flex-end' } },
                  h('button', { className: 'xz-btn', onClick: () => setInjecting(null) }, t('cancel')),
                  h('button', { className: 'xz-btn primary', disabled: !text.trim(), onClick: sendInject }, t('send'))
                )
              )
            )
          : null,
        historyAgent
          ? h(HistoryDialog, { agent: historyAgent, onClose: () => setHistoryAgent(null) })
          : null,
        configAgent
          ? h(AgentConfigDialog, {
              agent: configAgent,
              tools: toolCatalog,
              memory,
              memoryDraft,
              onMemoryDraft: setMemoryDraft,
              onAddMemory: () => addMemory(configAgent.id),
              onRemoveMemory: (index) => removeMemory(configAgent.id, index),
              onToggleTool: (tool) => toggleToolFor(configAgent.id, tool),
              onToggleMemory: () => toggleMemory(configAgent),
              onSaved: async () => {
                await onChanged();
              },
              onClose: () => setConfiguring('')
            })
          : null,
        manageAgent
          ? h(AgentDevicesDialog, {
              agent: manageAgent,
              agents,
              devices,
              busyId,
              onBind: (device) => bindDevice(manageAgent, device),
              onUnbind: (device) => unbindDevice(manageAgent, device),
              onDeviceAction: (action, device, value) => deviceAction(action, device, value),
              onClose: () => setManaging('')
            })
          : null
      );
    }
export { AgentsView }
