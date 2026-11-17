import { h, useState } from '../react.js'
import { t, callApi } from '../core.js'

    /**
     * 智能体的「管理设备」弹窗：绑定 / 解绑 / 改名 / OTA / 断开 / 删除设备。
     *
     * 页面单位是智能体，设备的物理操作收在这里，卡片上只留最常用的配置/历史/播报/删除。
     */
    function AgentDevicesDialog({ agent, agents = [], devices, busyId, onBind, onUnbind, onDeviceAction, onClose }) {
      const bound = agent.devices || [];
      const boundIds = new Set(bound.map((device) => device.deviceId));
      const unbound = devices.filter((device) => !boundIds.has(device.deviceId));
      const agentName = (id) => agents.find((item) => item.id === id)?.name || t('unnamed');
      // 设备名按字数给宽度，别用一个固定 180px 的大输入框把整行撑得很笨重。
      const renameWidth = (name) => Math.min(180, Math.max(88, String(name || '').length * 13 + 28));
      // 「移入本智能体」会改归属（从别的智能体手里拿走），所以先弹一次确认，不做一键生效。
      const [pendingMove, setPendingMove] = useState(null);
      // 设备工具：按需拉取，只读展示设备侧 MCP 上报的工具。
      const [toolViews, setToolViews] = useState({});
      const viewOf = (id) => toolViews[id] || {};
      const toggleTools = (device) => {
        const id = device.deviceId;
        const current = toolViews[id] || {};
        if (current.open) {
          setToolViews((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), open: false } }));
          return;
        }
        setToolViews((prev) => ({ ...prev, [id]: { open: true, loading: true, error: '', data: null } }));
        callApi(`/devices/tools?deviceId=${encodeURIComponent(id)}`)
          .then((data) =>
            setToolViews((prev) => ({ ...prev, [id]: { open: true, loading: false, error: '', data } }))
          )
          .catch((error) =>
            setToolViews((prev) => ({ ...prev, [id]: { open: true, loading: false, error: error.message, data: null } }))
          );
      };
      const toolsPanel = (device) => {
        const view = viewOf(device.deviceId);
        if (!view.open) return null;
        let body;
        if (view.loading) body = h('div', { className: 'xz-hint' }, t('deviceToolsLoading'));
        else if (view.error) body = h('div', { className: 'xz-hint' }, `${t('deviceToolsFailed')}：${view.error}`);
        else if (!view.data.online) body = h('div', { className: 'xz-hint' }, t('deviceToolsOffline'));
        else if (!view.data.ready) body = h('div', { className: 'xz-hint' }, t('deviceToolsWait'));
        else if (!view.data.tools || view.data.tools.length === 0) {
          body = h('div', { className: 'xz-hint' }, t('deviceToolsEmpty'));
        } else {
          body = h('div', { className: 'xz-device-tool-list' },
            view.data.tools.map((tool) =>
              h('div', { key: tool.name, className: 'xz-device-tool' },
                h('code', null, tool.name),
                tool.description ? h('span', null, tool.description) : null
              )
            )
          );
        }
        return h('div', { className: 'xz-device-tools' }, body);
      };
      const targetName = agent.name || t('unnamed');
      return h('div', { className: 'xz-modal-mask', onClick: onClose },
        h('div', {
          className: 'xz-modal xz-devices-modal',
          role: 'dialog',
          'aria-modal': 'true',
          onClick: (event) => event.stopPropagation()
        },
          h('div', { className: 'xz-devices-head' },
            h('div', { className: 'xz-devices-head-text' },
              h('h3', null, `${t('agentBindTitle')} · ${agent.name || t('unnamed')}`),
              h('p', null, t('agentBindHint'))
            ),
            h('button', {
              type: 'button',
              className: 'xz-modal-close',
              'aria-label': t('close'),
              onClick: onClose
            }, '×')
          ),
          h('div', { className: 'xz-modal-body' },
            h('div', { className: 'xz-device-section-title' }, `${t('agentBoundTitle')}（${bound.length}）`),
            bound.length === 0
              ? h('div', { className: 'xz-hint' }, t('agentNoDevices'))
              : bound.map((device) =>
                  h('div', { key: device.deviceId, className: 'xz-device-row' },
                    h('div', { className: 'xz-device-row-main' },
                      h('input', {
                        className: 'xz-input xz-device-rename',
                        style: { width: `${renameWidth(device.nickName)}px` },
                        defaultValue: device.nickName || '',
                        placeholder: t('name'),
                        'aria-label': t('name'),
                        maxLength: 40,
                        onBlur: (event) => onDeviceAction('rename', device, event.target.value)
                      }),
                      h('span', { className: 'xz-device-row-mac' }, device.deviceId),
                      h('span', { className: 'xz-hint', style: { marginLeft: 8 } },
                        `${t('firmwareVersion')} ${device.firmwareVersion || '—'}`),
                      h('span', { className: `xz-dot ${device.online ? 'on' : ''}` }),
                      h('span', { className: 'xz-devcard-state' }, device.online ? t('online') : t('offline'))
                    ),
                    h('div', { className: 'xz-device-row-actions' },
                      h('button', {
                        type: 'button',
                        className: 'xz-btn',
                        disabled: busyId === device.deviceId,
                        onClick: () => onDeviceAction('ota', device, device.otaEnabled === false)
                      }, `${t('otaUpgrade')} ${device.otaEnabled === false ? '✕' : '✓'}`),
                      device.online
                        ? h('button', {
                            type: 'button',
                            className: 'xz-btn',
                            onClick: () => onDeviceAction('disconnect', device)
                          }, t('disconnect'))
                        : null,
                      h('button', {
                        type: 'button',
                        className: 'xz-btn',
                        onClick: () => toggleTools(device)
                      }, `${t('deviceTools')} ${viewOf(device.deviceId).open ? '▲' : '▼'}`),
                      h('button', {
                        type: 'button',
                        className: 'xz-btn',
                        onClick: () => onUnbind(device)
                      }, t('agentUnbind'))
                    ),
                    toolsPanel(device)
                  )
                ),
            h('div', { className: 'xz-device-section-title', style: { marginTop: 16 } }, `${t('agentOtherTitle')}（${unbound.length}）`),
            unbound.length === 0
              ? h('div', { className: 'xz-hint' }, t('agentNoUnbound'))
              : unbound.map((device) =>
                  h('div', { key: device.deviceId, className: 'xz-device-row xz-device-row-inline' },
                    h('div', { className: 'xz-device-row-main' },
                      h('span', { className: 'xz-devcard-value' }, device.nickName || t('unnamed')),
                      h('span', { className: 'xz-device-row-mac' }, device.deviceId),
                      h('span', { className: 'xz-chip' },
                        device.agentId
                          ? `${t('agentCurrentOwner')} ${agentName(device.agentId)}`
                          : t('agentUnbound')
                      )
                    ),
                    h('div', { className: 'xz-device-row-actions' },
                      h('button', {
                        type: 'button',
                        className: 'xz-btn primary',
                        disabled: busyId === device.deviceId,
                        onClick: () => setPendingMove(device)
                      }, t('agentMoveHere'))
                    )
                  )
                )
          ),
          pendingMove
            ? h('div', {
                className: 'xz-modal-mask',
                style: { zIndex: 60 },
                onClick: (event) => {
                  event.stopPropagation();
                  setPendingMove(null);
                }
              },
                h('div', {
                  className: 'xz-modal xz-confirm-modal',
                  role: 'dialog',
                  'aria-modal': 'true',
                  'aria-label': t('agentMoveTitle'),
                  onClick: (event) => event.stopPropagation()
                },
                  h('h3', null, t('agentMoveTitle')),
                  h('p', { className: 'xz-confirm-text' },
                    (pendingMove.agentId ? t('agentMoveBody') : t('agentBindBody'))
                      .replace('{name}', pendingMove.nickName || pendingMove.deviceId)
                      .replace('{from}', pendingMove.agentId ? agentName(pendingMove.agentId) : '')
                      .replace('{to}', targetName)
                  ),
                  h('div', { className: 'xz-row xz-confirm-foot' },
                    h('button', {
                      type: 'button',
                      className: 'xz-btn',
                      onClick: () => setPendingMove(null)
                    }, t('cancel')),
                    h('button', {
                      type: 'button',
                      className: 'xz-btn primary',
                      disabled: busyId === pendingMove.deviceId,
                      onClick: () => {
                        const device = pendingMove;
                        setPendingMove(null);
                        onBind(device);
                      }
                    }, t('agentMoveAction'))
                  )
                )
              )
            : null
        )
      );
    }

export { AgentDevicesDialog }
