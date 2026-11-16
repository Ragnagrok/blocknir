import { describe, expect, it } from 'vitest';
import { analyze, catalogFor, check, countBlocks, runCase, type GridLevel, type Program, type Expr, type RealtimeLevel, type Statement } from '../blocks/index.js';
import { deserializeProgram, EditorModel, getList, listKey, locateStatement, parseListKey, serializeProgram, spots, type Spot } from './model.js';
import { hole, isHole, Schema, type BlockTemplate } from './schema.js';

const lamps: GridLevel = {
  id: 'ch1-lamps',
  world: 'grid',
  board: {
    width: 5,
    height: 3,
    robot: { x: 0, y: 0, facing: 'E' },
    cells: [
      { x: 1, y: 0, items: { lamp: 1 } },
      { x: 3, y: 0, items: { lamp: 1 } },
      { x: 1, y: 2, items: { lamp: 1 } },
      { x: 3, y: 2, items: { lamp: 1 } },
    ],
  },
  goal: { type: 'noItem', item: 'lamp' },
  toolbox: {
    commands: ['move', 'lightLamp'],
    sensors: [{ name: 'itemHere', args: ['lamp'], label: '¿Hay farol?' }, 'canMove'],
    control: ['repeat', 'repeatUntil', 'if', 'ifElse'],
    operators: ['not', '+', '='],
    procedures: true,
    parameters: true,
    variables: true,
    choices: { directions: ['N', 'E', 'S', 'W'] },
    par: 8,
  },
  labels: { blocks: { procedure: 'Enseñar a Bolo: {name}', call: 'Bolo sabe: {name}' } },
};

const main = { kind: 'main' } as const;

function setup(level: GridLevel | RealtimeLevel = lamps, program?: Program) {
  const schema = new Schema(level);
  const model = new EditorModel(schema, program ? { program } : {});
  const tpl = (id: string): BlockTemplate => {
    const t = schema.templates(model.program, { procedure: model.cursorProcedure, variables: model.variables }).find((x) => x.id === id);
    if (!t) throw new Error(`no template ${id}`);
    return t;
  };
  const make = (id: string) => schema.instantiate(tpl(id), model.newId)!;
  const stmt = (id: string) => make(id) as Statement;
  const expr = (id: string) => make(id) as Expr;
  return { schema, model, tpl, make: expr, stmt };
}

function shape(list: readonly Statement[]): unknown[] {
  return list.map((s) => {
    switch (s.kind) {
      case 'command':
        return s.args.length ? `${s.command}(${s.args.map((a) => ('value' in a ? a.value : a.kind)).join(',')})` : s.command;
      case 'repeat':
      case 'repeatUntil':
        return { [s.kind]: shape(s.body) };
      case 'if':
        return s.else ? { if: shape(s.then), else: shape(s.else) } : { if: shape(s.then) };
      case 'call':
        return `call ${s.procedure}`;
      default:
        return s.kind;
    }
  });
}

