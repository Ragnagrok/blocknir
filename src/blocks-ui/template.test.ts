import { describe, expect, it } from 'vitest';
import { fillTemplate, parseTemplate, stripParens, templateSlots } from './template.js';
import { fmt, mergeText, DEFAULT_TEXT } from './text.js';

describe('label templates', () => {
  it('splits text, slots and name fields', () => {
    expect(parseTemplate('Repetir {0} veces')).toEqual([
      { type: 'text', text: 'Repetir' },
      { type: 'slot', index: 0 },
      { type: 'text', text: 'veces' },
    ]);
    expect(parseTemplate('Fijar {var} en {0}')).toEqual([
      { type: 'text', text: 'Fijar' },
      { type: 'field', field: 'var' },
      { type: 'text', text: 'en' },
      { type: 'slot', index: 0 },
    ]);
    expect(parseTemplate('Enseñar a Bolo: {name}')).toEqual([{ type: 'text', text: 'Enseñar a Bolo:' }, { type: 'field', field: 'name' }]);
    // Unknown placeholders stay as text.
    expect(parseTemplate('{x} y {1}')).toEqual([{ type: 'text', text: '{x} y' }, { type: 'slot', index: 1 }]);
    expect(templateSlots(parseTemplate('{0} + {1}'))).toEqual([0, 1]);
  });

  it('drops only the outer parentheses of round reporters', () => {
    expect(stripParens('(mi columna)')).toBe('mi columna');
    expect(stripParens('(número al azar entre {0} y {1})')).toBe('número al azar entre {0} y {1}');
    expect(stripParens('(a) y (b)')).toBe('(a) y (b)');
    expect(stripParens('Mover {0}')).toBe('Mover {0}');
  });

  it('fills templates as plain text for aria labels', () => {
    expect(fillTemplate('Repetir {0} veces', ['3'])).toBe('Repetir 3 veces');
    expect(fillTemplate('Fijar {var} en {0}', [], { var: 'pasos' })).toBe('Fijar pasos en …');
    expect(fillTemplate('Enseñar a Bolo: {name}', [], { name: 'fila' })).toBe('Enseñar a Bolo: fila');
  });

  it('merges UI text and formats it', () => {
    const t = mergeText({ undo: 'Atrás', groups: { actions: 'Moverse' } });
    expect(t.undo).toBe('Atrás');
    expect(t.groups.actions).toBe('Moverse');
    expect(t.groups.control).toBe(DEFAULT_TEXT.groups.control);
    expect(fmt(t.count, { count: 5, par: 8 })).toBe('5 de 8');
    expect(fmt('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
});
