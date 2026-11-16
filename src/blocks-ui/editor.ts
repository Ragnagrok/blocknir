/**
 * `BlockEditor`: a touch-friendly DOM block editor for a level's blocks.
 *
 * The editor is a thin layer over `EditorModel` (all edits, undo and the insertion cursor live
 * there) and `Renderer` (blocks as DOM). It rebuilds the DOM on every model change and turns
 * gestures into model calls:
 *
 * - **drag** (mouse, touch, pen) from the palette or the workspace: statements go to the nearest
 *   gap (a line shows where), reporters into a slot that fits (it lights up), hats ("Enseñar…",
 *   events) anywhere on the workspace; dropping on the palette (the trash) deletes;
 * - **tap**: a palette block goes in at the insertion cursor; a gap moves the cursor; a block opens
 *   a small menu; a slot opens a keypad or a picker; names open a prompt;
 * - **keyboard**: arrows move through gaps and blocks (the cursor follows), Enter or Space acts,
 *   Delete removes, Alt+arrows move a block, Ctrl+Z / Ctrl+Y undo and redo.
 */
import { analyze, childExprs, type Expr, type EventSpec, type LabelOverrides, type Level, type NodeId, type ParamSpec, type Program, type Statement, type Value, type ValueType } from '../blocks/index.js';
import { Dialogs, swatchOf, type BlockOption, type PickOption } from './dialogs.js';
import { h, icon } from './dom.js';
import {
  deserializeProgram,
  EditorModel,
  getList,
  isExpr,
  listKey,
  locateExpr,
  locateStatement,
  parseListKey,
  procedureOf,
  sameList,
  serializeProgram,
  type EditResult,
  type ListRef,
  type ModelChange,
  type Refusal,
  type SlotRef,
  type Spot,
} from './model.js';
import { Renderer } from './render.js';
import { GROUP_ORDER, isHole, paramSpecOf, Schema, type BlockTemplate, type Group } from './schema.js';
import { injectStyles } from './styles.js';
import { fmt, mergeText, paramTypeName, type DeepPartial, type UiText } from './text.js';

export type Theme = 'light' | 'dark' | 'auto';

export interface BlockEditorOptions {
  /** The level: its toolbox decides the palette, its labels the words. */
  level: Level;
  /** The program to start with (ids are kept; missing ones are filled). Default: empty. */
  program?: Program;
  /** Variables created earlier but not used yet (from `deserialize`). */
  variables?: string[];
  /** Label overrides on top of the level's (block texts, names…). */
  labels?: LabelOverrides;
  /** The editor's own words (buttons, menus, hints). */
  text?: DeepPartial<UiText>;
  /** `auto` (default) follows the system. */
  theme?: Theme;
  /** `auto` (default): narrow (palette on top) when the editor is narrower than `narrowBelow`. */
  layout?: 'auto' | 'wide' | 'narrow';
  /** Width in px under which `auto` layout goes narrow. Default 700. */
  narrowBelow?: number;
  /** Text at the left of the top bar. Default: the level's title. */
  title?: string;
  readOnly?: boolean;
  /** Run `analyze()` after every edit and outline problem blocks. Default true. */
  liveCheck?: boolean;
  /** Called after every edit (not cursor moves), with a copy of the program. */
  onChange?: (program: Program, change: ModelChange) => void;
}

/** Events of `editor.on()`. */
export interface BlockEditorEvents {
  /** After every edit, undo and redo, with a copy of the program. */
  change: { program: Program; change: ModelChange };
  /** The insertion cursor moved. */
  cursor: { spot: Spot };
  /** An edit was refused (over par, a block that does not fit…), with the message shown. */
  refused: { reason: Refusal; message: string };
}

type Source = { type: 'template'; tpl: BlockTemplate } | { type: 'stmt'; id: NodeId } | { type: 'expr'; id: NodeId } | { type: 'hat'; id: NodeId };

type Target =
  | { type: 'gap'; spot: Spot; rect: DOMRect }
  | { type: 'slot'; slot: SlotRef; el: HTMLElement; ok: boolean }
  | { type: 'trash' }
  | { type: 'create' }
  | null;

interface Press {
  pointerId: number;
  touch: boolean;
  /** Which move starts a drag on touch: sideways (`x`), vertical (`y`) or any (`any`, nothing scrolls under it). */
  axis: 'x' | 'y' | 'any';
  x0: number;
  y0: number;
  x: number;
  y: number;
  source: Source;
  el: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Drag {
  pointerId: number;
  source: Source;
  /** Statement, reporter, or a hat (a new script, or an existing one that can only be deleted). */
  role: 'stmt' | 'expr' | 'create' | 'hat';
  /** For reporters: what it gives. */
  returns: ValueType;
  /** For parameters: the procedure they belong to. */
  paramOf: NodeId | null;
  el: HTMLElement;
  ghost: HTMLElement;
  offX: number;
  offY: number;
  x: number;
  y: number;
  target: Target;
  raf: number;
  /** When the pointer entered a scrolling edge of the workspace (0: not in one). */
  edgeSince: number;
}

const LONG_PRESS_MS = 260;
const SLOP_TOUCH = 8;
const SLOP_MOUSE = 5;

let editorCount = 0;

export class BlockEditor {
  /** The editor's root element (inside the container). */
  readonly element: HTMLElement;
  readonly schema: Schema;
  readonly model: EditorModel;
  readonly text: UiText;

  private readonly options: BlockEditorOptions;
  private readonly renderer: Renderer;
  private readonly dialogs: Dialogs;
  private readonly uid = ++editorCount;

  private readonly countEl: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly cats: HTMLElement;
  private readonly pal: HTMLElement;
  private readonly palette: HTMLElement;
  private readonly trash: HTMLElement;
  private readonly ws: HTMLElement;
  private readonly content: HTMLElement;
  private readonly indicator: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly live: HTMLElement;

  private templates = new Map<string, BlockTemplate>();
  private press: Press | null = null;
  /** Narrow layout: the palette group shown (the category chips work as tabs). */
  private narrowGroup: string | null = null;
  private drag: Drag | null = null;
  /** Set when a drag ends: the click the browser may fire right after it is not a tap. */
  private suppressClick = false;
  private menu: { el: HTMLElement; owner: HTMLElement } | null = null;
  private activeSlot: SlotRef | null = null;
  private marks: { running: NodeId | null; stack: NodeId[]; error: { id: NodeId | null; message: string } | null } = { running: null, stack: [], error: null };
  private issues: NodeId[] = [];
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private wsFocusKey: string | null = null;
  private palFocusKey: string | null = null;
  private resize: ResizeObserver | null = null;
  private listeners: { [K in keyof BlockEditorEvents]: Set<(e: BlockEditorEvents[K]) => void> } = { change: new Set(), cursor: new Set(), refused: new Set() };
  private readonly cleanup: Array<() => void> = [];
  private destroyed = false;