describe('schema: palette templates and new blocks', () => {
  it('groups the palette and builds nodes with fresh ids and default slots', () => {
    const { schema, model, stmt: make, make: reporter } = setup();
    const ts = schema.templates(model.program, { variables: [] });
    expect(new Set(ts.map((t) => t.group))).toEqual(new Set(['actions', 'sensors', 'control', 'values', 'procedures']));
    expect(ts.find((t) => t.key === 'procedure')).toMatchObject({ shape: 'hat', creates: 'procedure', label: 'Enseñar a Bolo: {name}' });
    const move = make('command:move');
    expect(move).toMatchObject({ kind: 'command', command: 'move', args: [{ kind: 'direction', value: 'N' }] });
    const rep = make('control:repeat');
    expect(rep).toMatchObject({ kind: 'repeat', times: { kind: 'number', value: 2 }, body: [] });
    const cond = make('control:if');
    expect(cond.kind === 'if' && isHole(cond.condition)).toBe(true);
    const preset = reporter('sensor:itemHere:["lamp"]');
    expect(preset).toMatchObject({ kind: 'sensor', sensor: 'itemHere', args: [{ kind: 'name', value: 'lamp' }] });
    expect(schema.labelOf(preset)).toMatchObject({ template: '¿Hay farol?', preset: true });
    expect(schema.labelOf(move)).toMatchObject({ template: 'Mover {0}', preset: false });
    const ids = [move, rep, cond, preset].flatMap((n) => [n.id]);
    expect(new Set(ids).size).toBe(4);
  });

  it('offers a call block per procedure, parameters only inside their procedure, and variables', () => {
    const { schema, model } = setup();
    model.addProcedure('dormirse', ['veces']);
    model.addVariable('pasos');
    const inProc = schema.templates(model.program, { procedure: model.cursorProcedure, variables: model.variables });
    expect(inProc.filter((t) => t.group === 'procedures').map((t) => t.id)).toEqual(['procedure:new', 'call:dormirse', 'param:veces']);
    expect(inProc.filter((t) => t.group === 'variables').map((t) => t.id)).toEqual(['variable:set', 'variable:change', 'variable:subtract', 'var:pasos']);
    model.setCursor({ list: main, index: 0 });
    const outside = schema.templates(model.program, { procedure: model.cursorProcedure, variables: model.variables });
    expect(outside.some((t) => t.key === 'param')).toBe(false);
  });

  it('checks slot types', () => {
    const { schema } = setup();
    expect(schema.fits('boolean', 'boolean')).toBe(true);
    expect(schema.fits('number', 'boolean')).toBe(false);
    expect(schema.fits('any', 'number')).toBe(true);
    expect(schema.fits('direction', 'name')).toBe(true);
    expect(schema.choices({ type: 'direction' })).toEqual(['N', 'E', 'S', 'W']);
    expect(schema.choices({ type: 'name', name: 'item' })).toEqual(['lamp']);
  });
});

describe('model: inserting, moving and deleting statements', () => {
  it('inserts at the cursor, which follows the new block; C-blocks can be entered', () => {
    const { model, stmt } = setup();
    expect(model.insert(stmt('command:move')).ok).toBe(true);
    expect(model.insert(stmt('control:repeat'), undefined, { enter: true }).ok).toBe(true);
    model.insert(stmt('command:lightLamp'));
    model.insert(stmt('command:move'));
    expect(shape(model.program.main)).toEqual(['move(N)', { repeat: ['lightLamp', 'move(N)'] }]);
    expect(model.cursor.list.kind).toBe('body');
    expect(model.cursor.index).toBe(2);
    expect(model.blockCount).toBe(4);
  });

  it('moves blocks within a list, into mouths and out of them, never into themselves', () => {
    const { model, stmt } = setup();
    const a = stmt('command:lightLamp');
    const r = stmt('control:repeat');
    const b = stmt('command:move');
    model.insert(a);
    model.insert(r);
    model.insert(b);
    expect(model.move(b.id, { list: main, index: 0 }).ok).toBe(true);
    expect(shape(model.program.main)).toEqual(['move(N)', 'lightLamp', { repeat: [] }]);
    expect(model.move(a.id, { list: { kind: 'body', id: r.id, branch: 0 }, index: 0 }).ok).toBe(true);
    expect(shape(model.program.main)).toEqual(['move(N)', { repeat: ['lightLamp'] }]);
    expect(model.move(r.id, { list: { kind: 'body', id: r.id, branch: 0 }, index: 0 })).toEqual({ ok: false, reason: 'cycle' });
    // Same list, later position: the index counts as if the block were still there.
    expect(model.move(b.id, { list: main, index: 2 }).ok).toBe(true);
    expect(shape(model.program.main)).toEqual([{ repeat: ['lightLamp'] }, 'move(N)']);
    expect(model.move(a.id, { list: main, index: 2 }).ok).toBe(true);
    expect(shape(model.program.main)).toEqual([{ repeat: [] }, 'move(N)', 'lightLamp']);
  });

  it('moves up and down past neighbours, between if/else mouths and out of mouths', () => {
    const { model, stmt } = setup();
    const x = stmt('command:lightLamp');
    const c = stmt('control:ifElse');
    model.insert(c);
    model.insert(x, { list: { kind: 'body', id: c.id, branch: 0 }, index: 0 });
    expect(model.moveDown(x.id).ok).toBe(true);
    expect(shape(model.program.main)).toEqual([{ if: [], else: ['lightLamp'] }]);
    expect(model.moveDown(x.id).ok).toBe(true);
    expect(shape(model.program.main)).toEqual([{ if: [], else: [] }, 'lightLamp']);
    expect(model.moveDown(x.id)).toEqual({ ok: false, reason: 'edge' });
    expect(model.moveUp(x.id).ok).toBe(true);
    expect(shape(model.program.main)).toEqual(['lightLamp', { if: [], else: [] }]);
    expect(model.moveUp(x.id)).toEqual({ ok: false, reason: 'edge' });
  });

  it('duplicates with fresh ids and deletes, keeping the cursor sensible', () => {
    const { model, stmt } = setup();
    const r = stmt('control:repeat');
    model.insert(r, undefined, { enter: true });
    model.insert(stmt('command:move'));
    const d = model.duplicate(r.id);
    expect(d.ok && d.id !== r.id).toBe(true);
    const ids: string[] = [];
    const visit = (list: readonly Statement[]): void => {
      for (const s of list) {
        ids.push(s.id);
        if (s.kind === 'repeat') {
          ids.push(s.times.id);
          visit(s.body);
        }
        if (s.kind === 'command') ids.push(...s.args.map((a) => a.id));
      }
    };
    visit(model.program.main);
    expect(new Set(ids).size).toBe(ids.length);
    // The cursor was inside the first repeat: deleting it puts the cursor where it was.
    model.setCursor({ list: { kind: 'body', id: r.id, branch: 0 }, index: 1 });
    expect(model.remove(r.id).ok).toBe(true);
    expect(model.cursor).toEqual({ list: main, index: 0 });
    expect(shape(model.program.main)).toEqual([{ repeat: ['move(N)'] }]);
  });

  it('keeps the cursor before the same block when others move', () => {
    const { model, stmt } = setup();
    const a = stmt('command:lightLamp');
    const b = stmt('command:move');
    const c = stmt('control:repeat');
    model.insert(a);
    model.insert(b);
    model.insert(c);
    model.setCursor({ list: main, index: 2 }); // before c
    model.move(a.id, { list: main, index: 3 });
    expect(model.cursor).toEqual({ list: main, index: 1 });
    expect(getList(model.program, main)![model.cursor.index]!.id).toBe(c.id);
  });

  it('walks every spot in reading order', () => {
    const { model, stmt } = setup();
    const r = stmt('control:repeat');
    model.insert(stmt('command:move'));
    model.insert(r, undefined, { enter: true });
    model.insert(stmt('command:lightLamp'));
    const keys = spots(model.program).map((s: Spot) => `${listKey(s.list)}@${s.index}`);
    const body = listKey({ kind: 'body', id: r.id, branch: 0 });
    expect(keys).toEqual(['main@0', 'main@1', `${body}@0`, `${body}@1`, 'main@2']);
    model.setCursor({ list: main, index: 1 });
    model.stepCursor(1);
    expect(listKey(model.cursor.list)).toBe(body);
    expect(parseListKey(body)).toEqual({ kind: 'body', id: r.id, branch: 0 });
  });
});

