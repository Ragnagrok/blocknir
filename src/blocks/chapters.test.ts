/**
 * One solved example per chapter of a kids' programming book: each level is plain JSON-like data,
 * each solution is a program, and `check()` must accept it (and reject a wrong one, with a reason).
 */
import { describe, expect, it } from 'vitest';
import { blocks } from './build.js';
import { check, type GridLevel, type RealtimeLevel, type TurtleLevel } from './level.js';
import { countBlocks } from './toolbox.js';
import type { Program } from './ast.js';

describe('chapter 1: sequence, commands, procedures', () => {
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
    toolbox: { commands: ['move', 'lightLamp'], procedures: true, choices: { directions: ['N', 'E', 'S', 'W'] }, par: 8 },
  };

  it('accepts a solution with a procedure, within par', () => {
    const b = blocks();
    const program = b.program(
      [b.call('row'), b.cmd('move', 'S'), b.cmd('move', 'S'), b.cmd('move', 'W'), b.cmd('move', 'W'), b.cmd('move', 'W'), b.call('row')],
      [b.proc('row', [], b.cmd('move', 'E'), b.cmd('lightLamp'), b.cmd('move', 'E'), b.cmd('move', 'E'), b.cmd('lightLamp'))],
    );
    const r = check(lamps, program);
    expect(r.passed).toBe(true);
    expect(r.blocks).toBe(7);
    expect(countBlocks(program, 'all')).toBe(13);
    expect(r.withinPar).toBe(true);
    expect(r.message).toBe('¡Funciona en todos los casos!');
  });

  it('accepts a long solution but says it is over par', () => {
    const b = blocks();
    const row = (): ReturnType<typeof b.cmd>[] => [b.cmd('move', 'E'), b.cmd('lightLamp'), b.cmd('move', 'E'), b.cmd('move', 'E'), b.cmd('lightLamp')];
    const program = b.program([...row(), b.cmd('move', 'S'), b.cmd('move', 'S'), ...['W', 'W', 'W'].map((d) => b.cmd('move', d)), ...row()]);
    const r = check(lamps, program);
    expect(r.passed).toBe(true);
    expect(r.withinPar).toBe(false);
    expect(r.message).toBe('¡Funciona! Usaste 15 bloques. ¿Te animás a hacerlo con 8 o menos?');
    expect(check({ ...lamps, toolbox: { ...lamps.toolbox, strictPar: true } }, program).passed).toBe(false);
  });

  it('rejects a program that leaves a lamp off, saying why', () => {
    const b = blocks();
    const r = check(lamps, b.program([b.cmd('move', 'E'), b.cmd('lightLamp')]));
    expect(r.passed).toBe(false);
    expect(r.cases[0]!.reason).toBe('Todavía quedan faroles sin prender (3).');
  });

  it('scene actions in order: a morning routine with procedures', () => {
    const level: GridLevel = {
      id: 'ch1-morning',
      world: 'grid',
      board: { width: 1, height: 1, robot: { x: 0, y: 0 } },
      actions: [
        { name: 'openEyes', label: 'abrir los ojos' },
        { name: 'stretch', label: 'estirarse' },
        { name: 'getUp', label: 'levantarse' },
        { name: 'lieDown', label: 'acostarse' },
        { name: 'closeEyes', label: 'cerrar los ojos' },
      ],
      goal: { type: 'sequence', commands: ['openEyes', 'stretch', 'getUp', 'lieDown', 'closeEyes', 'openEyes', 'stretch', 'getUp'] },
      toolbox: { commands: ['openEyes', 'stretch', 'getUp', 'lieDown', 'closeEyes'], procedures: true },
    };
    const b = blocks();
    const program = b.program(
      [b.call('wakeUp'), b.call('fallAsleep'), b.call('wakeUp')],
      [b.proc('wakeUp', [], b.cmd('openEyes'), b.cmd('stretch'), b.cmd('getUp')), b.proc('fallAsleep', [], b.cmd('lieDown'), b.cmd('closeEyes'))],
    );
    expect(check(level, program).passed).toBe(true);
    const wrong = b.program([b.call('fallAsleep'), b.call('wakeUp')], program.procedures);
    expect(check(level, wrong).cases[0]!.reason).toBe('Las acciones no se hicieron en el orden pedido.');
  });
});

