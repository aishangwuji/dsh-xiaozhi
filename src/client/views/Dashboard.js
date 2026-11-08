import { h, useState, useEffect } from '../react.js'
import { t, callApi } from '../core.js'
import { Metric, EndpointRow } from '../ui/primitives.js'
import { PillSelect } from '../ui/PillSelect.js'

    function Dashboard({ state, notify }) {
      const [probe, setProbe] = useState(null);
      const [probing, setProbing] = useState(false);
      const addresses = state.addresses || [];
      const [ip, setIp] = useState(addresses[0]?.ip || '');
      useEffect(() => {
        if (!ip && addresses.length > 0) setIp(addresses[0].ip);
      }, [addresses.length]);
      const online = (state.devices || []).filter((device) => device.online).length;
      const gateway = state.gateway || {};
      const port = state.listener?.port;
      const host = ip || state.endpoints?.lanIp || (state.listener?.host === '0.0.0.0' ? '127.0.0.1' : state.listener?.host);
      const ota = `http://${host}:${port}${state.endpoints?.otaPath || '/xiaozhi/ota/'}`;
      const ws = state.endpoints?.lanWsUrl || `ws://${host}:${port}/xiaozhi/v1/`;
      const gatewayUrl = `http://${host}:${port}`;

      const runProbe = async () => {
        setProbing(true);
        try {
          const result = await callApi('/probe/ota', { method: 'POST' });
          setProbe(result);
          notify(result.ok ? t('probeOk') : t('probeFail'), result.ok ? 'ok' : 'bad');
        } catch (error) {
          setProbe({ ok: false, error: error.message });
          notify(`${t('probeFail')}: ${error.message}`, 'bad');
        } finally {
          setProbing(false);
        }
      };

      return h('div', null,
        h('div', { className: 'xz-grid', style: { marginBottom: 16 } },
          h(Metric, { label: t('devicesTotal'), value: (state.devices || []).length, chip: t('devicesOnline') + ' ' + online }),
          h(Metric, { label: t('devicesOnline'), value: online, suffix: `/ ${(state.devices || []).length}` }),
          h(Metric, {
            label: t('voiceState'),
            value: state.voice?.enabled ? t('voiceOn') : t('voiceOff')
          }),
          h(Metric, {
            label: t('gatewayState'),
            value: gateway.enabled ? (gateway.commands || 0) : 0,
            suffix: gateway.enabled ? '' : t('gatewayOff'),
            chip: gateway.enabled ? t('gatewayOn').replace('{n}', String(gateway.commands || 0)) : t('gatewayOff'),
            chipKind: gateway.enabled ? 'ok' : 'mute'
          })
        ),
        h('div', { className: 'xz-card' },
          h('h3', null, t('endpointsTitle')),
          addresses.length > 1
            ? h('div', { className: 'xz-row', style: { marginBottom: 10 } },
                h('span', { className: 'xz-chip mute' }, t('addressPick')),
                h(PillSelect, {
                  value: host,
                  width: 320,
                  ariaLabel: t('addressPick'),
                  options: addresses.map((entry) => ({
                    value: entry.ip,
                    label: `${entry.ip} · ${entry.iface}${entry.virtual ? ` (${t('virtualNic')})` : ''}`,
                    hint: entry.virtual ? t('virtualNic') : ''
                  })),
                  onChange: (value) => setIp(value)
                })
              )
            : null,
          h(EndpointRow, { label: t('otaUrl'), value: ota, onCopied: () => notify(t('copied')) }),
          h(EndpointRow, { label: t('wsUrl'), value: ws, onCopied: () => notify(t('copied')) }),
          h(EndpointRow, { label: t('gatewayUrl'), value: gatewayUrl, onCopied: () => notify(t('copied')) }),
          h('div', { className: 'xz-row', style: { marginTop: 10 } },
            h('button', { className: 'xz-btn primary', disabled: probing, onClick: runProbe },
              probing ? t('probing') : t('probe'))
          ),
          probe ? h('pre', { className: 'xz-code', style: { marginTop: 12 } }, JSON.stringify(probe, null, 2)) : null
        ),
        h('div', { className: 'xz-card' },
          h('h3', null, t('lastEvents')),
          h('div', { className: 'xz-row', style: { gap: 8 } },
            (state.devices || []).length === 0
              ? h('span', { className: 'xz-chip mute' }, t('noEvents'))
              : (state.devices || []).slice(0, 6).map((device) =>
                  h('span', { key: device.deviceId, className: 'xz-chip mute' },
                    `${device.nickName || device.deviceId} · ${device.online ? t('online') : t('offline')}`)
                )
          )
        )
      );
    }
export { Dashboard }
