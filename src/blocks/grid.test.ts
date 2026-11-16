import { describe, expect, it } from 'vitest';
import { blocks } from './build.js';
import { applyGridEvent, boardFromRows, cellAt, cloneGridState, createGridState, runGrid, type CustomAction, type GridBoard } from './grid.js';
import { labelsFor, type GridLevel } from './level.js';
import { Rng } from './rng.js';
import { generateBoard, generateBoards } from './variants.js';

const labels = labelsFor({ id: 'x', world: 'grid', board: { width: 1, height: 1, robot: { x: 0, y: 0 } }, goal: { type: 'noItem', item: 'lamp' }, toolbox: { commands: [] } });

describe('grid world', () => {
  it('uses screen coordinates: N is up (y - 1), negatives count from the far side', () => {
    const b = blocks();
    const r = runGrid({ width: 3, height: 3, robot: { x: -1, y: -1 } }, b.program([b.cmd('move', 'N'), b.cmd('move', 'W')]), { labels });
    expect(r.initial.robot).toMatchObject({ x: 2, y: 2 });
    expect(r.final.robot).toMatchObject({ x: 1, y: 1 });
    expect(r.steps[0]!.events[0]).toEqual({ type: 'moved', from: [2, 2], to: [2, 1], dir: 'N' });
  });

  it('builds boards from text rows, top row first', () => {
    const board = boardFromRows(['R.L', '~~L'], { R: { robot: 'E' }, L: { items: { lamp: 1 } }, '~': { wall: true, terrain: 'water' } });
    const s = createGridState(board);
    expect(s.robot).toEqual({ x: 0, y: 0, facing: 'E' });
    expect(cellAt(s, 2, 0)!.items).toEqual({ lamp: 1 });
    expect(cellAt(s, 0, 1)).toMatchObject({ wall: true, terrain: 'water' });
  });

  it('stops at walls, water and edges with a message about why', () => {
    const b = blocks();
    const board = boardFromRows(['R~', '..'], { R: { robot: 'E' }, '~': { wall: true, terrain: 'water' } }, { walls: [{ x: 0, y: 1, side: 'E' }] });
    const water = runGrid(board, b.program([b.cmd('move', 'E')]), { labels });
    expect(water.error!.message).toBe('¡Hay agua! No puedo moverme →.');
    const edge = runGrid(board, b.program([b.cmd('move', 'N')]), { labels });
    expect(edge.error!.message).toBe('¡Me caigo del tablero! No puedo moverme ↑.');
    const wall = runGrid(board, b.program([b.cmd('move', 'S'), b.cmd('move', 'E')]), { labels });
    expect(wall.error!.message).toBe('¡Hay una pared! No puedo moverme →.');
    expect(wall.final.robot).toMatchObject({ x: 0, y: 1 });
  });

  it('turns and moves forward', () => {
    const b = blocks();
    const r = runGrid({ width: 3, height: 3, robot: { x: 1, y: 1, facing: 'N' } }, b.program([b.cmd('turnRight'), b.cmd('forward'), b.cmd('turnLeft'), b.cmd('turnLeft')]));
    expect(r.final.robot).toEqual({ x: 2, y: 1, facing: 'W' });
  });

  it('lights lamps, paints, picks and drops, with item changes in the events', () => {
    const b = blocks();
    const board: GridBoard = { width: 2, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: 0, y: 0, items: { lamp: 1, apple: 2 } }] };
    const r = runGrid(board, b.program([b.cmd('lightLamp'), b.cmd('pick', 'apple'), b.cmd('paint', 'red'), b.cmd('move', 'E'), b.cmd('drop', 'apple'), b.cmd('toggleLamp')]), { labels });
    expect(r.error!.code).toBe('noLamp');
    expect(cellAt(r.final, 0, 0)).toMatchObject({ items: { lampOn: 1, apple: 1 }, color: 'red' });
    expect(cellAt(r.final, 1, 0)!.items).toEqual({ apple: 1 });
    expect(r.final.inventory).toEqual({});
    expect(r.steps[1]!.events[0]).toMatchObject({ type: 'picked', changes: [{ where: 'cell', item: 'apple', before: 2, after: 1 }, { where: 'inventory', item: 'apple', before: 0, after: 1 }] });
  });

  it('fails clearly on missing items and full hands', () => {
    const b = blocks();
    const board: GridBoard = { width: 1, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: 0, y: 0, items: { wood: 2 } }], capacity: 1 };
    expect(runGrid(board, b.program([b.cmd('pick', 'cheese')]), { labels }).error!.message).toBe('Acá no hay queso.');
    expect(runGrid(board, b.program([b.cmd('drop', 'rope')]), { labels }).error!.message).toBe('No llevo soga para dejar.');
    expect(runGrid(board, b.program([b.cmd('pick', 'wood'), b.cmd('pick', 'wood')]), { labels }).error!.code).toBe('inventoryFull');
  });

  it('answers sensors', () => {
    const b = blocks();
    const board: GridBoard = {
      width: 5,
      height: 3,
      robot: { x: 1, y: 1, facing: 'S' },
      cells: [
        { x: 1, y: 1, items: { apple: 2 }, arrow: 'E', color: 'blue', terrain: 'grass' },
        { x: 4, y: 1, wall: true },
        { x: 1, y: 2, items: { star: 1 } },
      ],
      inventory: { key: 1 },
    };
    const sensors: Array<[string, unknown[], unknown]> = [
      ['itemHere', ['apple'], true],
      ['countHere', ['apple'], 2],
      ['canMove', ['W'], true],
      ['canMoveForward', [], true],
      ['atEdge', ['N'], false],
      ['hasArrow', [], true],
      ['arrowHere', [], 'E'],
      ['arrowIs', ['S'], false],
      ['colorHere', [], 'blue'],
      ['colorIs', ['blue'], true],
      ['hasItem', ['key'], true],
      ['inventoryCount', ['key'], 1],
      ['facing', [], 'S'],
      ['posX', [], 1],
      ['posY', [], 1],
      ['boardWidth', [], 5],
      ['boardHeight', [], 3],
      ['distanceToEdge', ['E'], 3],
      ['distanceToEdge', ['N'], 1],
      ['freeCells', ['E'], 2],
      ['stepsTo', ['star', 'S'], 1],
      ['stepsTo', ['star', 'N'], -1],
      ['terrainIs', ['grass'], true],
    ];
    for (const [name, args, want] of sensors) {
      const r = runGrid(board, b.program([b.cmd('say', b.sensor(name, ...(args as string[])))]), { labels });
      expect([name, r.final.said[0]]).toEqual([name, want]);
    }
  });

  it('replays a trace from the events to the same final state', () => {
    const b = blocks();
    const board: GridBoard = { width: 3, height: 2, robot: { x: 0, y: 0 }, cells: [{ x: 1, y: 0, items: { lamp: 1, apple: 1 }, hidden: { gem: 1 } }] };
    const actions: CustomAction[] = [{ name: 'dig', reveal: true, addInventory: { mud: 1 }, paint: 'brown', say: 'listo', goTo: { x: 0 } }];
    const program = b.program([b.cmd('move', 'E'), b.cmd('lightLamp'), b.cmd('pick', 'apple'), b.cmd('dig'), b.cmd('move', 'S'), b.cmd('paint', 'red'), b.cmd('say', 3)]);
    const r = runGrid(board, program, { actions, snapshots: true });
    expect(r.status).toBe('done');
    const replay = cloneGridState(r.initial);
    r.steps.forEach((s, i) => {
      for (const e of s.events) applyGridEvent(replay, e);
      expect(replay).toEqual(r.snapshots![i]);
    });
    expect(replay).toEqual(r.final);
    expect(cellAt(r.final, 1, 0)!.items).toEqual({ lampOn: 1, gem: 1 });
    expect(r.final.robot).toMatchObject({ x: 0, y: 1 });
  });
});