describe('chapter 2: procedures and repeat', () => {
  it('stones in the creek: 30 jumps with two blocks', () => {
    const level: GridLevel = {
      id: 'ch2-stones',
      world: 'grid',
      board: { width: 31, height: 1, robot: { x: 0, y: 0 } },
      goal: { type: 'robotAt', x: -1 },
      toolbox: { commands: ['move'], control: ['repeat'], par: 2 },
    };
    const b = blocks();
    const program = b.program([b.repeat(30, b.cmd('move', 'E'))]);
    const r = check(level, program);
    expect(r.passed && r.withinPar).toBe(true);
    expect(r.blocks).toBe(2);
  });

  it('mosaics: paint a window with a procedure', () => {
    const window = [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ].map(([x, y]) => ({ x: x!, y: y!, color: 'blue' }));
    const level: GridLevel = {
      id: 'ch2-mosaic',
      world: 'grid',
      board: { width: 3, height: 3, robot: { x: 0, y: 0 } },
      goal: { type: 'colors', cells: window, exact: true },
      toolbox: { commands: ['move', 'paint'], control: ['repeat'], procedures: true },
    };
    const b = blocks();
    const side = (d: string) => b.proc(`side${d}`, [], b.repeat(2, b.cmd('paint', 'blue'), b.cmd('move', d)));
    const program = b.program([b.call('sideS'), b.call('sideE'), b.call('sideN'), b.call('sideW')], [side('S'), side('E'), side('N'), side('W')]);
    expect(check(level, program).passed).toBe(true);
    const extra = b.program([...program.main, b.cmd('move', 'S'), b.cmd('move', 'E'), b.cmd('paint', 'red')], program.procedures);
    expect(check(level, extra).cases[0]!.reason).toContain('(1, 1)');
  });

  it('three computers: actions as data with requirements and parameters', () => {
    const level: GridLevel = {
      id: 'ch2-computers',
      world: 'grid',
      board: {
        width: 3,
        height: 1,
        robot: { x: 0, y: 0 },
        cells: [0, 1, 2].map((x) => ({ x, y: 0, items: { pcOff: 1 } })),
      },
      actions: [
        { name: 'turnOn', label: 'prender la compu', consumeHere: { pcOff: 1 }, addHere: { pcOn: 1 }, failMessage: 'Acá no hay una compu apagada.' },
        {
          name: 'write',
          label: 'escribir {0}',
          params: [{ type: 'name', name: 'letter' }],
          requireHere: { pcOn: 1 },
          addHere: { 'text{0}': 1 },
          failMessage: 'Para escribir, la compu tiene que estar prendida.',
        },
        { name: 'install', label: 'instalar el juego', requireHere: { pcOn: 1 }, forbidHere: ['game'], addHere: { game: 1 } },
        { name: 'turnOff', label: 'apagar la compu', consumeHere: { pcOn: 1 }, addHere: { pcOff: 1 } },
      ],
      goal: {
        type: 'all',
        goals: [0, 1, 2].map((x) => ({ type: 'cell' as const, x, y: 0, items: { pcOff: 1, pcOn: 0, textA: 1, textB: 1, textC: 1, game: 1 } })),
      },
      toolbox: { commands: ['move', 'turnOn', 'write', 'install', 'turnOff'], control: ['repeat'], procedures: true, choices: { names: ['A', 'B', 'C'] } },
    };
    const b = blocks();
    const use = b.proc('use', [], b.cmd('turnOn'), b.cmd('write', b.name('A')), b.cmd('write', b.name('B')), b.cmd('write', b.name('C')), b.cmd('install'), b.cmd('turnOff'));
    const program = b.program([b.call('use'), b.cmd('move', 'E'), b.call('use'), b.cmd('move', 'E'), b.call('use')], [use]);
    expect(check(level, program).passed).toBe(true);

    const early = b.program([b.cmd('write', b.name('A'))]);
    const r = check(level, early);
    expect(r.cases[0]!.error!.code).toBe('actionFailed');
    expect(r.cases[0]!.reason).toBe('Para escribir, la compu tiene que estar prendida.');
    expect(r.cases[0]!.error!.nodeId).toBe(early.main[0]!.id);
  });

  it('the great island adventure: a chain of items with preconditions', () => {
    const level: GridLevel = {
      id: 'ch2-adventure',
      world: 'grid',
      board: {
        width: 4,
        height: 2,
        robot: { x: 0, y: 0 },
        cells: [
          { x: 1, y: 0, items: { key: 1 } },
          { x: 3, y: 0, items: { chest: 1 } },
          { x: 3, y: 1, items: { lighthouse: 1 } },
        ],
      },
      actions: [
        { name: 'openChest', label: 'abrir el cofre', requireHere: { chest: 1 }, consumeInventory: { key: 1 }, addInventory: { lens: 1 }, failMessage: 'Para abrir el cofre hace falta la llave.' },
        { name: 'placeLens', label: 'poner la lente', requireHere: { lighthouse: 1 }, consumeInventory: { lens: 1 }, addHere: { lensPlaced: 1 } },
      ],
      goal: { type: 'cell', x: 3, y: 1, items: { lensPlaced: 1 } },
      toolbox: { commands: ['move', 'pick', 'openChest', 'placeLens'] },
    };
    const b = blocks();
    const ok = b.program([b.cmd('move', 'E'), b.cmd('pick', 'key'), b.cmd('move', 'E'), b.cmd('move', 'E'), b.cmd('openChest'), b.cmd('move', 'S'), b.cmd('placeLens')]);
    expect(check(level, ok).passed).toBe(true);
    const skipped = b.program([b.cmd('move', 'E'), b.cmd('move', 'E'), b.cmd('move', 'E'), b.cmd('openChest')]);
    expect(check(level, skipped).cases[0]!.reason).toBe('Para abrir el cofre hace falta la llave.');
  });
});

