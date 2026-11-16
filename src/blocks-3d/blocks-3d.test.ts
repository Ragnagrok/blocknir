import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { blocks, boardFromRows, runGrid, runTurtle, type GridEvent, type TraceStep } from '../blocks/index.js';
import { defaultCatalogue, defaultSkin } from './default-skin.js';
import { boardBounds, corners, frameBox, pitchFor, project, widen } from './framing.js';
import { layoutCell } from './layout.js';
import { actorOf, colorOf, extendSkin, itemContext, resolveName, terrainOf } from './skin.js';
import { StepShow } from './stage.js';
import { DEFAULT_TIMING, gridStepDuration, parseSpeed, Playhead, turtleStepDuration } from './timeline.js';

const b = blocks();

/** Every corner of the box projects inside the viewport (normalized device coordinates). */
function fits(width: number, height: number, aspect: number, fov = 36): { maxX: number; maxY: number } {
  const box = boardBounds(width, height);
  const f = frameBox(box, { fov, aspect });
  const t = Math.tan((fov * Math.PI) / 360);
  let maxX = 0;
  let maxY = 0;
  // Tiny boards are widened to 3 m so they do not look huge: measure that box.
  for (const c of corners(widen(box, 3))) {
    const q = project(c, f.position, f.pitch);
    expect(q.depth).toBeGreaterThan(0);
    maxX = Math.max(maxX, Math.abs(q.x / (t * aspect)));
    maxY = Math.max(maxY, Math.abs(q.y / t));
  }
  return { maxX, maxY };
}

describe('framing', () => {
  it('fits every board from 1×5 to 12×10 on laptops and phones, touching one side', () => {
    for (const [w, h] of [[5, 1], [1, 5], [4, 1], [7, 4], [12, 10], [10, 12], [3, 3]] as const) {
      for (const aspect of [1280 / 800, 390 / 664, 1, 2.2]) {
        const { maxX, maxY } = fits(w, h, aspect);
        expect(maxX).toBeLessThanOrEqual(1.0001);
        expect(maxY).toBeLessThanOrEqual(1.0001);
        // Not wastefully far: some side reaches the margin (default 6 %).
        expect(Math.max(maxX, maxY)).toBeGreaterThan(0.85);
      }
    }
  });

  it('centers the board on screen', () => {
    const box = boardBounds(7, 4);
    const f = frameBox(box, { fov: 36, aspect: 1.6 });
    const pts = corners(box).map((c) => project(c, f.position, f.pitch));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 4);
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 4);
  });

  it('looks more from above on tall phone screens', () => {
    expect(pitchFor(0.46)).toBeGreaterThan(pitchFor(1.6));
    expect(pitchFor(1.6)).toBeGreaterThanOrEqual(50);
    expect(pitchFor(0.3)).toBeLessThanOrEqual(66);
  });
});