describe('custom actions', () => {
  const b = blocks();
  it('jump, go back to the edge, eat, count and drop everything', () => {
    const board: GridBoard = { width: 4, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: 2, y: 0, items: { apple: 1 } }, { x: 3, y: 0, items: { boat: 1 } }] };
    const actions: CustomAction[] = [
      { name: 'jump', move: 'E' },
      { name: 'backToEdge', goTo: { x: 0 } },
      { name: 'countApple', requireHere: { apple: 1 }, addInventory: { appleCount: 1 } },
      { name: 'eatApple', consumeHere: { apple: 1 } },
      { name: 'leave', dropAll: true, failMessage: 'No llevo nada.' },
    ];
    const r = runGrid(board, b.program([b.cmd('jump'), b.cmd('jump'), b.cmd('countApple'), b.cmd('eatApple'), b.cmd('jump'), b.cmd('leave'), b.cmd('backToEdge')]), { actions, labels });
    expect(r.status).toBe('done');
    expect(r.final.robot.x).toBe(0);
    expect(cellAt(r.final, 3, 0)!.items).toEqual({ boat: 1, appleCount: 1 });
    expect(cellAt(r.final, 2, 0)!.items).toEqual({});
    const more = runGrid(board, b.program([b.cmd('leave')]), { actions, labels: labelsFor({ id: 'l', world: 'grid', board, actions, goal: { type: 'noItem', item: 'x' }, toolbox: { commands: [] } }) });
    expect(more.error!.message).toBe('No llevo nada.');
    expect(runGrid(board, b.program([b.cmd('jump'), b.cmd('jump'), b.cmd('jump'), b.cmd('jump')]), { actions, labels }).error!.code).toBe('outOfBoard');
  });

  it('state flags in the inventory make a scene: lie down, close eyes, open eyes, get up', () => {
    const board: GridBoard = { width: 2, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: 1, y: 0, items: { hammock: 1 } }] };
    const actions: CustomAction[] = [
      { name: 'walk', goTo: { x: 1 } },
      { name: 'lieDown', requireHere: { hammock: 1 }, forbidInventory: ['lying'], addInventory: { lying: 1 } },
      { name: 'closeEyes', requireInventory: { lying: 1 }, forbidInventory: ['asleep'], addInventory: { asleep: 1 } },
      { name: 'openEyes', consumeInventory: { asleep: 1 } },
      { name: 'getUp', consumeInventory: { lying: 1 }, forbidInventory: ['asleep'] },
    ];
    const ok = runGrid(board, b.program([b.cmd('walk'), b.cmd('lieDown'), b.cmd('closeEyes'), b.cmd('openEyes'), b.cmd('getUp')]), { actions, labels });
    expect(ok.status).toBe('done');
    expect(ok.final.inventory).toEqual({});
    const asleep = runGrid(board, b.program([b.cmd('walk'), b.cmd('lieDown'), b.cmd('closeEyes'), b.cmd('getUp')]), { actions, labels });
    expect(asleep.error).toMatchObject({ code: 'actionFailed', params: { item: 'asleep' } });
    expect(runGrid(board, b.program([b.cmd('lieDown')]), { actions, labels }).error!.params.item).toBe('hammock');
  });

  it('cycles through a 16-color lamp wheel', () => {
    const wheel = Array.from({ length: 16 }, (_, i) => `lamp${i}`);
    const board: GridBoard = { width: 1, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: 0, y: 0, items: { lamp0: 1 } }] };
    const r = runGrid(board, b.program([b.repeat(18, b.cmd('nextColor'))]), { actions: [{ name: 'nextColor', cycle: wheel }] });
    expect(cellAt(r.final, 0, 0)!.items).toEqual({ lamp2: 1 });
  });

  it('refuses actions named like built-ins', () => {
    expect(() => runGrid({ width: 1, height: 1, robot: { x: 0, y: 0 } }, b.program([]), { actions: [{ name: 'move' }] })).toThrow();
  });
});

