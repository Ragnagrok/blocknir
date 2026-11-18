/**
 * The editor's stylesheet, injected once into `<head>` (first, so host pages override it with
 * plain selectors). Everything is scoped under `.rbk-editor` and themed with custom properties.
 *
 * Block colors are deep enough that white text passes WCAG AA (≥ 5:1) in both themes.
 */

const LIGHT = `
  --rbk-bg: #f3f0e8;
  --rbk-surface: #fffdf8;
  --rbk-surface-2: #f1ede4;
  --rbk-ws-bg: #e6ecf1;
  --rbk-ws-dot: rgba(40, 60, 90, 0.16);
  --rbk-card: rgba(255, 255, 255, 0.5);
  --rbk-text: #1b1f27;
  --rbk-muted: #545b68;
  --rbk-border: #d3d6dc;
  --rbk-btn-bg: #ebe6db;
  --rbk-btn-text: #1b1f27;
  --rbk-on-block: #ffffff;
  --rbk-block-edge: rgba(0, 0, 0, 0.16);
  --rbk-slot-bg: #ffffff;
  --rbk-slot-text: #1b1f27;
  --rbk-hole: rgba(0, 0, 0, 0.32);
  --rbk-focus: #1660d0;
  --rbk-cursor: #1660d0;
  --rbk-indicator: #1660d0;
  --rbk-running: #ffc928;
  --rbk-running-glow: rgba(255, 201, 40, 0.55);
  --rbk-error: #c62828;
  --rbk-ok: #2e7d32;
  --rbk-amber: #a35200;
  --rbk-red: #b91c1c;
  --rbk-backdrop: rgba(14, 18, 26, 0.45);
  --rbk-toast-bg: #1b1f27;
  --rbk-toast-text: #ffffff;
`;

const DARK = `
  --rbk-bg: #12151b;
  --rbk-surface: #1a1e26;
  --rbk-surface-2: #222733;
  --rbk-ws-bg: #0f1218;
  --rbk-ws-dot: rgba(200, 215, 240, 0.1);
  --rbk-card: rgba(255, 255, 255, 0.03);
  --rbk-text: #e9ecf1;
  --rbk-muted: #a9b1bf;
  --rbk-border: #2e3440;
  --rbk-btn-bg: #2a303c;
  --rbk-btn-text: #e9ecf1;
  --rbk-block-edge: rgba(255, 255, 255, 0.22);
  --rbk-hole: rgba(0, 0, 0, 0.42);
  --rbk-focus: #8ab4f8;
  --rbk-cursor: #8ab4f8;
  --rbk-indicator: #8ab4f8;
  --rbk-backdrop: rgba(0, 0, 0, 0.6);
  --rbk-toast-bg: #e9ecf1;
  --rbk-toast-text: #12151b;
`;

