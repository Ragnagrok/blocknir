import { describe, expect, it } from 'vitest';
import { poseFromClip } from './anim.js';
import { buildHeightmap, heightAt, moveBody } from './collision.js';
import { gridOf, newModel, offsetFor, resizeModel, validate } from './project.js';
import type { Clip, Project, Scene, V3 } from './types.js';
import { createGrid, decodeGrid, encodeGrid, getCell, lostCells, raycast, resizeGrid, setCell } from './voxel.js';

const SCALE = 0.1;

/** An 8x3x8 m room with floor and walls, and a pillar in the middle. */
function testProject(): Project {
  const room = newModel('room', 'Room', [80, 30, 80], SCALE, true, [0x888888]);
  const g = gridOf(room);
  for (let y = 0; y < 30; y++) {
    for (let z = 0; z < 80; z++) {
      for (let x = 0; x < 80; x++) {
        const edge = x < 2 || z < 2 || x >= 78 || z >= 78;
        const pillar = x >= 30 && x < 50 && z >= 38 && z < 42;
        if (y < 2 || edge || pillar) setCell(g, x, y, z, 1);
      }
    }
  }
  room.data = encodeGrid(g);
  const scene: Scene = {
    id: 's1',
    name: 'Test',
    room: 'room',
    instances: [],
    cameras: [{ id: 'c1', name: 'A', pos: [1, 2, 1], target: [4, 0, 4], fov: 50, zone: { min: [0, 0], max: [8, 4] } },
      { id: 'c2', name: 'B', pos: [7, 2, 7], target: [4, 0, 4], fov: 50, zone: { min: [0, 4], max: [8, 8] } }],
    lights: [],
    entities: [
      { id: 'p', kind: 'player', name: 'P', pos: [4, 0.2, 6], heading: Math.PI, figure: 'f' },
      { id: 'k', kind: 'item', name: 'Key', pos: [4, 0.2, 5.2], heading: 0 },
      { id: 'd', kind: 'door', name: 'Door', pos: [2, 0.2, 6], heading: 0, requires: 'Key', lockedText: 'Locked', destination: 's1', entry: 'p' },
    ],
    ambient: { color: 0, intensity: 0 },
    fog: { color: 0, density: 0 },
  };
  return {
    version: 1,
    name: 'p',
    startScene: 's1',
    models: [room],
    figures: [{ id: 'f', name: 'F', parts: [], clips: [] }],
    scenes: [scene],
  };
}

describe('voxels', () => {
  it('encodes and decodes without losing anything', () => {
    const g = createGrid(40, 30, 20);
    for (let i = 0; i < g.cells.length; i += 7) g.cells[i] = (i % 250) + 1;
    expect(Buffer.compare(decodeGrid(encodeGrid(g), [40, 30, 20]).cells, g.cells)).toBe(0);
    const empty = createGrid(200, 100, 200);
    expect(Buffer.compare(decodeGrid(encodeGrid(empty), [200, 100, 200]).cells, empty.cells)).toBe(0);
  });

  it('rejects data that does not match the size', () => {
    expect(() => decodeGrid(encodeGrid(createGrid(2, 2, 2)), [3, 3, 3])).toThrow();
  });

  it('the ray finds the right face', () => {
    const g = createGrid(10, 10, 10);
    setCell(g, 5, 5, 5, 1);
    const h = raycast(g, [-3, 5.5, 5.5], [1, 0, 0]);
    expect(h?.cell).toEqual([5, 5, 5]);
    expect(h?.previous).toEqual([4, 5, 5]);
    expect(h?.normal).toEqual([-1, 0, 0]);
    expect(raycast(g, [-3, 0.5, 5.5], [1, 0, 0])).toBeNull();
  });

  it('from outside a room, the ray goes through the near wall', () => {
    const g = createGrid(10, 3, 3);
    for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) { setCell(g, 0, y, z, 1); setCell(g, 9, y, z, 1); }
    expect(raycast(g, [-2, 1.5, 1.5], [1, 0, 0], { skipExterior: true })?.cell).toEqual([9, 1, 1]);
    expect(raycast(g, [-2, 1.5, 1.5], [1, 0, 0])?.cell).toEqual([0, 1, 1]);
    expect(getCell(g, 99, 0, 0)).toBe(0);
  });
});

describe('collision', () => {
  it('walls stop the body and it slides along them', () => {
    const p = testProject();
    const m = buildHeightmap(p, p.scenes[0]!);
    const pos: V3 = [0.5, 0.2, 2];
    moveBody(m, pos, -1, 1, 0.2, 1.7);
    expect(pos[0]).toBe(0.5);
    expect(pos[2]).toBe(3);
  });

  it('a rotated solid object blocks where it is drawn', () => {
    const p = testProject();
    const furniture = newModel('m', 'M', [40, 10, 4], SCALE, false, [1]);
    const g = gridOf(furniture);
    g.cells.fill(1);
    furniture.data = encodeGrid(g);
    p.models.push(furniture);
    p.scenes[0]!.instances.push({ id: 'i', model: 'm', pos: [2, 0.2, 2], rot: 1, solid: true });
    const m = buildHeightmap(p, p.scenes[0]!);
    expect(heightAt(m, 2, 3.5, 0.05, 0.2, 1.7)).toBeNull();
    expect(heightAt(m, 3.5, 2, 0.05, 0.2, 1.7)).not.toBeNull();
  });

  it('climbs a low step but not a high one', () => {
    const p = testProject();
    const g = gridOf(p.models[0]!);
    for (let z = 10; z < 20; z++) for (let x = 10; x < 20; x++) for (let y = 2; y < 4; y++) setCell(g, x, y, z, 1);
    for (let z = 30; z < 36; z++) for (let x = 10; x < 20; x++) for (let y = 2; y < 8; y++) setCell(g, x, y, z, 1);
    const m = buildHeightmap(p, p.scenes[0]!);
    expect(heightAt(m, 1.5, 1.5, 0.05, 0.2, 1.7)).toBeCloseTo(0.4);
    expect(heightAt(m, 1.5, 3.2, 0.05, 0.2, 1.7)).toBeNull();
  });
});

