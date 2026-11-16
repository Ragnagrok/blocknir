/**
 * Builds the DOM of blocks, scripts and palette items from the model. Rendering is a pure function
 * of the model (the editor rebuilds on every change); interaction lives in `editor.ts`.
 *
 * Data attributes the editor reads:
 * - `data-node` the node id (`main` for the main hat), `data-kind` `stmt | expr | hat`;
 * - `data-slot="parent:index"` and `data-type` on slots; `data-list` / `data-index` on gaps;
 * - `data-field` (`var | proc | event`) on name chips, `data-param` / `data-proc` on parameter chips;
 * - `data-tpl` on palette items; `data-fk` is the focus key used to restore focus after renders.
 */
import { childExprs, formatNumber, type Expr, type Handler, type Procedure, type Statement } from '../blocks/index.js';
import { getList, innerLists, isExpr, listKey, sameList, type EditorModel, type ListRef } from './model.js';
import { groupOfNode, isHole, shapeOfNode, type BlockTemplate, type Schema } from './schema.js';
import { fillTemplate, parseTemplate, templateSlots, type Segment } from './template.js';
import { fmt, type UiText } from './text.js';
import { h, icon } from './dom.js';

export class Renderer {
  constructor(
    private readonly schema: Schema,
    private readonly model: EditorModel,
    private readonly text: UiText,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Workspace
  // -------------------------------------------------------------------------------------------

  workspace(options: { readOnly: boolean }): DocumentFragment {
    const p = this.model.program;
    const f = document.createDocumentFragment();
    f.append(this.script({ kind: 'main' }, this.mainHat(), options));
    for (const proc of p.procedures ?? []) f.append(this.script({ kind: 'procedure', id: proc.id }, this.procedureHat(proc), options, proc));
    for (const hd of p.handlers ?? []) f.append(this.script({ kind: 'handler', id: hd.id }, this.handlerHat(hd), options));
    return f;
  }

  private script(ref: ListRef, hat: HTMLElement, options: { readOnly: boolean }, proc?: Procedure): HTMLElement {
    const el = h('section', { class: 'rbk-script', 'data-script': listKey(ref), 'data-proc': proc?.id });
    el.append(hat, this.list(ref, options));
    return el;
  }

  private list(ref: ListRef, options: { readOnly: boolean }): HTMLElement {
    const stmts = getList(this.model.program, ref) ?? [];
    const key = listKey(ref);
    const el = h('div', { class: 'rbk-list', 'data-list': key, role: 'list' });
    const cursor = this.model.cursor;
    const owner = this.listOwnerText(ref);
    const gap = (i: number): HTMLElement => {
      const isCursor = !options.readOnly && sameList(cursor.list, ref) && cursor.index === i;
      const prev = stmts[i - 1];
      const label = prev ? fmt(this.text.gapAfter, { where: this.describe(prev) }) : fmt(this.text.gapStart, { where: owner });
      const g = h('div', {
        class: `rbk-gap${i === stmts.length ? ' rbk-end' : ''}${stmts.length === 0 ? ' rbk-empty' : ''}${isCursor ? ' rbk-cursor' : ''}`,
        'data-list': key,
        'data-index': i,
        'data-fk': `g:${key}:${i}`,
        role: 'button',
        tabindex: -1,
        'aria-label': isCursor ? `${label}. ${this.text.cursorHere}` : label,
      });
      if (isCursor) g.append(h('span', { class: 'rbk-caret', 'aria-hidden': 'true' }, icon('plus', 18), h('span', { class: 'rbk-caret-text' }, this.text.cursorHere)));
      else if (stmts.length === 0) g.append(h('span', { class: 'rbk-empty-text', 'aria-hidden': 'true' }, this.text.emptyList));
      return g;
    };
    stmts.forEach((s, i) => {
      el.append(gap(i));
      const item = this.stmt(s);
      item.setAttribute('role', 'listitem');
      el.append(item);
    });
    el.append(gap(stmts.length));
    return el;
  }

  private listOwnerText(ref: ListRef): string {
    const p = this.model.program;
    switch (ref.kind) {
      case 'main':
        return this.schema.template('main');
      case 'procedure': {
        const proc = p.procedures?.find((x) => x.id === ref.id);
        return fillTemplate(this.schema.template('procedure'), [], { name: proc?.name ?? '' });
      }
      case 'handler': {
        const hd = p.handlers?.find((x) => x.id === ref.id);
        return hd ? this.handlerText(hd) : '';
      }
      case 'body': {
        const n = this.model.node(ref.id);
        return n && 'kind' in n ? this.describe(n as Statement) : '';
      }
    }
  }

  mainHat(): HTMLElement {
    const label = this.schema.template('main');
    return h(
      'div',
      { class: 'rbk-hat rbk-g-events rbk-main-hat', 'data-kind': 'hat', 'data-node': 'main', 'data-fk': 'n:main', tabindex: -1, role: 'heading', 'aria-level': 3 },
      h('div', { class: 'rbk-row' }, icon('flag', 22), h('span', { class: 'rbk-txt' }, label)),
    );
  }

  procedureHat(proc: Procedure, preview = false): HTMLElement {
    const row = h('div', { class: 'rbk-row' });
    for (const seg of parseTemplate(this.schema.template('procedure'))) {
      if (seg.type === 'text') row.append(h('span', { class: 'rbk-txt' }, seg.text));
      else if (seg.type === 'field') {
        row.append(
          preview
            ? h('span', { class: 'rbk-field rbk-field-static' }, proc.name)
            : h(
                'span',
                { class: 'rbk-field', 'data-field': 'proc', 'data-node': proc.id, 'data-fk': `f:${proc.id}:proc`, role: 'button', tabindex: -1, 'aria-label': `${this.text.rename}: ${proc.name}` },
                h('span', {}, proc.name),
                icon('edit', 16),
              ),
        );
      }
    }
    if (!preview) {
      for (const name of proc.params) {
        row.append(
          h(
            'span',
            {
              class: 'rbk-rep rbk-g-procedures rbk-param',
              'data-param': name,
              'data-proc': proc.id,
              'data-fk': `pa:${proc.id}:${name}`,
              role: 'button',
              tabindex: -1,
              'aria-label': fmt(this.text.paramChip, { name }),
            },
            h('span', { class: 'rbk-txt' }, name),
          ),
        );
      }
      if (this.schema.parameters) {
        row.append(
          h('span', { class: 'rbk-add', 'data-action': 'addParam', 'data-node': proc.id, 'data-fk': `ap:${proc.id}`, role: 'button', tabindex: -1, 'aria-label': this.text.addParam }, icon('plus', 18)),
        );
      }
    }
    const text = fillTemplate(this.schema.template('procedure'), [], { name: proc.name });
    return h(
      'div',
      preview
        ? { class: 'rbk-hat rbk-g-procedures' }
        : { class: 'rbk-hat rbk-g-procedures', 'data-kind': 'hat', 'data-node': proc.id, 'data-fk': `n:${proc.id}`, tabindex: -1, role: 'heading', 'aria-level': 3, 'aria-label': text },
      row,
    );
  }

  handlerText(hd: Handler): string {
    const v = hd.event.type === 'key' ? hd.event.key : hd.event.type === 'touch' ? hd.event.what : '';
    return fillTemplate(this.schema.handlerLabel(hd), [v ? this.schema.describe(v) : '…']);
  }

  handlerHat(hd: Handler, preview = false): HTMLElement {
    const row = h('div', { class: 'rbk-row' });
    const value = hd.event.type === 'key' ? hd.event.key : hd.event.type === 'touch' ? hd.event.what : null;
    for (const seg of parseTemplate(this.schema.handlerLabel(hd))) {
      if (seg.type === 'text') row.append(h('span', { class: 'rbk-txt' }, seg.text));
      else if (seg.type === 'slot' && value !== null) {
        const shown = value === '' ? '…' : this.schema.describe(value);
        row.append(
          preview
            ? h('span', { class: 'rbk-field rbk-field-static' }, shown)
            : h('span', { class: 'rbk-field', 'data-field': 'event', 'data-node': hd.id, 'data-fk': `f:${hd.id}:event`, role: 'button', tabindex: -1, 'aria-label': `${this.text.chooseEvent}: ${shown}` }, h('span', {}, shown), h('span', { class: 'rbk-caret-down', 'aria-hidden': 'true' }, '▾')),
        );
      }
    }
    if (hd.event.type === 'tick' && hd.event.every && hd.event.every > 1) row.append(h('span', { class: 'rbk-txt rbk-small' }, `(${hd.event.every})`));
    return h(
      'div',
      preview
        ? { class: 'rbk-hat rbk-g-events' }
        : { class: 'rbk-hat rbk-g-events', 'data-kind': 'hat', 'data-node': hd.id, 'data-fk': `n:${hd.id}`, tabindex: -1, role: 'heading', 'aria-level': 3, 'aria-label': this.handlerText(hd) },
      row,
    );
  }

  // -------------------------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------------------------

  stmt(s: Statement, preview = false): HTMLElement {
    const shape = shapeOfNode(s, this.schema);
    const group = groupOfNode(s);
    const el = h('div', {
      class: `rbk-stmt rbk-g-${group}${shape === 'c' || shape === 'cc' ? ' rbk-c' : ''}`,
      ...(preview ? {} : { 'data-node': s.id, 'data-kind': 'stmt', 'data-fk': `n:${s.id}`, tabindex: -1, 'aria-label': this.describe(s, true) }),
    });
    const row = h('div', { class: 'rbk-row' });
    this.segments(row, s, preview);
    el.append(row);
    if (shape === 'c' || shape === 'cc') {
      const lists = innerLists(s);
      lists.forEach((inner, i) => {
        if (i === 1) el.append(h('div', { class: 'rbk-row rbk-mid' }, h('span', { class: 'rbk-txt' }, this.schema.template('else'))));
        const mouth = h('div', { class: 'rbk-mouth' }, h('div', { class: 'rbk-arm' }));
        mouth.append(preview ? h('div', { class: 'rbk-list rbk-preview-list' }) : this.list(inner.ref, { readOnly: this.model.readOnly }));
        el.append(mouth);
      });
      el.append(h('div', { class: 'rbk-foot' }));
    }
    return el;
  }

  expr(e: Expr, preview = false): HTMLElement {
    const shape = shapeOfNode(e, this.schema);
    const group = groupOfNode(e);
    const el = h('span', {
      class: `rbk-rep rbk-g-${group}${shape === 'boolean' ? ' rbk-bool' : ''}`,
      ...(preview ? {} : { 'data-node': e.id, 'data-kind': 'expr', 'data-fk': `n:${e.id}`, tabindex: -1, role: 'button', 'aria-label': this.describe(e) }),
    });
    this.segments(el, e, preview);
    return el;
  }

  private segments(into: HTMLElement, node: Statement | Expr, preview: boolean): void {
    const { template, fixed } = this.schema.labelOf(node);
    const hidden = new Set(fixed);
    const segs: Segment[] = parseTemplate(template);
    const kids = childExprs(node);
    const specs = this.schema.slots(node);
    for (const seg of segs) {
      if (seg.type === 'text') into.append(h('span', { class: 'rbk-txt' }, seg.text));
      else if (seg.type === 'slot') {
        if (!hidden.has(seg.index) && kids[seg.index]) into.append(this.slot(node, seg.index, kids[seg.index]!, specs[seg.index]?.type ?? 'any', preview));
      } else into.append(this.field(node, seg.field, preview));
    }
    const shown = new Set(templateSlots(segs));
    const proc = node.kind === 'call' ? this.model.program.procedures?.find((p) => p.name === node.procedure) : undefined;
    kids.forEach((k, i) => {
      if (shown.has(i) || hidden.has(i)) return;
      const pname = proc?.params[i];
      if (pname) into.append(h('span', { class: 'rbk-pname' }, pname));
      into.append(this.slot(node, i, k, specs[i]?.type ?? 'any', preview));
    });
  }

  private field(node: Statement | Expr, field: 'var' | 'name', preview: boolean): HTMLElement {
    let name = '';
    if (node.kind === 'set' || node.kind === 'change') name = node.variable;
    else if (node.kind === 'var' || node.kind === 'param') name = node.name;
    else if (node.kind === 'call') name = node.procedure;
    const editable = !preview && field === 'var' && (node.kind === 'set' || node.kind === 'change');
    if (!editable) return h('span', { class: field === 'var' ? 'rbk-field rbk-field-static' : 'rbk-txt rbk-name' }, name || '…');
    return h(
      'span',
      { class: 'rbk-field', 'data-field': 'var', 'data-node': node.id, 'data-fk': `f:${node.id}:var`, role: 'button', tabindex: -1, 'aria-label': `${this.text.chooseVariable}: ${name}` },
      h('span', {}, name || '…'),
      h('span', { class: 'rbk-caret-down', 'aria-hidden': 'true' }, '▾'),
    );
  }

  private slot(parent: Statement | Expr, index: number, e: Expr, type: string, preview: boolean): HTMLElement {
    const ref = `${parent.id}:${index}`;
    const attrs = preview ? { class: 'rbk-slot', 'data-type': type } : { class: 'rbk-slot', 'data-slot': ref, 'data-type': type };
    const el = h('span', attrs);
    const fk = preview ? {} : { 'data-fk': `s:${ref}`, tabindex: -1, role: 'button' };
    if (isHole(e)) {
      el.append(h('span', { class: `rbk-hole${type === 'boolean' ? ' rbk-bool-hole' : ''}`, ...fk, 'aria-label': `${fmt(this.text.slotOf, { n: index + 1 })}: ${this.text.emptySlot}` }));
    } else if (e.kind === 'number') {
      el.append(h('span', { class: 'rbk-lit rbk-num', ...fk, 'aria-label': `${fmt(this.text.slotOf, { n: index + 1 })}: ${formatNumber(e.value, this.schema.labels)}` }, formatNumber(e.value, this.schema.labels)));
    } else if (e.kind === 'direction' || e.kind === 'name' || e.kind === 'boolean') {
      const shown = this.schema.describe(e.value);
      el.append(
        h('span', { class: `rbk-lit rbk-choice${e.kind === 'direction' ? ' rbk-dir' : ''}`, ...fk, 'aria-label': `${fmt(this.text.slotOf, { n: index + 1 })}: ${shown}` }, h('span', {}, shown), h('span', { class: 'rbk-caret-down', 'aria-hidden': 'true' }, '▾')),
      );
    } else {
      el.append(this.expr(e, preview));
    }
    return el;
  }

  // -------------------------------------------------------------------------------------------
  // Palette
  // -------------------------------------------------------------------------------------------

  /** The look of a palette item: a block built from the template with throwaway ids. */
  templatePreview(t: BlockTemplate): HTMLElement {
    if (t.creates === 'procedure') return this.procedureHat({ id: 'pv', name: '…', params: [], body: [] }, true);
    if (t.creates === 'handler') {
      const c = this.schema.creation(t);
      if (c?.type === 'handler') return this.handlerHat({ id: 'pv', event: c.event, body: [] }, true);
    }
    let n = 0;
    const node = this.schema.instantiate(t, () => `pv${++n}`);
    if (!node) return h('span', {}, t.label);
    return isExpr(node) ? this.expr(node, true) : this.stmt(node, true);
  }

  /** The words of a palette item. */
  templateText(t: BlockTemplate): string {
    if (t.creates === 'procedure') return fillTemplate(this.schema.template('procedure'), [], { name: '…' });
    if (t.creates === 'handler') {
      const c = this.schema.creation(t);
      if (c?.type === 'handler') return this.handlerText({ id: 'pv', event: c.event, body: [] });
    }
    let n = 0;
    const node = this.schema.instantiate(t, () => `pv${++n}`);
    return node ? this.describe(node as Statement) : t.label;
  }

  // -------------------------------------------------------------------------------------------
  // Words
  // -------------------------------------------------------------------------------------------

  /** A block in words, for screen readers and messages. */
  describe(node: Statement | Expr, withContents = false): string {
    const { template, fixed } = this.schema.labelOf(node);
    const hidden = new Set(fixed);
    const kids = childExprs(node);
    const slots = kids.map((k) => this.describeSlot(k));
    let name = '';
    if (node.kind === 'call') name = node.procedure;
    else if (node.kind === 'var' || node.kind === 'param') name = node.name;
    const fields: { var?: string; name?: string } = { name };
    if (node.kind === 'set' || node.kind === 'change') fields.var = node.variable;
    let s = fillTemplate(template, slots.map((x, i) => (hidden.has(i) ? '' : x)), fields);
    const shown = new Set(templateSlots(parseTemplate(template)));
    const rest = slots.filter((_, i) => !shown.has(i) && !hidden.has(i));
    if (rest.length) s += ` ${rest.join(', ')}`;
    if (withContents && 'kind' in node) {
      const lists = (node.kind === 'repeat' || node.kind === 'repeatUntil' || node.kind === 'if' ? innerLists(node as Statement) : []).map((l) => l.list.length);
      if (lists.length) s += ` (${lists.join(' / ')} ${this.text.blocks.toLowerCase()})`;
    }
    return s;
  }

  private describeSlot(e: Expr): string {
    if (isHole(e)) return this.text.emptySlot;
    if (e.kind === 'number' || e.kind === 'boolean' || e.kind === 'direction' || e.kind === 'name') return this.schema.describe(e.value);
    return this.describe(e);
  }
}