describe('timeline', () => {
  const board = boardFromRows(['R.L.'], { R: { robot: 'E' }, L: { items: { lamp: 1 } }, '.': {} });
  const run = runGrid(board, b.program([b.repeat(3, b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'lamp'), b.cmd('lightLamp')))]));

  it('gives each kind of step its time', () => {
    const kinds = run.steps.map((s) => [s.kind, gridStepDuration(s)]);
    expect(kinds[0]).toEqual(['repeat', DEFAULT_TIMING.control]);
    const moves = run.steps.filter((s) => s.events.some((e) => e.type === 'moved'));
    expect(moves.every((s) => gridStepDuration(s) === DEFAULT_TIMING.move)).toBe(true);
    const lit = run.steps.find((s) => s.events.some((e) => e.type === 'lit'))!;
    expect(gridStepDuration(lit)).toBe(DEFAULT_TIMING.light);
    const jump: TraceStep<GridEvent> = { index: 0, node: 'x', kind: 'command', stack: [], events: [{ type: 'moved', from: [0, 0], to: [3, 0], dir: null }] };
    expect(gridStepDuration(jump)).toBe(DEFAULT_TIMING.jump);
  });

  it('turtle steps take longer for longer lines and bigger turns, within limits', () => {
    const t = runTurtle({}, b.program([b.cmd('forward', 10), b.cmd('forward', 200), b.cmd('turnRight', 30), b.cmd('turnRight', 180)]));
    const [short, long, small, half] = t.steps.map((s) => turtleStepDuration(s, 0.05));
    expect(long!).toBeGreaterThan(short!);
    expect(half!).toBeGreaterThan(small!);
    expect(long!).toBeLessThanOrEqual(1.6);
  });

  it('plays begins and ends in order, at any speed, and instantly', () => {
    const d = run.steps.map((s) => gridStepDuration(s));
    const total = d.reduce((a, x) => a + x, 0);
    const p = new Playhead(d);
    p.play();
    const seen: string[] = [];
    let time = 0;
    while (p.state === 'playing' && time < 100) {
      for (const t of p.advance(1 / 60, 2)) seen.push(t.type === 'done' ? 'done' : `${t.type}${t.index}`);
      time += 1 / 60;
    }
    expect(seen[0]).toBe('begin0');
    expect(seen[seen.length - 1]).toBe('done');
    expect(seen.filter((s) => s.startsWith('end')).length).toBe(d.length);
    expect(time).toBeCloseTo(total / 2, 1);
    const q = new Playhead(d);
    q.play();
    const all = q.advance(0, Infinity);
    expect(all.filter((t) => t.type === 'end').length).toBe(d.length);
    expect(q.state).toBe('done');
  });

  it('step() plays exactly one step and pauses, pause() stops mid-step', () => {
    const p = new Playhead([0.5, 0.5, 0.5]);
    p.step();
    const a = p.advance(10, 1);
    expect(a.map((t) => t.type)).toEqual(['begin', 'end']);
    expect(p.state).toBe('paused');
    p.play();
    p.advance(0.25, 1);
    p.pause();
    expect(p.advance(1, 1)).toEqual([]);
    expect(p.index).toBe(1);
    expect(p.progress).toBeCloseTo(0.5);
    p.step();
    expect(p.advance(10, 1).map((t) => t.type)).toEqual(['end']);
    expect(p.remaining()).toBeCloseTo(0.5);
  });

  it('reads speeds', () => {
    expect(parseSpeed('instant')).toBe(Infinity);
    expect(parseSpeed(0.5)).toBe(0.5);
    expect(parseSpeed(100)).toBe(16);
    expect(parseSpeed(-1, 2)).toBe(2);
  });

  it('a step show finishes every beat once, in order, even when skipped', () => {
    const log: string[] = [];
    const beat = (n: string, w: number) => ({ weight: w, start: () => log.push(`s${n}`), update: (t: number) => log.push(`u${n}:${t.toFixed(2)}`), finish: () => log.push(`f${n}`) });
    const s = new StepShow([beat('a', 1), beat('b', 3)]);
    s.run(0.1);
    s.run(0.5);
    s.end();
    s.end();
    expect(log).toEqual(['sa', 'ua:0.40', 'ua:1.00', 'fa', 'sb', 'ub:0.33', 'ub:1.00', 'fb']);
    const skipped: string[] = [];
    new StepShow([{ weight: 1, finish: () => skipped.push('x') }, { weight: 1, finish: () => skipped.push('y') }]).end();
    expect(skipped).toEqual(['x', 'y']);
  });
});

