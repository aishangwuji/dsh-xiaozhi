import { h } from '../react.js'

    const ICONS = {
      overview:
        'M3 10.5 12 3l9 7.5M5 10v10h14V10',
      devices:
        'M4 5h16v11H4zM9 20h6M12 16v4',
      profiles:
        'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
      config:
        'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM4 12h2M18 12h2M12 4v2M12 18v2M6.5 6.5 8 8M16 16l1.5 1.5M17.5 6.5 16 8M8 16l-1.5 1.5'
    };

    function Icon({ name, size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }, h('path', { d: ICONS[name] || ICONS.overview }));
    }
    function XiaozhiIcon({ size = 20, active, openPanel }) {
      const handleClick = openPanel
        ? () => {
            try {
              openPanel();
            } catch (error) {
              console.error('[dsh-xiaozhi] could not open panel from sidebar', error);
            }
          }
        : undefined;
      return h('span', {
        style: {
          display: 'inline-flex',
          color: active ? 'var(--dsw-alias-label-primary, currentColor)' : 'var(--dsw-alias-label-secondary, currentColor)',
          cursor: openPanel ? 'pointer' : undefined
        },
        onClick: handleClick
      },
        h('svg', {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true'
        },
          h('rect', { x: 5, y: 6, width: 14, height: 12, rx: 3 }),
          h('circle', { cx: 12, cy: 12, r: 2.6 }),
          h('path', { d: 'M12 18v3' }),
          h('path', { d: 'M8.5 3.5 12 6l3.5-2.5' })
        )
      );
    }
export { Icon, XiaozhiIcon }
