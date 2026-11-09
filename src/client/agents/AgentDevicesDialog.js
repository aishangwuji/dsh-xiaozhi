import { h } from '../react.js'
import { t } from '../core.js'

    /**
     * 智能体的「管理设备」弹窗：绑定 / 解绑 / 改名 / OTA / 封禁 / 断开 / 删除设备。
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
                      h('span', { className: `xz-dot ${device.online ? 'on' : ''}` }),
                      h('span', { className: 'xz-devcard-state' }, device.online ? t('online') : t('offline')),
                      device.blocked ? h('span', { className: 'xz-chip mute' }, t('blocked')) : null
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
                        onClick: () => onDeviceAction('block', device)
                      }, device.blocked ? t('unblock') : t('block')),
                      h('button', {
                        type: 'button',
                        className: 'xz-btn',
                        onClick: () => onUnbind(device)
                      }, t('agentUnbind')),
                      h('button', {
                        type: 'button',
                        className: 'xz-btn danger',
                        onClick: () => onDeviceAction('remove', device)
                      }, t('agentRemoveDevice'))
                    )
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
                        onClick: () => onBind(device)
                      }, t('agentMoveHere'))
                    )
                  )
                )
          )
        )
      );
    }

export { AgentDevicesDialog }
