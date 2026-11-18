import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { blocks, boardFromRows, runGrid, runTurtle, type GridEvent, type TraceStep } from '../blocks/index.js';
import { defaultCatalogue, defaultSkin } from './default-skin.js';
import type { Clip, Figure, Project } from '../core/index.js';
import { boardBounds, corners, distanceForPixels, followBox, frameBox, pitchFor, pixelsPerMeter, project, widen, type Framing, type Vec3 } from './framing.js';
import { cameraModeOf } from './board-view.js';
import * as M from './models.js';
import { figureCharacter } from './pieces.js';
import { layoutCell, roomFor } from './layout.js';
import { actorOf, colorOf, extendSkin, itemContext, mergeSkin, resolveName, terrainOf } from './skin.js';
import { Mover, StepShow } from './stage.js';
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

  it('steps items aside to the corners while the character stands on the cell', () => {
    const lamp = [{ name: 'lamp', count: 1, height: 1.3 }];
    const center = layoutCell(lamp).placements[0]!;
    expect([center.x, center.z]).toEqual([0, 0]);
    // On the cell, come in from the front (the camera side): the lamp goes to the back corner.
    const on = layoutCell(lamp, undefined, { k: 1, away: [0, -1] }).placements[0]!;
    expect(on.z).toBeLessThan(-0.3);
    expect(Math.abs(on.x)).toBeGreaterThan(0.3);
    expect(on.scale).toBeLessThan(center.scale);
    // Came in from the right: the lamp goes left.
    expect(layoutCell(lamp, undefined, { k: 1, away: [-1, 0] }).placements[0]!.x).toBeLessThan(-0.3);
    // Half way: half way.
    const half = layoutCell(lamp, undefined, { k: 0.5, away: [0, -1] }).placements[0]!;
    expect(half.z).toBeCloseTo(on.z / 2);
    // Two items: both corners of the far side.
    const two = layoutCell([{ name: 'a', count: 1 }, { name: 'b', count: 1 }], undefined, { k: 1, away: [0, 1] }).placements;
    expect(two.every((p) => p.z > 0.3)).toBe(true);
    expect(two[0]!.x).toBeCloseTo(-two[1]!.x);
    // A hammock the character lies in stays put.
    const hammock = layoutCell([{ name: 'hammock', count: 1, stay: true }], undefined, { k: 1, away: [0, -1] }).placements[0]!;
    expect([hammock.x, hammock.z, hammock.scale]).toEqual([center.x, center.z, center.scale]);
  });

  it('makes room as a character comes near, away from where it comes in, and keeps the side', () => {
    expect(roomFor(1, 0)).toBeUndefined();
    expect(roomFor(0, 0)).toEqual({ k: 1, away: [0, -1] });
    // Coming in from the right (x > 0): the items go left.
    const near = roomFor(0.7, 0.1)!;
    expect(near.away).toEqual([-1, 0]);
    expect(near.k).toBeGreaterThan(0);
    expect(near.k).toBeLessThan(1);
    // The side chosen first is kept while the character walks on across the cell.
    expect(roomFor(-0.3, 0, near.away)!.away).toEqual([-1, 0]);
    expect(roomFor(0.2, 0)!.k).toBe(1);
  });
});

