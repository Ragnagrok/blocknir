/** Tiny DOM helpers and inline icons (no external assets). */

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Creates an element with attributes (`class`, `data-*`, `aria-*`…) and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const PATHS: Record<string, string> = {
  undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12h-3',
  redo: 'm15 5 5 5-5 5M20 10h-9a6 6 0 0 0 0 12h3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  close: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  flag: 'M6 21V4M6 4h11l-2 4 2 4H6',
  below: 'M12 4v10M7 9l5 5 5-5M5 20h14',
  back: 'M10 6 4 12l6 6M4 12h16',
};

/** An inline SVG icon (decorative: hidden from screen readers). */
export function icon(name: keyof typeof PATHS | string, size = 22): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'rbk-icon');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name] ?? '');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** Swatch colors for well-known color names in pickers. */
export const SWATCHES: Record<string, string> = {
  red: '#d32f2f',
  blue: '#1e63c6',
  green: '#2e8b3a',
  yellow: '#f4c20d',
  black: '#1b1b1b',
  white: '#ffffff',
  purple: '#7b3fb2',
  brown: '#7a4a24',
  pink: '#e86aa6',
  gray: '#8a8f98',
  orange: '#ef7d1a',
};
