import { h, useState, useEffect } from '../react.js'
import { t, callApi, toolLabel } from '../core.js'

    /** 独立的能力页：只读服务端 `/tools`，不依赖任何设备配置。 */
    function CapabilitiesView() {
      const [tools, setTools] = useState([]);
      const [status, setStatus] = useState('loading');

      // 每个工具都能单独开/关：关掉后服务端不再把它交给模型，也不再执行。
      const toggleTool = async (name, enabled) => {
        try {
          const data = await callApi('/tools/toggle', { method: 'POST', admin: true, body: { name, enabled } });
          if (Array.isArray(data?.tools)) setTools(data.tools);
        } catch {
          setStatus('error');
        }
      };

      useEffect(() => {
        let alive = true;
        fetch('dsh-xiaozhi-7c3a/tools')
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((data) => {
            if (!alive) return;
            setTools(Array.isArray(data?.tools) ? data.tools : []);
            setStatus('ready');
          })
          .catch(() => {
            if (alive) setStatus('error');
          });
        return () => {
          alive = false;
        };
      }, []);

      if (status === 'loading') return h('div', { className: 'xz-empty' }, t('loading'));
      if (status === 'error') return h('div', { className: 'xz-empty' }, t('actionFailed'));

      return h('div', { className: 'xz-card' },
        h('h3', null, t('capabilitiesTitle')),
        tools.length === 0
          ? h('div', { className: 'xz-empty' }, t('capabilityEmpty'))
          : h('div', { className: 'xz-capability-grid' },
              tools.map((tool) =>
                h('div', { key: tool.name, className: `xz-capability ${tool.enabled === false ? 'is-off' : 'is-on'}` },
                  h('span', { className: 'xz-capability-name' }, toolLabel(tool.name)),
                  h('button', {
                    type: 'button',
                    className: `xz-switch ${tool.enabled === false ? '' : 'on'}`,
                    role: 'switch',
                    'aria-checked': tool.enabled === false ? 'false' : 'true',
                    'aria-label': toolLabel(tool.name),
                    onClick: () => toggleTool(tool.name, tool.enabled === false)
                  }, h('span', null))
                )
              )
            ),
      );
    }
export { CapabilitiesView }