describe('follow camera', () => {
  const fov = 36;
  const phone = { w: 390, h: 844 };
  const desk = { w: 1280, h: 800 };
  const ndc = (p: Vec3, f: Framing, aspect: number): { x: number; y: number } => {
    const q = project(p, f.position, f.pitch);
    const t = Math.tan((fov * Math.PI) / 360);
    return { x: q.x / (t * aspect), y: q.y / t };
  };

  it('a 30 × 1 row is too small to read whole on a phone, but not a 7 × 4 board', () => {
    const aspect = phone.w / phone.h;
    const row = frameBox(boardBounds(30, 1), { fov, aspect, margin: 0.03 });
    expect(pixelsPerMeter(row.distance, fov, phone.h)).toBeLessThan(28);
    const small = frameBox(boardBounds(7, 4), { fov, aspect, margin: 0.03 });
    expect(pixelsPerMeter(small.distance, fov, phone.h)).toBeGreaterThan(28);
    expect(distanceForPixels(pixelsPerMeter(12, fov, 800), fov, 800)).toBeCloseTo(12, 6);
  });

  it('follows the character along a 30 × 1 row, clamped to the ends, at the asked zoom', () => {
    for (const vp of [phone, desk]) {
      const aspect = vp.w / vp.h;
      const box = boardBounds(30, 1);
      const o = { fov, aspect, margin: 0.03, viewportHeight: vp.h, cellPx: 56 };
      const at = (x: number): Framing => followBox(box, [x, 0, 0], o);
      const start = at(-14.5);
      expect(pixelsPerMeter(start.distance, fov, vp.h)).toBeCloseTo(56, 3);
      // At the start the left end of the board touches the left edge of the screen, not beyond.
      expect(ndc([box.min[0], 0, 0], start, aspect).x).toBeCloseTo(-1, 1);
      // In the middle the character is in the middle of the screen.
      const mid = at(0.5);
      expect(Math.abs(ndc([0.5, 0.35, 0], mid, aspect).x)).toBeLessThan(0.02);
      // At the end the right end touches the right edge.
      const end = at(14.5);
      expect(ndc([box.max[0], 0, 0], end, aspect).x).toBeCloseTo(1, 1);
      // The single row stays centered vertically.
      expect(start.target[2]).toBeCloseTo(mid.target[2], 6);
      expect(Math.abs(ndc([0, 0, 0], mid, aspect).y)).toBeLessThan(0.15);
    }
  });

  it('pans over both axes of a big maze and never shows past its far and near sides', () => {
    const aspect = phone.w / phone.h;
    const box = boardBounds(20, 20);
    const o = { fov, aspect, margin: 0.03, viewportHeight: phone.h, cellPx: 56 };
    const corner = followBox(box, [-9.5, 0, -9.5], o);
    expect(ndc([corner.target[0], 0, box.min[2]], corner, aspect).y).toBeLessThanOrEqual(1.0001);
    expect(ndc([corner.target[0], 0, box.min[2]], corner, aspect).y).toBeGreaterThan(0.9);
    const other = followBox(box, [9.5, 0, 9.5], o);
    expect(ndc([other.target[0], 0, box.max[2]], other, aspect).y).toBeGreaterThanOrEqual(-1.0001);
    expect(ndc([other.target[0], 0, box.max[2]], other, aspect).y).toBeLessThan(-0.9);
  });

  it('is the full framing when the whole board already fits at that zoom', () => {
    const aspect = desk.w / desk.h;
    const box = boardBounds(5, 3);
    const full = frameBox(box, { fov, aspect, margin: 0.03 });
    expect(followBox(box, [2, 0, 1], { fov, aspect, margin: 0.03, viewportHeight: desk.h, cellPx: 56, full })).toBe(full);
  });

  it('reads the camera from level meta, in English or Spanish', () => {
    expect(cameraModeOf({ camera: 'follow' })).toBe('follow');
    expect(cameraModeOf({ camara: 'sigue' })).toBe('follow');
    expect(cameraModeOf({ camara: 'fija' })).toBe('frame');
    expect(cameraModeOf({ camera: 'frame', camara: 'sigue' })).toBe('frame');
    expect(cameraModeOf({ camara: 'rara' })).toBeNull();
    expect(cameraModeOf(undefined)).toBeNull();
  });
});