export const CSS = `
.rbk-editor {
  ${LIGHT}
  --rbk-c-actions: #0a6e6a;
  --rbk-c-control: #6d3fa6;
  --rbk-c-sensors: #1f5fae;
  --rbk-c-values: #3b7a1e;
  --rbk-c-variables: #b0450f;
  --rbk-c-procedures: #b02a5b;
  --rbk-c-param: #7e1d43;
  --rbk-c-events: #8a5a00;
  --rbk-font: ui-rounded, "SF Pro Rounded", "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  --rbk-font-size: 16px;
  --rbk-hit: 48px;
  --rbk-radius: 12px;
  /* Stacked blocks fit together: a tab under each block, the matching notch on top of the next. */
  --rbk-corner: 6px;
  --rbk-tab-x: 18px;
  --rbk-tab-w: 28px;
  --rbk-tab-h: 8px;
  --rbk-tab-in: 6px;
  --rbk-arm: 18px;
  --rbk-palette-width: 300px;
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  font-family: var(--rbk-font);
  font-size: var(--rbk-font-size);
  line-height: 1.25;
  color: var(--rbk-text);
  background: var(--rbk-bg);
  -webkit-tap-highlight-color: transparent;
}
.rbk-editor[data-rbk-theme="dark"] { ${DARK} }
@media (prefers-color-scheme: dark) { .rbk-editor[data-rbk-theme="auto"] { ${DARK} } }
.rbk-editor *, .rbk-editor *::before, .rbk-editor *::after { box-sizing: border-box; }
.rbk-g-actions { --rbk-cat: var(--rbk-c-actions); }
.rbk-g-control { --rbk-cat: var(--rbk-c-control); }
.rbk-g-sensors { --rbk-cat: var(--rbk-c-sensors); }
.rbk-g-values { --rbk-cat: var(--rbk-c-values); }
.rbk-g-variables { --rbk-cat: var(--rbk-c-variables); }
.rbk-g-procedures { --rbk-cat: var(--rbk-c-procedures); }
.rbk-g-events { --rbk-cat: var(--rbk-c-events); }

/* ---------- bar ---------- */
.rbk-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--rbk-surface); border-bottom: 1px solid var(--rbk-border); flex: none; }
.rbk-bar-title { font-weight: 800; margin-right: auto; color: var(--rbk-muted); font-size: 15px; }
.rbk-count { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: 999px; background: var(--rbk-ok); color: #fff; font-weight: 800; white-space: nowrap; }
.rbk-count[data-state="amber"] { background: var(--rbk-amber); }
.rbk-count[data-state="red"] { background: var(--rbk-red); }
.rbk-count[data-state="none"] { background: var(--rbk-btn-bg); color: var(--rbk-btn-text); }
.rbk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 44px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 12px; background: var(--rbk-btn-bg); color: var(--rbk-btn-text); font: inherit; font-weight: 700; cursor: pointer; }
.rbk-btn:disabled { opacity: 0.45; cursor: default; }
.rbk-btn:focus-visible, .rbk-cat:focus-visible, .rbk-mbtn:focus-visible, .rbk-dlg-btn:focus-visible, .rbk-choice-btn:focus-visible, .rbk-pitem:focus-visible, .rbk-key:focus-visible { outline: 3px solid var(--rbk-focus); outline-offset: 2px; }
.rbk-narrow .rbk-btn-label { display: none; }

/* ---------- layout ---------- */
.rbk-body { flex: 1; min-height: 0; display: flex; }
.rbk-palette { position: relative; flex: none; width: min(var(--rbk-palette-width), 42%); display: flex; flex-direction: column; align-items: stretch; margin: 0; padding: 0; background: var(--rbk-surface); border-right: 1px solid var(--rbk-border); min-height: 0; }
.rbk-ws { position: relative; flex: 1; min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; background-color: var(--rbk-ws-bg); background-image: radial-gradient(var(--rbk-ws-dot) 1.3px, transparent 1.6px); background-size: 22px 22px; }
.rbk-ws:focus-visible { outline: 3px solid var(--rbk-focus); outline-offset: -3px; }
.rbk-ws-content { position: relative; min-height: 100%; padding: 14px 14px 140px; }
.rbk-narrow .rbk-body { flex-direction: column; }
.rbk-narrow .rbk-palette { width: auto; flex: none; border-right: 0; border-bottom: 1px solid var(--rbk-border); }
.rbk-narrow .rbk-ws-content { padding: 10px 10px 120px; }

/* ---------- palette ---------- */
.rbk-cats { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border-bottom: 1px solid var(--rbk-border); flex: none; }
.rbk-cats[hidden] { display: none; }
.rbk-narrow .rbk-cats { gap: 6px; padding: 6px 8px; }
.rbk-narrow .rbk-cat { min-height: 36px; padding: 0 10px; font-size: 14px; }
.rbk-cat { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border-radius: 999px; border: 2px solid var(--rbk-cat); background: transparent; color: var(--rbk-text); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; white-space: nowrap; flex: none; }
.rbk-cat::before { content: ""; width: 12px; height: 12px; border-radius: 50%; background: var(--rbk-cat); }
.rbk-cat[aria-current="true"] { background: var(--rbk-cat); color: var(--rbk-on-block); }
.rbk-cat[aria-current="true"]::before { background: var(--rbk-on-block); }
.rbk-pal { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 4px 10px 28px; }
.rbk-pal-h { margin: 14px 2px 8px; font-size: 14px; font-weight: 800; color: var(--rbk-muted); letter-spacing: 0.02em; }
.rbk-pal-sub { margin: 10px 2px 6px; font-size: 13px; font-weight: 700; color: var(--rbk-muted); }
.rbk-pal-items { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.rbk-pal-sec { min-width: 0; }
.rbk-pitem { display: block; max-width: 100%; border-radius: 14px; cursor: grab; touch-action: pan-y pinch-zoom; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.rbk-pitem * { touch-action: auto; }
/* Narrow: one group at a time (the chips are tabs); its blocks wrap and the palette scrolls down if it must. */
.rbk-narrow .rbk-pal { flex: none; max-height: var(--rbk-pal-max, 220px); padding: 0 10px 10px; }
.rbk-narrow .rbk-pal-sec[hidden] { display: none; }
.rbk-narrow .rbk-pal-h { margin: 6px 2px 6px; }
.rbk-narrow .rbk-cats:not([hidden]) + .rbk-pal .rbk-pal-h { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.rbk-narrow .rbk-cats:not([hidden]) + .rbk-pal { padding-top: 8px; }
.rbk-narrow .rbk-pal-items { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
/* Narrow: a block in the palette moves the moment the finger does (no scrolling under it). */
.rbk-narrow .rbk-pitem { touch-action: none; }
.rbk-pitem.rbk-disabled { opacity: 0.45; cursor: not-allowed; }
.rbk-newvar { min-height: 44px; }
.rbk-trash { position: absolute; inset: 0; z-index: 6; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px; text-align: center; background: color-mix(in srgb, var(--rbk-surface) 90%, var(--rbk-error)); border: 3px dashed var(--rbk-error); color: var(--rbk-error); font-weight: 800; font-size: 18px; }
.rbk-drag-ws .rbk-trash { display: flex; }
.rbk-trash.rbk-over { background: color-mix(in srgb, var(--rbk-surface) 72%, var(--rbk-error)); }
.rbk-editor[data-rbk-theme="dark"] .rbk-trash { color: #ff8a80; border-color: #ff8a80; }

/* ---------- scripts and lists ---------- */
.rbk-script { margin: 0 0 18px; padding: 10px; border-radius: 18px; background: var(--rbk-card); max-width: 100%; }
.rbk-list { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
/* Gaps sit under the blocks: their tall hit area (40px+) shows beside the blocks, never over them. */
.rbk-gap { position: relative; z-index: 2; align-self: stretch; height: 0; border-radius: 8px; cursor: pointer; outline: none; }
.rbk-gap::before { content: ""; position: absolute; left: 0; right: 0; top: -18px; bottom: -18px; }
.rbk-list > .rbk-stmt, .rbk-list > .rbk-bubble { z-index: 3; }
.rbk-hat, .rbk-stmt > .rbk-row, .rbk-stmt > .rbk-foot, .rbk-stmt > .rbk-mouth > .rbk-arm { position: relative; z-index: 3; }
.rbk-gap.rbk-end { height: 24px; }
/* Inside a C block the last block meets the foot: the end gap only keeps its tap area. */
.rbk-mouth .rbk-gap.rbk-end:not(.rbk-cursor) { height: 0; }
.rbk-gap.rbk-end::before { bottom: -8px; }
.rbk-gap.rbk-empty { height: auto; min-height: 44px; margin: 2px 0; display: flex; align-items: center; padding: 0 12px; border: 2px dashed var(--rbk-border); color: var(--rbk-muted); font-size: 14px; font-weight: 700; }
.rbk-gap.rbk-empty::before { top: -4px; bottom: -4px; }
.rbk-gap.rbk-cursor { height: auto; margin: 2px 0; padding: 0; border: 0; }
.rbk-gap.rbk-cursor::before { top: -4px; bottom: -4px; }
.rbk-caret { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 12px; border: 3px dashed var(--rbk-cursor); border-radius: 12px; color: var(--rbk-cursor); font-size: 14px; font-weight: 800; white-space: nowrap; overflow: hidden; animation: rbk-pulse 1.6s ease-in-out infinite; }
.rbk-caret-text { overflow: hidden; text-overflow: ellipsis; }
.rbk-gap:focus-visible { outline: 3px solid var(--rbk-focus); outline-offset: 1px; }
.rbk-readonly .rbk-gap { pointer-events: none; }
@keyframes rbk-pulse { 50% { border-color: transparent; } }

/* ---------- blocks ---------- */
.rbk-stmt, .rbk-hat { position: relative; width: max-content; max-width: 100%; border-radius: var(--rbk-radius); outline: none; touch-action: pan-y pinch-zoom; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: grab; }
.rbk-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-height: var(--rbk-hit); padding: 5px 14px; background: var(--rbk-cat); color: var(--rbk-on-block); font-weight: 700; border-radius: var(--rbk-radius); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.2), 0 0 0 1px var(--rbk-block-edge); }
.rbk-txt { white-space: normal; overflow-wrap: anywhere; }
.rbk-small { font-size: 13px; opacity: 0.9; }
.rbk-name { font-weight: 800; }
.rbk-pname { font-size: 13px; font-weight: 700; opacity: 0.92; }
/* The tab also covers the block's darker bottom edge where it starts, and carries that edge on its
   own bottom: block and tab read as one piece. */
.rbk-stmt::after, .rbk-hat::after, .rbk-mouth::before { content: ""; position: absolute; z-index: 4; left: var(--rbk-tab-x); bottom: calc(-1 * var(--rbk-tab-h)); width: var(--rbk-tab-w); height: calc(var(--rbk-tab-h) + 3px); background: linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)) bottom / 100% 3px no-repeat, var(--rbk-cat); clip-path: polygon(0 0, 100% 0, 100% 3px, calc(100% - var(--rbk-tab-in)) 100%, var(--rbk-tab-in) 100%, 0 3px); }
/* The notch: the block's paint (a layer under its content) has a hole where the tab above fits.
   Outlines (running, selected, errors) stay on the block itself, so the mask never cuts them. */
.rbk-stmt > .rbk-row, .rbk-stmt > .rbk-foot { --rbk-nx: var(--rbk-tab-x); background: transparent; box-shadow: none; border-radius: var(--rbk-corner); }
.rbk-stmt > .rbk-mid, .rbk-stmt > .rbk-foot { --rbk-nx: calc(var(--rbk-arm) + var(--rbk-tab-x)); }
/* The paint reaches 1px up, under the block above: no hairline of background between two blocks
   that land on half pixels. */
.rbk-stmt > .rbk-row::before, .rbk-stmt > .rbk-foot::before { content: ""; position: absolute; inset: -1px 0 0; z-index: -1; border-radius: inherit; background: var(--rbk-cat); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.2), inset 0 0 0 1px var(--rbk-block-edge);
  -webkit-mask: linear-gradient(#000 0 0) 0 var(--rbk-tab-h) / 100% calc(100% - var(--rbk-tab-h)) no-repeat, linear-gradient(#000 0 0) 0 0 / var(--rbk-nx) var(--rbk-tab-h) no-repeat, linear-gradient(#000 0 0) calc(var(--rbk-nx) + var(--rbk-tab-w)) 0 / 100% var(--rbk-tab-h) no-repeat, linear-gradient(to top right, #000 50%, transparent 50%) var(--rbk-nx) 0 / var(--rbk-tab-in) var(--rbk-tab-h) no-repeat, linear-gradient(to top left, #000 50%, transparent 50%) calc(var(--rbk-nx) + var(--rbk-tab-w) - var(--rbk-tab-in)) 0 / var(--rbk-tab-in) var(--rbk-tab-h) no-repeat;
  mask: linear-gradient(#000 0 0) 0 var(--rbk-tab-h) / 100% calc(100% - var(--rbk-tab-h)) no-repeat, linear-gradient(#000 0 0) 0 0 / var(--rbk-nx) var(--rbk-tab-h) no-repeat, linear-gradient(#000 0 0) calc(var(--rbk-nx) + var(--rbk-tab-w)) 0 / 100% var(--rbk-tab-h) no-repeat, linear-gradient(to top right, #000 50%, transparent 50%) var(--rbk-nx) 0 / var(--rbk-tab-in) var(--rbk-tab-h) no-repeat, linear-gradient(to top left, #000 50%, transparent 50%) calc(var(--rbk-nx) + var(--rbk-tab-w) - var(--rbk-tab-in)) 0 / var(--rbk-tab-in) var(--rbk-tab-h) no-repeat; }
.rbk-hat > .rbk-row { min-height: 54px; border-radius: 22px 22px var(--rbk-corner) var(--rbk-corner); padding-top: 9px; }
.rbk-main-hat .rbk-icon { flex: none; }
.rbk-c > .rbk-row:first-child { border-radius: var(--rbk-corner) var(--rbk-corner) var(--rbk-corner) 0; }
/* The C's mouth: the arm on the left, a tab under the top for the first block inside, which sits
   right against the arm, the top and the foot. */
.rbk-mouth { position: relative; display: flex; min-height: 44px; }
.rbk-mouth::before { top: -3px; bottom: auto; left: calc(var(--rbk-arm) + var(--rbk-tab-x)); }
.rbk-arm { flex: none; width: var(--rbk-arm); background: var(--rbk-cat); box-shadow: inset 1px 0 0 var(--rbk-block-edge); }
.rbk-mouth > .rbk-list { flex: 1; padding: 0; }
.rbk-preview-list { min-width: 60px; min-height: 22px; }
.rbk-stmt > .rbk-mid { border-radius: 0 var(--rbk-corner) var(--rbk-corner) 0; min-height: 40px; }
.rbk-stmt > .rbk-foot { height: 22px; width: 100%; min-width: 96px; border-radius: 0 var(--rbk-corner) var(--rbk-corner) var(--rbk-corner); }

.rbk-rep { position: relative; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-height: 40px; max-width: 100%; padding: 3px 14px; border-radius: 999px; background: var(--rbk-cat); color: var(--rbk-on-block); font-weight: 700; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.22), 0 0 0 1px var(--rbk-block-edge); touch-action: pan-y pinch-zoom; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; cursor: grab; outline: none; }
.rbk-bool { border-radius: 6px; padding: 3px 22px; clip-path: polygon(16px 0, calc(100% - 16px) 0, 100% 50%, calc(100% - 16px) 100%, 16px 100%, 0 50%); box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.22); }
.rbk-param { --rbk-cat: var(--rbk-c-param); box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55); }
.rbk-ptype { font-size: 0.72em; font-weight: 600; opacity: 0.8; }
.rbk-ptype::before { content: '· '; }

/* ---------- slots ---------- */
.rbk-slot { display: inline-flex; align-items: center; min-height: 40px; max-width: 100%; border-radius: 999px; }
.rbk-lit, .rbk-hole, .rbk-field, .rbk-add { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 40px; min-width: 44px; cursor: pointer; outline: none; }
.rbk-lit { padding: 2px 14px; border-radius: 999px; background: var(--rbk-slot-bg); color: var(--rbk-slot-text); font-weight: 800; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3); }
.rbk-dir { font-size: 20px; }
.rbk-caret-down { font-size: 12px; opacity: 0.7; }
.rbk-hole { min-width: 56px; border-radius: 999px; background: var(--rbk-hole); box-shadow: inset 0 3px 5px rgba(0, 0, 0, 0.45); }
.rbk-bool-hole { border-radius: 4px; clip-path: polygon(14px 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 14px 100%, 0 50%); min-width: 72px; }
.rbk-field { padding: 2px 10px; border-radius: 10px; background: rgba(0, 0, 0, 0.28); color: var(--rbk-on-block); border: 2px dashed rgba(255, 255, 255, 0.7); font-weight: 800; }
.rbk-field-static { cursor: inherit; border-style: solid; border-color: transparent; }
.rbk-add { border-radius: 50%; min-width: 40px; background: rgba(0, 0, 0, 0.28); color: var(--rbk-on-block); border: 2px dashed rgba(255, 255, 255, 0.7); }
.rbk-pitem .rbk-lit, .rbk-pitem .rbk-hole, .rbk-pitem .rbk-field { cursor: inherit; }

/* ---------- states ---------- */
.rbk-stmt:focus-visible > .rbk-row:first-child, .rbk-hat:focus-visible > .rbk-row, .rbk-rep:focus-visible, .rbk-lit:focus-visible, .rbk-field:focus-visible, .rbk-add:focus-visible { outline: 3px solid var(--rbk-focus); outline-offset: 2px; }
.rbk-bool:focus-visible, .rbk-hole:focus-visible { outline: none; box-shadow: inset 0 0 0 4px var(--rbk-focus); }
.rbk-slot:has(> .rbk-bool:focus-visible), .rbk-slot:has(> .rbk-hole:focus-visible) { outline: 3px solid var(--rbk-focus); outline-offset: 1px; }
.rbk-selected > .rbk-row:first-child, .rbk-rep.rbk-selected { outline: 3px solid var(--rbk-focus); outline-offset: 2px; }
.rbk-active-slot { outline: 3px dashed var(--rbk-focus); outline-offset: 2px; }
.rbk-running > .rbk-row, .rbk-running > .rbk-foot, .rbk-rep.rbk-running, .rbk-hat.rbk-running > .rbk-row { outline: 4px solid var(--rbk-running); outline-offset: 2px; box-shadow: 0 0 18px 6px var(--rbk-running-glow), inset 0 -3px 0 rgba(0, 0, 0, 0.2); }
.rbk-slot.rbk-running-slot { outline: 4px solid var(--rbk-running); outline-offset: 2px; box-shadow: 0 0 14px 4px var(--rbk-running-glow); }
.rbk-calling > .rbk-row { outline: 3px dashed var(--rbk-running); outline-offset: 2px; }
.rbk-error-mark > .rbk-row:first-child, .rbk-rep.rbk-error-mark, .rbk-slot.rbk-error-slot { outline: 4px solid var(--rbk-error); outline-offset: 2px; }
.rbk-issue > .rbk-row:first-child, .rbk-rep.rbk-issue { outline: 3px dashed var(--rbk-error); outline-offset: 2px; }
.rbk-flash > .rbk-row:first-child, .rbk-rep.rbk-flash { animation: rbk-flash 0.7s ease-out; }
@keyframes rbk-flash { from { box-shadow: 0 0 0 6px var(--rbk-focus); } to { box-shadow: 0 0 0 0 transparent; } }
.rbk-dragging { opacity: 0.35; }
.rbk-target-slot { outline: 4px solid var(--rbk-indicator); outline-offset: 2px; border-radius: 999px; }
.rbk-target-bad { outline: 3px dashed var(--rbk-error); outline-offset: 2px; border-radius: 999px; }
.rbk-target-slot > .rbk-hole, .rbk-target-slot > .rbk-lit { background: var(--rbk-indicator); }
.rbk-ws.rbk-create-target { box-shadow: inset 0 0 0 4px var(--rbk-indicator); }

/* ---------- drag ---------- */
.rbk-ghost { position: fixed; left: 0; top: 0; z-index: 2000; pointer-events: none; opacity: 0.78; filter: drop-shadow(0 10px 12px rgba(0, 0, 0, 0.35)); will-change: transform; }
.rbk-ghost .rbk-stmt::after { display: none; }
.rbk-indicator { position: absolute; left: 0; top: 0; z-index: 15; height: 8px; border-radius: 4px; background: var(--rbk-indicator); pointer-events: none; box-shadow: 0 0 0 2px var(--rbk-ws-bg); }
.rbk-indicator::before { content: ""; position: absolute; left: -8px; top: -5px; width: 16px; height: 16px; border-radius: 50%; background: var(--rbk-indicator); box-shadow: 0 0 0 2px var(--rbk-ws-bg); }

.rbk-indicator[hidden] { display: none; }
.rbk-drag-any, .rbk-drag-any * { cursor: grabbing !important; }

/* ---------- error bubble ---------- */
.rbk-bubble { position: relative; z-index: 4; margin: 12px 0 6px; max-width: min(100%, 440px); padding: 10px 14px; border-radius: 14px; background: var(--rbk-error); color: #fff; font-weight: 700; font-size: 16px; line-height: 1.3; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); }
.rbk-bubble::before { content: ""; position: absolute; left: 22px; top: -9px; border: 10px solid transparent; border-top: 0; border-bottom-color: var(--rbk-error); }

/* ---------- menu ---------- */
.rbk-menu { position: absolute; z-index: 20; display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; max-width: calc(100% - 16px); background: var(--rbk-surface); border: 1px solid var(--rbk-border); border-radius: 16px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28); }
.rbk-mbtn { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; min-width: 44px; padding: 0 12px; border: 0; border-radius: 12px; background: var(--rbk-btn-bg); color: var(--rbk-btn-text); font: inherit; font-weight: 700; cursor: pointer; }
.rbk-mbtn.rbk-danger { background: var(--rbk-error); color: #fff; }
.rbk-mbtn:disabled { opacity: 0.4; cursor: default; }

/* ---------- dialogs ---------- */
.rbk-modal { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--rbk-backdrop); }
.rbk-dialog { width: min(380px, 100%); max-height: calc(100% - 16px); overflow: auto; padding: 16px; border-radius: 20px; background: var(--rbk-surface); color: var(--rbk-text); box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35); }
.rbk-dlg-title { margin: 0 0 12px; font-size: 19px; font-weight: 800; }
.rbk-dlg-msg { margin: 0 0 14px; font-size: 17px; }
.rbk-dlg-err { min-height: 1.3em; margin: 6px 0 0; color: var(--rbk-error); font-weight: 700; }
.rbk-editor[data-rbk-theme="dark"] .rbk-dlg-err { color: #ff8a80; }
.rbk-dlg-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; flex-wrap: wrap; }
.rbk-dlg-btn { min-height: 48px; min-width: 96px; padding: 0 18px; border: 0; border-radius: 14px; background: var(--rbk-btn-bg); color: var(--rbk-btn-text); font: inherit; font-size: 17px; font-weight: 800; cursor: pointer; }
.rbk-dlg-btn.rbk-primary { background: var(--rbk-focus); color: #fff; }
.rbk-editor[data-rbk-theme="dark"] .rbk-dlg-btn.rbk-primary { color: #0b1220; }
.rbk-dlg-btn.rbk-danger { background: var(--rbk-error); color: #fff; }
.rbk-input { width: 100%; min-height: 54px; padding: 0 14px; border: 2px solid var(--rbk-border); border-radius: 14px; background: var(--rbk-slot-bg); color: var(--rbk-slot-text); font: inherit; font-size: 22px; font-weight: 700; }
.rbk-input:focus { outline: 3px solid var(--rbk-focus); outline-offset: 1px; }
.rbk-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(132px, 100%), 1fr)); gap: 8px; }
.rbk-choice-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 56px; padding: 6px 10px; border: 2px solid var(--rbk-border); border-radius: 14px; background: var(--rbk-surface-2); color: var(--rbk-text); font: inherit; font-size: 18px; font-weight: 800; cursor: pointer; overflow-wrap: break-word; hyphens: auto; }
.rbk-choice-btn.rbk-dir-btn { font-size: 30px; }
.rbk-choice-btn[aria-pressed="true"] { border-color: var(--rbk-focus); box-shadow: inset 0 0 0 2px var(--rbk-focus); }
.rbk-swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid rgba(0, 0, 0, 0.35); flex: none; }
.rbk-dlg-blocks { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; margin-top: 14px; }
.rbk-dlg-blocks > .rbk-dlg-h { font-size: 14px; font-weight: 800; color: var(--rbk-muted); }
.rbk-block-btn { border: 0; padding: 2px; background: none; cursor: pointer; border-radius: 16px; max-width: 100%; text-align: left; font: inherit; }
.rbk-block-btn:focus-visible { outline: 3px solid var(--rbk-focus); outline-offset: 2px; }
.rbk-kp-display { display: flex; align-items: center; justify-content: center; min-height: 64px; margin-bottom: 12px; padding: 0 12px; border-radius: 14px; background: var(--rbk-slot-bg); color: var(--rbk-slot-text); border: 2px solid var(--rbk-border); font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; overflow: hidden; }
.rbk-keys { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.rbk-key { min-height: 56px; border: 0; border-radius: 14px; background: var(--rbk-btn-bg); color: var(--rbk-btn-text); font: inherit; font-size: 26px; font-weight: 800; cursor: pointer; }
.rbk-key:active, .rbk-choice-btn:active, .rbk-dlg-btn:active, .rbk-mbtn:active { transform: translateY(1px); }

/* ---------- toast and screen reader text ---------- */
.rbk-toast { position: absolute; z-index: 40; left: 50%; bottom: 18px; transform: translate(-50%, 12px); max-width: calc(100% - 32px); padding: 12px 18px; border-radius: 14px; background: var(--rbk-toast-bg); color: var(--rbk-toast-text); font-weight: 800; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); opacity: 0; pointer-events: none; transition: opacity 0.2s, transform 0.2s; }
.rbk-toast.rbk-show { opacity: 1; transform: translate(-50%, 0); }
.rbk-sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.rbk-readonly .rbk-palette { opacity: 0.55; }
/* ---------- static pictures of programs (renderProgram, renderStatement) ---------- */
.rbk-editor.rbk-static { display: block; height: auto; min-height: 0; overflow: visible; background: transparent; }
.rbk-static-small { --rbk-font-size: 14px; --rbk-hit: 38px; --rbk-radius: 10px; }
.rbk-static .rbk-script { margin: 0 0 10px; padding: 0; background: transparent; }
.rbk-static .rbk-script:last-child { margin-bottom: 0; }
.rbk-static .rbk-gap { height: 0; pointer-events: none; }
.rbk-static .rbk-mouth { min-height: 26px; }
.rbk-static .rbk-gap::before { display: none; }
.rbk-static .rbk-gap.rbk-end { height: 0; }
.rbk-static .rbk-gap.rbk-empty { min-height: 26px; padding: 0; font-size: 0; }
.rbk-static-nohat .rbk-hat { display: none; }
.rbk-static .rbk-field svg { display: none; }
.rbk-static .rbk-field { border-style: solid; }
.rbk-static .rbk-stmt, .rbk-static .rbk-hat { max-width: 100%; }
.rbk-static .rbk-stmt, .rbk-static .rbk-hat, .rbk-static .rbk-rep { cursor: inherit; }
.rbk-readonly .rbk-stmt, .rbk-readonly .rbk-rep, .rbk-readonly .rbk-pitem { cursor: default; }
@media (prefers-reduced-motion: reduce) { .rbk-editor * { animation: none !important; transition: none !important; } }
`;

let injected = false;

/** Adds the stylesheet to the document once. */
export function injectStyles(doc: Document = document): void {
  if (injected && doc === document) return;
  if (doc.getElementById('rbk-styles')) {
    injected = true;
    return;
  }
  const style = doc.createElement('style');
  style.id = 'rbk-styles';
  style.textContent = CSS;
  doc.head.insertBefore(style, doc.head.firstChild);
  if (doc === document) injected = true;
}