describe('skins', () => {
  const has = (keys: string[]) => (k: string) => keys.includes(k);

  it('resolves decorated names', () => {
    const keys = ['lamp', 'computer', 'apple', 'text', 'box', 'lens'];
    const aliases = { pc: 'computer' };
    expect(resolveName('lampOn', has(keys), aliases)).toMatchObject({ key: 'lamp', state: 'on' });
    expect(resolveName('pcOff', has(keys), aliases)).toMatchObject({ key: 'computer', state: 'off' });
    expect(resolveName('lamp7', has(keys), aliases)).toMatchObject({ key: 'lamp', index: 7 });
    expect(resolveName('textA', has(keys), aliases)).toMatchObject({ key: 'text', letter: 'A' });
    expect(resolveName('apples', has(keys), aliases)).toMatchObject({ key: 'apple' });
    expect(resolveName('boxes', has(keys), aliases)).toMatchObject({ key: 'box' });
    expect(resolveName('bigApple', has(keys), aliases)).toMatchObject({ key: 'apple' });
    expect(resolveName('lensPlaced', has(keys), aliases)).toMatchObject({ key: 'lens' });
    expect(resolveName('Apple', has(keys), aliases)).toMatchObject({ key: 'apple' });
    expect(resolveName('moon', has(keys), aliases).key).toBeNull();
    expect(resolveName('bacon', has(keys), aliases).key).toBeNull();
  });

  it('has a model for every common item, and a labeled marker for the rest', () => {
    const skin = defaultSkin();
    for (const name of ['lamp', 'lampOn', 'apple', 'banana', 'orange', 'star', 'cheese', 'computer', 'pcOn', 'flag', 'fish', 'food', 'key', 'chest', 'coin', 'textA', 'lamp3', 'manzana', 'farol']) {
      expect(itemContext(skin, name).fallback, name).toBe(false);
    }
    const unknown = itemContext(skin, 'telescope', 'telescopio');
    expect(unknown.fallback).toBe(true);
    expect(unknown.ctx.label).toBe('telescopio');
    expect(unknown.def.pile).toBe('single');
  });

  it('lamps glow only when lit', () => {
    const skin = defaultSkin();
    const off = itemContext(skin, 'lamp');
    const on = itemContext(skin, 'lampOn');
    const glow = (x: typeof on) => (typeof x.def.glow === 'function' ? x.def.glow(x.ctx) : x.def.glow);
    expect(glow(off)).toBeNull();
    expect(glow(on)).toMatchObject({ height: expect.any(Number) });
  });

  it('terrain, actors and colors fall back to something drawable', () => {
    const skin = defaultSkin();
    expect(terrainOf(skin, 'river').key).toBe('water');
    expect(terrainOf(skin, 'lava').key).toBe(skin.defaultTerrain);
    expect(terrainOf(skin, null).key).toBe(skin.defaultTerrain);
    expect(actorOf(skin, 'gull', null).source).toBe('actor');
    expect(actorOf(skin, 'apple', null).source).toBe('item');
    expect(actorOf(skin, 'dragon', null).source).toBe('fallback');
    expect(colorOf(skin, 'rojo')).toBe(colorOf(skin, 'red'));
    expect(colorOf(skin, '#123456')).toBe(0x123456);
    expect(colorOf(skin, 'chartreuse')).toBe(colorOf(skin, 'chartreuse'));
  });

  it('extends a skin per name with shorthands', () => {
    const mine = new THREE.Group();
    const skin = extendSkin(defaultSkin, {
      items: { apple: () => mine, telescope: { create: () => new THREE.Group(), pile: 'stack' } },
      actors: { dragon: () => new THREE.Group() },
      aliases: { catalejo: 'telescope' },
      character: { grid: 'robotBlue' },
      environment: { sky: 0x000000 },
    });
    const apple = itemContext(skin, 'apple');
    expect(apple.def.create(apple.ctx)).toBe(mine);
    expect(itemContext(skin, 'catalejo').def.pile).toBe('stack');
    expect(itemContext(skin, 'banana').fallback).toBe(false);
    expect(actorOf(skin, 'dragon', null).source).toBe('actor');
    expect(skin.character).toEqual({ grid: 'robotBlue', turtle: 'turtle', realtime: 'kid' });
    expect(skin.environment.sky).toBe(0);
    expect(skin.environment.sand).toBe(defaultSkin().environment.sand);
  });

  it('lists its catalogue', () => {
    const c = defaultCatalogue();
    expect(c.items).toEqual(expect.arrayContaining(['lamp', 'apple', 'banana', 'orange', 'star', 'cheese', 'computer', 'flag', 'fish', 'food']));
    expect(c.terrain).toEqual(expect.arrayContaining(['grass', 'path', 'water', 'rock', 'sand']));
    expect(c.characters).toEqual(expect.arrayContaining(['robot', 'turtle', 'kid']));
  });
});

describe('cell layout', () => {
  it('places names in stable slots, piles copies and badges counts', () => {
    const one = layoutCell([{ name: 'apple', count: 1 }]);
    expect(one.placements).toHaveLength(1);
    expect(one.badges).toHaveLength(0);
    const many = layoutCell([{ name: 'star', count: 12, pile: 'stack' }, { name: 'apple', count: 3 }]);
    expect(many.placements.filter((p) => p.name === 'apple')).toHaveLength(3);
    expect(many.placements.filter((p) => p.name === 'star').length).toBeLessThanOrEqual(5);
    expect(many.badges.map((x) => [x.name, x.count])).toEqual([['apple', 3], ['star', 12]]);
    const stars = many.placements.filter((p) => p.name === 'star').map((p) => p.y);
    expect([...stars].sort((a, c) => a - c)).toEqual(stars);
    const flipped = layoutCell([{ name: 'apple', count: 3 }, { name: 'star', count: 12, pile: 'stack' }]);
    expect(flipped).toEqual(many);
    expect(layoutCell([{ name: 'lamp', count: 0 }]).placements).toHaveLength(0);
  });
});