describe('board variants', () => {
  const base: GridBoard = { width: 4, height: 1, robot: { x: 0, y: 0 }, cells: [{ x: -1, y: 0, items: { flag: 1 } }] };

  it('are the same for the same seed and change with it', () => {
    const gen = { seed: 9, count: 5, rules: [{ type: 'size' as const, width: [3, 12] as [number, number] }, { type: 'scatter' as const, item: 'lamp', chance: 0.5 }] };
    expect(generateBoards(base, gen)).toEqual(generateBoards(base, gen));
    expect(generateBoards(base, gen)).not.toEqual(generateBoards(base, { ...gen, seed: 10 }));
    for (const b of generateBoards(base, gen)) {
      expect(b.cells!.find((c) => c.items?.flag)!.x).toBe(b.width - 1);
    }
  });

  it('place, stack, choose, fill a border and place the robot', () => {
    const rng = new Rng(4);
    const b = generateBoard({ width: 7, height: 5, robot: { x: 0, y: 0 } }, [
      { type: 'fill', region: { x0: 0, y0: 0, x1: -1, y1: -1 }, border: true, content: { items: { pc: 1 } } },
      { type: 'fill', region: { x0: 1, y0: 1, x1: -2, y1: -2 }, content: { wall: true } },
      { type: 'place', item: 'gift', count: [2, 2], region: { x0: 0, y0: 0, x1: -1, y1: -1 } },
      { type: 'stack', x: 0, y: 0, item: 'banana', count: [3, 3] },
      { type: 'robot', x: [0, -1], facing: ['S'] },
    ], rng);
    const s = createGridState(b);
    expect(s.cells.filter((c) => c.items.pc).length).toBe(20);
    expect(s.cells.filter((c) => c.wall).length).toBe(15);
    expect(s.cells.filter((c) => c.items.gift).length).toBe(2);
    expect(s.cells.every((c) => !(c.wall && c.items.gift))).toBe(true);
    expect(cellAt(s, 0, 0)!.items.banana).toBe(3);
    expect(s.robot.facing).toBe('S');
  });

  it('a random arrow path with water around and a flag at the end', () => {
    const b = generateBoard({ width: 1, height: 1, robot: { x: 0, y: 0 } }, [{ type: 'path', length: [20, 20], dirs: ['S', 'E'] }], new Rng(1));
    const s = createGridState(b);
    expect(b.width + b.height).toBe(22);
    let { x, y } = s.robot;
    for (let i = 0; i < 20; i++) {
      const c = cellAt(s, x, y)!;
      expect(c.wall).toBe(false);
      if (c.arrow === 'S') y++;
      else x++;
    }
    expect(cellAt(s, x, y)!.items.flag).toBe(1);
    expect(s.cells.filter((c) => !c.wall).length).toBe(21);
  });

  it('rows of random length with a start column and a way down only there', () => {
    const b = generateBoard({ width: 1, height: 1, robot: { x: 0, y: 0 } }, [
      { type: 'rows', count: 6, length: [2, 8], start: { items: { start: 1 } }, last: [{ items: { ball: 1 } }], downOnlyAtStart: true },
    ], new Rng(3));
    const s = createGridState(b);
    expect(s.height).toBe(6);
    for (let y = 0; y < 6; y++) {
      expect(cellAt(s, 0, y)!.items.start).toBe(1);
      const len = [...Array(s.width).keys()].filter((x) => !cellAt(s, x, y)!.wall).length - 1;
      expect(len).toBeGreaterThanOrEqual(2);
      expect(cellAt(s, len, y)!.items.ball).toBe(1);
    }
    const level: GridLevel = { id: 'r', world: 'grid', board: b, goal: { type: 'noItem', item: 'ball' }, toolbox: { commands: [] } };
    const bb = blocks();
    const r = runGrid(level.board, bb.program([bb.cmd('move', 'E'), bb.cmd('move', 'S')]), { labels });
    expect(r.error!.code).toBe('wall');
  });
});