  constructor(container: HTMLElement, options: BlockEditorOptions) {
    injectStyles(container.ownerDocument);
    this.options = options;
    this.text = mergeText(options.text);
    this.schema = new Schema(options.level, options.labels);
    this.model = new EditorModel(this.schema, {
      ...(options.program ? { program: options.program } : {}),
      ...(options.variables ? { variables: options.variables } : {}),
    });
    this.model.readOnly = !!options.readOnly;
    this.renderer = new Renderer(this.schema, this.model, this.text);

    const t = this.text;
    this.countEl = h('span', { class: 'rbk-count', role: 'status' });
    this.undoBtn = h('button', { class: 'rbk-btn', type: 'button', 'aria-label': `${t.undo} (Ctrl+Z)`, 'data-act': 'undo' }, icon('undo'), h('span', { class: 'rbk-btn-label' }, t.undo));
    this.redoBtn = h('button', { class: 'rbk-btn', type: 'button', 'aria-label': `${t.redo} (Ctrl+Y)`, 'data-act': 'redo' }, icon('redo'), h('span', { class: 'rbk-btn-label' }, t.redo));
    this.statusEl = h('span', { class: 'rbk-bar-title' }, options.title ?? options.level.title ?? t.workspace);
    const bar = h('div', { class: 'rbk-bar' }, this.statusEl, h('span', { class: 'rbk-count-wrap' }, h('span', { class: 'rbk-sr' }, `${t.blocks}: `), this.countEl), this.undoBtn, this.redoBtn);

    this.cats = h('div', { class: 'rbk-cats', role: 'toolbar', 'aria-label': t.palette });
    this.pal = h('div', { class: 'rbk-pal', role: 'listbox', 'aria-label': t.palette, 'aria-orientation': 'vertical' });
    this.trash = h('div', { class: 'rbk-trash', 'aria-hidden': 'true' }, icon('trash', 40), h('span', {}, t.trash));
    this.palette = h('aside', { class: 'rbk-palette', 'aria-label': t.palette }, this.cats, this.pal, this.trash);

    this.indicator = h('div', { class: 'rbk-indicator', 'aria-hidden': 'true', hidden: true });
    this.content = h('div', { class: 'rbk-ws-content' });
    this.ws = h('div', { class: 'rbk-ws', role: 'region', 'aria-label': t.workspace }, this.content);

    this.toastEl = h('div', { class: 'rbk-toast', 'aria-hidden': 'true' });
    this.live = h('div', { class: 'rbk-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });

    this.element = h(
      'div',
      { class: 'rbk-editor', 'data-rbk-theme': options.theme ?? 'auto', 'data-rbk-world': options.level.world },
      bar,
      h('div', { class: 'rbk-body' }, this.palette, this.ws),
      this.toastEl,
      this.live,
    );
    this.dialogs = new Dialogs(this.element, this.text);
    container.append(this.element);

    this.bind();
    this.applyLayout();
    if ((options.layout ?? 'auto') === 'auto' && typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(() => this.applyLayout());
      this.resize.observe(this.element);
    }
    this.model.subscribe((c) => this.onModel(c));
    this.render();
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  /** A copy of the program: a valid AST with stable ids. */
  getProgram(): Program {
    return this.model.getProgram();
  }

  /** Replaces the program. With `history: false` the undo history is cleared too. */
  setProgram(program: Program, options: { history?: boolean; variables?: string[] } = {}): void {
    this.model.setProgram(program, options);
  }

  /** The program (and created variables) as JSON text, for saving progress. */
  serialize(): string {
    return serializeProgram(this.model.getProgram(), { level: this.options.level.id, variables: this.model.createdVariables });
  }

  /** Loads text from `serialize()` (or a bare program JSON). False if it is not one. */
  deserialize(text: string, options: { history?: boolean } = {}): boolean {
    const saved = deserializeProgram(text);
    if (!saved) return false;
    this.model.setProgram(saved.program, { ...options, variables: saved.variables });
    return true;
  }

  undo(): boolean {
    return this.model.undo();
  }

  redo(): boolean {
    return this.model.redo();
  }

  get canUndo(): boolean {
    return this.model.canUndo;
  }

  get canRedo(): boolean {
    return this.model.canRedo;
  }

  /** Blocks counted as the level counts them. */
  get blockCount(): number {
    return this.model.blockCount;
  }

  get readOnly(): boolean {
    return this.model.readOnly;
  }

  /** While read-only (a run is playing) no edit is possible; scrolling still works. */
  setReadOnly(readOnly: boolean): void {
    if (this.model.readOnly === readOnly) return;
    this.model.readOnly = readOnly;
    this.cancelGesture();
    this.closeMenu();
    if (readOnly) this.dialogs.close();
    this.render();
  }

  /**
   * Highlights the block that is running (`TraceStep.node`), or none. `stack` (the trace step's
   * call ids) outlines the calls being executed.
   */
  highlight(nodeId: NodeId | null, stack: readonly NodeId[] = []): void {
    this.marks.running = nodeId;
    this.marks.stack = [...stack];
    this.applyMarks(true);
  }

  /** Marks the block that failed (`RunError.nodeId`, a block or a slot) with a bubble saying why. */
  markError(nodeId: NodeId | null, message: string): void {
    this.marks.error = { id: nodeId, message };
    this.applyMarks(true);
  }

  /** Removes the running highlight and the error mark. */
  clearMarks(): void {
    this.marks = { running: null, stack: [], error: null };
    this.applyMarks(false);
  }

  setTheme(theme: Theme): void {
    this.element.setAttribute('data-rbk-theme', theme);
  }

  /** Focuses the workspace at the insertion cursor. */
  focus(): void {
    const gap = this.content.querySelector<HTMLElement>('.rbk-gap.rbk-cursor') ?? this.content.querySelector<HTMLElement>('[data-fk]');
    gap?.focus();
  }

  /** Listens to editor events. Returns a function that stops listening. */
  on<K extends keyof BlockEditorEvents>(type: K, fn: (e: BlockEditorEvents[K]) => void): () => void {
    const set = this.listeners[type] as Set<(e: BlockEditorEvents[K]) => void>;
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Removes the editor from the page and stops listening. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelGesture();
    this.dialogs.close();
    this.resize?.disconnect();
    for (const f of this.cleanup) f();
    this.element.remove();
  }

  // -------------------------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------------------------

  private onModel(change: ModelChange): void {
    if (change.op !== 'cursor') {
      this.marks = { running: null, stack: [], error: null };
      this.activeSlot = null;
    }
    this.render(change.op === 'cursor' ? undefined : change.id);
    if (change.op === 'cursor') {
      this.emit('cursor', { spot: this.model.cursor });
      return;
    }
    const program = this.model.getProgram();
    this.options.onChange?.(program, change);
    this.emit('change', { program, change });
  }

  private emit<K extends keyof BlockEditorEvents>(type: K, e: BlockEditorEvents[K]): void {
    for (const fn of this.listeners[type]) (fn as (e: BlockEditorEvents[K]) => void)(e);
  }

  private applyLayout(): void {
    const mode = this.options.layout ?? 'auto';
    const narrow = mode === 'narrow' || (mode === 'auto' && this.element.clientWidth > 0 && this.element.clientWidth < (this.options.narrowBelow ?? 700));
    // Narrow: the palette takes at most about a third of the editor and scrolls inside if it needs to.
    const hgt = this.element.clientHeight;
    const max = hgt > 0 ? `${Math.round(Math.min(280, Math.max(132, hgt * 0.34)))}px` : '';
    if (this.element.style.getPropertyValue('--rbk-pal-max') !== max) this.element.style.setProperty('--rbk-pal-max', max);
    if (narrow === this.element.classList.contains('rbk-narrow')) return;
    this.element.classList.toggle('rbk-narrow', narrow);
    this.applyGroupTabs();
  }

  private render(flashId?: NodeId): void {
    if (this.destroyed) return;
    const wsTop = this.ws.scrollTop;
    const palTop = this.pal.scrollTop;
    const palLeft = this.pal.scrollLeft;
    const active = this.element.ownerDocument.activeElement as HTMLElement | null;
    const focusKey = active && this.element.contains(active) ? (active.getAttribute('data-fk') ?? null) : null;
    this.closeMenu(false);
    this.element.classList.toggle('rbk-readonly', this.model.readOnly);
    this.content.replaceChildren(this.renderer.workspace({ readOnly: this.model.readOnly }), this.indicator);
    this.renderPalette();
    this.renderBar();
    if (this.options.liveCheck !== false) this.issues = this.findIssues();
    this.applyIssues();
    this.applyActiveSlot();
    this.applyMarks(false);
    this.ws.scrollTop = wsTop;
    this.pal.scrollTop = palTop;
    this.pal.scrollLeft = palLeft;
    this.rove(this.content, this.wsFocusKey, '.rbk-gap.rbk-cursor');
    this.rove(this.pal, this.palFocusKey, '[data-fk]');
    if (focusKey) this.element.querySelector<HTMLElement>(`[data-fk="${esc(focusKey)}"]`)?.focus({ preventScroll: true });
    if (flashId) {
      const el = this.nodeEl(flashId);
      if (el) {
        el.classList.add('rbk-flash');
        this.reveal(el);
      }
    }
  }

  /** Roving tabindex: one element of a region is in the tab order. */
  private rove(region: HTMLElement, key: string | null, fallback: string): void {
    const el = (key ? region.querySelector<HTMLElement>(`[data-fk="${esc(key)}"]`) : null) ?? region.querySelector<HTMLElement>(fallback) ?? region.querySelector<HTMLElement>('[data-fk]');
    for (const x of region.querySelectorAll<HTMLElement>('[tabindex="0"][data-fk]')) x.tabIndex = -1;
    if (el) el.tabIndex = 0;
  }

  private renderBar(): void {
    const t = this.text;
    const n = this.model.blockCount;
    const par = this.schema.par;
    this.countEl.textContent = par ? fmt(t.count, { count: n, par: par.limit }) : fmt(t.countNoPar, { count: n });
    let state = 'none';
    if (par) {
      if (n > par.limit) state = par.strict || n > par.limit + Math.max(2, Math.ceil(par.limit * 0.25)) ? 'red' : 'amber';
      else state = n === par.limit && par.strict ? 'amber' : 'ok';
    }
    this.countEl.setAttribute('data-state', state);
    this.undoBtn.disabled = this.model.readOnly || !this.model.canUndo;
    this.redoBtn.disabled = this.model.readOnly || !this.model.canRedo;
    this.statusEl.textContent = this.model.readOnly ? t.readOnly : (this.options.title ?? this.options.level.title ?? t.workspace);
  }

  private paletteTemplates(): BlockTemplate[] {
    return this.schema.templates(this.model.program, { procedure: this.model.cursorProcedure, variables: this.model.variables });
  }

  private renderPalette(): void {
    const t = this.text;
    const all = this.paletteTemplates();
    this.templates = new Map(all.map((x) => [x.id, x]));
    const par = this.schema.par;
    const full = !!par?.strict && this.model.blockCount >= par.limit;
    const groups = new Map<Group, BlockTemplate[]>();
    for (const x of all) {
      const list = groups.get(x.group) ?? [];
      list.push(x);
      groups.set(x.group, list);
    }
    if (this.schema.variablesAllowed && !groups.has('variables')) groups.set('variables', []);
    const sections: HTMLElement[] = [];
    const chips: HTMLElement[] = [];
    for (const g of GROUP_ORDER) {
      const items = groups.get(g);
      if (!items) continue;
      const hid = `rbk-${this.uid}-h-${g}`;
      const list = h('div', { class: 'rbk-pal-items' });
      for (const x of items) {
        const disabled = full && !x.creates;
        const label = this.renderer.templateText(x);
        list.append(
          h(
            'div',
            {
              class: `rbk-pitem${disabled ? ' rbk-disabled' : ''}`,
              'data-tpl': x.id,
              'data-fk': `t:${x.id}`,
              role: 'option',
              'aria-selected': 'false',
              'aria-disabled': disabled ? 'true' : null,
              tabindex: -1,
              'aria-label': label,
            },
            this.renderer.templatePreview(x),
          ),
        );
      }
      if (g === 'variables') {
        list.append(h('button', { class: 'rbk-btn rbk-newvar', type: 'button', 'data-act': 'newVariable', 'data-fk': 't:newvar', tabindex: -1 }, icon('plus', 18), t.newVariable));
      }
      sections.push(h('section', { class: `rbk-pal-sec rbk-g-${g}`, 'data-group': g, role: 'group', 'aria-labelledby': hid }, h('h3', { class: 'rbk-pal-h', id: hid }, t.groups[g]), list));
      chips.push(h('button', { class: `rbk-cat rbk-g-${g}`, type: 'button', 'data-cat': g }, t.groups[g]));
    }
    this.pal.replaceChildren(...sections);
    this.cats.replaceChildren(...chips);
    this.cats.hidden = chips.length < 2;
    this.applyGroupTabs();
  }

  /**
   * Narrow layout with two groups or more: one group at a time, chosen with the category chips, and
   * its blocks wrap to the next line. Nothing is cut at the edge of a sideways strip. Wide layout:
   * every group, one under the other, and the chips scroll to them.
   */
  private applyGroupTabs(): void {
    const secs = [...this.pal.querySelectorAll<HTMLElement>('.rbk-pal-sec')];
    const tabs = this.element.classList.contains('rbk-narrow') && secs.length > 1;
    if (!tabs) {
      for (const sec of secs) sec.hidden = false;
      this.updateCats();
      return;
    }
    const groups = secs.map((sec) => sec.getAttribute('data-group'));
    if (!this.narrowGroup || !groups.includes(this.narrowGroup)) this.narrowGroup = groups[0] ?? null;
    for (const sec of secs) sec.hidden = sec.getAttribute('data-group') !== this.narrowGroup;
    for (const c of this.cats.querySelectorAll<HTMLElement>('.rbk-cat')) c.setAttribute('aria-current', c.getAttribute('data-cat') === this.narrowGroup ? 'true' : 'false');
  }

  private updateCats(): void {
    if (this.element.classList.contains('rbk-narrow')) return;
    const box = this.pal.getBoundingClientRect();
    let current: string | null = null;
    for (const sec of this.pal.querySelectorAll<HTMLElement>('.rbk-pal-sec')) {
      const r = sec.getBoundingClientRect();
      const start = r.top - box.top;
      if (current === null || start <= 24) current = sec.getAttribute('data-group');
    }
    for (const c of this.cats.querySelectorAll<HTMLElement>('.rbk-cat')) c.setAttribute('aria-current', c.getAttribute('data-cat') === current ? 'true' : 'false');
  }

  private findIssues(): NodeId[] {
    try {
      return analyze(this.model.program as Program, this.schema.catalog, this.options.level.toolbox, this.schema.labels)
        .map((i) => i.nodeId)
        .filter((x): x is NodeId => x !== null);
    } catch {
      return [];
    }
  }

  private applyIssues(): void {
    for (const id of this.issues) this.nodeEl(id)?.classList.add('rbk-issue');
  }

  private applyActiveSlot(): void {
    for (const x of this.content.querySelectorAll('.rbk-active-slot')) x.classList.remove('rbk-active-slot');
    if (this.activeSlot) this.slotEl(this.activeSlot)?.classList.add('rbk-active-slot');
  }

  private applyMarks(scroll: boolean): void {
    for (const x of this.content.querySelectorAll('.rbk-running, .rbk-running-slot, .rbk-calling, .rbk-error-mark, .rbk-error-slot')) {
      x.classList.remove('rbk-running', 'rbk-running-slot', 'rbk-calling', 'rbk-error-mark', 'rbk-error-slot');
    }
    for (const b of this.content.querySelectorAll('.rbk-bubble')) b.remove();
    for (const id of this.marks.stack) this.nodeEl(id)?.classList.add('rbk-calling');
    let reveal: HTMLElement | null = null;
    if (this.marks.running) {
      const el = this.nodeEl(this.marks.running);
      if (el) {
        el.classList.add(el.matches('[data-slot]') ? 'rbk-running-slot' : 'rbk-running');
        reveal = el;
      }
    }
    const err = this.marks.error;
    if (err) {
      const el = err.id ? this.nodeEl(err.id) : null;
      if (el) el.classList.add(el.matches('[data-slot]') ? 'rbk-error-slot' : 'rbk-error-mark');
      const host = el?.closest<HTMLElement>('[data-kind="stmt"], [data-kind="hat"]') ?? this.content.querySelector<HTMLElement>('[data-node="main"]');
      const bubble = h('div', { class: 'rbk-bubble', role: 'alert' }, err.message);
      if (host) host.after(bubble);
      else this.content.prepend(bubble);
      reveal = bubble;
    }
    if (scroll && reveal) this.reveal(reveal);
  }

  /** The element of a node: a block, a hat, or the slot holding a literal. */
  private nodeEl(id: NodeId): HTMLElement | null {
    const el = this.content.querySelector<HTMLElement>(`[data-node="${esc(id)}"]:not([data-field]):not([data-action])`);
    if (el) return el;
    const at = locateExpr(this.model.program as Program, id);
    return at ? this.slotEl(at) : null;
  }

  private slotEl(slot: SlotRef): HTMLElement | null {
    return this.content.querySelector<HTMLElement>(`[data-slot="${esc(`${slot.parent}:${slot.slot}`)}"]`);
  }

  private reveal(el: HTMLElement): void {
    const ws = this.ws.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const margin = 24;
    if (r.top < ws.top + margin) this.ws.scrollTop -= ws.top + margin - r.top;
    else if (r.bottom > ws.bottom - margin) this.ws.scrollTop += Math.min(r.bottom - (ws.bottom - margin), r.top - ws.top - margin);
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('rbk-show');
    this.announce(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('rbk-show'), 2600);
  }

  private announce(message: string): void {
    this.live.textContent = '';
    queueMicrotask(() => (this.live.textContent = message));
  }

  /** Reports a model result: refusals become a toast; successes an announcement. */
  private result(r: EditResult, done?: string): boolean {
    if (r.ok) {
      if (done) this.announce(done);
      return true;
    }
    const message = fmt(this.text.refused[r.reason] ?? this.text.refused.invalid ?? '', { par: this.schema.par?.limit ?? 0 });
    this.toast(message);
    this.emit('refused', { reason: r.reason, message });
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------------------------

  private listen<K extends keyof HTMLElementEventMap>(target: HTMLElement | Window | Document, type: K, fn: (e: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn as EventListener, options);
    this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, options));
  }

  private bind(): void {
    const root = this.element;
    this.listen(root, 'pointerdown', (e) => this.onPointerDown(e));
    this.listen(root, 'click', (e) => this.onClick(e));
    this.listen(root, 'keydown', (e) => this.onKey(e));
    this.listen(root, 'contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.rbk-pitem, [data-kind], [data-param]')) e.preventDefault();
    });
    this.listen(root, 'focusin', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-fk]');
      if (!el) return;
      const key = el.getAttribute('data-fk');
      if (this.content.contains(el)) {
        this.wsFocusKey = key;
        this.rove(this.content, key, '.rbk-gap.rbk-cursor');
      } else if (this.pal.contains(el)) {
        this.palFocusKey = key;
        this.rove(this.pal, key, '[data-fk]');
      }
    });
    // While dragging with a finger, the page must not scroll.
    this.listen(root, 'touchmove', (e) => {
      if (this.drag) e.preventDefault();
    }, { passive: false });
    this.listen(this.pal, 'scroll', () => this.updateCats(), { passive: true });
    const doc = this.element.ownerDocument;
    const win = doc.defaultView ?? window;
    this.listen(win, 'pointermove', (e) => this.onPointerMove(e), { passive: false });
    this.listen(win, 'pointerup', (e) => this.onPointerUp(e));
    this.listen(win, 'pointercancel', (e) => this.onPointerCancel(e));
    this.listen(doc, 'pointerdown', (e) => {
      if (this.menu && !this.menu.el.contains(e.target as Node) && !this.menu.owner.contains(e.target as Node)) this.closeMenu(false);
    }, { capture: true });
  }

  // -------------------------------------------------------------------------------------------
  // Pointer: press, drag, drop
  // -------------------------------------------------------------------------------------------

  private sourceAt(target: HTMLElement): { source: Source; el: HTMLElement } | null {
    const pitem = target.closest<HTMLElement>('.rbk-pitem');
    if (pitem && this.pal.contains(pitem)) {
      const tpl = this.templates.get(pitem.getAttribute('data-tpl') ?? '');
      if (!tpl || pitem.classList.contains('rbk-disabled')) return null;
      return { source: { type: 'template', tpl }, el: (pitem.firstElementChild as HTMLElement | null) ?? pitem };
    }
    if (!this.content.contains(target)) return null;
    const chip = target.closest<HTMLElement>('[data-param]');
    if (chip) {
      const tpl = this.paramTemplate(chip.getAttribute('data-proc') ?? '', chip.getAttribute('data-param') ?? '');
      return tpl ? { source: { type: 'template', tpl }, el: chip } : null;
    }
    if (target.closest('[data-field], [data-action], .rbk-menu, .rbk-bubble')) return null;
    const block = target.closest<HTMLElement>('[data-kind]');
    if (!block) return null;
    const id = block.getAttribute('data-node') ?? '';
    const kind = block.getAttribute('data-kind');
    if (kind === 'stmt') return { source: { type: 'stmt', id }, el: block };
    if (kind === 'expr') return { source: { type: 'expr', id }, el: block };
    if (kind === 'hat' && id !== 'main') return { source: { type: 'hat', id }, el: block };
    return null;
  }

  private paramTemplate(procId: NodeId, name: string): BlockTemplate | null {
    const proc = this.model.program.procedures?.find((p) => p.id === procId);
    if (!proc || !proc.params.includes(name)) return null;
    const returns = paramSpecOf(proc, proc.params.indexOf(name)).type;
    return { id: `param:${name}`, key: 'param', group: 'procedures', shape: 'reporter', label: '{name}', params: [], returns, param: name, procedure: proc.name };
  }

  private onPointerDown(e: PointerEvent): void {
    this.suppressClick = false;
    if (this.model.readOnly || this.dialogs.isOpen || this.press || this.drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.rbk-menu')) return;
    const found = this.sourceAt(target);
    if (!found) return;
    const touch = e.pointerType !== 'mouse';
    // Touch: `pan-y` (wide palette, workspace) drags on a sideways move, `pan-x` on a vertical one, `none` (narrow palette) on any.
    const ta = getComputedStyle(found.el.closest('.rbk-pitem') ?? found.el).touchAction;
    const axis: Press['axis'] = ta === 'none' ? 'any' : ta.includes('pan-x') && !ta.includes('pan-y') ? 'y' : 'x';
    this.press = { pointerId: e.pointerId, touch, axis, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, source: found.source, el: found.el, timer: null };
    if (touch) {
      this.press.timer = setTimeout(() => {
        const p = this.press;
        if (p && Math.hypot(p.x - p.x0, p.y - p.y0) < SLOP_TOUCH) {
          navigator.vibrate?.(12);
          this.startDrag(p);
        }
      }, LONG_PRESS_MS);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.press;
    if (p && e.pointerId === p.pointerId) {
      p.x = e.clientX;
      p.y = e.clientY;
      const dx = Math.abs(p.x - p.x0);
      const dy = Math.abs(p.y - p.y0);
      if (!p.touch) {
        if (Math.hypot(dx, dy) > SLOP_MOUSE) this.startDrag(p);
      } else if (Math.hypot(dx, dy) > SLOP_TOUCH) {
        if (p.axis === 'any' || (p.axis === 'x' ? dx > dy : dy > dx)) this.startDrag(p);
        else this.cancelPress(); // the browser scrolls
      }
      return;
    }
    const d = this.drag;
    if (d && e.pointerId === d.pointerId) {
      e.preventDefault();
      d.x = e.clientX;
      d.y = e.clientY;
      this.moveGhost(d);
      this.updateTarget(d);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.press && e.pointerId === this.press.pointerId) {
      this.cancelPress();
      return;
    }
    const d = this.drag;
    if (d && e.pointerId === d.pointerId) {
      d.x = e.clientX;
      d.y = e.clientY;
      this.updateTarget(d);
      const target = d.target;
      const source = d.source;
      this.endDrag();
      this.suppressClick = true;
      void this.drop(source, target, d.role);
    }
  }

  private onPointerCancel(e: PointerEvent): void {
    if (this.press && e.pointerId === this.press.pointerId) this.cancelPress();
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.endDrag();
      this.suppressClick = true;
    }
  }

  private cancelPress(): void {
    if (this.press?.timer) clearTimeout(this.press.timer);
    this.press = null;
  }

  private cancelGesture(): void {
    this.cancelPress();
    if (this.drag) this.endDrag();
  }

  private startDrag(p: Press): void {
    this.cancelPress();
    this.closeMenu(false);
    const source = p.source;
    let role: Drag['role'];
    let returns: ValueType = 'any';
    let paramOf: NodeId | null = null;
    if (source.type === 'template') {
      const tpl = source.tpl;
      if (tpl.creates) role = 'create';
      else if (tpl.shape === 'reporter' || tpl.shape === 'boolean') {
        role = 'expr';
        returns = tpl.returns ?? 'any';
        if (tpl.param) paramOf = this.model.program.procedures?.find((x) => x.name === tpl.procedure)?.id ?? null;
      } else role = 'stmt';
    } else if (source.type === 'expr') {
      role = 'expr';
      const n = this.model.node(source.id);
      if (n && 'kind' in n && isExpr(n)) {
        returns = this.schema.returns(n);
        paramOf = procedureOf(this.model.program as Program, source.id)?.id ?? null;
        if (n.kind !== 'param') paramOf = null;
      }
    } else role = source.type === 'stmt' ? 'stmt' : 'hat';
    const rect = p.el.getBoundingClientRect();
    const ghost = p.el.cloneNode(true) as HTMLElement;
    for (const x of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
      for (const a of ['data-node', 'data-slot', 'data-list', 'data-fk', 'data-kind', 'data-tpl', 'tabindex', 'id', 'role', 'aria-label']) x.removeAttribute(a);
    }
    ghost.classList.remove('rbk-flash', 'rbk-selected', 'rbk-running', 'rbk-issue');
    const wrap = h('div', { class: 'rbk-ghost', 'aria-hidden': 'true' }, ghost);
    wrap.style.width = `${Math.ceil(rect.width)}px`;
    this.element.append(wrap);
    const offX = Math.min(p.x0 - rect.left, 48);
    const offY = Math.min(p.y0 - rect.top, 28);
    if (source.type !== 'template') p.el.classList.add('rbk-dragging');
    this.element.classList.add('rbk-drag-any');
    if (source.type !== 'template') this.element.classList.add('rbk-drag-ws');
    const d: Drag = { pointerId: p.pointerId, source, role, returns, paramOf, el: p.el, ghost: wrap, offX, offY, x: p.x, y: p.y, target: null, raf: 0, edgeSince: 0 };
    this.drag = d;
    this.moveGhost(d);
    this.updateTarget(d);
    const tick = (): void => {
      if (this.drag !== d) return;
      this.autoScroll(d);
      d.raf = requestAnimationFrame(tick);
    };
    d.raf = requestAnimationFrame(tick);
  }

  private moveGhost(d: Drag): void {
    d.ghost.style.transform = `translate(${Math.round(d.x - d.offX)}px, ${Math.round(d.y - d.offY)}px)`;
  }

  private autoScroll(d: Drag): void {
    const r = this.ws.getBoundingClientRect();
    if (d.x < r.left || d.x > r.right) return;
    const edge = 48;
    let v = 0;
    if (d.y < r.top + edge && d.y > r.top - 30) v = -Math.ceil((r.top + edge - d.y) / 5);
    else if (d.y > r.bottom - edge && d.y < r.bottom + 30) v = Math.ceil((d.y - (r.bottom - edge)) / 5);
    if (!v) {
      d.edgeSince = 0;
      return;
    }
    // Only after a short stay at the edge, so dropping on a gap near the edge does not scroll it away.
    const now = performance.now();
    if (!d.edgeSince) d.edgeSince = now;
    if (now - d.edgeSince < 250) return;
    const before = this.ws.scrollTop;
    this.ws.scrollTop += v;
    if (this.ws.scrollTop !== before) this.updateTarget(d);
  }

  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    d.el.classList.remove('rbk-dragging');
    this.element.classList.remove('rbk-drag-any', 'rbk-drag-ws');
    this.setTarget(d, null);
    this.drag = null;
  }

  private inside(r: DOMRect, x: number, y: number): boolean {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private updateTarget(d: Drag): void {
    let target: Target = null;
    const pr = this.palette.getBoundingClientRect();
    const wr = this.ws.getBoundingClientRect();
    if (d.source.type !== 'template' && this.inside(pr, d.x, d.y)) target = { type: 'trash' };
    else if (this.inside(wr, d.x, d.y)) {
      // The probe: near the ghost's top-left corner, where the block "plugs in".
      const px = d.x - d.offX + 14;
      const py = d.y - d.offY + 16;
      if (d.role === 'stmt') target = this.gapAt(px, py, d);
      else if (d.role === 'expr') target = this.slotAt(px, py, d) ?? this.slotAt(d.x, d.y, d);
      else if (d.role === 'create') target = { type: 'create' };
    }
    this.setTarget(d, target);
  }

  private gapAt(px: number, py: number, d: Drag): Target {
    let best: { el: HTMLElement; score: number; left: number } | null = null;
    for (const g of this.content.querySelectorAll<HTMLElement>('.rbk-gap')) {
      if (d.source.type === 'stmt' && d.el.contains(g)) continue;
      const r = g.getBoundingClientRect();
      if (r.width === 0) continue;
      const tall = r.height > 20;
      const top = tall ? r.top : r.top - 4;
      const bottom = tall ? r.bottom : r.bottom + 4;
      const dy = py < top ? top - py : py > bottom ? py - bottom : 0;
      const dx = px < r.left - 24 ? r.left - 24 - px : 0;
      const score = dy + dx * 1.5;
      if (!best || score < best.score - 0.5 || (Math.abs(score - best.score) <= 0.5 && r.left > best.left)) best = { el: g, score, left: r.left };
    }
    if (!best) return null;
    const list = parseListKey(best.el.getAttribute('data-list') ?? '');
    if (!list) return null;
    return { type: 'gap', spot: { list, index: Number(best.el.getAttribute('data-index') ?? 0) }, rect: best.el.getBoundingClientRect() };
  }

  private slotAt(px: number, py: number, d: Drag): Target {
    let best: { el: HTMLElement; area: number } | null = null;
    for (const s of this.content.querySelectorAll<HTMLElement>('[data-slot]')) {
      if (d.source.type === 'expr' && d.el.contains(s)) continue;
      const r = s.getBoundingClientRect();
      const pad = 6;
      if (px < r.left - pad || px > r.right + pad || py < r.top - pad || py > r.bottom + pad) continue;
      const area = r.width * r.height;
      if (!best || area < best.area) best = { el: s, area };
    }
    if (!best) return null;
    const [parent, index] = splitSlot(best.el.getAttribute('data-slot') ?? '');
    const type = (best.el.getAttribute('data-type') ?? 'any') as ValueType;
    let ok = this.schema.fits(d.returns, type);
    if (ok && d.paramOf) ok = procedureOf(this.model.program as Program, parent)?.id === d.paramOf;
    if (ok && d.source.type === 'expr') {
      const from = locateExpr(this.model.program as Program, d.source.id);
      if (from && from.parent === parent && from.slot === index) ok = false;
    }
    return { type: 'slot', slot: { parent, slot: index }, el: best.el, ok };
  }

  private setTarget(d: Drag, target: Target): void {
    const prev = d.target;
    if (prev?.type === 'slot') prev.el.classList.remove('rbk-target-slot', 'rbk-target-bad');
    d.target = target;
    this.trash.classList.toggle('rbk-over', target?.type === 'trash');
    this.ws.classList.toggle('rbk-create-target', target?.type === 'create');
    if (target?.type === 'slot') target.el.classList.add(target.ok ? 'rbk-target-slot' : 'rbk-target-bad');
    if (target?.type === 'gap') {
      const c = this.content.getBoundingClientRect();
      const r = target.rect;
      const tall = r.height > 20;
      const y = (tall ? r.top + 6 : r.top + r.height / 2 - 3) - c.top;
      this.indicator.hidden = false;
      this.indicator.style.transform = `translate(${Math.round(r.left - c.left + 8)}px, ${Math.round(y)}px)`;
      this.indicator.style.width = `${Math.max(60, Math.min(220, r.width - 12))}px`;
    } else this.indicator.hidden = true;
  }

  private async drop(source: Source, target: Target, role: Drag['role']): Promise<void> {
    if (!target) return;
    if (target.type === 'trash') {
      if (source.type === 'hat') await this.removeScript(source.id);
      else if (source.type !== 'template') {
        const label = this.labelOf(source.id);
        this.result(this.model.remove(source.id), fmt(this.text.removed, { block: label }));
      }
      return;
    }
    if (target.type === 'create' && source.type === 'template') {
      await this.createFromHat(source.tpl);
      return;
    }
    if (target.type === 'gap' && role === 'stmt') {
      if (source.type === 'template') {
        const node = this.schema.instantiate(source.tpl, this.model.newId);
        if (node && !isExpr(node)) this.result(this.model.insert(node, target.spot), fmt(this.text.added, { block: this.renderer.describe(node) }));
      } else if (source.type === 'stmt') {
        const from = locateStatement(this.model.program as Program, source.id);
        if (from && sameList(from.list, target.spot.list) && (target.spot.index === from.index || target.spot.index === from.index + 1)) return;
        this.result(this.model.move(source.id, target.spot), fmt(this.text.moved, { block: this.labelOf(source.id) }));
      }
      return;
    }
    if (target.type === 'slot' && role === 'expr') {
      if (!target.ok) {
        if (source.type === 'expr') {
          const from = locateExpr(this.model.program as Program, source.id);
          if (from && from.parent === target.slot.parent && from.slot === target.slot.slot) return;
        }
        this.result({ ok: false, reason: this.paramScopeFails(source, target.slot) ? 'scope' : 'type' });
        return;
      }
      if (source.type === 'template') {
        const node = this.schema.instantiate(source.tpl, this.model.newId);
        if (node && isExpr(node)) this.result(this.model.putExpr(node, target.slot), fmt(this.text.added, { block: this.renderer.describe(node) }));
      } else if (source.type === 'expr') this.result(this.model.moveExpr(source.id, target.slot), fmt(this.text.moved, { block: this.labelOf(source.id) }));
    }
  }

  /** Whether a parameter would leave its procedure (rather than not fitting the slot). */
  private paramScopeFails(source: Source, slot: SlotRef): boolean {
    const p = this.model.program as Program;
    const here = procedureOf(p, slot.parent);
    if (source.type === 'template') return !!source.tpl.param && here?.name !== source.tpl.procedure;
    if (source.type !== 'expr') return false;
    const n = this.model.node(source.id);
    return !!n && 'kind' in n && n.kind === 'param' && procedureOf(p, source.id)?.id !== here?.id;
  }

  // -------------------------------------------------------------------------------------------
  // Taps
  // -------------------------------------------------------------------------------------------

  private onClick(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]');
    if (act && this.element.contains(act) && !act.closest('.rbk-menu')) {
      this.action(act.getAttribute('data-act') ?? '');
      return;
    }
    const cat = target.closest<HTMLElement>('[data-cat]');
    if (cat) {
      this.showGroup(cat.getAttribute('data-cat') ?? '');
      return;
    }
    if (target.closest('.rbk-menu, .rbk-modal')) return;
    const el = target.closest<HTMLElement>('[data-tpl], [data-action], [data-param], [data-field], .rbk-lit, .rbk-hole, .rbk-gap, [data-kind]');
    if (!el) {
      if (this.content.contains(target)) this.setActiveSlot(null);
      return;
    }
    void this.activate(el);
  }

  private action(name: string): void {
    if (name === 'undo') this.result(this.model.undo() ? { ok: true } : { ok: false, reason: 'edge' });
    else if (name === 'redo') this.result(this.model.redo() ? { ok: true } : { ok: false, reason: 'edge' });
    else if (name === 'newVariable') void this.newVariable();
  }

  private showGroup(group: string): void {
    const sec = this.pal.querySelector<HTMLElement>(`.rbk-pal-sec[data-group="${esc(group)}"]`);
    if (!sec) return;
    if (this.element.classList.contains('rbk-narrow')) {
      this.narrowGroup = group;
      this.applyGroupTabs();
      this.pal.scrollTop = 0;
      return;
    }
    const box = this.pal.getBoundingClientRect();
    const r = sec.getBoundingClientRect();
    this.pal.scrollTop += r.top - box.top - 4;
    for (const c of this.cats.querySelectorAll<HTMLElement>('.rbk-cat')) c.setAttribute('aria-current', c.getAttribute('data-cat') === group ? 'true' : 'false');
  }

  /** What a tap, Enter or Space does on an element. */
  private async activate(el: HTMLElement): Promise<void> {
    if (this.model.readOnly) return;
    if (el.hasAttribute('data-tpl')) {
      const tpl = this.templates.get(el.getAttribute('data-tpl') ?? '');
      if (tpl) await this.tapTemplate(tpl);
      return;
    }
    if (!this.content.contains(el)) return;
    if (el.getAttribute('data-action') === 'addParam') {
      await this.addParam(el.getAttribute('data-node') ?? '');
      return;
    }
    if (el.hasAttribute('data-param')) {
      this.paramMenu(el);
      return;
    }
    if (el.hasAttribute('data-field')) {
      await this.editField(el);
      return;
    }
    if (el.matches('.rbk-lit, .rbk-hole')) {
      const slotEl = el.closest<HTMLElement>('[data-slot]');
      if (slotEl) {
        const [parent, index] = splitSlot(slotEl.getAttribute('data-slot') ?? '');
        await this.editSlot({ parent, slot: index });
      }
      return;
    }
    if (el.classList.contains('rbk-gap')) {
      const list = parseListKey(el.getAttribute('data-list') ?? '');
      if (list) this.model.setCursor({ list, index: Number(el.getAttribute('data-index') ?? 0) });
      this.content.querySelector<HTMLElement>(`[data-fk="${esc(el.getAttribute('data-fk') ?? '')}"]`)?.focus({ preventScroll: true });
      return;
    }
    const kind = el.getAttribute('data-kind');
    if (kind === 'stmt') this.stmtMenu(el);
    else if (kind === 'expr') this.exprMenu(el);
    else if (kind === 'hat') {
      const id = el.getAttribute('data-node') ?? '';
      if (id === 'main') this.model.setCursor({ list: { kind: 'main' }, index: 0 });
      else this.hatMenu(el);
    }
  }

  private async tapTemplate(tpl: BlockTemplate): Promise<void> {
    if (tpl.creates) {
      await this.createFromHat(tpl);
      return;
    }
    const node = this.schema.instantiate(tpl, this.model.newId);
    if (!node) return;
    if (!isExpr(node)) {
      const inner = node.kind === 'repeat' || node.kind === 'repeatUntil' || node.kind === 'if';
      this.result(this.model.insert(node, undefined, { enter: inner }), fmt(this.text.added, { block: this.renderer.describe(node) }));
      return;
    }
    const slot = this.activeSlot ?? this.holeNearCursor(this.schema.returns(node));
    if (!slot) {
      this.toast(this.text.tapSlotFirst);
      return;
    }
    this.result(this.model.putExpr(node, slot), fmt(this.text.added, { block: this.renderer.describe(node) }));
  }

  /** An empty slot where a tapped reporter probably goes: in the block before the cursor, or the one the cursor is in. */
  private holeNearCursor(given: ValueType): SlotRef | null {
    const p = this.model.program as Program;
    const cur = this.model.cursor;
    const list = getList(p, cur.list) ?? [];
    const candidates: Statement[] = [];
    const prev = list[cur.index - 1];
    if (prev) candidates.push(prev);
    if (cur.list.kind === 'body') {
      const owner = this.model.node(cur.list.id);
      if (owner && 'kind' in owner && !isExpr(owner)) candidates.push(owner);
    }
    for (const s of candidates) {
      const found = this.findHole(s, given);
      if (found) return found;
    }
    return null;
  }

  private findHole(node: Statement | Expr, given: ValueType): SlotRef | null {
    const specs = this.schema.slots(node);
    const kids = childExprs(node);
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!;
      if (isHole(k) && this.schema.fits(given, specs[i]?.type ?? 'any')) return { parent: node.id, slot: i };
      if (!isHole(k) && !isLit(k)) {
        const inner = this.findHole(k, given);
        if (inner) return inner;
      }
    }
    return null;
  }

  private setActiveSlot(slot: SlotRef | null): void {
    this.activeSlot = slot;
    this.applyActiveSlot();
  }

  /** The reporters of the palette that fit a slot (for the "Poner un bloque" part of pickers). */
  private reporterOptions(type: ValueType, slot: SlotRef): BlockOption[] {
    const proc = procedureOf(this.model.program as Program, slot.parent);
    const out: BlockOption[] = [];
    const seen = new Set<string>();
    const tpls = [...this.templates.values()];
    if (proc) for (const name of proc.params) {
      const t = this.paramTemplate(proc.id, name);
      if (t && !this.templates.has(t.id)) tpls.push(t);
    }
    for (const t of tpls) {
      if (t.shape !== 'reporter' && t.shape !== 'boolean') continue;
      if (!this.schema.fits(t.returns ?? 'any', type)) continue;
      if (t.param && proc?.name !== t.procedure) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ id: t.id, el: this.renderer.templatePreview(t), label: this.renderer.templateText(t) });
    }
    return out;
  }

  private templateById(id: string, slot: SlotRef): BlockTemplate | null {
    const t = this.templates.get(id);
    if (t) return t;
    const proc = procedureOf(this.model.program as Program, slot.parent);
    return id.startsWith('param:') && proc ? this.paramTemplate(proc.id, id.slice(6)) : null;
  }

  private async editSlot(slot: SlotRef): Promise<void> {
    const parent = this.model.node(slot.parent);
    if (!parent || !('kind' in parent)) return;
    const spec = this.schema.slots(parent)[slot.slot];
    const cur = childExprs(parent)[slot.slot];
    if (!spec || !cur) return;
    this.setActiveSlot(slot);
    const t = this.text;
    const blocks = this.reporterOptions(spec.type, slot);
    const putBlock = (id: string): void => {
      const tpl = this.templateById(id, slot);
      const node = tpl ? this.schema.instantiate(tpl, this.model.newId) : null;
      if (node && isExpr(node)) this.result(this.model.putExpr(node, slot), fmt(t.added, { block: this.renderer.describe(node) }));
    };
    const keypad = async (): Promise<void> => {
      const r = await this.dialogs.keypad({ title: t.typeNumber, value: cur.kind === 'number' ? cur.value : 0, decimal: this.schema.labels.decimalSeparator, blocks, blocksTitle: t.putBlock });
      if (r?.type === 'value') this.result(this.model.setValue(slot, r.value));
      else if (r?.type === 'block') putBlock(r.id);
    };
    const typeText = async (): Promise<void> => {
      const v = await this.dialogs.prompt({ title: t.typeText, value: cur.kind === 'name' ? cur.value : '' });
      if (v) this.result(this.model.setValue(slot, v));
    };
    if (spec.type === 'number') {
      await keypad();
      return;
    }
    let choices = this.schema.choices(spec);
    if (spec.type === 'boolean' && blocks.length) choices = [];
    const current = isLit(cur) ? cur.value : undefined;
    const options: PickOption[] = choices.map((v) => {
      const o: PickOption = { label: this.schema.describe(v), value: v, pressed: v === current };
      const sw = swatchOf(v);
      if (sw) o.swatch = sw;
      if (typeof v === 'string' && /^[NESW]$/.test(v) && spec.type !== 'name') o.big = true;
      return o;
    });
    const extras: Array<{ id: string; label: string }> = [];
    if (spec.type === 'any') extras.push({ id: 'number', label: t.typeNumber });
    if (spec.type === 'any' || (spec.type === 'name' && !choices.length)) extras.push({ id: 'text', label: t.typeText });
    if (!options.length && !blocks.length && extras.length === 1) {
      if (extras[0]!.id === 'text') await typeText();
      return;
    }
    const r = await this.dialogs.picker({ title: blocks.length && !options.length ? t.putBlock : t.chooseValue, options, blocks, blocksTitle: t.putBlock, extras });
    if (!r) return;
    if (r.type === 'value') this.result(this.model.setValue(slot, r.value as Value));
    else if (r.type === 'block') putBlock(r.id);
    else if (r.id === 'number') await keypad();
    else if (r.id === 'text') await typeText();
  }

  private async editField(el: HTMLElement): Promise<void> {
    const id = el.getAttribute('data-node') ?? '';
    const field = el.getAttribute('data-field');
    const t = this.text;
    if (field === 'proc') {
      await this.renameProcedure(id);
    } else if (field === 'var') {
      const n = this.model.node(id);
      const current = n && 'kind' in n && (n.kind === 'set' || n.kind === 'change') ? n.variable : '';
      const r = await this.dialogs.picker({
        title: t.chooseVariable,
        options: this.model.variables.map((v) => ({ label: v, value: v, pressed: v === current })),
        extras: [{ id: 'new', label: t.newVariable }],
      });
      if (r?.type === 'value') this.result(this.model.setVariable(id, String(r.value)));
      else if (r?.type === 'extra') {
        const name = await this.askName(t.nameVariable, '', (v) => (this.model.variables.includes(v) ? t.refused.duplicateName ?? '' : null));
        if (name && this.result(this.model.addVariable(name))) this.result(this.model.setVariable(id, name));
      }
    } else if (field === 'event') {
      const hd = this.model.program.handlers?.find((x) => x.id === id);
      if (!hd) return;
      const ev = await this.chooseEvent(hd.event);
      if (ev) this.result(this.model.setHandlerEvent(id, ev));
    }
  }

  private eventChoices(type: EventSpec['type']): string[] {
    if (type === 'key') return this.schema.choices({ type: 'name', name: 'key' }).map(String);
    if (type === 'touch') return [...new Set([...this.schema.choices({ type: 'name', name: 'kind' }), ...this.schema.choices({ type: 'name', name: 'tile' })].map(String))];
    return [];
  }

  private async chooseEvent(event: EventSpec): Promise<EventSpec | null> {
    if (event.type !== 'key' && event.type !== 'touch') return event;
    const current = event.type === 'key' ? event.key : event.what;
    const values = this.eventChoices(event.type);
    if (!values.length) return event;
    const r = await this.dialogs.picker({ title: this.text.chooseEvent, options: values.map((v) => ({ label: this.schema.describe(v), value: v, pressed: v === current, big: event.type === 'key' })) });
    if (r?.type !== 'value') return null;
    const v = String(r.value);
    return event.type === 'key' ? { type: 'key', key: v } : { type: 'touch', what: v };
  }

  // -------------------------------------------------------------------------------------------
  // Names, procedures, handlers
  // -------------------------------------------------------------------------------------------

  private askName(title: string, value: string, taken: (v: string) => string | null): Promise<string | null> {
    return this.dialogs.prompt({ title, value, validate: (v) => (v ? taken(v) : (this.text.refused.name ?? '')) });
  }

  private unique(base: string, used: readonly string[]): string {
    if (!used.includes(base)) return base;
    for (let i = 2; ; i++) if (!used.includes(`${base} ${i}`)) return `${base} ${i}`;
  }

  private async createFromHat(tpl: BlockTemplate): Promise<void> {
    const c = this.schema.creation(tpl);
    if (!c) return;
    if (c.type === 'procedure') {
      const used = (this.model.program.procedures ?? []).map((p) => p.name);
      const name = await this.askName(this.text.nameProcedure, this.unique(this.text.defaultProcedure, used), (v) => (used.includes(v) ? (this.text.refused.duplicateName ?? '') : null));
      if (!name) return;
      this.result(this.model.addProcedure(name), fmt(this.text.added, { block: name }));
    } else {
      const ev = await this.chooseEvent(c.event);
      if (!ev) return;
      this.result(this.model.addHandler(ev));
    }
  }

  private async renameProcedure(id: NodeId): Promise<void> {
    const proc = this.model.program.procedures?.find((p) => p.id === id);
    if (!proc) return;
    const used = (this.model.program.procedures ?? []).filter((p) => p.id !== id).map((p) => p.name);
    const name = await this.askName(this.text.nameProcedure, proc.name, (v) => (used.includes(v) ? (this.text.refused.duplicateName ?? '') : null));
    if (name && name !== proc.name) this.result(this.model.renameProcedure(id, name));
  }

  private async addParam(procId: NodeId): Promise<void> {
    const proc = this.model.program.procedures?.find((p) => p.id === procId);
    if (!proc) return;
    const name = await this.askName(this.text.nameParam, this.unique(this.text.defaultParam, proc.params), (v) => (proc.params.includes(v) ? (this.text.refused.duplicateName ?? '') : null));
    if (!name) return;
    // What goes in it: asked only when the level offers more than numbers.
    const types = this.schema.paramTypes();
    let type: ParamSpec | null = types[0] ?? null;
    if (types.length > 1) {
      type = await this.askParamType(name, types, null);
      if (!type) return;
    }
    this.result(this.model.addParam(procId, name, type ?? undefined));
  }

  /** Asks what a parameter takes, among the level's types. Null when cancelled. */
  private async askParamType(name: string, types: ParamSpec[], current: ParamSpec | null): Promise<ParamSpec | null> {
    const same = (a: ParamSpec, b: ParamSpec | null): boolean => !!b && a.type === b.type && (a.name ?? '') === (b.name ?? '');
    const r = await this.dialogs.picker({
      title: fmt(this.text.paramTypeTitle, { name }),
      options: types.map((t, i) => ({ label: paramTypeName(this.text, t), value: i, pressed: same(t, current) })),
    });
    return r?.type === 'value' && typeof r.value === 'number' ? (types[r.value] ?? null) : null;
  }

  /** Deletes a procedure (asking first when blocks call it) or a handler. */
  private async removeScript(id: NodeId): Promise<void> {
    const proc = this.model.program.procedures?.find((p) => p.id === id);
    if (proc) {
      const calls = this.model.callCount(proc.name);
      if (calls > 0) {
        const ok = await this.dialogs.confirm({ title: this.text.deleteProcedure, message: fmt(this.text.confirmDeleteProcedure, { name: proc.name, count: calls }), ok: this.text.confirmDelete });
        if (!ok) return;
      }
      this.result(this.model.removeProcedure(id), fmt(this.text.removed, { block: proc.name }));
      return;
    }
    this.result(this.model.remove(id));
  }

  private async newVariable(): Promise<void> {
    if (this.model.readOnly) return;
    const name = await this.askName(this.text.nameVariable, '', (v) => (this.model.variables.includes(v) ? (this.text.refused.duplicateName ?? '') : null));
    if (name) this.result(this.model.addVariable(name), fmt(this.text.added, { block: name }));
  }

  // -------------------------------------------------------------------------------------------
  // Menus
  // -------------------------------------------------------------------------------------------

  private labelOf(id: NodeId): string {
    const n = this.model.node(id);
    return n && 'kind' in n ? this.renderer.describe(n) : '';
  }

  private openMenu(owner: HTMLElement, items: Array<{ label: string; icon: string; run: () => void | Promise<void>; danger?: boolean; disabled?: boolean }>): void {
    this.closeMenu(false);
    const menu = h('div', { class: 'rbk-menu', role: 'menu', 'aria-label': owner.getAttribute('aria-label') ?? '' });
    for (const it of items) {
      const b = h('button', { class: `rbk-mbtn${it.danger ? ' rbk-danger' : ''}`, type: 'button', role: 'menuitem', disabled: it.disabled ? true : null }, icon(it.icon, 20), h('span', {}, it.label));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMenu(false);
        void it.run();
      });
      menu.append(b);
    }
    menu.append(
      (() => {
        const b = h('button', { class: 'rbk-mbtn', type: 'button', role: 'menuitem', 'aria-label': this.text.close }, icon('close', 20));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeMenu(true);
        });
        return b;
      })(),
    );
    menu.addEventListener('keydown', (e) => {
      const btns = [...menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      const i = btns.indexOf(e.target as HTMLButtonElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') btns[(i + 1) % btns.length]?.focus();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length]?.focus();
      else if (e.key === 'Escape') this.closeMenu(true);
      else if (e.key === 'Tab') this.closeMenu(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    owner.classList.add('rbk-selected');
    this.content.append(menu);
    const c = this.content.getBoundingClientRect();
    const row = (owner.querySelector(':scope > .rbk-row') ?? owner).getBoundingClientRect();
    const width = menu.offsetWidth;
    const left = Math.max(4, Math.min(row.left - c.left, this.content.clientWidth - width - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${row.bottom - c.top + 6}px`;
    this.menu = { el: menu, owner };
    menu.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
    this.reveal(menu);
  }

  private closeMenu(refocus = false): void {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    m.el.remove();
    m.owner.classList.remove('rbk-selected');
    if (refocus && m.owner.isConnected) m.owner.focus({ preventScroll: true });
  }

  private stmtMenu(el: HTMLElement): void {
    const id = el.getAttribute('data-node') ?? '';
    const t = this.text;
    const at = locateStatement(this.model.program as Program, id);
    if (!at) return;
    const label = this.labelOf(id);
    this.openMenu(el, [
      { label: t.delete, icon: 'trash', danger: true, run: () => void this.result(this.model.remove(id), fmt(t.removed, { block: label })) },
      { label: t.duplicate, icon: 'copy', run: () => void this.result(this.model.duplicate(id)) },
      { label: t.moveUp, icon: 'up', run: () => void this.result(this.model.moveUp(id)) },
      { label: t.moveDown, icon: 'down', run: () => void this.result(this.model.moveDown(id)) },
      { label: t.insertBelow, icon: 'below', run: () => void this.model.setCursor({ list: at.list, index: at.index + 1 }) },
    ]);
  }

  private exprMenu(el: HTMLElement): void {
    const id = el.getAttribute('data-node') ?? '';
    const t = this.text;
    const slot = locateExpr(this.model.program as Program, id);
    const label = this.labelOf(id);
    this.openMenu(el, [
      { label: t.delete, icon: 'trash', danger: true, run: () => void this.result(this.model.remove(id), fmt(t.removed, { block: label })) },
      ...(slot ? [{ label: t.chooseValue, icon: 'edit', run: () => this.editSlot(slot) }] : []),
    ]);
  }

  private hatMenu(el: HTMLElement): void {
    const id = el.getAttribute('data-node') ?? '';
    const t = this.text;
    const proc = this.model.program.procedures?.find((p) => p.id === id);
    if (proc) {
      this.openMenu(el, [
        { label: t.rename, icon: 'edit', run: () => this.renameProcedure(id) },
        ...(this.schema.parameters ? [{ label: t.addParam, icon: 'plus', run: () => this.addParam(id) }] : []),
        { label: t.deleteProcedure, icon: 'trash', danger: true, run: () => this.removeScript(id) },
      ]);
      return;
    }
    const hd = this.model.program.handlers?.find((x) => x.id === id);
    if (!hd) return;
    this.openMenu(el, [
      ...(hd.event.type === 'key' || hd.event.type === 'touch'
        ? [{ label: t.chooseEvent, icon: 'edit', run: async () => {
            const ev = await this.chooseEvent(hd.event);
            if (ev) this.result(this.model.setHandlerEvent(id, ev));
          } }]
        : []),
      { label: t.deleteHandler, icon: 'trash', danger: true, run: () => this.removeScript(id) },
    ]);
  }

  private paramMenu(el: HTMLElement): void {
    const procId = el.getAttribute('data-proc') ?? '';
    const name = el.getAttribute('data-param') ?? '';
    const t = this.text;
    const proc = this.model.program.procedures?.find((p) => p.id === procId);
    if (!proc) return;
    this.openMenu(el, [
      {
        label: t.rename,
        icon: 'edit',
        run: async () => {
          const v = await this.askName(t.nameParam, name, (x) => (x !== name && proc.params.includes(x) ? (t.refused.duplicateName ?? '') : null));
          if (v && v !== name) this.result(this.model.renameParam(procId, name, v));
        },
      },
      ...(this.schema.paramTypes().length > 1
        ? [{ label: t.paramTypeMenu, icon: 'edit', run: async () => {
            const types = this.schema.paramTypes();
            const current = paramSpecOf(proc, proc.params.indexOf(name));
            // A type the level does not list (made elsewhere) still shows, chosen.
            if (current.type !== 'any' && !types.some((x) => x.type === current.type && (x.name ?? '') === (current.name ?? ''))) types.push(current);
            const v = await this.askParamType(name, types, current);
            if (v) this.result(this.model.setParamType(procId, name, v));
          } }]
        : []),
      { label: t.removeParam, icon: 'minus', danger: true, run: () => void this.result(this.model.removeParam(procId, name)) },
    ]);
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (this.dialogs.isOpen) return;
    const target = e.target as HTMLElement;
    if (target.matches('input, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (!this.model.readOnly) this.model.undo();
      return;
    }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (!this.model.readOnly) this.model.redo();
      return;
    }
    if (e.key === 'Escape') {
      if (this.drag) {
        this.endDrag();
        e.preventDefault();
      } else if (this.activeSlot) this.setActiveSlot(null);
      return;
    }
    if (target.closest('.rbk-menu')) return;
    const fk = target.closest<HTMLElement>('[data-fk]');
    if (!fk) return;
    if (this.pal.contains(fk)) this.paletteKey(e, fk);
    else if (this.content.contains(fk)) this.workspaceKey(e, fk);
  }

  private paletteKey(e: KeyboardEvent, el: HTMLElement): void {
    const items = [...this.pal.querySelectorAll<HTMLElement>('[data-fk]')];
    const i = items.indexOf(el);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = items[i + 1];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = items[i - 1];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if ((e.key === 'Enter' || e.key === ' ') && el.hasAttribute('data-tpl')) {
      e.preventDefault();
      void this.activate(el);
      return;
    } else return;
    e.preventDefault();
    if (next) {
      const sec = next.closest<HTMLElement>('.rbk-pal-sec');
      if (sec?.hidden) this.showGroup(sec.getAttribute('data-group') ?? '');
      next.focus();
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  private workspaceKey(e: KeyboardEvent, el: HTMLElement): void {
    const id = el.getAttribute('data-node');
    const kind = el.getAttribute('data-kind');
    if (e.altKey && kind === 'stmt' && id && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      this.result(e.key === 'ArrowUp' ? this.model.moveUp(id) : this.model.moveDown(id));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const lines = [...this.content.querySelectorAll<HTMLElement>('.rbk-gap, [data-kind="stmt"], [data-kind="hat"]')];
      const line = el.closest<HTMLElement>('.rbk-gap, [data-kind="stmt"], [data-kind="hat"]');
      const i = line ? lines.indexOf(line) : -1;
      const next = lines[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (!next) return;
      this.focusLine(next);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const all = [...this.content.querySelectorAll<HTMLElement>('[data-fk]')];
      const next = all[all.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)];
      next?.focus();
      if (next) this.reveal(next);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void this.activate(el);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && id && !this.model.readOnly) {
      e.preventDefault();
      if (kind === 'hat' && id !== 'main') void this.removeScript(id);
      else if (kind === 'stmt' || kind === 'expr') {
        const label = this.labelOf(id);
        // Keep the keyboard where the block was.
        const at = kind === 'stmt' ? locateStatement(this.model.program as Program, id) : null;
        if (this.result(this.model.remove(id), fmt(this.text.removed, { block: label })) && at) {
          this.content.querySelector<HTMLElement>(`[data-fk="${esc(`g:${listKey(at.list)}:${at.index}`)}"]`)?.focus();
        }
      }
    }
  }

  /** Focuses a gap (moving the insertion cursor there) or a block. */
  private focusLine(el: HTMLElement): void {
    if (el.classList.contains('rbk-gap')) {
      const key = el.getAttribute('data-fk') ?? '';
      const list = parseListKey(el.getAttribute('data-list') ?? '');
      if (list && !this.model.readOnly) {
        this.wsFocusKey = key;
        this.model.setCursor({ list, index: Number(el.getAttribute('data-index') ?? 0) });
      }
      const now = this.content.querySelector<HTMLElement>(`[data-fk="${esc(key)}"]`);
      now?.focus();
      if (now) this.reveal(now);
      return;
    }
    el.focus();
    this.reveal(el);
  }
}

function esc(s: string): string {
  const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  return css?.escape ? css.escape(s) : s.replace(/["\\]/g, '\\$&');
}

function splitSlot(ref: string): [NodeId, number] {
  const i = ref.lastIndexOf(':');
  return [ref.slice(0, i), Number(ref.slice(i + 1))];
}

function isLit(e: Expr): e is Extract<Expr, { kind: 'number' | 'boolean' | 'direction' | 'name' }> {
  return e.kind === 'number' || e.kind === 'boolean' || e.kind === 'direction' || e.kind === 'name';
}

export type { ListRef };
