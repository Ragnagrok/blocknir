/**
 * Features a kids' book needs from levels: preset blocks, program requirements, counting games,
 * new random boards per run, scene puzzles, and levels as plain JSON.
 */
import { describe, expect, it } from 'vitest';
import { blocks } from './build.js';
import { check, gridCases, palette, type GridLevel, type Level } from './level.js';

const b = blocks();

describe('preset blocks', () => {
  const level: GridLevel = {
    id: 'presets',
    world: 'grid',
    board: { width: 2, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: 1, y: 0, items: { apple: 1 } }] },
    goal: { type: 'noItem', item: 'apple' },
    actions: [{ name: 'eatApple', label: 'Comer manzana', consumeHere: { apple: 1 }, failMessage: 'Acá no hay manzana para comer.' }],
    toolbox: {
      commands: [{ name: 'move', args: ['E'], label: 'Mover →' }, 'eatApple', { name: 'paint', args: ['red'], label: 'Pintar' }],
      sensors: [{ name: 'itemHere', args: ['apple'], label: '¿Hay manzana?' }],
      control: ['if'],
      procedures: true,
    },
    labels: { blocks: { procedure: 'Enseñar a Chela: {name}' } },
  };

  it('the palette lists them with their labels and fixed arguments', () => {
    const p = palette(level);
    expect(p.slice(0, 4)).toEqual([
      { key: 'move', category: 'command', label: 'Mover →', params: [{ type: 'direction' }], args: ['E'] },
      { key: 'eatApple', category: 'command', label: 'Comer manzana', params: [] },
      { key: 'paint', category: 'command', label: 'Pintar', params: [{ type: 'name', name: 'color' }], args: ['red'] },
      { key: 'itemHere', category: 'sensor', label: '¿Hay manzana?', params: [{ type: 'name', name: 'item' }], returns: 'boolean', args: ['apple'] },
    ]);
    expect(p.find((e) => e.key === 'procedure')!.label).toBe('Enseñar a Chela: {name}');
  });

  it('a program must use them as given', () => {
    expect(check(level, b.program([b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'apple'), b.cmd('eatApple'))])).passed).toBe(true);
    const r = check(level, b.program([b.cmd('move', 'E'), b.cmd('move', 'W')]));
    expect(r.issues.map((i) => i.code)).toEqual(['notAllowed']);
    expect(r.passed).toBe(false);
    expect(check(level, b.program([b.cmd('eatApple')])).cases[0]!.reason).toBe('Acá no hay manzana para comer.');
  });
});

describe('program requirements', () => {
  const board = { width: 5, height: 2, robot: { x: 0, y: 0 }, cells: [0, 1, 2, 3].map((x) => ({ x: x + 1, y: 0, items: { banana: 1 } })).concat([1, 2].map((x) => ({ x, y: 1, items: { banana: 1 } }))) };
  const level: GridLevel = {
    id: 'bananas-2',
    world: 'grid',
    board,
    goal: { type: 'noItem', item: 'banana' },
    actions: [
      { name: 'eatBanana', consumeHere: { banana: 1 } },
      { name: 'backToEdge', goTo: { x: 0 } },
    ],
    requires: [{ type: 'procedure', params: 1, distinctCalls: 2 }],
    toolbox: { commands: ['move', 'eatBanana', 'backToEdge'], control: ['repeat'], procedures: true, parameters: true },
  };
  const eat = b.proc('eatRow', ['amount'], b.repeat(b.param('amount'), b.cmd('move', 'E'), b.cmd('eatBanana')));

  it('one procedure with a parameter, used with two values', () => {
    const good = b.program([b.call('eatRow', 4), b.cmd('backToEdge'), b.cmd('move', 'S'), b.call('eatRow', 2)], [eat]);
    const r = check(level, good);
    expect(r.requirements).toEqual([{ passed: true, reason: null }]);
    expect(r.passed).toBe(true);
  });

  it('works but misses the requirement', () => {
    const row4 = b.proc('row4', [], b.repeat(4, b.cmd('move', 'E'), b.cmd('eatBanana')));
    const row2 = b.proc('row2', [], b.repeat(2, b.cmd('move', 'E'), b.cmd('eatBanana')));
    const r = check(level, b.program([b.call('row4'), b.cmd('backToEdge'), b.cmd('move', 'S'), b.call('row2')], [row4, row2]));
    expect(r.cases[0]!.passed).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.message).toBe('Funciona, pero falta algo: Falta un bloque enseñado con 1 huecos, usado con 2 valores distintos.');
  });

  it('the main stack only calls procedures, with a custom message', () => {
    const scene: GridLevel = {
      id: 'morning-3',
      world: 'grid',
      board: { width: 1, height: 1, robot: { x: 0, y: 0 } },
      actions: [{ name: 'lieDown' }, { name: 'closeEyes' }],
      goal: { type: 'sequence', commands: ['lieDown', 'closeEyes'] },
      requires: [{ type: 'uses', block: 'lieDown', in: 'main', max: 0, message: 'Usá el bloque enseñado "dormirse".' }],
      toolbox: { commands: ['lieDown', 'closeEyes'], procedures: true },
    };
    const sleep = b.proc('fallAsleep', [], b.cmd('lieDown'), b.cmd('closeEyes'));
    expect(check(scene, b.program([b.call('fallAsleep')], [sleep])).passed).toBe(true);
    const loose = check(scene, b.program([b.cmd('lieDown'), b.cmd('closeEyes')]));
    expect(loose.message).toBe('Funciona, pero falta algo: Usá el bloque enseñado "dormirse".');
  });
});