describe('chapter 3: deciding with if and sensors', () => {
  const level: GridLevel = {
    id: 'ch3-apple-or-banana',
    world: 'grid',
    board: { width: 2, height: 1, robot: { x: 0, y: 0 } },
    generate: { seed: 7, count: 8, rules: [{ type: 'choose', region: { x0: 1, y0: 0, x1: 1, y1: 0 }, options: [{ items: { apple: 1 } }, { items: { banana: 1 } }] }] },
    goal: { type: 'all', goals: [{ type: 'noItem', item: 'apple' }, { type: 'noItem', item: 'banana' }] },
    toolbox: { commands: ['move', 'pick'], sensors: ['itemHere'], control: ['if', 'ifElse'] },
  };

  it('passes on every board with if/else', () => {
    const b = blocks();
    const program = b.program([b.cmd('move', 'E'), b.ifElse(b.sensor('itemHere', 'apple'), [b.cmd('pick', 'apple')], [b.cmd('pick', 'banana')])]);
    const r = check(level, program);
    expect(r.cases).toHaveLength(8);
    expect(r.passed).toBe(true);
  });

  it('fails on some boards without deciding', () => {
    const b = blocks();
    const r = check(level, b.program([b.cmd('move', 'E'), b.cmd('pick', 'apple')]));
    expect(r.passed).toBe(false);
    const bad = r.cases.filter((c) => !c.passed);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.length).toBeLessThan(8);
    expect(bad[0]!.reason).toBe('Acá no hay manzana.');
    expect(r.message).toMatch(/^Todavía no funciona en todos los casos\. Prueba \d+: Acá no hay manzana\.$/);
  });

  it('random lamps: light only where there is one', () => {
    const lamps: GridLevel = {
      id: 'ch3-random-lamps',
      world: 'grid',
      board: { width: 6, height: 1, robot: { x: 0, y: 0 } },
      generate: { seed: 3, count: 6, rules: [{ type: 'scatter', item: 'lamp', chance: 0.5, region: { x0: 1, y0: 0, x1: -1, y1: 0 }, atLeast: 1 }] },
      goal: { type: 'noItem', item: 'lamp' },
      toolbox: { commands: ['move', 'lightLamp'], sensors: ['itemHere'], control: ['repeat', 'if'] },
    };
    const b = blocks();
    const program = b.program([b.repeat(5, b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'lamp'), b.cmd('lightLamp')))]);
    expect(check(lamps, program).passed).toBe(true);
    const blind = b.program([b.repeat(5, b.cmd('move', 'E'), b.cmd('lightLamp'))]);
    expect(check(lamps, blind).cases.some((c) => c.error?.code === 'noLamp')).toBe(true);
  });
});

