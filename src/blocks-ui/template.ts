/**
 * Block label templates (`Repetir {0} veces`, `Fijar {var} en {0}`, `Enseñar a Tito: {name}`) split
 * into the pieces a view lays out: text, slots and name fields. Pure.
 */

/** One piece of a block's label. */
export type Segment =
  | { type: 'text'; text: string }
  /** The slot with this index (in `childExprs` order). */
  | { type: 'slot'; index: number }
  /** The variable (`{var}`) or the procedure / variable / parameter name (`{name}`). */
  | { type: 'field'; field: 'var' | 'name' };

/** Splits a template into segments. Unknown placeholders stay as text. */
export function parseTemplate(template: string): Segment[] {
  const out: Segment[] = [];
  const re = /\{([^}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (s: string): void => {
    if (s.trim() === '') return;
    out.push({ type: 'text', text: s.trim() });
  };
  while ((m = re.exec(template))) {
    const key = m[1]!;
    let seg: Segment | null = null;
    if (/^\d+$/.test(key)) seg = { type: 'slot', index: Number(key) };
    else if (key === 'var' || key === 'name') seg = { type: 'field', field: key };
    if (!seg) continue;
    text(template.slice(last, m.index));
    out.push(seg);
    last = m.index + m[0].length;
  }
  text(template.slice(last));
  return out;
}

/** The slot indexes a template shows. */
export function templateSlots(segments: readonly Segment[]): number[] {
  return segments.flatMap((s) => (s.type === 'slot' ? [s.index] : []));
}

/**
 * Round reporters already look round, so labels written as `(mi columna)` drop the outer
 * parentheses. Inner ones (`(número al azar entre {0} y {1})`) only lose the outer pair.
 */
export function stripParens(template: string): string {
  const t = template.trim();
  if (t.startsWith('(') && t.endsWith(')')) {
    let depth = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') depth--;
      if (depth === 0 && i < t.length - 1) return t;
    }
    return t.slice(1, -1).trim();
  }
  return t;
}

/** A template as plain text with values filled in (for aria labels and messages). */
export function fillTemplate(template: string, slots: readonly string[], fields: { var?: string; name?: string } = {}): string {
  return template
    .replace(/\{(\d+)\}/g, (_, i: string) => slots[Number(i)] ?? '…')
    .replace(/\{var\}/g, fields.var ?? '…')
    .replace(/\{name\}/g, fields.name ?? '…')
    .replace(/\s+/g, ' ')
    .trim();
}