describe('counting and random boards', () => {
  const level: GridLevel = {
    id: 'count',
    world: 'grid',
    board: { width: 1, height: 1, robot: { x: 0, y: 0 } },
    generate: {
      seed: 1,
      count: 5,
      rules: [{ type: 'rows', count: 3, length: [3, 7], start: { items: { start: 1 } }, middle: [{ items: { apple: 1 } }, { items: { banana: 1 } }, null], last: [{ items: { flag: 1 } }], downOnlyAtStart: true }],
    },
    actions: [
      { name: 'countApple', requireHere: { apple: 1 }, addInventory: { apples: 1 } },
      { name: 'countBanana', requireHere: { banana: 1 }, addInventory: { bananas: 1 } },
      { name: 'backToStart', goTo: { x: 0 } },
    ],
    goal: { type: 'all', goals: [{ type: 'tally', counter: 'apples', of: 'apple' }, { type: 'tally', counter: 'bananas', of: 'banana' }] },
    toolbox: { commands: ['move', 'countApple', 'countBanana', 'backToStart'], sensors: ['itemHere'], control: ['repeat', 'repeatUntil', 'if'], procedures: true },
  };
  const row = b.proc('countRow', [], b.until(b.sensor('itemHere', 'flag'), b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'apple'), b.cmd('countApple')), b.if(b.sensor('itemHere', 'banana'), b.cmd('countBanana'))));
  const program = b.program([b.call('countRow'), b.cmd('backToStart'), b.cmd('move', 'S'), b.call('countRow'), b.cmd('backToStart'), b.cmd('move', 'S'), b.call('countRow')], [row]);

  it('counts fruit row by row on five random boards', () => {
    const r = check(level, program);
    expect(r.cases).toHaveLength(5);
    expect(r.passed).toBe(true);
  });

  it('a new seed gives new boards, and still passes', () => {
    expect(gridCases(level, 99)).not.toEqual(gridCases(level));
    expect(check(level, program, { seed: 99 }).passed).toBe(true);
  });

  it('counting twice gives a wrong tally', () => {
    const twice = b.proc('countRow', [], b.until(b.sensor('itemHere', 'flag'), b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'apple'), b.cmd('countApple'), b.cmd('countApple'))));
    const r = check(level, b.program(program.main, [twice]));
    expect(r.passed).toBe(false);
    expect(r.cases.find((c) => !c.passed)!.reason).toMatch(/^La cuenta de manzana dio \d+, y había \d+\.$/);
  });
});

describe('levels are plain JSON', () => {
  it('a level and a program that went through JSON give the same check', () => {
    const level: Level = {
      id: 'json',
      world: 'grid',
      board: { width: 6, height: 1, robot: { x: 0, y: 0 } },
      generate: { seed: 4, count: 5, rules: [{ type: 'scatter', item: 'lamp', chance: 0.5, atLeast: 1 }] },
      goal: { type: 'noItem', item: 'lamp' },
      toolbox: { commands: [{ name: 'move', args: ['E'], label: 'Mover →' }, 'lightLamp'], sensors: ['itemHere'], control: ['repeat', 'if'], par: 6 },
    };
    const program = b.program([b.if(b.sensor('itemHere', 'lamp'), b.cmd('lightLamp')), b.repeat(5, b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'lamp'), b.cmd('lightLamp')))]);
    const direct = check(level, program);
    const viaJson = check(JSON.parse(JSON.stringify(level)) as Level, JSON.parse(JSON.stringify(program)) as typeof program);
    expect(JSON.stringify(viaJson)).toBe(JSON.stringify(direct));
    expect(direct.passed).toBe(true);
    expect(direct.blocks).toBe(8);
    expect(direct.message).toBe('¡Funciona! Usaste 8 bloques. ¿Te animás a hacerlo con 6 o menos?');
  });
});

describe('the README example level', () => {
  it('passes with a repeat-until solution', () => {
    const level = JSON.parse(`{
      "id": "c4-muelle-1", "world": "grid", "title": "Faroles hasta el muelle",
      "board": { "width": 5, "height": 1, "robot": { "x": 0, "y": 0 }, "cells": [{ "x": -1, "y": 0, "items": { "flag": 1 } }] },
      "generate": { "seed": 11, "count": 5, "rules": [
        { "type": "size", "width": [3, 12] },
        { "type": "fill", "region": { "x0": 0, "y0": 0, "x1": -2, "y1": 0 }, "content": { "items": { "lamp": 1 } } } ] },
      "goal": { "type": "all", "goals": [{ "type": "noItem", "item": "lamp" }, { "type": "robotAt", "onItem": "flag" }] },
      "toolbox": {
        "commands": [{ "name": "move", "args": ["E"], "label": "Mover →" }, "lightLamp"],
        "sensors": [{ "name": "itemHere", "args": ["flag"], "label": "¿Llegué al final?" }],
        "control": ["repeat", "repeatUntil"] },
      "labels": { "blocks": { "procedure": "Enseñar a Bolo: {name}" } }
    }`) as Level;
    const program = b.program([b.until(b.sensor('itemHere', 'flag'), b.cmd('lightLamp'), b.cmd('move', 'E'))]);
    const r = check(level, program);
    expect(r.issues).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.blocks).toBe(4);
  });
});
