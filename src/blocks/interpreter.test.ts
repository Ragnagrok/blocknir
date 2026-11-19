import { describe, expect, it } from 'vitest';
import { ensureIds, findNode, type Program } from './ast.js';
import { blocks } from './build.js';
import { fail } from './errors.js';
import { Runner, type World } from './interpreter.js';
import { DEFAULT_LABELS, describeValue, formatMessage, mergeLabels } from './labels.js';
import { analyze, countBlocks } from './toolbox.js';
import { runGrid } from './grid.js';
import type { Value } from './values.js';

/** A tiny world: a tape of numbers written by `emit`, and a `limit` sensor. */
class Tape implements World<number> {
  readonly out: number[] = [];
  readonly commands = { emit: { params: [{ type: 'number' as const }] }, boom: { params: [] } };
  readonly sensors = { limit: { params: [], returns: 'number' as const }, full: { params: [], returns: 'boolean' as const } };
  command(name: string, args: Value[]): number[] {
    if (name === 'boom') fail('actionFailed', { action: 'boom', item: 'x' });
    this.out.push(args[0] as number);
    return [args[0] as number];
  }
  sensor(name: string): Value {
    return name === 'limit' ? 3 : this.out.length >= 3;
  }
}

const run = (p: Program, options = {}) => {
  const w = new Tape();
  const r = new Runner(p, w, options).run();
  return { ...r, out: w.out };
};

describe('control flow', () => {
  it('runs sequences, repeat, repeat until and if/else', () => {
    const b = blocks();
    const p = b.program([
      b.repeat(2, b.cmd('emit', 1)),
      b.until(b.sensor('full'), b.cmd('emit', 2)),
      b.ifElse(b.cmp('>', b.sensor('limit'), 5), [b.cmd('emit', 9)], [b.cmd('emit', 4)]),
      b.if(b.bool(false), b.cmd('emit', 9)),
    ]);
    expect(run(p).out).toEqual([1, 1, 2, 4]);
  });

  it('evaluates arithmetic, comparisons, logic and direction operators', () => {
    const b = blocks();
    const p = b.program([
      b.cmd('emit', b.arith('+', 2, b.arith('*', 3, 4))),
      b.cmd('emit', b.arith('/', 360, 7)),
      b.cmd('emit', b.arith('%', -1, 4)),
      b.if(b.and(b.cmp('=', b.dir('opposite', 'N'), 'S'), b.not(b.cmp('=', b.dir('right', 'W'), 'S'))), b.cmd('emit', 1)),
      b.if(b.or(b.bool(false), b.cmp('=', b.arith('+', 0.1, 0.2), 0.3)), b.cmd('emit', 2)),
    ]);
    const r = run(p);
    expect(r.out[0]).toBe(14);
    expect(r.out[1]).toBeCloseTo(51.428, 2);
    expect(r.out.slice(2)).toEqual([3, 1, 2]);
  });

  it('calls procedures with parameters, nested and recursive', () => {
    const b = blocks();
    const p = b.program(
      [b.call('countdown', 3)],
      [
        b.proc('countdown', ['n'], b.if(b.cmp('>', b.param('n'), 0), b.cmd('emit', b.param('n')), b.call('countdown', b.arith('-', b.param('n'), 1)))),
      ],
    );
    expect(run(p).out).toEqual([3, 2, 1]);
  });

  it('keeps variables global, adds, subtracts and starts missing counters at 0', () => {
    const b = blocks();
    const p = b.program([b.change('n', 5), b.subtract('n', 2), b.set('m', b.arith('*', b.v('n'), 2)), b.cmd('emit', b.v('m'))]);
    const r = run(p);
    expect(r.out).toEqual([6]);
    expect(r.variables).toEqual({ n: 3, m: 6 });
  });
});

