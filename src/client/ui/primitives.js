import { h } from '../react.js'
import { t } from '../core.js'

    function Badge({ kind = 'ok', children }) {
      return h('span', { className: `xz-chip ${kind === 'ok' ? '' : kind === 'mute' ? 'mute' : kind}` }, children);
    }

    function Metric({ label, value, suffix, chip, chipKind }) {
      return h('div', { className: 'xz-metric' },
        h('div', { className: 'k' }, label),
        h('div', { className: 'v' }, String(value), suffix ? h('small', null, suffix) : null),
        chip ? h('div', { style: { marginTop: 8 } }, h(Badge, { kind: chipKind }, chip)) : null
      );
    }

    function EndpointRow({ label, value, onCopied }) {
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(value);
          onCopied?.();
        } catch {
          /* clipboard blocked */
        }
      };
      return h('div', { className: 'xz-endpoint' },
        h('span', { className: 'label' }, label),
        h('code', { title: value }, value || '—'),
        h('button', { className: 'xz-btn ghost', onClick: copy }, t('copy'))
      );
    }
export { Badge, Metric, EndpointRow }