describe('model: slots', () => {
  it('fills slots with reporters of the right type and empties them on delete', () => {
    const { model, stmt, make } = setup();
    const c = stmt('control:if');
    model.insert(c);
    expect(model.putExpr(make('operator:+'), { parent: c.id, slot: 0 })).toEqual({ ok: false, reason: 'type' });
    const not = make('operator:not');
    expect(model.putExpr(not, { parent: c.id, slot: 0 }).ok).toBe(true);
    const sensor = make('sensor:itemHere:["lamp"]');
    expect(model.putExpr(sensor, { parent: not.id, slot: 0 }).ok).toBe(true);
    const cond = (model.program.main[0] as Extract<Statement, { kind: 'if' }>).condition;
    expect(cond).toMatchObject({ kind: 'not', operand: { kind: 'sensor', sensor: 'itemHere' } });
    expect(model.remove(sensor.id).ok).toBe(true);
    const after = (model.program.main[0] as Extract<Statement, { kind: 'if' }>).condition;
    expect(after.kind === 'not' && isHole(after.operand)).toBe(true);
  });

  it('moves a reporter between slots, but not into itself', () => {
    const { model, stmt, make } = setup();
    const a = stmt('control:if');
    const b = stmt('control:repeatUntil');
    model.insert(a);
    model.insert(b);
    const not = make('operator:not');
    model.putExpr(not, { parent: a.id, slot: 0 });
    expect(model.moveExpr(not.id, { parent: not.id, slot: 0 })).toEqual({ ok: false, reason: 'cycle' });
    expect(model.moveExpr(not.id, { parent: b.id, slot: 0 }).ok).toBe(true);
    const [ifS, untilS] = model.program.main as [Extract<Statement, { kind: 'if' }>, Extract<Statement, { kind: 'repeatUntil' }>];
    expect(isHole(ifS.condition)).toBe(true);
    expect(untilS.until.id).toBe(not.id);
  });

  it('types values into literal slots keeping their ids, and refuses bad types', () => {
    const { model, stmt } = setup();
    const r = stmt('control:repeat');
    model.insert(r);
    const timesId = (r as Extract<Statement, { kind: 'repeat' }>).times.id;
    expect(model.setValue({ parent: r.id, slot: 0 }, 7).ok).toBe(true);
    expect((model.program.main[0] as Extract<Statement, { kind: 'repeat' }>).times).toEqual({ id: timesId, kind: 'number', value: 7 });
    expect(model.setValue({ parent: r.id, slot: 0 }, 'E')).toEqual({ ok: false, reason: 'type' });
    expect(model.setValue({ parent: r.id, slot: 0 }, Number.NaN)).toEqual({ ok: false, reason: 'type' });
    const m = stmt('command:move');
    model.insert(m);
    expect(model.setValue({ parent: m.id, slot: 0 }, 'S').ok).toBe(true);
    expect(shape(model.program.main)).toEqual([{ repeat: [] }, 'move(S)']);
  });

  it('an empty condition runs into a clear error on the hole itself', () => {
    const { model, stmt } = setup();
    const c = stmt('control:if');
    model.insert(c);
    const holeId = (model.program.main[0] as Extract<Statement, { kind: 'if' }>).condition.id;
    const run = runCase(lamps, model.getProgram());
    expect(run.error).toMatchObject({ code: 'notBoolean', nodeId: holeId });
  });
});

