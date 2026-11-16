import type { V3 } from '../src/core/index.js';

/** Small DOM helpers for the editor panels: every control is labelled, so tests and screen readers find it. */

type Attributes = Record<string, string | boolean | ((ev: Event) => void)>;

/** Creates an element. Function attributes become event listeners; `true` booleans become empty attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attributes)) {
    if (typeof v === 'function') el.addEventListener(k, v);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, v);
  }
  el.append(...children.filter((x): x is Node | string => x !== null));
  return el;
}

export const heading = (t: string): HTMLElement => h('h3', {}, t);

export function button(text: string, action: () => void, active = false, hint = ''): HTMLButtonElement {
  return h('button', { type: 'button', click: action, class: active ? 'active' : '', title: hint }, text);
}

export const row = (...children: (Node | null)[]): HTMLElement => h('div', { class: 'row' }, ...children);

let lastId = 0;

function field(label: string, control: HTMLElement): HTMLElement {
  control.id ||= `field-${++lastId}`;
  return h('div', { class: 'field' }, h('label', { for: control.id }, label), control);
}

export function textField(label: string, value: string, change: (v: string) => void): HTMLElement {
  return field(label, h('input', { value, change: (e) => change((e.target as HTMLInputElement).value) }));
}

export function textArea(label: string, value: string, change: (v: string) => void): HTMLElement {
  const area = h('textarea', { rows: '3', change: (e) => change((e.target as HTMLTextAreaElement).value) });
  area.value = value;
  return field(label, area);
}

export const round = (v: number): number => Math.round(v * 1000) / 1000;

export function numberField(label: string, value: number, change: (v: number) => void, step = 0.01): HTMLElement {
  return field(
    label,
    h('input', {
      type: 'number',
      step: String(step),
      value: String(round(value)),
      change: (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) change(v);
      },
    }),
  );
}

export function vectorField(label: string, value: V3, change: (v: V3) => void, step = 0.01): HTMLElement {
  const copy: V3 = [...value];
  const inputs = copy.map((n, i) =>
    h('input', {
      type: 'number',
      step: String(step),
      value: String(round(n)),
      'aria-label': `${label} ${'XYZ'[i]}`,
      change: (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        if (!Number.isFinite(v)) return;
        copy[i] = v;
        change([...copy]);
      },
    }),
  );
  return field(label, h('div', { class: 'three' }, ...inputs));
}

export function colorField(label: string, value: number, change: (v: number) => void): HTMLElement {
  return field(label, h('input', { type: 'color', value: toHex(value), change: (e) => change(fromHex((e.target as HTMLInputElement).value)) }));
}

export function select(options: [string, string][], value: string, change: (v: string) => void): HTMLSelectElement {
  const s = h('select', { change: (e) => change((e.target as HTMLSelectElement).value) });
  for (const [v, t] of options) s.append(h('option', { value: v }, t));
  s.value = value;
  return s;
}

export function selectField(label: string, options: [string, string][], value: string, change: (v: string) => void): HTMLElement {
  return field(label, select(options, value, change));
}

export function checkbox(label: string, value: boolean, change: (v: boolean) => void): HTMLElement {
  return h(
    'label',
    { class: 'row' },
    h('input', { type: 'checkbox', ...(value ? { checked: true } : {}), change: (e) => change((e.target as HTMLInputElement).checked) }),
    label,
  );
}

/** `change(value, final)`: `final` is false while dragging and true when the slider is released. */
export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  change: (v: number, final: boolean) => void,
): HTMLElement {
  return field(
    label,
    h('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      input: (e) => change(Number((e.target as HTMLInputElement).value), false),
      change: (e) => change(Number((e.target as HTMLInputElement).value), true),
    }),
  );
}

export const toHex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
export const fromHex = (s: string): number => parseInt(s.slice(1), 16);
