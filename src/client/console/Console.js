import { h, useState, useEffect, useRef } from '../react.js'
import { t } from '../core.js'
import { Icon } from '../ui/Icon.js'
import { Dashboard } from '../views/Dashboard.js'
import { AgentsView } from '../agents/AgentsView.js'
import { ConfigWizard } from '../settings/ConfigWizard.js'

    function Console({ state, refresh, notify }) {
      const [view, setView] = useState('overview');
      const appRef = useRef(null);

      /**
       * 控制台渲染在宿主面板里：宿主可能把高度定死、也可能让内容自然撑高。
       * 统一把 `.xz-app` 钉成「视口高度 - 顶端偏移」，让 `.xz-content` 成为唯一滚动容器。
       * 不用纯 CSS `height:100vh` 是因为宿主面板上方可能还有自己的 header，100vh 会被裁掉底部；
       * 2026-11-07 之前靠宿主页面滚动，单页配置变长后整页滑不动，这里改成自持滚动。
       */
      useEffect(() => {
        const node = appRef.current;
        if (!node) return undefined;
        const apply = () => {
          const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
          if (!viewport) return;
          const top = Math.max(0, Math.round(node.getBoundingClientRect().top || 0));
          node.style.height = `${Math.max(320, viewport - top)}px`;
        };
        apply();
        // 宿主可能在本帧之后才把面板挂到最终位置，补测一次。
        const raf = typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame(apply)
          : 0;
        const onScroll = () => apply();
        window.addEventListener('resize', apply);
        window.addEventListener('scroll', onScroll, true);
        return () => {
          window.removeEventListener('resize', apply);
          window.removeEventListener('scroll', onScroll, true);
          if (raf) window.cancelAnimationFrame(raf);
        };
      }, [view]);

      // 「行为档案」页已删除（配置改成智能体 overrides 直配，全局默认搬进设置），
      // 所以侧栏只剩三个平级入口，不再需要可折叠分组。
      const nav = [
        { id: 'overview', label: t('navOverview'), icon: 'overview' },
        { id: 'agents', label: t('navDevices'), icon: 'devices' },
        { id: 'config', label: t('navGlobal'), icon: 'config' }
      ];

      const content =
        view === 'agents'
          ? h(AgentsView, { state, notify, onChanged: refresh })
          : view === 'config'
            ? h(ConfigWizard, { state, notify })
            : h(Dashboard, { state, notify });

      const title =
        view === 'agents' ? t('devicesTitle') : view === 'config' ? t('navGlobal') : t('overview');

      return h('div', { className: 'xz-app', ref: appRef },
        h('aside', { className: 'xz-side' },
          h('div', { className: 'xz-brand' },
            h('div', { className: 'xz-brand-mark' }, h(Icon, { name: 'devices', size: 18 })),
            h('div', null,
              h('div', { className: 'xz-brand-title' }, t('brand')),
              h('div', { className: 'xz-brand-sub' },
                `${state.endpoints?.lanIp || state.listener?.host}:${state.listener?.port}`)
            )
          ),
          h('nav', { className: 'xz-nav' },
            nav.map((item) =>
              h('button', {
                key: item.id,
                className: `xz-nav-item ${view === item.id ? 'active' : ''}`,
                onClick: () => setView(item.id)
              }, h(Icon, { name: item.icon }), item.label)
            )
          )
        ),
        h('main', { className: 'xz-main' },
          h('div', { className: 'xz-header' },
            h('div', null,
              h('h1', { className: 'xz-h1' }, title)
            ),
            h('div', { className: 'xz-spacer' }),
            h('button', { className: 'xz-btn', onClick: refresh }, '↻')
          ),
          h('div', { className: 'xz-content' }, content)
        ),
        h('div', { className: 'xz-tabbar' },
          nav.map((item) =>
            h('button', {
              key: item.id,
              className: view === item.id ? 'active' : '',
              onClick: () => setView(item.id)
            }, h(Icon, { name: item.icon, size: 18 }), item.label)
          )
        )
      );
    }
export { Console }