describe('model: undo and redo', () => {
  it('undoes and redoes every kind of edit, including the cursor position', () => {
    const { model, stmt } = setup();
    const m = stmt('command:move');
    model.insert(m);
    model.setValue({ parent: m.id, slot: 0 }, 'E');
    model.insert(stmt('command:lightLamp'));
    const full = JSON.stringify(model.program);
    expect(model.undo()).toBe(true);
    expect(shape(model.program.main)).toEqual(['move(E)']);
    expect(model.cursor).toEqual({ list: main, index: 1 });
    model.undo();
    expect(shape(model.program.main)).toEqual(['move(N)']);
    model.undo();
    expect(model.program.main).toEqual([]);
    expect(model.undo()).toBe(false);
    model.redo();
    model.redo();
    model.redo();
    expect(JSON.stringify(model.program)).toBe(full);
    expect(model.redo()).toBe(false);
    model.undo();
    model.insert(stmt('command:move'));
    expect(model.canRedo).toBe(false);
  });

  it('refused edits leave no history', () => {
    const { model, stmt } = setup();
    const r = stmt('control:repeat');
    model.insert(r);
    model.move(r.id, { list: { kind: 'body', id: r.id, branch: 0 }, index: 0 });
    model.undo();
    expect(model.program.main).toEqual([]);
    expect(model.canUndo).toBe(false);
  });

  it('new ids never repeat, even after undo', () => {
    const { model, stmt } = setup();
    const a = stmt('command:move');
    model.insert(a);
    model.undo();
    const b = stmt('command:move');
    expect(b.id).not.toBe(a.id);
  });
});

