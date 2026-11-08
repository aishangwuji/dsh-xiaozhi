import { h, useState, useEffect, useCallback, useRef } from '../react.js'
import { t, callApi, POLL_MS } from '../core.js'
import { Console } from './Console.js'

    function XiaozhiPanel() {
      const [state, setState] = useState({ status: 'loading', data: null, error: '' });
      const [toast, setToast] = useState(null);
      const mounted = useRef(true);

      const notify = useCallback((message, kind = 'ok') => {
        setToast({ message, kind });
        window.setTimeout(() => setToast(null), 2600);
      }, []);

      const refresh = useCallback(async () => {
        try {
          const data = await callApi('/state');
          if (!mounted.current) return;
          setState({ status: 'ready', data, error: '' });
        } catch (error) {
          if (!mounted.current) return;
          setState((previous) => ({ ...previous, status: 'ready', error: error.message }));
        }
      }, []);

      useEffect(() => {
        mounted.current = true;
        void refresh();
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') void refresh();
        }, POLL_MS);
        return () => {
          mounted.current = false;
          window.clearInterval(timer);
        };
      }, [refresh]);

      // Keep this boring: the host gives the slot a height derived from our
      // content, so we simply claim at least one viewport (`min-height` on
      // .xz-app) and let the host scroll. Moving our root out of the host with
      // appendChild broke React's unmount (it removes the node from the parent it
      // recorded), which blanked the whole app when switching conversations.
      if (state.status === 'loading') {
        return h('div', {
          style: {
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--xz-text-3)',
            fontSize: 13
          }
        }, '…');
      }

      return h('div', { style: { width: '100%' } },
        h(Console, { state: state.data, refresh, notify }),
        toast ? h('div', { className: `xz-toast ${toast.kind === 'bad' ? 'bad' : ''}` }, toast.message) : null
      );
    }
export { XiaozhiPanel }
