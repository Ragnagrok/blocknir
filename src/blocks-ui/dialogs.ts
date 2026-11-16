/**
 * Modal dialogs with big targets: a number keypad, a value picker, a name prompt and a confirm.
 * Each returns a promise; Escape or a tap on the backdrop cancels (resolves null / false).
 */
import { h, icon, SWATCHES } from './dom.js';
import type { UiText } from './text.js';

export interface PickOption {
  label: string;
  value: unknown;
  /** Show a color dot (a CSS color). */
  swatch?: string;
  /** Bigger text (arrows). */
  big?: boolean;
  pressed?: boolean;
}

export type PickResult = { type: 'value'; value: unknown } | { type: 'block'; id: string } | { type: 'extra'; id: string } | null;

export interface BlockOption {
  id: string;
  el: HTMLElement;
  label: string;
}

export class Dialogs {
  private current: { el: HTMLElement; cancel: () => void } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly text: UiText,
  ) {}

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** Closes the open dialog, as if cancelled. */
  close(): void {
    this.current?.cancel();
  }

  private show<T>(title: string, build: (body: HTMLElement, done: (v: T) => void) => void, cancelValue: T): Promise<T> {
    this.close();
    return new Promise<T>((resolve) => {
      const titleId = `rbk-dlg-${Math.floor(performance.now())}`;
      const dialog = h('div', { class: 'rbk-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, h('h2', { class: 'rbk-dlg-title', id: titleId }, title));
      const modal = h('div', { class: 'rbk-modal' }, dialog);
      let finished = false;
      const done = (v: T): void => {
        if (finished) return;
        finished = true;
        modal.remove();
        if (this.current?.el === modal) this.current = null;
        resolve(v);
      };
      modal.addEventListener('pointerdown', (e) => {
        if (e.target === modal) {
          e.preventDefault();
          done(cancelValue);
        }
      });
      modal.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          done(cancelValue);
        } else if (e.key === 'Tab') {
          const items = [...dialog.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
          if (!items.length) return;
          const first = items[0]!;
          const last = items[items.length - 1]!;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });
      build(dialog, done);
      this.root.append(modal);
      this.current = { el: modal, cancel: () => done(cancelValue) };
      const focus = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog.querySelector<HTMLElement>('input, button');
      focus?.focus({ preventScroll: true });
    });
  }

  /** Asks for a name. Resolves the trimmed text, or null. `validate` returns an error message. */
  prompt(options: { title: string; value?: string; validate?: (v: string) => string | null }): Promise<string | null> {
    return this.show<string | null>(
      options.title,
      (body, done) => {
        const input = h('input', { class: 'rbk-input', type: 'text', value: options.value ?? '', 'aria-label': options.title, autocomplete: 'off', spellcheck: 'false', maxlength: 40 });
        const err = h('p', { class: 'rbk-dlg-err', role: 'alert' });
        const submit = (): void => {
          const v = input.value.trim();
          const problem = options.validate?.(v) ?? null;
          if (problem) {
            err.textContent = problem;
            input.focus();
            return;
          }
          done(v);
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        });
        const ok = h('button', { class: 'rbk-dlg-btn rbk-primary', type: 'button' }, this.text.ok);
        const cancel = h('button', { class: 'rbk-dlg-btn', type: 'button' }, this.text.cancel);
        ok.addEventListener('click', submit);
        cancel.addEventListener('click', () => done(null));
        body.append(input, err, h('div', { class: 'rbk-dlg-row' }, cancel, ok));
        input.setAttribute('data-autofocus', '');
        queueMicrotask(() => input.select());
      },
      null,
    );
  }

  /** Asks yes or no. */
  confirm(options: { title: string; message: string; ok: string }): Promise<boolean> {
    return this.show<boolean>(
      options.title,
      (body, done) => {
        const ok = h('button', { class: 'rbk-dlg-btn rbk-danger', type: 'button' }, options.ok);
        const cancel = h('button', { class: 'rbk-dlg-btn', type: 'button', 'data-autofocus': '' }, this.text.cancel);
        ok.addEventListener('click', () => done(true));
        cancel.addEventListener('click', () => done(false));
        body.append(h('p', { class: 'rbk-dlg-msg' }, options.message), h('div', { class: 'rbk-dlg-row' }, cancel, ok));
      },
      false,
    );
  }

  /**
   * A big on-screen keypad for numbers (physical keys work too). Resolves the number, a chosen
   * reporter block (`blocks`), or null.
   */
  keypad(options: { title: string; value: number; decimal: string; blocks?: BlockOption[]; blocksTitle?: string }): Promise<{ type: 'value'; value: number } | { type: 'block'; id: string } | null> {
    type R = { type: 'value'; value: number } | { type: 'block'; id: string } | null;
    return this.show<R>(
      options.title,
      (body, done) => {
        let s = String(options.value).replace('.', options.decimal);
        let fresh = true;
        const display = h('div', { class: 'rbk-kp-display', role: 'status', 'aria-live': 'polite' });
        const ok = h('button', { class: 'rbk-dlg-btn rbk-primary', type: 'button' }, this.text.ok);
        const parse = (): number | null => {
          if (s === '' || s === '-' || s === options.decimal) return null;
          const n = Number(s.replace(options.decimal, '.'));
          return Number.isFinite(n) ? n : null;
        };
        const show = (): void => {
          display.textContent = s === '' ? '…' : s;
          if (parse() === null) ok.setAttribute('disabled', '');
          else ok.removeAttribute('disabled');
        };
        const press = (k: string): void => {
          if (k === 'back') {
            s = fresh ? '' : s.slice(0, -1);
            fresh = false;
          } else if (k === '-') {
            s = s.startsWith('-') ? s.slice(1) : `-${fresh ? '' : s}`;
            fresh = false;
          } else if (k === options.decimal) {
            if (fresh) s = '0';
            if (!s.includes(options.decimal)) s += options.decimal;
            fresh = false;
          } else {
            if (fresh) s = '';
            fresh = false;
            if (s.replace(/[^0-9]/g, '').length < 7) s = s === '0' ? k : s === '-0' ? `-${k}` : s + k;
          }
          show();
        };
        const keys = h('div', { class: 'rbk-keys' });
        for (const k of ['7', '8', '9', '4', '5', '6', '1', '2', '3', '-', '0', options.decimal]) {
          const b = h('button', { class: 'rbk-key', type: 'button', 'aria-label': k === '-' ? 'menos' : k }, k === '-' ? '−' : k);
          b.addEventListener('click', () => press(k));
          keys.append(b);
        }
        const back = h('button', { class: 'rbk-dlg-btn', type: 'button', 'aria-label': 'borrar' }, icon('back', 22));
        back.addEventListener('click', () => press('back'));
        const submit = (): void => {
          const n = parse();
          if (n !== null) done({ type: 'value', value: n });
        };
        ok.addEventListener('click', submit);
        ok.setAttribute('data-autofocus', '');
        body.addEventListener('keydown', (e) => {
          if (/^[0-9]$/.test(e.key)) press(e.key);
          else if (e.key === '-' ) press('-');
          else if (e.key === ',' || e.key === '.') press(options.decimal);
          else if (e.key === 'Backspace') press('back');
          else if (e.key === 'Enter') submit();
          else return;
          e.preventDefault();
        });
        const cancel = h('button', { class: 'rbk-dlg-btn', type: 'button' }, this.text.cancel);
        cancel.addEventListener('click', () => done(null));
        body.append(display, keys, h('div', { class: 'rbk-dlg-row' }, back, cancel, ok));
        if (options.blocks?.length) body.append(this.blockList(options.blocks, options.blocksTitle ?? this.text.putBlock, (id) => done({ type: 'block', id })));
        show();
      },
      null,
    );
  }

  /** A grid of big choices, optional reporter blocks to put instead, and extra actions. */
  picker(options: { title: string; options: PickOption[]; blocks?: BlockOption[]; blocksTitle?: string; extras?: Array<{ id: string; label: string }> }): Promise<PickResult> {
    return this.show<PickResult>(
      options.title,
      (body, done) => {
        if (options.options.length) {
          const grid = h('div', { class: 'rbk-choices', role: 'group' });
          options.options.forEach((o, i) => {
            const b = h('button', { class: `rbk-choice-btn${o.big ? ' rbk-dir-btn' : ''}`, type: 'button', 'aria-pressed': o.pressed ? 'true' : 'false', 'data-autofocus': o.pressed || (i === 0 && !options.options.some((x) => x.pressed)) ? '' : null });
            if (o.swatch) b.append(h('span', { class: 'rbk-swatch', style: `background:${o.swatch}`, 'aria-hidden': 'true' }));
            b.append(h('span', {}, o.label));
            b.addEventListener('click', () => done({ type: 'value', value: o.value }));
            grid.append(b);
          });
          body.append(grid);
        }
        if (options.blocks?.length) body.append(this.blockList(options.blocks, options.blocksTitle ?? this.text.putBlock, (id) => done({ type: 'block', id })));
        const row = h('div', { class: 'rbk-dlg-row' });
        for (const x of options.extras ?? []) {
          const b = h('button', { class: 'rbk-dlg-btn', type: 'button' }, x.label);
          b.addEventListener('click', () => done({ type: 'extra', id: x.id }));
          row.append(b);
        }
        const cancel = h('button', { class: 'rbk-dlg-btn', type: 'button' }, this.text.cancel);
        cancel.addEventListener('click', () => done(null));
        row.append(cancel);
        body.append(row);
      },
      null,
    );
  }

  private blockList(blocks: BlockOption[], title: string, pick: (id: string) => void): HTMLElement {
    const wrap = h('div', { class: 'rbk-dlg-blocks' }, h('div', { class: 'rbk-dlg-h' }, title));
    for (const b of blocks) {
      const btn = h('button', { class: 'rbk-block-btn', type: 'button', 'aria-label': b.label }, b.el);
      btn.addEventListener('click', () => pick(b.id));
      wrap.append(btn);
    }
    return wrap;
  }
}

/** The swatch color of a color name, if it is one. */
export function swatchOf(name: unknown): string | undefined {
  return typeof name === 'string' ? SWATCHES[name] : undefined;
}