describe('model: procedures, parameters and variables', () => {
  it('renames a procedure and its calls; deleting it removes its calls', () => {
    const { model, stmt } = setup();
    const p = model.addProcedure('dormirse');
    expect(p.ok).toBe(true);
    const procId = p.ok ? p.id! : '';
    model.insert(stmt('command:lightLamp'));
    model.setCursor({ list: main, index: 0 });
    model.insert(stmt('call:dormirse'));
    model.insert(stmt('control:repeat'), undefined, { enter: true });
    model.insert(stmt('call:dormirse'));
    expect(model.callCount('dormirse')).toBe(2);
    expect(model.addProcedure('dormirse')).toEqual({ ok: false, reason: 'duplicateName' });
    expect(model.addProcedure('  ')).toEqual({ ok: false, reason: 'name' });
    expect(model.renameProcedure(procId, 'despertarse').ok).toBe(true);
    expect(shape(model.program.main)).toEqual(['call despertarse', { repeat: ['call despertarse'] }]);
    expect(model.program.procedures![0]!.name).toBe('despertarse');
    expect(model.remove(procId).ok).toBe(true);
    expect(shape(model.program.main)).toEqual([{ repeat: [] }]);
    expect(model.program.procedures).toEqual([]);
    model.undo();
    expect(model.callCount('despertarse')).toBe(2);
  });

  it('parameters: calls get slots, uses follow renames, removed ones leave holes', () => {
    const { model, schema, stmt, make, tpl } = setup();
    const p = model.addProcedure('caminar');
    const procId = p.ok ? p.id! : '';
    expect(model.addParam(procId, 'pasos').ok).toBe(true);
    expect(model.addParam(procId, 'pasos')).toEqual({ ok: false, reason: 'duplicateName' });
    const r = stmt('control:repeat');
    model.insert(r);
    const paramTpl = tpl('param:pasos');
    const param = make('param:pasos');
    expect(model.putExpr(param, { parent: r.id, slot: 0 }).ok).toBe(true);
    model.setCursor({ list: main, index: 0 });
    const call = stmt('call:caminar');
    model.insert(call);
    expect(call.kind === 'call' && call.args.length).toBe(1);
    model.setValue({ parent: call.id, slot: 0 }, 3);
    // A parameter cannot leave its procedure.
    expect(model.move(r.id, { list: main, index: 0 })).toEqual({ ok: false, reason: 'scope' });
    expect(model.putExpr(schema.instantiate(paramTpl, model.newId) as Expr, { parent: call.id, slot: 0 })).toEqual({ ok: false, reason: 'scope' });
    expect(model.renameParam(procId, 'pasos', 'veces').ok).toBe(true);
    const body = model.program.procedures![0]!.body[0] as Extract<Statement, { kind: 'repeat' }>;
    expect(body.times).toMatchObject({ kind: 'param', name: 'veces' });
    const program = model.getProgram();
    expect(analyze(program, catalogFor(lamps), lamps.toolbox)).toEqual([]);
    expect(model.removeParam(procId, 'veces').ok).toBe(true);
    const main0 = model.program.main[0] as Extract<Statement, { kind: 'call' }>;
    expect(main0.args).toEqual([]);
    const body2 = model.program.procedures![0]!.body[0] as Extract<Statement, { kind: 'repeat' }>;
    expect(body2.times.kind).toBe('number');
  });

  it('variables: created ones are offered, set blocks can switch variable', () => {
    const { model, stmt, make } = setup();
    expect(model.addVariable('pasos').ok).toBe(true);
    expect(model.addVariable('pasos')).toEqual({ ok: false, reason: 'duplicateName' });
    model.addVariable('vueltas');
    const s = stmt('variable:set');
    model.insert(s);
    expect(s.kind === 'set' && s.variable).toBe('pasos');
    expect(model.setVariable(s.id, 'vueltas').ok).toBe(true);
    const v = make('var:pasos');
    const c = stmt('variable:change');
    model.insert(c);
    expect(model.putExpr(v, { parent: c.id, slot: 0 }).ok).toBe(true);
    expect(model.variables).toEqual(['vueltas', 'pasos']);
  });
});

