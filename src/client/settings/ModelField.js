import { h, useState, useEffect } from '../react.js'
import { PillSelect } from '../ui/PillSelect.js'

    /**
     * 模型选择器：选项来自服务端 `/models`（能连厂商接口就实时取，取不到用内置清单），
     * 拿不到任何选项时退回文本框，保证自定义模型名仍可手填。
     */
    /**
     * 模型选择器：**模型清单只来自厂商接口**（后端 `GET/POST /models`），前端不内置任何模型 id。
     *
     * - 弹窗里刚填了 Key（未保存）→ POST /models，把 Key 放请求体做即时预览（600ms 防抖）；
     * - 已保存的条目 → GET /models，后端按 `source`（primary/backup）+ `index` 取该条目的
     *   provider/baseUrl/apiKey 去拉 `GET {baseUrl}/models`；
     * - 接口不可达 / 没 Key → 空列表，退回文本框手填（不猜、不硬编码）。
     */
    function ModelField({
      kind, provider, hostProvider = '', source = 'primary', index, value, onChange, placeholder, baseUrl, probeKey
    }) {
      const [options, setOptions] = useState([]);
      useEffect(() => {
        let alive = true;
        setOptions([]);
        // provider="host"：模型清单来自 DSH（`GET /llm/providers?provider=<hostProvider>`），
        // 不走厂商接口、也不需要 Key；还没选 DSH 厂商时就是空清单（退回手填）。
        if (provider === 'host') {
          if (!hostProvider) return () => {
            alive = false;
          };
          fetch(`dsh-xiaozhi-7c3a/llm/providers?provider=${encodeURIComponent(hostProvider)}`)
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
              const list = Array.isArray(data?.models) ? data.models : [];
              if (alive) setOptions(list.map((item) => ({ value: item.value ?? item.id, label: item.label ?? item.name ?? item.id })).filter((item) => item.value));
            })
            .catch(() => {});
          return () => {
            alive = false;
          };
        }
        const rawKey = typeof probeKey === 'string' ? probeKey.trim() : '';
        const unsavedKey = rawKey && !rawKey.includes('•') && rawKey.length >= 8 ? rawKey : '';
        const timer = setTimeout(() => {
          const request = unsavedKey
            ? fetch('dsh-xiaozhi-7c3a/models', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-dsh-xiaozhi': '1' },
                body: JSON.stringify({ kind, provider, baseUrl: baseUrl || '', apiKey: unsavedKey })
              })
            : fetch(
                `dsh-xiaozhi-7c3a/models?kind=${encodeURIComponent(kind)}&provider=${encodeURIComponent(provider || '')}` +
                  `&source=${encodeURIComponent(source)}${Number.isInteger(index) ? `&index=${index}` : ''}`
              );
          request
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
              if (alive && Array.isArray(data?.options)) setOptions(data.options);
            })
            .catch(() => {});
        }, unsavedKey ? 600 : 0);
        return () => {
          alive = false;
          clearTimeout(timer);
        };
      }, [kind, provider, hostProvider, source, index, baseUrl, probeKey]);

      if (options.length === 0) {
        return h('input', { className: 'xz-input', value, placeholder, onChange: (e) => onChange(e.target.value) });
      }
      // 当前值可能不在厂商刚返回的清单里（模型下线 / 手工填的自定义 id / 清单接口只返回一部分）。
      // 直接交给 PillSelect 会显示「未选择」，看起来像配置丢了；把当前值补进选项，保证回显。
      const text = typeof value === 'string' ? value : '';
      const merged = text.trim() && !options.some((option) => option.value === value)
        ? [{ value, label: text }, ...options]
        : options;
      return h(PillSelect, {
        value,
        options: merged,
        ariaLabel: placeholder,
        placeholder,
        onChange
      });
    }
export { ModelField }