describe('chapter 4: repeat until, variable lengths, counting', () => {
  it('lamps to the dock on rows of changing length', () => {
    const level: GridLevel = {
      id: 'ch4-dock',
      world: 'grid',
      board: { width: 4, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: -1, y: 0, items: { dock: 1 } }] },
      generate: {
        seed: 11,
        count: 5,
        includeBase: true,
        rules: [
          { type: 'size', width: [3, 10] },
          { type: 'fill', region: { x0: 1, y0: 0, x1: -2, y1: 0 }, content: { items: { lamp: 1 } } },
        ],
      },
      goal: { type: 'all', goals: [{ type: 'noItem', item: 'lamp' }, { type: 'robotAt', onItem: 'dock' }] },
      toolbox: { commands: ['move', 'lightLamp'], sensors: ['itemHere'], control: ['repeatUntil', 'if'] },
    };
    const b = blocks();
    const program = b.program([b.until(b.sensor('itemHere', 'dock'), b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'lamp'), b.cmd('lightLamp')))]);
    const r = check(level, program);
    expect(r.cases).toHaveLength(6);
    expect(new Set(r.cases.map((c) => ('initial' in c.run && 'width' in c.run.initial ? c.run.initial.width : 0))).size).toBeGreaterThan(1);
    expect(r.passed).toBe(true);
    const fixed = b.program([b.repeat(3, b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'lamp'), b.cmd('lightLamp')))]);
    expect(check(level, fixed).passed).toBe(false);
  });

  it('counting fruit without an end mark', () => {
    const level: GridLevel = {
      id: 'ch4-count',
      world: 'grid',
      board: { width: 8, height: 1, robot: { x: 0, y: 0 } },
      generate: {
        seed: 5,
        count: 6,
        rules: [
          { type: 'size', width: [4, 9] },
          { type: 'scatter', item: 'apple', chance: 0.4, region: { x0: 1, y0: 0, x1: -1, y1: 0 } },
        ],
      },
      goal: { type: 'saidCount', item: 'apple' },
      toolbox: { commands: ['move', 'say'], sensors: ['itemHere', 'atEdge'], control: ['repeatUntil', 'if'], variables: true },
    };
    const b = blocks();
    const program = b.program([
      b.set('apples', 0),
      b.until(b.sensor('atEdge', 'E'), b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'apple'), b.change('apples', 1))),
      b.cmd('say', b.v('apples')),
    ]);
    expect(check(level, program).passed).toBe(true);
    const r = check(level, b.program([b.cmd('say', 2)]));
    expect(r.passed).toBe(false);
    expect(r.cases.find((c) => !c.passed)!.reason).toMatch(/^Había que decir \d+, y se dijo 2\.$/);
  });

  it('who ate the cake: take disguises off until the crumbs show', () => {
    const suspects = (culprit: number) => ({
      width: 6,
      height: 1,
      robot: { x: 0, y: 0 },
      cells: [1, 2, 3, 4, 5].map((x) => ({ x, y: 0, items: { disguise: 1 }, ...(x === culprit ? { hidden: { crumbs: 1 } } : {}) })),
    });
    const level: GridLevel = {
      id: 'ch4-cake',
      world: 'grid',
      board: suspects(3),
      variants: [{ board: suspects(1) }, { board: suspects(3) }, { board: suspects(5) }],
      actions: [{ name: 'unmask', label: 'sacar el disfraz', consumeHere: { disguise: 1 }, reveal: true }],
      goal: { type: 'robotAt', onItem: 'crumbs' },
      toolbox: { commands: ['move', 'unmask'], sensors: ['itemHere'], control: ['repeatUntil'] },
    };
    const b = blocks();
    const program = b.program([b.until(b.sensor('itemHere', 'crumbs'), b.cmd('move', 'E'), b.cmd('unmask'))]);
    const r = check(level, program);
    expect(r.passed).toBe(true);
    // A sensor cannot see hidden crumbs before the disguise is off.
    const peek = b.program([b.until(b.sensor('itemHere', 'crumbs'), b.cmd('move', 'E'))]);
    expect(check(level, peek).cases[0]!.error!.code).toBe('outOfBoard');
  });

  it('the big flight: a numeric sensor drives a repeat', () => {
    const level: GridLevel = {
      id: 'ch4-flight',
      world: 'grid',
      board: { width: 5, height: 1, robot: { x: 0, y: 0 } },
      generate: { seed: 2, count: 4, includeBase: true, rules: [{ type: 'size', width: [2, 12] }] },
      goal: { type: 'all', goals: [{ type: 'robotAt', edge: 'E' }, { type: 'saidCount', item: 'none' }] },
      toolbox: { commands: ['move', 'say'], sensors: ['distanceToEdge'], control: ['repeat'], variables: true, operators: ['-'] },
    };
    // Say how many cells are left behind at the end (0 apples: saidCount of a missing item is 0).
    const b = blocks();
    const program = b.program([b.set('d', b.sensor('distanceToEdge', 'E')), b.repeat(b.v('d'), b.cmd('move', 'E')), b.cmd('say', b.sensor('distanceToEdge', 'E'))]);
    expect(check(level, program).passed).toBe(true);
  });
});

