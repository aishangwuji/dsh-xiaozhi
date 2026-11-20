import { h, useState, useRef, useEffect } from '../react.js'
import { t, callApi, formatAgo } from '../core.js'
import { PillSelect } from '../ui/PillSelect.js'
import { ROLE_PRESETS, matchRolePreset } from './rolePresets.js'
import { AgentConfigDialog } from './AgentConfigDialog.js'
import { AgentDevicesDialog } from './AgentDevicesDialog.js'
import { HistoryDialog } from './HistoryDialog.js'

    /**
     * 智能体页：卡片 = 智能体（配置单位），一台智能体可以绑定多台设备。
     *
     * 对齐参考服务端：人设/模型/音色/语种/记忆/工具都在智能体上（同一智能体的设备共用），
     * 设备只留物理属性与绑定关系。删除智能体级联删除它绑定的设备（与 deleteAgent 一致），
     * 所以删除入口做成二次确认，并把「会一起删几台设备」写在提示里。
     */
    // 操作条上的三个小图标（内联 SVG，避免为三个图标引入图标库）。
    const ACTION_PATHS = {
      config: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 7a2 2 0 1 0 0-.1z', 'M8 17a2 2 0 1 0 0-.1z'],
      history: ['M3.5 12a8.5 8.5 0 1 0 2.6-6.1', 'M3.5 5.5v4h4', 'M12 7.5V12l3 1.8'],
      devices: ['M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5z', 'M11 17.5h2']
    }
    const agentActionIcon = (name) => h('svg', {
      width: 14,
      height: 14,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      className: 'xz-agent-action-icon'
    }, (ACTION_PATHS[name] || []).map((d, index) => h('path', { key: index, d })))

    function AgentsView({ state, notify, onChanged }) {
      const [injecting, setInjecting] = useState(null);
      const [text, setText] = useState('');
      const [busyId, setBusyId] = useState('');
      const [configuring, setConfiguring] = useState('');
      const [managing, setManaging] = useState('');
      // 删除智能体走确认弹窗（2026-11-13 用户要求）：卡片菜单点一下就弹窗，不再「再次点击删除」。
      const [confirmAgent, setConfirmAgent] = useState('');
      const renameCancelled = useRef(false);
      const renameBusy = useRef(false);
      const [memory, setMemory] = useState([]);
      const [memoryDraft, setMemoryDraft] = useState('');
      const [toolCatalog, setToolCatalog] = useState([]);
      const [editing, setEditing] = useState('');
      const [editName, setEditName] = useState('');
      // 卡片右上角「⋯」菜单：position:fixed 贴着按钮弹出，不参与卡片布局。
      const [menu, setMenu] = useState(null);
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
      const deleteAgent = confirmAgent ? agents.find((item) => item.id === confirmAgent) || null : null;

      // 点空白 / Esc 关掉「⋯」菜单：菜单是浮层，不能跟着卡片一起滚进布局。
      useEffect(() => {
        if (!menu) return undefined;
        const close = (event) => {
          if (event?.target?.closest?.('.xz-agent-menu, .xz-agent-menu-btn')) return;
          setMenu(null);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setMenu(null);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', close);
          document.removeEventListener('keydown', onKey);
        };
      }, [menu]);

      /** 卡片上的「角色」= 人设命中的角色模板名；没命中就是自定义。 */
      const agentRoleName = (agent) => {
        const hit = matchRolePreset(agent.systemPrompt || '', agent.name || '');
        const preset = hit ? ROLE_PRESETS.find((item) => item.id === hit) : null;
        return preset ? t(preset.labelKey) : t('agentRoleCustom');
      };

      /** 状态徽标：会话在跑 → 运行中；没绑设备 → 未绑定；绑了 → 在线/离线。 */
      const agentChip = (agent) => {
        if (agent.session && agent.session.running) return { kind: 'ok', text: t('sessionRunning') };
        if ((agent.deviceCount ?? 0) === 0) return { kind: 'warn', text: t('agentUnbound') };
        return agent.online
          ? { kind: 'ok', text: t('online') }
          : { kind: '', text: t('offline') };
      };

      const createAgent = async () => {
        setBusyId('new');
        try {
          const data = await callApi('/agents', {
            method: 'POST',
            // 新 Bot 默认走 DSH 会话（Bot 本身是主推形态）；直连模型仍可在配置里切回。
            body: { name: nextDefaultName(), backend: 'session' }
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
        // 级联删除是破坏性操作：确认弹窗里点「删除」才会走到这里。
        setConfirmAgent('');
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
        if (action === 'rename' && (device.nickName || '') === String(value ?? '')) return;
        setBusyId(device.deviceId);
        try {
          if (action === 'rename') {
            await callApi('/devices/rename', { method: 'POST', body: { deviceId: device.deviceId, nickName: value } });
          } else if (action === 'ota') {
            await callApi('/devices/ota', { method: 'POST', body: { deviceId: device.deviceId, enabled: value === true } });
          } else if (action === 'disconnect') {
            await callApi('/devices/disconnect', { method: 'POST', body: { deviceId: device.deviceId } });
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
            : h('div', null,
                h('p', { className: 'xz-hint', style: { marginTop: 0 } }, t('botsHint')),
                h('div', { className: 'xz-card-grid' },
                agents.map((agent) => {
                  const chip = agentChip(agent);
                  const startRename = () => {
                    setEditing(agent.id);
                    setEditName(agent.name || '');
                  };
                  const toggleMenu = (event) => {
                    if (menu?.id === agent.id) {
                      setMenu(null);
                      return;
                    }
                    // 菜单相对卡片定位（卡片 position:relative）：卡片外层 .xz-card 有 backdrop-filter，
                    // 会成为 fixed 元素的包含块，用视口坐标会整体偏移、还会被卡片圆角/溢出裁掉。
                    // 所以这里算「相对卡片」的坐标，并给下方留不足时向上翻。
                    const button = event.currentTarget;
                    const cardBox = button.closest('.xz-agent-card').getBoundingClientRect();
                    const rect = button.getBoundingClientRect();
                    const openUp = window.innerHeight - rect.bottom < 150;
                    setMenu({
                      id: agent.id,
                      right: Math.max(8, cardBox.right - rect.right),
                      top: openUp ? null : rect.bottom - cardBox.top + 6,
                      bottom: openUp ? cardBox.bottom - rect.top + 6 : null
                    });
                  };
                  const cell = (label, value, title) =>
                    h('div', { className: 'xz-agent-cell' },
                      h('div', { className: 'xz-agent-cell-label' }, label),
                      h('div', { className: 'xz-agent-cell-value', title: title || value }, value)
                    );
                  return h('div', { key: agent.id, className: 'xz-agent-card' },
                    h('div', { className: 'xz-agent-head' },
                      h('span', { className: 'xz-agent-avatar', 'aria-hidden': 'true' },
                        (agent.name || '?').trim().slice(0, 1) || '?'),
                      h('div', { className: 'xz-agent-titlebar' },
                        editing === agent.id
                          ? h('input', {
                              className: 'xz-input xz-agent-rename',
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
                          : h('h3', {
                              className: 'xz-agent-name',
                              title: t('rename'),
                              onClick: startRename
                            }, agent.name || t('unnamed')),
                        h('span', { className: `xz-agent-chip ${chip.kind}` }, chip.text)
                      ),
                      h('button', {
                        type: 'button',
                        className: 'xz-agent-menu-btn',
                        'aria-label': t('agentMenu'),
                        'aria-haspopup': 'menu',
                        'aria-expanded': menu?.id === agent.id,
                        onClick: toggleMenu
                      }, '⋯')
                    ),
                    menu?.id === agent.id
                      ? h('div', {
                          className: 'xz-menu xz-agent-menu',
                          role: 'menu',
                          style: {
                            position: 'absolute',
                            right: menu.right,
                            left: 'auto',
                            top: menu.top ?? 'auto',
                            bottom: menu.bottom ?? 'auto'
                          }
                        },
                          h('button', {
                            type: 'button',
                            className: 'xz-provider-menu-item',
                            onClick: () => {
                              setMenu(null);
                              setInjecting(agent);
                              setText('');
                            }
                          }, `${t('inject')}…`),
                          h('button', {
                            type: 'button',
                            className: 'xz-provider-menu-item',
                            onClick: () => {
                              setMenu(null);
                              startRename();
                            }
                          }, t('agentMenuRename')),
                          h('button', {
                            type: 'button',
                            className: 'xz-provider-menu-item is-danger',
                            disabled: busyId === agent.id,
                            title: t('agentDeleteHint'),
                            onClick: () => {
                              setMenu(null);
                              setConfirmAgent(agent.id);
                            }
                          }, t('agentMenuDelete'))
                        )
                      : null,
                    h('div', { className: 'xz-agent-grid' },
                      cell(t('agentRole'), agentRoleName(agent)),
                      cell(
                        t('agentModel'),
                        agent.overrides?.model || t('agentModelDefault'),
                        agent.overrides?.model || ''
                      ),
                      cell(t('agentRecentChat'), formatAgo(agent.lastSeenAt))
                    ),
                    h('div', { className: 'xz-agent-actions' },
                      h('button', {
                        type: 'button',
                        className: 'xz-agent-action',
                        onClick: () => openConfig(agent.id)
                      }, agentActionIcon('config'), t('configure')),
                      h('button', {
                        type: 'button',
                        className: 'xz-agent-action',
                        onClick: () => {
                          setConfiguring('');
                          setHistoryAgent(agent);
                        }
                      }, agentActionIcon('history'), t('history')),
                      h('button', {
                        type: 'button',
                        className: 'xz-agent-action',
                        onClick: () => setManaging(agent.id)
                      }, agentActionIcon('devices'), `${t('agentDevices')} (${agent.deviceCount ?? 0})`)
                    )
                  );
                })
              ))
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
        deleteAgent
          ? h('div', { className: 'xz-modal-mask', onClick: () => setConfirmAgent('') },
              h('div', {
                className: 'xz-modal xz-confirm-modal',
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': t('agentDeleteTitle'),
                onClick: (event) => event.stopPropagation()
              },
                h('h3', null, t('agentDeleteTitle')),
                h('p', { className: 'xz-confirm-text' },
                  t('agentDeleteBody').replace('{name}', deleteAgent.name || t('unnamed'))
                ),
                h('div', { className: 'xz-row xz-confirm-foot' },
                  h('button', { className: 'xz-btn', onClick: () => setConfirmAgent('') }, t('cancel')),
                  h('button', {
                    className: 'xz-btn danger-confirm',
                    disabled: busyId === deleteAgent.id,
                    onClick: () => removeAgent(deleteAgent)
                  }, t('remove'))
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
              onClose: () => setConfiguring(''),
              notify
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