describe('the trace', () => {
  it('records each step with its node, kind, call stack and values', () => {
    const b = blocks();
    const emit = b.cmd('emit', b.param('x'));
    const call = b.call('twice', 7);
    const p = b.program([call, b.set('v', 1)], [b.proc('twice', ['x'], b.repeat(2, emit))]);
    const r = run(p);
    expect(r.steps.map((s) => s.kind)).toEqual(['call', 'repeat', 'command', 'command', 'set']);
    expect(r.steps[0]!.node).toBe(call.id);
    expect(r.steps[1]!.value).toBe(2);
    expect(r.steps[2]).toMatchObject({ index: 2, node: emit.id, stack: [call.id], events: [7] });
    expect(r.steps[4]).toMatchObject({ variable: 'v', value: 1, stack: [] });
  });

  it('steps one at a time', () => {
    const b = blocks();
    const runner = new Runner(b.program([b.cmd('emit', 1), b.cmd('emit', 2)]), new Tape());
    expect(runner.next()?.events).toEqual([1]);
    expect(runner.status).toBe('running');
    expect(runner.next()?.events).toEqual([2]);
    expect(runner.next()).toBeNull();
    expect(runner.status).toBe('done');
  });

  it('records the condition answers of if and repeat until', () => {
    const b = blocks();
    const r = run(b.program([b.until(b.sensor('full'), b.cmd('emit', 0))]));
    expect(r.steps.filter((s) => s.kind === 'condition').map((s) => s.value)).toEqual([false, false, false, true]);
  });
});

describe('errors children can understand', () => {
  const b = blocks();
  const cases: Array<[string, Program, string, string]> = [
    ['infinite loop', b.program([b.until(b.bool(false))]), 'stepLimit', 'El programa hizo más de 50 pasos sin terminar. ¿Habrá una repetición que no termina nunca?'],
    ['recursion', b.program([b.call('again')], [b.proc('again', [], b.call('again'))]), 'recursionDepth', 'Hay procedimientos que se llaman entre sí demasiadas veces (más de 10).'],
    ['param count', b.program([b.call('p', 1, 2)], [b.proc('p', ['a'])]), 'paramCount', '"p" necesita 1 datos y recibió 2.'],
    ['unknown procedure', b.program([b.call('nope')]), 'unknownProcedure', 'No existe un comando definido que se llame "nope".'],
    ['unknown param', b.program([b.cmd('emit', b.param('q'))]), 'unknownParam', '"q" no es un hueco de este comando definido.'],
    ['unset variable', b.program([b.cmd('emit', b.v('score'))]), 'unknownVariable', '"score" todavía no tiene ningún valor.'],
    ['not a condition', b.program([b.if(b.num(3), b.cmd('emit', 1))]), 'notBoolean', 'Acá va una pregunta que se conteste con sí o no.'],
    ['bad repeat', b.program([b.repeat(-2, b.cmd('emit', 1))]), 'badCount', 'No se puede repetir -2 veces: tiene que ser un número entero, 0 o más.'],
    ['division', b.program([b.cmd('emit', b.arith('/', 1, 0))]), 'divisionByZero', 'No se puede dividir por cero.'],
    ['slot type', b.program([b.cmd('emit', 'N')]), 'argType', '"emit" esperaba un número en el hueco 1.'],
    ['unknown command', b.program([b.cmd('fly')]), 'unknownCommand', 'No conozco el bloque "fly".'],
    ['world failure', b.program([b.cmd('boom')]), 'actionFailed', 'No puedo boom acá: falta x.'],
    ['duplicate procedure', b.program([], [b.proc('p', []), b.proc('p', [])]), 'duplicateProcedure', 'Hay dos comandos definidos que se llaman "p".'],
  ];
  for (const [name, program, code, message] of cases) {
    it(name, () => {
      const r = run(program, { stepLimit: 50, maxDepth: 10 });
      expect(r.status).toBe('error');
      expect(r.error!.code).toBe(code);
      expect(r.error!.message).toBe(message);
      expect(r.error!.nodeId).not.toBeNull();
      expect(findNode(program, r.error!.nodeId!)).not.toBeNull();
    });
  }

  it('points at the failing block inside a procedure', () => {
    const b2 = blocks();
    const bad = b2.cmd('boom');
    const p = b2.program([b2.cmd('emit', 1), b2.call('p')], [b2.proc('p', [], b2.cmd('emit', 2), bad)]);
    const r = run(p);
    expect(r.error!.nodeId).toBe(bad.id);
    expect(r.out).toEqual([1, 2]);
  });

  it('guards empty loops with huge counts', () => {
    const b2 = blocks();
    const r = run(b2.program([b2.repeat(1e9)]), { stepLimit: 1000 });
    expect(r.error!.code).toBe('stepLimit');
  });

  it('uses level labels for messages', () => {
    const labels = mergeLabels(DEFAULT_LABELS, { errors: { unknownProcedure: 'No sé "{name}".' } });
    const b2 = blocks();
    expect(run(b2.program([b2.call('x')]), { labels }).error!.message).toBe('No sé "x".');
  });

  it('describes directions and names from the tables', () => {
    expect(describeValue('N', DEFAULT_LABELS)).toBe('↑');
    expect(describeValue('apple', DEFAULT_LABELS)).toBe('manzana');
    expect(describeValue(2.5, DEFAULT_LABELS)).toBe('2,5');
    expect(formatMessage('{a} y {b} {c}', { a: true, b: 'W' }, DEFAULT_LABELS)).toBe('sí y ← {c}');
  });
});