describe('chapter 5: parameters and the turtle', () => {
  it('eat (amount) bananas: a harness calls the child procedure with different amounts', () => {
    const board = (n: number) => ({ width: 1, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: 0, y: 0, items: { banana: n } }] });
    const h = blocks('h');
    const level: GridLevel = {
      id: 'ch5-bananas',
      world: 'grid',
      board: board(4),
      variants: [2, 4, 7].map((n) => ({
        board: board(n),
        main: [h.call('eatBananas', n)],
        goal: { type: 'all', goals: [{ type: 'noItem', item: 'banana' }, { type: 'inventory', items: { banana: n } }] },
      })),
      goal: { type: 'noItem', item: 'banana' },
      toolbox: { commands: ['pick'], control: ['repeat'], procedures: true, parameters: true },
    };
    const b = blocks();
    const good = b.program([], [b.proc('eatBananas', ['amount'], b.repeat(b.param('amount'), b.cmd('pick', 'banana')))]);
    expect(check(level, good).passed).toBe(true);
    const fixed = b.program([], [b.proc('eatBananas', ['amount'], b.repeat(4, b.cmd('pick', 'banana')))]);
    const r = check(level, fixed);
    expect(r.cases.map((c) => c.passed)).toEqual([false, true, false]);
    expect(r.cases[0]!.reason).toBe('Acá no hay banana.');
  });

  it('polygons with two parameters, and 360 / sides', () => {
    const h = blocks('h');
    const level: TurtleLevel = {
      id: 'ch5-polygons',
      world: 'turtle',
      goal: { type: 'shape', target: { polygon: { sides: 4, side: 50 } } },
      variants: [
        { main: [h.call('polygon', 4, 50)], goal: { type: 'shape', target: { polygon: { sides: 4, side: 50 } } } },
        { main: [h.call('polygon', 6, 30)], goal: { type: 'shape', target: { polygon: { sides: 6, side: 30 } } } },
        { main: [h.call('polygon', 9, 20)], goal: { type: 'shape', target: { polygon: { sides: 9, side: 20 } } } },
      ],
      toolbox: { commands: ['forward', 'turnLeft', 'turnRight'], control: ['repeat'], procedures: true, parameters: true, operators: ['/'] },
    };
    const b = blocks();
    const program = b.program([], [
      b.proc('polygon', ['sides', 'side'], b.repeat(b.param('sides'), b.cmd('forward', b.param('side')), b.cmd('turnRight', b.arith('/', 360, b.param('sides'))))),
    ]);
    expect(check(level, program).passed).toBe(true);
    const square = b.program([], [b.proc('polygon', ['sides', 'side'], b.repeat(4, b.cmd('forward', b.param('side')), b.cmd('turnRight', 90)))]);
    const r = check(level, square);
    expect(r.cases.map((c) => c.passed)).toEqual([true, false, false]);
    expect(r.cases[1]!.reason).toBe('El dibujo tiene 4 líneas, y tenía que tener 6.');
  });
});