describe('project and animation', () => {
  it('validates broken references', () => {
    const p = testProject();
    expect(validate(p)).toEqual([]);
    p.scenes[0]!.room = 'nothing';
    expect(validate(p).length).toBeGreaterThan(0);
  });

  it('interpolates between keys and closes the loop', () => {
    const clip: Clip = {
      name: 'x',
      duration: 2,
      loop: true,
      keys: [{ t: 0, rot: { a: [0, 0, 0] } }, { t: 1, rot: { a: [1, 0, 0] } }],
    };
    expect(poseFromClip(clip, 0.5).a![0]).toBeCloseTo(0.5);
    expect(poseFromClip(clip, 1.5).a![0]).toBeCloseTo(0.5);
    expect(poseFromClip(clip, 2.5).a![0]).toBeCloseTo(0.5);
  });
});

describe('resizing', () => {
  /** World center of one voxel of an object, the same way the renderer places it. */
  const worldOf = (pos: V3, rot: number, size: V3, s: number, c: V3): V3 => {
    const x = (c[0] + 0.5 - size[0] / 2) * s;
    const z = (c[2] + 0.5 - size[2] / 2) * s;
    const a = (rot * Math.PI) / 2;
    return [pos[0] + x * Math.cos(a) + z * Math.sin(a), pos[1] + (c[1] + 0.5) * s, pos[2] - x * Math.sin(a) + z * Math.cos(a)];
  };

  it('grows and crops keeping the cells', () => {
    const g = createGrid(4, 4, 4);
    setCell(g, 1, 2, 3, 7);
    const big = resizeGrid(g, [8, 6, 8], [2, 0, 1]);
    expect(getCell(big, 3, 2, 4)).toBe(7);
    expect(big.cells.reduce((a, b) => a + (b ? 1 : 0), 0)).toBe(1);
    expect(lostCells(g, [1, 4, 4], [0, 0, 0])).toBe(1);
    expect(lostCells(g, [2, 4, 4], [0, 0, 0])).toBe(0);
    expect(getCell(resizeGrid(g, [2, 4, 4], [-1, 0, 0]), 0, 2, 3)).toBe(7);
  });

  it('works out which side grows', () => {
    expect(offsetFor([10, 10, 10], [14, 14, 14], ['start', 'center', 'end'])).toEqual([0, 2, 4]);
    expect(offsetFor([10, 10, 10], [6, 6, 6], ['start', 'center', 'end'])).toEqual([0, -2, -4]);
  });

  it.each([0, 1, 2, 3])('an object turned %i times does not move in the world', (rot) => {
    const p = testProject();
    const m = newModel('m', 'M', [10, 6, 4], SCALE, false, [1]);
    p.models.push(m);
    p.scenes[0]!.instances.push({ id: 'i', model: 'm', pos: [3, 0.2, 3], rot, solid: true });
    const inst = p.scenes[0]!.instances[0]!;
    const c: V3 = [2, 1, 3];
    const before = worldOf(inst.pos, rot, [10, 6, 4], SCALE, c);
    const { offset: d } = resizeModel(p, m, [16, 9, 12], ['end', 'center', 'start']);
    const after = worldOf(inst.pos, rot, [16, 9, 12], SCALE, [c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
    for (let i = 0; i < 3; i++) expect(after[i]).toBeCloseTo(before[i]!);
  });

  it('growing the room at the origin shifts everything inside', () => {
    const p = testProject();
    const s = p.scenes[0]!;
    const zone = structuredClone(s.cameras[0]!.zone);
    resizeModel(p, p.models[0]!, [90, 30, 80], ['end', 'start', 'start']);
    expect(s.entities[0]!.pos[0]).toBeCloseTo(5);
    expect(s.cameras[0]!.pos[0]).toBeCloseTo(2);
    expect(s.cameras[0]!.target[0]).toBeCloseTo(5);
    expect(s.cameras[0]!.zone.max[0]).toBeCloseTo(zone.max[0] + 1);
    expect(p.models[0]!.size).toEqual([90, 30, 80]);
    expect(decodeGrid(p.models[0]!.data, [90, 30, 80]).x).toBe(90);
  });

  it('a figure keeps its joint', () => {
    const p = testProject();
    const m = newModel('m', 'M', [4, 4, 4], SCALE, false, [1]);
    p.models.push(m);
    p.figures[0]!.parts.push({ id: 'a', model: 'm', parent: null, pivot: [0, 0, 0], origin: [2, 4, 2] });
    resizeModel(p, m, [8, 8, 4], ['center', 'end', 'start']);
    expect(p.figures[0]!.parts[0]!.origin).toEqual([4, 8, 2]);
  });
});