describe('static checks and block counting', () => {
  it('counts the main stack (default) or everything, never literals', () => {
    const b = blocks();
    const p = b.program([b.repeat(3, b.call('step')), b.if(b.sensor('full'), b.cmd('emit', 1))], [b.proc('step', [], b.cmd('emit', 1), b.cmd('emit', 2))]);
    expect(countBlocks(p)).toBe(5);
    expect(countBlocks(p, 'all')).toBe(8);
  });

  it('finds unknown names, wrong slot counts and blocks the toolbox does not offer', () => {
    const b = blocks();
    const p = b.program(
      [b.cmd('emit'), b.cmd('fly'), b.call('p', 1), b.repeat(2, b.cmd('emit', b.sensor('limit')))],
      [b.proc('p', []), b.proc('q', ['a'], b.cmd('emit', b.param('zz')))],
    );
    const tape = new Tape();
    const issues = analyze(p, tape, { commands: ['emit'], sensors: [], procedures: true });
    const codes = issues.map((i) => i.code).sort();
    expect(codes).toEqual(['notAllowed', 'notAllowed', 'notAllowed', 'notAllowed', 'notAllowed', 'notAllowed', 'paramCount', 'paramCount', 'unknownCommand', 'unknownParam']);
    expect(issues.find((i) => i.code === 'notAllowed' && i.message.includes('Repetir'))!.message).toBe('En este desafío no se puede usar el bloque "Repetir … veces".');
  });

  it('accepts preset toolbox entries only with their fixed arguments', () => {
    const b = blocks();
    const tb = { commands: [{ name: 'move', args: ['N'], label: 'Mover ↑' }, { name: 'move', args: ['E'] }] };
    const catalog = { commands: { move: { params: [{ type: 'direction' as const }] } }, sensors: {} };
    expect(analyze(b.program([b.cmd('move', 'N'), b.cmd('move', 'E')]), catalog, tb)).toEqual([]);
    expect(analyze(b.program([b.cmd('move', 'S')]), catalog, tb).map((i) => i.code)).toEqual(['notAllowed']);
    expect(analyze(b.program([b.cmd('move', b.dir('opposite', 'S'))]), catalog, tb)[0]!.code).toBe('notAllowed');
  });

  it('fills missing and repeated ids', () => {
    const raw = { main: [{ kind: 'command', command: 'emit', args: [{ kind: 'number', value: 1 }] }, { id: 'a', kind: 'wait', ticks: { id: 'a', kind: 'number', value: 1 } }] } as unknown as Program;
    const p = ensureIds(raw);
    const ids: string[] = [];
    JSON.stringify(p, (k, v: unknown) => {
      if (k === 'id') ids.push(v as string);
      return v;
    });
    expect(new Set(ids).size).toBe(4);
    expect(ids).toContain('a');
    expect(raw.main[0]!.id).toBeUndefined();
  });

  it('programs and traces survive JSON', () => {
    const b = blocks();
    const p = b.program([b.repeat(2, b.cmd('move', 'E'))]);
    const copy = JSON.parse(JSON.stringify(p)) as Program;
    const board = { width: 3, height: 1, robot: { x: 0, y: 0 } };
    expect(JSON.stringify(runGrid(board, copy))).toBe(JSON.stringify(runGrid(board, p)));
  });
});