describe('model: par, handlers and saving', () => {
  it('refuses edits that add blocks beyond a strict par', () => {
    const level: GridLevel = { ...lamps, toolbox: { ...lamps.toolbox, par: 2, strictPar: true } };
    const { model, stmt } = setup(level);
    model.insert(stmt('command:move'));
    model.insert(stmt('command:move'));
    expect(model.insert(stmt('command:move'))).toEqual({ ok: false, reason: 'par' });
    expect(model.duplicate(model.program.main[0]!.id)).toEqual({ ok: false, reason: 'par' });
    // Literals do not count.
    expect(model.setValue({ parent: model.program.main[0]!.id, slot: 0 }, 'S').ok).toBe(true);
    expect(model.blockCount).toBe(2);
  });

  it('adds event handlers and edits their events', () => {
    const level: RealtimeLevel = {
      id: 'rt',
      world: 'realtime',
      arena: { width: 5, height: 1 },
      player: { x: 0, y: 0 },
      keys: ['left', 'right'],
      variables: { points: 0 },
      toolbox: { commands: ['move'], events: ['key', 'tick'], variables: true },
    };
    const { model, schema, stmt, tpl } = setup(level);
    const creation = schema.creation(tpl('event.key'));
    expect(creation).toEqual({ type: 'handler', event: { type: 'key', key: 'left' } });
    const h = model.addHandler(creation!.type === 'handler' ? creation!.event : { type: 'start' });
    const hid = h.ok ? h.id! : '';
    model.insert(stmt('command:move'));
    expect(model.program.handlers![0]!.body.length).toBe(1);
    expect(model.setHandlerEvent(hid, { type: 'key', key: 'right' }).ok).toBe(true);
    expect(model.variables).toEqual(['points']);
    expect(countBlocks(model.getProgram())).toBe(1);
    expect(model.remove(hid).ok).toBe(true);
    expect(model.program.handlers).toEqual([]);
  });

  it('serializes and reads back programs; foreign JSON gets ids', () => {
    const { model, stmt } = setup();
    model.insert(stmt('command:move'));
    model.addVariable('x');
    const text = serializeProgram(model.getProgram(), { level: lamps.id, variables: model.createdVariables });
    const back = deserializeProgram(text)!;
    expect(back.level).toBe('ch1-lamps');
    expect(back.variables).toEqual(['x']);
    expect(back.program).toEqual(model.getProgram());
    expect(deserializeProgram('nope')).toBeNull();
    expect(deserializeProgram('{"main": 3}')).toBeNull();
    const other = setup();
    other.model.setProgram({ main: [{ kind: 'command', command: 'lightLamp', args: [] } as unknown as Statement] }, { history: false });
    expect(other.model.program.main[0]!.id).toMatch(/^k\d+$/);
    expect(other.model.canUndo).toBe(false);
  });

  it('a program built with the model passes check()', () => {
    const { model, stmt } = setup();
    const p = model.addProcedure('fila');
    const procId = p.ok ? p.id! : '';
    const dirs = (m: Statement, d: 'N' | 'E' | 'S' | 'W'): void => void model.setValue({ parent: m.id, slot: 0 }, d);
    for (const k of ['E', 'L', 'E', 'E', 'L'] as const) {
      const s = stmt(k === 'L' ? 'command:lightLamp' : 'command:move');
      model.insert(s);
      if (k === 'E') dirs(s, 'E');
    }
    model.setCursor({ list: main, index: 0 });
    model.insert(stmt('call:fila'));
    const m1 = stmt('command:move');
    const m2 = stmt('command:move');
    model.insert(m1);
    model.insert(m2);
    dirs(m1, 'S');
    dirs(m2, 'S');
    const r = stmt('control:repeat');
    model.insert(r, undefined, { enter: true });
    model.setValue({ parent: r.id, slot: 0 }, 3);
    const w = stmt('command:move');
    model.insert(w);
    dirs(w, 'W');
    model.setCursor({ list: main, index: 4 });
    model.insert(stmt('call:fila'));
    expect(locateStatement(model.program, procId)).toBeNull();
    const result = check(lamps, model.getProgram());
    expect(result.message).toBe('¡Funciona en todos los casos!');
    expect(result.passed).toBe(true);
    expect(result.blocks).toBe(6);
  });

  it('holes are name literals', () => {
    expect(hole('x')).toEqual({ id: 'x', kind: 'name', value: '' });
  });
});

