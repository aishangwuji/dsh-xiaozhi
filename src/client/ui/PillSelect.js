import { h, useState, useEffect, useRef } from '../react.js'
import { t } from '../core.js'
import { MenuItem } from './menu.js'

    /** 悬浮面板与触发器的间距、视口留白、高度上限（与 CSS 的 max-height 一致）。 */
    const MENU_GAP = 6;
    const MENU_EDGE = 8;
    const MENU_MAX_HEIGHT = 340;

    /**
     * `position:fixed` 的包含块不一定是视口：祖先带 transform / filter / backdrop-filter /
     * perspective / contain:paint 时（本控制台里 `.xz-card`、`.xz-modal-mask` 都带
     * backdrop-filter），fixed 元素会相对那个祖先定位。返回最近的这类祖先，坐标计算时减掉
     * 它的 padding box 原点，菜单才能真的贴在触发器旁边（弹窗的 mask 是 inset:0 全屏，
     * 换算后坐标仍等于视口坐标）。
     */
    function fixedContainingBlock(el) {
      let node = el ? el.parentElement : null;
      while (node && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const transform = style.transform && style.transform !== 'none';
        const filter = style.filter && style.filter !== 'none';
        const backdrop = (style.backdropFilter && style.backdropFilter !== 'none')
          || (style.webkitBackdropFilter && style.webkitBackdropFilter !== 'none');
        const perspective = style.perspective && style.perspective !== 'none';
        const containPaint = typeof style.contain === 'string' && style.contain.includes('paint');
        const willChange = typeof style.willChange === 'string' && /transform|filter|perspective/.test(style.willChange);
        if (transform || filter || backdrop || perspective || containPaint || willChange) return node;
        node = node.parentElement;
      }
      return null;
    }

    /**
     * 胶囊触发器 + 悬浮命令面板，用来替代原生 <select>。规范见 `docs/pill-popover.md`。
     *
     * 原生 select 的系统弹层无法跟随设计令牌，和整体的胶囊语言冲突；这里锚定在
     * 触发器下方、点外部或 Esc 关闭、选中行右侧打勾。
     *
     * 面板用 `position:fixed` + 内联 left/top/width/maxHeight 渲染，不再依赖容器
     * `position:absolute`：绝对定位会参与页面可滚动高度的计算，在页面底部展开时滚动条
     * 出现/消失、整页内容横向位移（用户反馈的「点开下拉框整个页面 UI 也变了」）。
     * fixed 不参与布局，菜单再长也不改变页面尺寸；弹窗（mask 全屏）里同样贴触发器定位。
     *
     * options 支持（向后兼容，全部可选）：
     * - `group`：连续同组的选项只渲染一次 `.xz-menu-group` 标题；
     * - `disabled`：`opacity: .45`、不可点击（用于「不可选但需要解释为什么没有」的项）；
     * - 行内 `badge`：选项右侧的计数文字；
     * - 触发器 `badge`：胶囊右端的计数徽标（如该段已配置的备用数量）。
     * `width` 保留为「最大宽度」提示，`alignEnd` 保留为右对齐语义（坐标在 JS 里算）。
     */
    function PillSelect({ value, options, onChange, disabled, alignEnd, label, ariaLabel, width, badge, placeholder }) {
      const [open, setOpen] = useState(false);
      const [pos, setPos] = useState(null);
      const rootRef = useRef(null);
      const menuRef = useRef(null);
      const computeRef = useRef(() => null);

      /** 首帧还没渲染出菜单时按行数估算高度（分组标题也占一行），只用来决定上下翻转。 */
      const estimateHeight = () => {
        let groups = 0;
        let lastGroup = '';
        for (const option of options) {
          const group = option.group || '';
          if (group && group !== lastGroup) groups += 1;
          lastGroup = group;
        }
        return Math.min(MENU_MAX_HEIGHT, 14 + options.length * 32 + groups * 20);
      };

      const computePosition = (heightHint) => {
        const trigger = rootRef.current;
        if (!trigger) return null;
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        if (viewportWidth <= 0 || viewportHeight <= 0) return null;
        // fixed 的包含块可能是带 backdrop-filter 的祖先（本控制台里 .xz-card / .xz-modal-mask
        // 都有）：坐标要换算成相对它的局部坐标。但「视口还剩多少空间」必须按视口算，不能按
        // 卡片算——卡片比视口高时，按卡片算会导致该翻转时不翻转、菜单落到视口外面
        // （2026-11-07 无头 Chromium 实测）。
        const block = fixedContainingBlock(trigger);
        const blockRect = block ? block.getBoundingClientRect() : { left: 0, top: 0 };
        const blockLeft = blockRect.left + (block ? block.clientLeft : 0);
        const blockTop = blockRect.top + (block ? block.clientTop : 0);
        // 视口四边与触发器在包含块局部坐标系里的位置。
        const viewLeft = -blockLeft;
        const viewTop = -blockTop;
        const viewRight = viewportWidth - blockLeft;
        const viewBottom = viewportHeight - blockTop;
        const triggerLeft = rect.left - blockLeft;
        const triggerTop = rect.top - blockTop;
        const triggerRight = rect.right - blockLeft;
        const triggerBottom = rect.bottom - blockTop;
        const widthCap = Math.min(420, viewportWidth * 0.82, typeof width === 'number' ? width : Infinity);
        const menuWidth = Math.max(160, Math.min(Math.max(rect.width, 240), widthCap, viewportWidth - MENU_EDGE * 2));
        const spaceBelow = viewBottom - triggerBottom - MENU_GAP - MENU_EDGE;
        const spaceAbove = triggerTop - viewTop - MENU_GAP - MENU_EDGE;
        const wanted = Math.min(MENU_MAX_HEIGHT, Math.max(120, heightHint || estimateHeight()));
        // 下方放不下且上方更宽裕时向上翻转；两侧都不够就选空间大的一侧，内部滚动。
        const flipUp = wanted > spaceBelow && spaceAbove > spaceBelow;
        const available = Math.max(80, flipUp ? spaceAbove : spaceBelow);
        const maxHeight = Math.min(MENU_MAX_HEIGHT, available);
        const rendered = Math.min(wanted, maxHeight);
        const preferredLeft = alignEnd ? triggerRight - menuWidth : triggerLeft;
        const left = Math.max(
          viewLeft + MENU_EDGE,
          Math.min(preferredLeft, viewRight - menuWidth - MENU_EDGE)
        );
        const preferredTop = flipUp ? triggerTop - MENU_GAP - rendered : triggerBottom + MENU_GAP;
        const top = Math.max(
          viewTop + MENU_EDGE,
          Math.min(preferredTop, viewBottom - MENU_EDGE - rendered)
        );
        return {
          left: Math.round(left),
          top: Math.round(top),
          width: Math.round(menuWidth),
          maxHeight: Math.round(maxHeight)
        };
      };
      computeRef.current = computePosition;

      useEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        const sync = () => {
          const measured = menuRef.current ? menuRef.current.getBoundingClientRect().height : 0;
          const next = computeRef.current(measured || undefined);
          if (!next) return;
          setPos((previous) => {
            if (
              previous &&
              previous.left === next.left &&
              previous.top === next.top &&
              previous.width === next.width &&
              previous.maxHeight === next.maxHeight
            ) return previous;
            return next;
          });
        };
        // 点开那一帧先用估算高度定位；下一帧量到真实高度再修正一次，避免菜单闪一下就跳位置。
        sync();
        const frame = typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame(sync)
          : window.setTimeout(sync, 0);
        const onPointerDown = (event) => {
          const target = event.target;
          if (rootRef.current && rootRef.current.contains(target)) return;
          if (menuRef.current && menuRef.current.contains(target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        // 滚动 / 缩放时跟着触发器重新定位：关闭虽然更“稳”，但用户正在操作时会丢上下文。
        const onViewportChange = () => sync();
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onViewportChange, true);
        window.addEventListener('resize', onViewportChange);
        return () => {
          if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
          else window.clearTimeout(frame);
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', onViewportChange, true);
          window.removeEventListener('resize', onViewportChange);
        };
      }, [open]);

      const openMenu = () => {
        setPos(computePosition());
        setOpen(true);
      };

      const current = options.find((option) => option.value === value);
      let lastGroup = '';
      const rows = [];
      options.forEach((option, index) => {
        const group = option.group || '';
        if (group && group !== lastGroup) {
          rows.push(h('div', { key: `group-${index}`, className: 'xz-menu-group', role: 'presentation' }, group));
        }
        lastGroup = group;
        rows.push(h(MenuItem, {
          key: `${option.value ?? 'option'}-${index}`,
          active: option.value === value,
          hint: option.hint,
          badge: option.badge,
          disabled: option.disabled === true,
          onClick: () => {
            if (option.disabled) return;
            setOpen(false);
            if (option.value !== value) onChange(option.value);
          }
        }, option.label));
      });

      return h('span', {
        className: 'xz-pillselect',
        ref: rootRef,
        style: width ? { maxWidth: `${width}px` } : undefined
      },
        h('button', {
          type: 'button',
          className: 'xz-pillselect-trigger',
          disabled,
          onClick: () => (open ? setOpen(false) : openMenu()),
          'aria-haspopup': 'listbox',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': ariaLabel || label,
          title: current ? current.label : (placeholder || label)
        },
          h('span', { className: `xz-pill-label${current ? '' : ' xz-pill-placeholder'}` }, current ? current.label : (placeholder || t('selectPlaceholder'))),
          badge ? h('span', { className: 'xz-pillselect-badge' }, String(badge)) : null,
          h('span', { className: 'xz-pillselect-chevron', 'aria-hidden': 'true' })
        ),
        open && pos
          ? h('div', {
              ref: menuRef,
              className: `xz-menu${alignEnd ? ' xz-menu-end' : ''}`,
              role: 'listbox',
              'aria-label': ariaLabel || label,
              // position:fixed 由 CSS 给；left/top/width/maxHeight 用内联坐标，菜单不参与页面布局。
              style: {
                left: `${pos.left}px`,
                top: `${pos.top}px`,
                width: `${pos.width}px`,
                maxHeight: `${pos.maxHeight}px`
              }
            }, rows)
          : null
      );
    }
export { PillSelect }
