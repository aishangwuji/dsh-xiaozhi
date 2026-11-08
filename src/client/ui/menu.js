import { h } from '../react.js'

    function IconCheck({ size = 13 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }, h('path', { d: 'm5 12.5 4.5 4.5L19 7' }));
    }

    function MenuItem({ active, onClick, children, hint, badge, disabled }) {
      return h('button', {
        type: 'button',
        role: 'option',
        'aria-selected': active ? 'true' : 'false',
        'aria-disabled': disabled ? 'true' : undefined,
        disabled: disabled ? true : undefined,
        className: `xz-menu-item${active ? ' active' : ''}${disabled ? ' is-disabled' : ''}`,
        onClick: disabled ? undefined : onClick
      },
        h('span', { className: 'xz-menu-label' }, children),
        badge ? h('span', { className: 'xz-menu-badge' }, String(badge)) : null,
        hint ? h('span', { className: 'xz-menu-hint' }, hint) : null,
        active ? h(IconCheck) : null
      );
    }
export { IconCheck, MenuItem }
