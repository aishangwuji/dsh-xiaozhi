    const CSS = `
.xz-app{scrollbar-gutter:stable;--xz-bg:#f5f7fa;--xz-bg-soft:#fbfcfe;--xz-surface:rgba(255,255,255,.82);--xz-surface-strong:#fff;--xz-surface-muted:#f8fafc;--xz-primary:#007aff;--xz-primary-pressed:#0062cc;--xz-primary-soft:rgba(0,122,255,.1);--xz-success:#34c759;--xz-warning:#ff9f0a;--xz-danger:#ff3b30;--xz-text:#1d1d1f;--xz-text-2:#6e6e73;--xz-text-3:#8e8e93;--xz-line:#e5e5ea;--xz-radius-xl:28px;--xz-radius-lg:22px;--xz-radius-md:18px;--xz-radius-sm:14px;--xz-shadow-sm:0 10px 28px rgba(15,23,42,.05);--xz-shadow-md:0 16px 36px rgba(15,23,42,.07);--xz-shadow-lg:0 24px 56px rgba(15,23,42,.1);--xz-font:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Segoe UI",sans-serif;height:100vh;max-height:100vh;overflow:hidden;display:flex;background:linear-gradient(180deg,#f7f9fc 0%,#f2f5f9 100%);color:var(--xz-text);font-family:var(--xz-font);box-sizing:border-box}
.xz-side{width:264px;flex:none;overflow-y:auto;margin:18px 0 18px 18px;padding:20px 16px;border-radius:var(--xz-radius-xl);background:var(--xz-surface);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.88);box-shadow:var(--xz-shadow-md);display:flex;flex-direction:column;gap:18px;box-sizing:border-box}
.xz-brand{display:flex;align-items:center;gap:10px;padding:0 6px}
.xz-brand-mark{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#0a84ff,#5ac8fa);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 8px 18px rgba(10,132,255,.35)}
.xz-brand-title{font-size:15px;font-weight:650;letter-spacing:.2px}
.xz-brand-sub{font-size:11px;color:var(--xz-text-3);margin-top:2px}
.xz-nav{display:flex;flex-direction:column;gap:4px}
.xz-nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--xz-radius-sm);border:none;background:transparent;color:var(--xz-text-2);font-size:13px;font-family:inherit;cursor:pointer;text-align:left;transition:background .18s ease,color .18s ease,transform .18s ease}
.xz-nav-item:hover{background:rgba(0,0,0,.035);color:var(--xz-text)}
.xz-nav-item.active{background:var(--xz-surface-strong);color:var(--xz-primary);box-shadow:var(--xz-shadow-sm);font-weight:600}
.xz-nav-item.locked{opacity:.55;cursor:not-allowed}
.xz-nav-group{width:100%}
.xz-nav-group .xz-caret{margin-left:auto;transition:transform .18s ease;font-size:11px;color:var(--xz-text-3, #9a9a9a)}
.xz-nav-group .xz-caret.open{transform:rotate(0deg)}
.xz-nav-group .xz-caret:not(.open){transform:rotate(-90deg)}
.xz-nav-sub{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px 14px;padding-left:10px;border-left:1px solid rgba(0,0,0,.07)}
.xz-nav-child{font-size:12.5px;padding:8px 10px}

.xz-main{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:18px 22px 0}
.xz-header{display:flex;align-items:flex-end;gap:14px;margin-bottom:16px}
.xz-h1{font-size:22px;font-weight:680;letter-spacing:-.2px;margin:0}
.xz-sub{font-size:12px;color:var(--xz-text-2);margin:4px 0 0}
.xz-spacer{flex:1}
.xz-content{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable;padding-bottom:26px}
.xz-card{background:var(--xz-surface);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.88);border-radius:var(--xz-radius-lg);box-shadow:var(--xz-shadow-sm);padding:18px 20px;margin-bottom:14px}
/* 待审核卡片里有 PillSelect：backdrop-filter 会建立 fixed 包含块并把菜单裁在卡片底边，
   所以这张卡片不用毛玻璃，菜单按视口定位，才能完整列出所有智能体。 */
.xz-pending-card{backdrop-filter:none;background:var(--xz-surface-strong)}
.xz-card h3{margin:0 0 4px;font-size:14px;font-weight:650}
.xz-card p.xz-hint{margin:0 0 14px;font-size:12px;color:var(--xz-text-2);line-height:1.5}
.xz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.xz-metric{padding:16px 18px;border-radius:var(--xz-radius-md);background:var(--xz-surface-strong);box-shadow:var(--xz-shadow-sm);border:1px solid rgba(0,0,0,.03)}
.xz-metric .k{font-size:12px;color:var(--xz-text-2)}
.xz-metric .v{font-size:26px;font-weight:700;letter-spacing:-.5px;margin-top:6px}
.xz-metric .v small{font-size:12px;font-weight:500;color:var(--xz-text-3);margin-left:4px}
.xz-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 9px;border-radius:999px;background:rgba(52,199,89,.12);color:#1f9d45;font-weight:600}
.xz-chip.warn{background:rgba(255,159,10,.14);color:#b26a00}
.xz-chip.bad{background:rgba(255,59,48,.12);color:#c9271f}
.xz-chip.mute{background:rgba(142,142,147,.14);color:var(--xz-text-2)}
.xz-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.xz-endpoint{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:var(--xz-radius-sm);background:var(--xz-surface-muted);border:1px solid var(--xz-line);margin-bottom:8px}
.xz-endpoint .label{font-size:11px;color:var(--xz-text-3);width:96px;flex:none}
.xz-endpoint code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.xz-btn{appearance:none;border:1px solid rgba(0,0,0,.08);background:var(--xz-surface-strong);color:var(--xz-text);border-radius:12px;padding:7px 13px;font-size:12px;font-family:inherit;cursor:pointer;transition:transform .12s ease,box-shadow .18s ease,background .18s ease}
.xz-btn:hover:not(:disabled){box-shadow:var(--xz-shadow-sm);transform:translateY(-1px)}
.xz-btn:disabled{opacity:.45;cursor:default}
.xz-btn.primary{background:var(--xz-primary);border-color:transparent;color:#fff;box-shadow:0 8px 20px rgba(0,122,255,.28)}
.xz-btn.primary:hover:not(:disabled){background:var(--xz-primary-pressed)}
.xz-btn.danger{color:var(--xz-danger)}
.xz-btn.ghost{background:transparent;border-color:transparent;color:var(--xz-primary)}
.xz-editor{border:1px solid var(--xz-line);border-radius:var(--xz-radius-md);padding:16px;margin-bottom:16px;background:var(--xz-surface)}
.xz-editor-head{display:flex;gap:12px;margin-bottom:12px}
.xz-tabs{display:flex;gap:6px;padding:4px;background:rgba(0,0,0,.04);border-radius:12px;margin-bottom:14px;width:fit-content}
.xz-tab{border:none;background:transparent;font-family:inherit;font-size:12.5px;color:var(--xz-text-2);padding:6px 14px;border-radius:9px;cursor:pointer;transition:background .16s ease,color .16s ease}
.xz-tab:hover{color:var(--xz-text)}
.xz-tab.active{background:var(--xz-surface-strong);color:var(--xz-text);font-weight:600;box-shadow:var(--xz-shadow-sm)}
.xz-pane{display:flex;flex-direction:column;gap:12px}
.xz-inset{background:rgba(0,0,0,.02);border:1px solid var(--xz-line);box-shadow:none;padding:14px;margin:0}
.xz-card-title{font-size:12px;font-weight:600;color:var(--xz-text-2);margin-bottom:10px}
.xz-slider{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.xz-slider-head{display:flex;justify-content:space-between;font-size:12px;color:var(--xz-text-2)}
.xz-slider-value{color:var(--xz-text-3);font-variant-numeric:tabular-nums}
.xz-slider input[type=range]{width:100%;height:4px;border-radius:999px;appearance:none;background:linear-gradient(90deg,#0a84ff,rgba(10,132,255,.25));outline:none}
.xz-slider input[type=range]::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #0a84ff;box-shadow:0 1px 4px rgba(0,0,0,.18);cursor:pointer}
.xz-slider-scale{display:flex;justify-content:space-between;font-size:10.5px;color:var(--xz-text-3)}
.xz-capability-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
.xz-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;align-items:start}
.xz-devcard{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--xz-line);border-radius:14px;background:var(--xz-surface-strong)}
.xz-devcard-head{display:flex;align-items:center;gap:10px}
.xz-devcard-mark{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:var(--xz-primary-soft);color:var(--xz-primary);flex:none}
.xz-devcard-title{display:flex;align-items:center;font-size:13.5px;flex:1;min-width:0}
.xz-devcard-state{font-size:11.5px;color:var(--xz-text-3)}
.xz-devcard-mac{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--xz-text-3)}
.xz-devcard-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--xz-line);border-bottom:1px solid var(--xz-line)}
.xz-devcard-label{display:block;font-size:10.5px;color:var(--xz-text-3);margin-bottom:4px}
.xz-devcard-value{font-size:12.5px}
.xz-memory-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.xz-memory-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid var(--xz-line);border-radius:9px;font-size:12px}
.xz-devcard-config{border-top:1px solid var(--xz-line);padding-top:10px}
.xz-devcard-config .xz-capability{padding:6px 8px;font-size:12px}
.xz-devcard-foot{display:flex;gap:6px;flex-wrap:wrap}
.xz-switch{position:relative;width:38px;height:22px;border-radius:999px;border:none;background:rgba(0,0,0,.16);cursor:pointer;padding:0;transition:background .18s ease}
.xz-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.22);transition:transform .18s ease}
.xz-switch.on{background:#0a84ff}
.xz-switch.on span{transform:translateX(16px)}
.xz-switch:disabled{opacity:.5;cursor:default}
.xz-details{padding:0 14px 12px}
.xz-details>summary{cursor:pointer;list-style:none;padding:12px 0;font-size:12.5px;font-weight:600;color:var(--xz-text-2)}
.xz-details>summary::-webkit-details-marker{display:none}
.xz-details>summary::after{content:'▾';float:right;color:var(--xz-text-3);font-size:11px;transition:transform .18s ease}
.xz-details[open]>summary::after{transform:rotate(180deg)}
.xz-capability{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--xz-line);border-radius:10px;font-size:12.5px;background:var(--xz-surface-strong)}
.xz-capability-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.xz-capability-name{font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xz-capability .xz-switch{margin-left:auto;flex:none}
.xz-capability-desc{font-size:11px;color:var(--xz-text-3);line-height:1.35}
.xz-capability-dot{width:8px;height:8px;border-radius:50%;background:rgba(0,0,0,.18);flex:none}
.xz-capability.is-on .xz-capability-dot{background:#30d158}
.xz-capability-tag.on{color:#0a7f3f;border-color:rgba(48,209,88,.45);background:rgba(48,209,88,.10)}
.xz-capability.is-off{opacity:.62}
.xz-details{padding:0 14px 12px}
.xz-details>summary{cursor:pointer;list-style:none;padding:12px 0;font-size:12.5px;font-weight:600;color:var(--xz-text-2)}
.xz-details>summary::-webkit-details-marker{display:none}
.xz-details>summary::after{content:'▾';float:right;color:var(--xz-text-3);font-size:11px;transition:transform .18s ease}
.xz-details[open]>summary::after{transform:rotate(180deg)}
.xz-capability{align-items:flex-start}
.xz-capability-tag{margin-left:auto;font-size:10px;color:var(--xz-text-3);border:1px solid var(--xz-line);border-radius:999px;padding:1px 6px}.xz-input,.xz-textarea{width:100%;box-sizing:border-box;background:var(--xz-surface-strong);border:1px solid var(--xz-line);border-radius:12px;padding:9px 12px;font-size:13px;font-family:inherit;color:var(--xz-text);outline:none;transition:border-color .16s ease,box-shadow .16s ease}
.xz-input:focus,.xz-textarea:focus{border-color:rgba(0,122,255,.55);box-shadow:0 0 0 4px var(--xz-primary-soft)}
.xz-textarea{resize:vertical;min-height:76px;line-height:1.5}
.xz-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.xz-field label{font-size:12px;color:var(--xz-text-2);font-weight:500}
.xz-field .note{font-size:11px;color:var(--xz-text-3)}
.xz-pillselect{position:relative;display:inline-flex;align-self:flex-start;min-width:0;max-width:100%}
.xz-pillselect-trigger{position:relative;display:inline-flex;align-items:center;gap:6px;height:26px;max-width:240px;min-width:0;padding:0 26px 0 11px;border:1px solid var(--xz-line);border-radius:999px;background:var(--xz-surface-strong);color:var(--xz-text);font:inherit;font-size:11.5px;white-space:nowrap;cursor:pointer;transition:background-color .12s ease,border-color .12s ease}
.xz-pillselect-trigger:hover:not(:disabled){background:#f2f6fb;border-color:rgba(0,122,255,.28)}
.xz-pillselect-trigger[aria-expanded="true"]{background:var(--xz-primary-soft);border-color:rgba(0,122,255,.4);color:var(--xz-primary)}
.xz-pillselect-trigger:disabled{opacity:.5;cursor:default}
.xz-pillselect-chevron{position:absolute;right:9px;pointer-events:none;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:5px solid var(--xz-text-3)}
.xz-field .xz-pillselect{width:100%;align-self:stretch;display:flex}
/* 表单字段里的选择器也是胶囊：之前覆写成 36px/12px 的方框，和页面级 999px 胶囊不一致。 */
.xz-field .xz-pillselect-trigger{height:32px;max-width:none;width:100%;font-size:12.5px;padding:0 26px 0 11px;background:var(--xz-surface-strong);border-radius:999px}
.xz-field .xz-pillselect-chevron{right:12px;border-top-width:5px}

.xz-pill-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-pill-label.xz-pill-placeholder{color:var(--xz-text-3)}
.xz-required{color:var(--xz-danger);margin-left:2px}
/* 悬浮面板改成 position:fixed（left/top/width/maxHeight/z-index 由 PillSelect 内联计算）。
   绝对定位会参与页面可滚动高度的计算：页面底部展开时出现滚动条、整页横向位移，
   这正是用户反馈的「点开下拉框其他内容也变了」。fixed 不占布局，菜单再长也不改页面尺寸。 */
.xz-menu{position:fixed;top:0;left:0;z-index:60;min-width:160px;max-height:340px;overflow:auto;padding:6px;border-radius:14px;border:1px solid var(--xz-line);background:var(--xz-surface-strong);box-shadow:var(--xz-shadow-md)}
.xz-menu-item{display:flex;align-items:center;gap:7px;width:100%;min-height:28px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;transition:background-color .1s ease}
.xz-menu-item:hover:not(:disabled),.xz-menu-item:focus-visible{background:rgba(0,0,0,.045);outline:none}
.xz-menu-item.active{background:var(--xz-primary-soft);font-weight:600;color:var(--xz-primary)}
.xz-menu-label{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-menu-hint{flex:0 0 auto;color:var(--xz-text-3);font-size:10px}
.xz-menu-check{flex:0 0 auto;color:var(--xz-primary)}
.xz-table{width:100%;border-collapse:separate;border-spacing:0 8px}
.xz-table th{text-align:left;font-size:11px;font-weight:600;color:var(--xz-text-3);padding:0 12px 4px}
.xz-table td{background:var(--xz-surface-strong);padding:12px;font-size:13px;border-top:1px solid rgba(0,0,0,.03);border-bottom:1px solid rgba(0,0,0,.03)}
.xz-table tr td:first-child{border-left:1px solid rgba(0,0,0,.03);border-radius:14px 0 0 14px}
.xz-table tr td:last-child{border-right:1px solid rgba(0,0,0,.03);border-radius:0 14px 14px 0}
.xz-dot{width:8px;height:8px;border-radius:50%;background:#c7c7cc;display:inline-block;margin-right:7px}
.xz-dot.on{background:var(--xz-success);box-shadow:0 0 0 4px rgba(52,199,89,.18);animation:xz-breathe 2.4s ease-in-out infinite}
@keyframes xz-breathe{0%,100%{box-shadow:0 0 0 3px rgba(52,199,89,.14)}50%{box-shadow:0 0 0 6px rgba(52,199,89,.06)}}
.xz-modal-mask{position:fixed;inset:0;background:rgba(15,23,42,.28);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:40}
.xz-devcard-name{cursor:pointer;border-bottom:1px dashed transparent}
.xz-devcard-name:hover{border-bottom-color:var(--xz-line)}

.xz-modal{width:min(520px,92vw);background:var(--xz-surface-strong);border-radius:var(--xz-radius-lg);box-shadow:var(--xz-shadow-lg);padding:22px;box-sizing:border-box}
.xz-modal h3{margin:0 0 6px;font-size:15px}
.xz-modal p{margin:0 0 14px;font-size:12px;color:var(--xz-text-2)}
.xz-toast{position:fixed;right:24px;bottom:24px;z-index:50;background:rgba(29,29,31,.92);color:#fff;padding:11px 16px;border-radius:14px;font-size:12px;box-shadow:var(--xz-shadow-md);max-width:360px}
.xz-toast.bad{background:rgba(201,39,31,.95)}
.xz-code{background:#0f172a;color:#e2e8f0;border-radius:var(--xz-radius-sm);padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.6;overflow:auto;max-height:280px;white-space:pre-wrap;word-break:break-all}
.xz-empty{padding:26px;text-align:center;color:var(--xz-text-2);font-size:13px;border:1px dashed var(--xz-line);border-radius:var(--xz-radius-md);background:var(--xz-surface-muted)}
.xz-auth{position:relative;height:100%;display:flex;align-items:center;justify-content:center;padding:32px;overflow:hidden;box-sizing:border-box;font-family:var(--xz-font);color:var(--xz-text);background:radial-gradient(1100px 680px at 18% -18%,#e6f0ff 0%,rgba(230,240,255,0) 62%),radial-gradient(880px 560px at 108% 6%,#f2e9ff 0%,rgba(242,233,255,0) 58%),linear-gradient(180deg,#f8fafd 0%,#eef3f9 100%)}
.xz-auth-card{position:relative;width:min(440px,100%);background:rgba(255,255,255,.9);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.92);border-radius:26px;box-shadow:0 30px 70px rgba(15,23,42,.13);padding:30px 30px 24px;box-sizing:border-box}
.xz-tabbar{display:none}
@media (max-width:900px){.xz-side{width:220px}.xz-brand-sub{display:none}}
@media (max-width:768px){
  .xz-app{flex-direction:column}
  .xz-side{width:auto;overflow:visible;margin:10px 10px 0;padding:12px 14px;flex-direction:row;align-items:center;gap:12px;border-radius:var(--xz-radius-lg)}
  .xz-brand{padding:0}
  .xz-brand-sub{display:none}
  .xz-nav{flex-direction:row;overflow:auto;gap:2px;flex:1}
  .xz-nav-item{padding:8px 10px;font-size:12px;white-space:nowrap}
  .xz-main{padding:10px 12px 76px}
  .xz-h1{font-size:19px}
  .xz-table{display:block;overflow-x:auto;white-space:nowrap}
  .xz-tabbar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(255,255,255,.86);backdrop-filter:blur(20px);border-top:1px solid var(--xz-line);padding:8px 6px calc(8px + env(safe-area-inset-bottom))}
  .xz-tabbar button{flex:1;border:none;background:transparent;color:var(--xz-text-3);font-size:11px;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0;cursor:pointer}
  .xz-tabbar button.active{color:var(--xz-primary);font-weight:600}
  .xz-modal{width:94vw;padding:18px}
}
/* ---- PillSelect 规范补充（docs/pill-popover.md）：分组标题 / 禁用行 / 触发器徽标 ---- */
.xz-menu-group{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--xz-text-3);padding:6px 8px 3px}
.xz-menu-item:disabled,.xz-menu-item.is-disabled{opacity:.45;cursor:default}
.xz-menu-item:disabled:hover,.xz-menu-item.is-disabled:hover{background:transparent}
.xz-menu-badge{flex:0 0 auto;font-size:10px;color:var(--xz-text-3);font-variant-numeric:tabular-nums}
.xz-pillselect-badge{flex:0 0 auto;font-size:10px;font-weight:600;line-height:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--xz-primary-soft);color:var(--xz-primary)}

/* ---- 备用服务商卡片（契约 docs/backup-providers.md 第 5 节）---- */
.xz-backup-section{margin-top:16px;padding-top:14px;border-top:1px solid var(--xz-line)}
.xz-backup-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;align-items:start}
.xz-backup-card{padding:12px;gap:8px;border-radius:14px}
.xz-backup-card.is-draft{border-style:dashed}
/* 主用卡：同一套卡片语言，用淡蓝描边 + 「主用」徽标区分第一优先级 */
.xz-primary-card{border-color:rgba(0,122,255,.32);background:linear-gradient(180deg,rgba(0,122,255,.06),var(--xz-surface-strong) 55%)}
.xz-primary-card+.xz-backup-grid{margin-top:10px}
.xz-chip.primary{background:var(--xz-primary-soft);color:var(--xz-primary);font-weight:600}
.xz-devcard-ord{width:24px;height:24px;flex:none;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;background:var(--xz-primary-soft);color:var(--xz-primary)}
.xz-backup-facts{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--xz-text-2)}
.xz-backup-fact{display:flex;gap:8px;min-width:0}
.xz-backup-fact .k{flex:none;width:62px;color:var(--xz-text-3);font-size:10.5px;line-height:17px}
.xz-backup-fact .v{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-backup-test{font-size:10.5px;color:var(--xz-text-3);font-variant-numeric:tabular-nums}
.xz-backup-test{padding:4px 6px;border-radius:8px;background:var(--xz-surface-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-btn.danger.confirm{background:rgba(255,59,48,.12);border-color:rgba(255,59,48,.35);color:var(--xz-danger);font-weight:600}
.xz-backup-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}
.xz-backup-actions .xz-btn{padding:5px 9px;font-size:11.5px;border-radius:9px}
.xz-backup-add{display:flex;align-items:center;justify-content:center;gap:6px;min-height:96px;padding:12px;border:1px dashed var(--xz-line);border-radius:14px;background:transparent;color:var(--xz-primary);font:inherit;font-size:12.5px;cursor:pointer;transition:background .16s ease,border-color .16s ease}
.xz-backup-add:hover:not(:disabled){background:var(--xz-primary-soft);border-color:rgba(0,122,255,.4)}
.xz-backup-add:disabled{opacity:.45;cursor:default;color:var(--xz-text-3)}
/* 服务商编辑弹窗：固定外框（头 + 可滚动表单区 + 页脚）。换厂商时字段数量会变
   （TTS 下 Edge 0 个、火山 1 个、讯飞 3 个，ASR/LLM 更多），只给 min-height 挡不住
   「变高」，所以直接写死高度，由表单区自己滚动。 */
.xz-modal-lg{width:min(560px,94vw);height:min(460px,86vh);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-modal-lg .xz-modal-head{padding:18px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-modal-lg .xz-modal-head h3{margin:0}
.xz-modal-lg .xz-modal-body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px 20px;scrollbar-gutter:stable}
.xz-modal-lg .xz-modal-foot{padding:12px 20px;border-top:1px solid var(--xz-line);flex:none;margin-top:0}
.xz-dialog-grid{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
@media (max-width:640px){.xz-backup-grid{grid-template-columns:1fr}}

/* ---- 历史对话弹窗（设备卡片「历史」）：双栏 = 会话列表 + 消息气泡；<720px 上下布局 ---- */
.xz-history-modal{width:min(920px,94vw);height:min(720px,88vh);max-height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden}
.xz-history-head{display:flex;align-items:flex-start;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--xz-line);flex-wrap:wrap;flex:none}
.xz-history-head h3{margin:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.xz-history-head-titles{min-width:0;flex:1 1 220px}
.xz-history-sub{margin:2px 0 0;font-size:11.5px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.xz-modal .xz-history-sub{margin:2px 0 0}
.xz-history-head-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;flex:none}
.xz-history-body{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:0;flex:1 1 auto}
.xz-history-list{border-right:1px solid var(--xz-line);overflow:auto;padding:8px;display:flex;flex-direction:column;gap:4px;min-width:0;min-height:0}
.xz-history-item{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;border:1px solid transparent;background:transparent;border-radius:12px;padding:9px 10px;font:inherit;color:inherit;cursor:pointer;min-width:0;width:100%;box-sizing:border-box}
.xz-history-item:hover{background:rgba(0,0,0,.035)}
.xz-history-item.active{background:var(--xz-primary-soft);border-color:rgba(0,122,255,.28)}
.xz-history-item-title{font-size:12.5px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-history-item-meta{font-size:10.5px;color:var(--xz-text-3)}
.xz-history-thread{display:flex;flex-direction:column;gap:10px;padding:14px 16px;overflow:auto;min-width:0;min-height:0;background:var(--xz-surface-muted)}
.xz-history-msg{display:flex;flex-direction:column;gap:4px;max-width:82%;min-width:0}
.xz-history-msg.user{align-self:flex-end;align-items:flex-end}
.xz-history-msg.assistant{align-self:flex-start;align-items:flex-start}
.xz-history-bubble{font-size:12.5px;line-height:1.55;padding:9px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-width:100%;box-sizing:border-box}
.xz-history-msg.user .xz-history-bubble{background:var(--xz-primary);color:#fff;border-bottom-right-radius:4px}
.xz-history-msg.assistant .xz-history-bubble{background:var(--xz-surface-strong);border:1px solid var(--xz-line);border-bottom-left-radius:4px}
.xz-history-msg-meta{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--xz-text-3);flex-wrap:wrap}
.xz-history-audio{border:1px solid var(--xz-line);background:var(--xz-surface-strong);border-radius:999px;font:inherit;font-size:10.5px;line-height:1;padding:3px 8px;cursor:pointer;color:var(--xz-text-2);text-decoration:none;display:inline-flex;align-items:center}
.xz-history-audio:hover{background:var(--xz-primary-soft);color:var(--xz-primary)}
.xz-history-ai{font-size:10px;color:var(--xz-text-3)}
.xz-history-hint{padding:18px 10px;text-align:center;font-size:12px;color:var(--xz-text-2);line-height:1.5}
.xz-history-error{color:var(--xz-danger)}
.xz-history-foot{padding:10px 18px;border-top:1px solid var(--xz-line);font-size:10.5px;color:var(--xz-text-3);text-align:center;background:var(--xz-surface-strong);flex:none}
@media (max-width:720px){
  .xz-history-modal{width:96vw;height:min(620px,92vh);max-height:92vh}
  .xz-history-head{padding:12px 12px 10px}
  .xz-history-head-actions{margin-left:0;width:100%}
  .xz-history-body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .xz-history-list{max-height:170px;border-right:none;border-bottom:1px solid var(--xz-line)}
  .xz-history-thread{max-height:none;padding:10px}
  .xz-history-msg{max-width:92%}
}

/* ---- TTS 播报测试弹窗：固定高度，textarea 吃掉剩余空间，不再被内容/拖动撑大 ---- */
.xz-inject-modal{height:min(320px,86vh);display:flex;flex-direction:column}
.xz-inject-modal>.xz-field{flex:1 1 auto;min-height:0;margin-bottom:12px}
.xz-inject-modal .xz-textarea{flex:1 1 auto;min-height:96px;resize:none}

/* ---- 全局设置单页 IA（2026-11-07）：以服务商为主体，语音默认参数 / 接入与网关次之 ---- */
.xz-config-page{display:flex;flex-direction:column;gap:14px;padding-bottom:10px}
.xz-config-page>.xz-card{margin-bottom:0}
/* 一级：三个环节概览卡（2026-11-08）。桌面 3 列 / 平板 2 列 / 手机 1 列，一屏能扫完。 */
.xz-stage-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.xz-stage-card{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--xz-line);border-radius:16px;background:var(--xz-surface-strong);cursor:pointer;text-align:left;font:inherit;color:inherit;transition:border-color .16s ease,box-shadow .16s ease}
.xz-stage-card:hover{border-color:rgba(0,122,255,.35);box-shadow:var(--xz-shadow-sm)}
.xz-stage-card.is-warn{border-color:rgba(255,159,10,.3)}
.xz-stage-card-head{display:flex;align-items:center;gap:10px}
.xz-stage-icon{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--xz-primary-soft);color:var(--xz-primary);font-size:13px;font-weight:700;flex:none}
.xz-stage-card-heading{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.xz-stage-card-heading strong{font-size:13.5px}
.xz-stage-card-desc{font-size:10.5px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-stage-card-primary{display:flex;flex-direction:column;gap:2px;min-width:0}
.xz-stage-card-primary strong{font-size:15px}
.xz-stage-card-detail{font-size:11.5px;color:var(--xz-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-stage-card-facts{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--xz-text-2)}
.xz-stage-card-chain{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-stage-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:2px}
.xz-stage-card-health{font-size:11px;color:var(--xz-text-3)}
.xz-stage-card-health.ok{color:var(--xz-success)}
.xz-stage-card-health.warn{color:var(--xz-warning)}
.xz-stage-card-manage{font-size:12px;font-weight:600;color:var(--xz-primary)}
/* 二级：一个环节的管理弹窗（复用 devices modal 的「固定头 + 可滚体 + 固定脚」骨架） */
.xz-stage-modal{width:min(680px,94vw);height:min(600px,88vh);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-stage-modal .xz-modal-head{padding:16px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-stage-modal .xz-modal-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px;scrollbar-gutter:stable}
.xz-stage-modal .xz-modal-foot{padding:12px 20px;border-top:1px solid var(--xz-line);flex:none;display:flex;justify-content:flex-end;gap:8px}
/* 备用：纵向列表（不是 grid），行内信息 + 右侧编辑/⋯，操作区展开在行下方 */
.xz-provider-list{display:flex;flex-direction:column;margin-top:12px}
.xz-provider-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--xz-line);min-width:0}
.xz-provider-row:last-child{border-bottom:none}
.xz-provider-row.is-draft{border-bottom-style:dashed}
.xz-provider-row-main{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 260px}
.xz-provider-row-title{display:flex;align-items:center;gap:8px;min-width:0}
.xz-provider-row-title strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-provider-row-facts{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--xz-text-2)}
.xz-provider-row-facts span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-provider-row-actions{display:flex;gap:6px;flex:none;margin-left:auto}
.xz-provider-row-menu{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 6px 34px}
.xz-provider-empty{margin:10px 0 2px;padding:12px;border:1px dashed var(--xz-line);border-radius:12px;background:var(--xz-surface-muted)}
/* 添加备用：列表底部一整行，不再是同尺寸 dashed 方块 */
.xz-backup-add-row{display:flex;align-items:center;justify-content:flex-start;gap:8px;width:100%;margin-top:8px;padding:10px 12px;border:1px dashed var(--xz-line);border-radius:12px;background:transparent;color:var(--xz-primary);font:inherit;font-size:12.5px;cursor:pointer}
.xz-backup-add-row:hover:not(:disabled){background:var(--xz-primary-soft);border-color:rgba(0,122,255,.4)}
/* 接入与网关：可折叠、默认收起，页面的视觉重点留给服务商 */
.xz-config-access>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:650}
.xz-config-access>summary::-webkit-details-marker{display:none}
.xz-config-access>summary::after{content:'▾';margin-left:auto;font-size:11px;color:var(--xz-text-3);transition:transform .18s ease}
.xz-config-access[open]>summary::after{transform:rotate(180deg)}
.xz-config-access[open]>summary{margin-bottom:12px}
/* 页面底部：sticky 保存条，滚到哪都能点（2026-11-08） */
.xz-config-footer{position:sticky;bottom:0;z-index:5;display:flex;align-items:center;gap:12px;justify-content:flex-end;margin:2px 2px 10px;padding:10px 12px;border:1px solid var(--xz-line);border-radius:14px;background:var(--xz-surface-strong);box-shadow:var(--xz-shadow-sm)}
.xz-config-footer .xz-hint{margin-right:auto}
@media (max-width:768px){.xz-config-footer{flex-wrap:wrap;justify-content:flex-end}.xz-config-footer .xz-hint{flex:1 1 100%;margin-right:0}}
@media (max-width:640px){.xz-stage-cards{grid-template-columns:1fr}.xz-stage-modal{width:96vw;height:92vh;max-height:92vh}.xz-provider-row-menu{padding-left:0}}

/* 弹窗骨架仍被「智能体 → 配置」的 AgentConfigDialog 复用：固定头 + 可滚动页签内容 + 页脚。
   高度必须写死，不能只给 max-height（2026-11-08 修）：三个页签内容高度差很大，弹窗按内容
   收缩时垂直居中会让标题/页签跟着上下跳；固定高度后只有页签内部滚动。 */
.xz-config-modal{width:min(720px,94vw);height:min(600px,86vh);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-config-modal-head{padding:18px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-config-modal-head h3{margin:0 0 4px;font-size:15px}
.xz-config-modal-head p{margin:0;font-size:11.5px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 页签条固定，只有页签内容滚动；滚动条槽常驻，切换页签时正文宽度不变 */
.xz-config-modal-body{flex:1 1 auto;min-height:0;overflow:hidden;padding:16px 20px;display:flex;flex-direction:column}
.xz-config-modal-body>.xz-tabs{flex:none}
.xz-config-modal-body>.xz-pane{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable}
/* 角色页的人设输入框吃掉剩余高度：固定弹窗高度后在短页签里不会剩一大片空白 */
.xz-config-modal-body>.xz-pane>.xz-field:last-child{flex:1 1 auto;min-height:0;margin-bottom:0}
.xz-config-modal-body>.xz-pane>.xz-field:last-child .xz-textarea{flex:1 1 auto;min-height:120px;resize:none}
.xz-config-modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--xz-line);flex:none}
/* 智能体的「管理设备」弹窗：固定外框，列表内部滚动（2026-11-08）。 */
.xz-devices-modal{width:min(680px,94vw);height:min(560px,86vh);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;padding:0}
.xz-devices-modal .xz-modal-head{padding:18px 20px 12px;border-bottom:1px solid var(--xz-line);flex:none}
.xz-devices-modal .xz-modal-head h3{margin:0 0 4px;font-size:15px}
.xz-devices-modal .xz-modal-head p{margin:0;font-size:11.5px;color:var(--xz-text-3)}
.xz-devices-modal .xz-modal-body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px;scrollbar-gutter:stable}
.xz-devices-modal .xz-modal-foot{padding:12px 20px;border-top:1px solid var(--xz-line);flex:none;display:flex;justify-content:flex-end;gap:8px}
.xz-device-section-title{font-size:11.5px;color:var(--xz-text-3);margin:6px 0 2px}
.xz-device-row{display:flex;flex-direction:column;gap:8px;padding:10px 0;border-bottom:1px solid var(--xz-line)}
.xz-device-row:last-child{border-bottom:none}
.xz-device-row-main{display:flex;align-items:center;gap:8px;min-width:0}
.xz-device-row-main .xz-input{max-width:180px}
.xz-device-row-mac{font-family:ui-monospace,monospace;font-size:11px;color:var(--xz-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xz-device-row-actions{display:flex;gap:6px;flex-wrap:wrap}
.xz-device-row-actions .xz-btn{padding:4px 9px;font-size:11.5px;border-radius:9px}
@media (max-width:768px){.xz-config-modal{width:94vw;height:min(620px,90vh)}.xz-config-modal-body{padding:12px 14px}.xz-config-modal-foot{flex-wrap:wrap}}
`;
export { CSS }