describe('model: more edges', () => {
  it('read-only refuses every edit and keeps no history', () => {
    const { model, stmt } = setup();
    model.insert(stmt('command:move'));
    model.readOnly = true;
    expect(model.insert(stmt('command:lightLamp'))).toEqual({ ok: false, reason: 'readOnly' });
    expect(model.remove(model.program.main[0]!.id)).toEqual({ ok: false, reason: 'readOnly' });
    expect(model.addProcedure('x')).toEqual({ ok: false, reason: 'readOnly' });
    expect(model.program.main.length).toBe(1);
    model.readOnly = false;
    expect(model.undo()).toBe(true);
    expect(model.canUndo).toBe(false);
  });

  it('setProgram can be undone, or clear the history', () => {
    const { model, stmt } = setup();
    model.insert(stmt('command:move'));
    model.setProgram({ main: [] });
    expect(model.program.main).toEqual([]);
    model.undo();
    expect(shape(model.program.main)).toEqual(['move(N)']);
    model.setProgram({ main: [] }, { history: false });
    expect(model.canUndo).toBe(false);
    expect(model.canRedo).toBe(false);
  });

  it('ids of untouched blocks never change across edits', () => {
    const { model, stmt } = setup();
    const a = stmt('command:move');
    const b = stmt('command:lightLamp');
    const r = stmt('control:repeat');
    model.insert(a);
    model.insert(b);
    model.insert(r);
    const before = JSON.stringify(model.program.main.map((s) => s.id));
    model.move(b.id, { list: { kind: 'body', id: r.id, branch: 0 }, index: 0 });
    model.undo();
    expect(JSON.stringify(model.program.main.map((s) => s.id))).toBe(before);
    model.setValue({ parent: a.id, slot: 0 }, 'W');
    expect(model.program.main[0]!.id).toBe(a.id);
  });

  it('the cursor walks from the main stack into procedure bodies and stops at the ends', () => {
    const { model, stmt } = setup();
    model.insert(stmt('command:move'));
    const p = model.addProcedure('fila');
    const procId = p.ok ? p.id! : '';
    model.setCursor({ list: main, index: 1 });
    expect(model.stepCursor(1)).toBe(true);
    expect(model.cursor).toEqual({ list: { kind: 'procedure', id: procId }, index: 0 });
    expect(model.cursorProcedure?.name).toBe('fila');
    expect(model.stepCursor(1)).toBe(false);
    model.setCursor({ list: main, index: 0 });
    expect(model.stepCursor(-1)).toBe(false);
    // Out-of-range spots are clamped; unknown lists refused.
    expect(model.setCursor({ list: main, index: 99 })).toBe(true);
    expect(model.cursor.index).toBe(1);
    expect(model.setCursor({ list: { kind: 'procedure', id: 'nope' }, index: 0 })).toBe(false);
  });

  it('moves out of a nested mouth one level at a time', () => {
    const { model, stmt } = setup();
    const outer = stmt('control:repeat');
    model.insert(outer, undefined, { enter: true });
    const inner = stmt('control:if');
    model.insert(inner, undefined, { enter: true });
    const x = stmt('command:lightLamp');
    model.insert(x);
    expect(shape(model.program.main)).toEqual([{ repeat: [{ if: ['lightLamp'] }] }]);
    model.moveDown(x.id);
    expect(shape(model.program.main)).toEqual([{ repeat: [{ if: [] }, 'lightLamp'] }]);
    model.moveDown(x.id);
    expect(shape(model.program.main)).toEqual([{ repeat: [{ if: [] }] }, 'lightLamp']);
    // Up from the main stack jumps past the neighbour (it does not enter its mouth).
    model.moveUp(x.id);
    expect(shape(model.program.main)).toEqual(['lightLamp', { repeat: [{ if: [] }] }]);
  });

  it('removing a reporter leaves a hole in boolean slots and a default in number slots', () => {
    const { model, stmt, make } = setup();
    const r = stmt('control:repeat');
    const c = stmt('control:if');
    model.insert(r);
    model.insert(c);
    const plus = make('operator:+');
    model.putExpr(plus, { parent: r.id, slot: 0 });
    const eq = make('operator:=');
    model.putExpr(eq, { parent: c.id, slot: 0 });
    model.remove(plus.id);
    model.remove(eq.id);
    const [rs, cs] = model.program.main as [Extract<Statement, { kind: 'repeat' }>, Extract<Statement, { kind: 'if' }>];
    expect(rs.times).toMatchObject({ kind: 'number', value: 2 });
    expect(isHole(cs.condition)).toBe(true);
  });

  it('parameters stay inside their procedure, also when moving reporters', () => {
    const { model, stmt, make } = setup();
    const a = model.addProcedure('a', ['n']);
    const aId = a.ok ? a.id! : '';
    const ra = stmt('control:repeat');
    model.insert(ra);
    const n = make('param:n');
    expect(model.putExpr(n, { parent: ra.id, slot: 0 }).ok).toBe(true);
    const b = model.addProcedure('b');
    const rb = stmt('control:repeat');
    model.insert(rb);
    expect(model.moveExpr(n.id, { parent: rb.id, slot: 0 })).toEqual({ ok: false, reason: 'scope' });
    // Duplicating inside the same procedure is fine.
    expect(model.duplicate(ra.id).ok).toBe(true);
    expect(model.program.procedures!.find((p) => p.id === aId)!.body.length).toBe(2);
    expect(b.ok).toBe(true);
  });

  it('a preset label shows only when the toolbox has no general block of that name', () => {
    const presets: GridLevel = { ...lamps, toolbox: { ...lamps.toolbox, commands: [{ name: 'move', args: ['E'], label: 'Mover →' }, 'lightLamp'] } };
    const { schema, stmt } = setup(presets);
    const m = stmt('command:move:["E"]');
    expect(schema.labelOf(m)).toMatchObject({ template: 'Mover →', preset: true });
    const both: GridLevel = { ...lamps, toolbox: { ...lamps.toolbox, commands: [{ name: 'move', args: ['E'], label: 'Mover →' }, 'move'] } };
    const s2 = new Schema(both);
    expect(s2.labelOf(m)).toMatchObject({ template: 'Mover {0}', preset: false });
  });

  it('an operator preset (360 ÷ ( )) shows its fixed part as text and keeps it fixed', () => {
    const level: GridLevel = { ...lamps, toolbox: { ...lamps.toolbox, operators: [{ op: '/', args: [360, null] }] } };
    const { schema, model, stmt, make, tpl } = setup(level);
    const t = tpl('operator:/:[360,null]');
    expect(schema.labelOfTemplate(t)).toBe('360 ÷ {1}');
    const div = make('operator:/:[360,null]');
    expect(div).toMatchObject({ kind: 'arith', op: '/', left: { kind: 'number', value: 360 } });
    expect(isHole((div as Extract<Expr, { kind: 'arith' }>).right)).toBe(true);
    expect(schema.labelOf(div)).toEqual({ template: '360 ÷ {1}', preset: true, fixed: [0] });
    const r = stmt('control:repeat');
    model.insert(r);
    expect(model.putExpr(div, { parent: r.id, slot: 0 }).ok).toBe(true);
    expect(model.setValue({ parent: div.id, slot: 0 }, 180)).toEqual({ ok: false, reason: 'fixed' });
    expect(model.clearSlot({ parent: div.id, slot: 0 })).toEqual({ ok: false, reason: 'fixed' });
    expect(model.putExpr(make('sensor:itemHere:["lamp"]'), { parent: div.id, slot: 0 })).toEqual({ ok: false, reason: 'fixed' });
    expect(model.setValue({ parent: div.id, slot: 1 }, 6).ok).toBe(true);
    expect(model.clearSlot({ parent: div.id, slot: 1 }).ok).toBe(true);
    const back = (model.program.main[0] as Extract<Statement, { kind: 'repeat' }>).times as Extract<Expr, { kind: 'arith' }>;
    expect(back.left).toMatchObject({ kind: 'number', value: 360 });
    expect(isHole(back.right)).toBe(true);
    // With the plain operator offered too, the block is an ordinary division.
    const both = new Schema({ ...level, toolbox: { ...level.toolbox, operators: [{ op: '/', args: [360, null] }, '/'] } });
    expect(both.labelOf(div)).toMatchObject({ preset: false, fixed: [] });
    expect(both.isFixed(div, 0)).toBe(false);
  });

  it('a strict par refuses new blocks but allows edits that do not add any', () => {
    const level: GridLevel = { ...lamps, toolbox: { ...lamps.toolbox, par: 1, strictPar: true } };
    const { model, stmt } = setup(level);
    const r = stmt('control:repeat');
    model.insert(r);
    expect(model.insert(stmt('command:lightLamp'))).toEqual({ ok: false, reason: 'par' });
    expect(model.setValue({ parent: r.id, slot: 0 }, 5).ok).toBe(true);
    expect(model.remove(r.id).ok).toBe(true);
    expect(model.insert(stmt('command:lightLamp')).ok).toBe(true);
  });

  it('the program is always valid for analyze()', () => {
    const { model, stmt, make } = setup();
    model.insert(stmt('control:repeatUntil'), undefined, { enter: true });
    model.insert(stmt('command:move'));
    const p = model.addProcedure('paso', ['d']);
    model.insert(stmt('command:lightLamp'));
    model.setCursor({ list: main, index: 1 });
    model.insert(stmt('call:paso'));
    const until = model.program.main[0] as Extract<Statement, { kind: 'repeatUntil' }>;
    model.putExpr(make('sensor:itemHere:["lamp"]'), { parent: until.id, slot: 0 });
    expect(p.ok).toBe(true);
    const issues = analyze(model.getProgram(), catalogFor(lamps), lamps.toolbox);
    expect(issues).toEqual([]);
  });
});