describe('action clips', () => {
  const apple = M.appleModel();
  const clip = (name: string, x: number): Clip => ({ name, duration: 1, loop: true, keys: [{ t: 0, rot: { body: [x, 0, 0] } }] });
  const figure = (clips: Clip[]): Figure => ({ id: 'f', name: 'f', parts: [{ id: 'body', model: apple.id, parent: null, pivot: [0, 0, 0], origin: [0, 0, 0] }], clips });
  const project = (f: Figure): Project => ({ version: 1, name: 't', startScene: '', models: [apple], figures: [f], scenes: [] });
  const angle = (v: ReturnType<typeof figureCharacter>): number => v.figure.joints.get('body')!.rotation.x;

  it('a figure plays its own clip for a level action, and the generic action clip otherwise', () => {
    const f = figure([clip('idle', 0), clip('action', 1), clip('chew', 2), clip('sing', 3)]);
    const v = figureCharacter(project(f), f, { height: 1, actions: { eatApple: 'chew' } });
    v.pose('action', 0, { action: 'eatApple' });
    expect(angle(v)).toBeCloseTo(2);
    v.pose('action', 0, { action: 'sing' });
    expect(angle(v)).toBeCloseTo(3);
    v.pose('action', 0, { action: 'kick' });
    expect(angle(v)).toBeCloseTo(1);
    v.pose('action', 0);
    expect(angle(v)).toBeCloseTo(1);
  });

  it('the mover hands the action to the character while the clip lasts', () => {
    const calls: Array<[string, string | undefined]> = [];
    const m = new Mover({ object: new THREE.Group(), height: 1, pose: (c, _t, info) => calls.push([c, info?.action]) });
    m.once('action', 0.5, 'idle', { action: 'wave' });
    m.update(0.1);
    m.update(0.5);
    expect(calls).toEqual([
      ['action', 'wave'],
      ['idle', undefined],
    ]);
  });

  it('a lasting pose holds between actions while the robot carries its item', () => {
    const f = figure([clip('idle', 0), clip('lying', 4), clip('asleep', 5)]);
    const v = figureCharacter(project(f), f, { height: 1, rest: { lying: 'lying', asleep: 'asleep' } });
    v.pose('idle', 0, { inventory: { lying: 1 } });
    expect(angle(v)).toBeCloseTo(4);
    v.pose('idle', 0, { inventory: { lying: 1, asleep: 1 } });
    expect(angle(v)).toBeCloseTo(5);
    // Cheering when the level passes keeps the lasting pose (it won asleep in the hammock).
    v.pose('cheer', 0, { inventory: { lying: 1, asleep: 1 } });
    expect(angle(v)).toBeCloseTo(5);
    v.pose('idle', 0, { inventory: { lying: 0 } });
    expect(angle(v)).toBeCloseTo(0);
    const seen: Array<Record<string, number> | undefined> = [];
    const m = new Mover({ object: new THREE.Group(), height: 1, pose: (_c, _t, info) => seen.push(info?.inventory as Record<string, number> | undefined) });
    m.rest = { inventory: { lying: 1 } };
    m.once('action', 0.5, 'idle', { action: 'closeEyes' });
    m.update(0.1);
    m.update(0.5);
    expect(seen).toEqual([{ lying: 1 }, { lying: 1 }]);
  });

  it('a new clip blends in from the pose on screen instead of snapping', () => {
    const root = new THREE.Group();
    const arm = new THREE.Object3D();
    root.add(arm);
    const m = new Mover({ object: root, height: 1, pose: (c) => {
      arm.position.x = c === 'walk' ? 1 : 0;
      arm.rotation.z = c === 'walk' ? 1 : 0;
    } });
    m.update(0.1);
    expect(arm.position.x).toBe(0);
    m.play('walk');
    m.update(m.blend / 2);
    expect(arm.position.x).toBeCloseTo(0.5, 5);
    expect(arm.rotation.z).toBeCloseTo(0.5, 2);
    m.update(m.blend);
    expect(arm.position.x).toBe(1);
    // A one-shot clip that ends blends back too.
    m.once('idle', 0.2, 'walk');
    m.update(0.01);
    expect(arm.position.x).toBeGreaterThan(0.9);
    m.update(0.5);
    m.update(0.5);
    expect(arm.position.x).toBe(1);
    // After a cut (a reset), the next pose shows at once.
    m.play('idle', true);
    m.cut();
    m.update(0.01);
    expect(arm.position.x).toBe(0);
  });
});

describe('skin tables', () => {
  it('extendSkin removes names with null and replaces whole tables', () => {
    const mine = new THREE.Group();
    const skin = extendSkin(defaultSkin, { items: { apple: null, rock: () => mine }, colors: { red: null }, replace: ['actors'], actors: { bird: () => new THREE.Group() } });
    expect(itemContext(skin, 'apple').fallback).toBe(true);
    expect(itemContext(skin, 'banana').fallback).toBe(false);
    expect(Object.keys(skin.actors)).toEqual(['bird']);
    expect(skin.colors.red).toBeUndefined();
    expect(skin.colors.blue).toBe(defaultSkin().colors.blue);
    expect('replace' in skin).toBe(false);
    // The base skin is not changed.
    const base = defaultSkin();
    const only = mergeSkin(base, { items: {}, replace: ['items'] });
    expect(Object.keys(only.items)).toEqual([]);
    expect(Object.keys(base.items).length).toBeGreaterThan(5);
  });
});