describe('chapter 6: games with events and variables', () => {
  const parrot = (): Program => {
    const p = blocks('p');
    return p.program([
      p.wait(p.sensor('random', 3, 6)),
      p.set('pick', p.sensor('random', 1, 3)),
      p.ifElse(p.cmp('=', p.v('pick'), 1), [p.set('mood', 'happy'), p.cmd('play', 'whistle')], [
        p.ifElse(p.cmp('=', p.v('pick'), 2), [p.set('mood', 'happy'), p.cmd('play', 'song')], [p.set('mood', 'grumpy'), p.cmd('play', 'squawk')]),
      ]),
    ]);
  };
  const level: RealtimeLevel = {
    id: 'ch6-parrot',
    world: 'realtime',
    arena: { width: 3, height: 1 },
    player: { x: 0, y: 0 },
    actors: [{ kind: 'parrot', x: 2, y: 0, id: 'parrot' }],
    kinds: { parrot: { script: parrot() } },
    variables: { mood: 'none' },
    win: {
      type: 'any',
      conditions: [
        { type: 'all', conditions: [{ type: 'var', name: 'mood', op: '=', value: 'happy' }, { type: 'look', look: 'dance' }] },
        { type: 'all', conditions: [{ type: 'var', name: 'mood', op: '=', value: 'grumpy' }, { type: 'look', look: 'hide' }] },
      ],
    },
    lose: {
      type: 'any',
      conditions: [
        { type: 'all', conditions: [{ type: 'var', name: 'mood', op: '=', value: 'happy' }, { type: 'look', look: 'hide' }] },
        { type: 'all', conditions: [{ type: 'var', name: 'mood', op: '=', value: 'grumpy' }, { type: 'look', look: 'dance' }] },
      ],
    },
    maxTicks: 30,
    trials: [1, 2, 3, 4, 5, 6].map((seed) => ({ seed, expect: 'win' as const })),
    toolbox: { commands: ['look'], sensors: ['heard', 'heardSound'], control: ['repeatUntil', 'ifElse'], operators: ['or'], events: ['start'] },
  };

  it("the parrot's music: repeat until a sound, if/else and or", () => {
    const b = blocks();
    const program = b.program([
      b.until(b.sensor('heard')),
      b.ifElse(b.or(b.sensor('heardSound', 'whistle'), b.sensor('heardSound', 'song')), [b.cmd('look', 'dance')], [b.cmd('look', 'hide')]),
    ]);
    const r = check(level, program);
    expect(r.passed).toBe(true);
    // The seeds give both moods.
    const moods = new Set(r.cases.map((c) => ('ticks' in c.run ? String(c.run.final.variables.mood) : '')));
    expect(moods).toEqual(new Set(['happy', 'grumpy']));
    // Always dancing fails for a grumpy parrot.
    const dance = check(level, b.program([b.until(b.sensor('heard')), b.cmd('look', 'dance')]));
    expect(dance.passed).toBe(false);
    expect(dance.cases.find((c) => !c.passed)!.reason).toBe('había que ganar, pero se perdió.');
  });

  it('crossing the bridge: arrow keys move the player, a crab patrols', () => {
    const crab = blocks('c');
    const bridge: RealtimeLevel = {
      id: 'ch6-bridge',
      world: 'realtime',
      arena: {
        width: 7,
        height: 3,
        tiles: [0, 1, 2, 3, 4, 5, 6].flatMap((x) => [
          { x, y: 0, tile: 'water' },
          { x, y: 2, tile: 'water' },
        ]),
      },
      player: { x: 0, y: 1 },
      actors: [{ kind: 'crab', x: 3, y: 0, facing: 'S' }],
      kinds: { crab: { script: crab.program([], [], [crab.on({ type: 'tick' }, crab.ifElse(crab.sensor('canMoveForward'), [crab.cmd('forward')], [crab.cmd('turnAround')]))]) } },
      keys: ['left', 'right'],
      win: { type: 'reach', edge: 'E' },
      lose: { type: 'touch', kind: 'crab' },
      maxTicks: 40,
      trials: [
        { name: 'go at once', hold: ['right'], expect: 'win' },
        { name: 'go one tick late', inputs: [[], ...Array.from({ length: 10 }, () => ['right'])], expect: 'lose' },
        { name: 'stay', expect: 'timeout' },
      ],
      toolbox: { commands: ['move'], events: ['key'] },
    };
    const b = blocks();
    const program = b.program([], [], [b.on({ type: 'key', key: 'right' }, b.cmd('move', 'E')), b.on({ type: 'key', key: 'left' }, b.cmd('move', 'W'))]);
    const r = check(bridge, program);
    expect(r.cases.map((c) => c.passed)).toEqual([true, true, true]);
    expect(countBlocks(program)).toBe(2);
    expect(countBlocks(program, 'all')).toBe(4);
  });
});
