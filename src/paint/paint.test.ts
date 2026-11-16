import { describe, expect, it } from 'vitest';
import { decodeGrid, getCell, type Project } from '../core/index.js';
import { validate } from '../core/index.js';
import { hash3, noise3, VoxelCanvas } from './canvas.js';
import { createHumanoid, HUMANOID_CLIPS, HUMANOID_PARTS, shade } from './humanoid.js';

describe('hash3 and noise3', () => {
  it('are deterministic and stay in [0, 1)', () => {
    for (let i = -20; i < 20; i++) {
      const h = hash3(i, i * 7, -i * 3);
      expect(h).toBe(hash3(i, i * 7, -i * 3));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      const n = noise3(i * 0.37, i * 1.1, i * 0.5, 4);
      expect(n).toBe(noise3(i * 0.37, i * 1.1, i * 0.5, 4));
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('hash3 differs by argument and noise3 matches it on lattice points', () => {
    expect(hash3(1, 2, 3)).not.toBe(hash3(3, 2, 1));
    expect(noise3(8, 4, 12, 4)).toBeCloseTo(hash3(2, 1, 3), 12);
  });

  it('noise3 is smooth: neighbors differ little', () => {
    let worst = 0;
    for (let x = 0; x < 40; x++) worst = Math.max(worst, Math.abs(noise3(x, 3, 5, 8) - noise3(x + 1, 3, 5, 8)));
    expect(worst).toBeLessThan(0.3);
  });
});

describe('VoxelCanvas', () => {
  it('paints boxes clipped to the canvas and builds the palette as colors appear', () => {
    const c = new VoxelCanvas('m', 'M', [4, 4, 4], 0.1).box(-5, 0, 0, 1, 0, 0, 0xff0000).box(3, 3, 3, 9, 9, 9, 0x00ff00);
    const m = c.toModel();
    expect(m.palette).toEqual([0, 0xff0000, 0x00ff00]);
    const g = decodeGrid(m.data, m.size);
    expect(getCell(g, 0, 0, 0)).toBe(1);
    expect(getCell(g, 1, 0, 0)).toBe(1);
    expect(getCell(g, 2, 0, 0)).toBe(0);
    expect(getCell(g, 3, 3, 3)).toBe(2);
    expect(g.cells.reduce((n, v) => n + (v ? 1 : 0), 0)).toBe(3);
  });

  it('null empties, undefined keeps, and functions paint per cell', () => {
    const c = new VoxelCanvas('m', 'M', [3, 1, 1], 0.1).box(0, 0, 0, 2, 0, 0, 0x111111);
    c.box(0, 0, 0, 2, 0, 0, (x) => (x === 0 ? null : x === 1 ? undefined : 0x222222));
    expect([c.filled(0, 0, 0), c.filled(1, 0, 0), c.filled(2, 0, 0)]).toEqual([false, true, true]);
    const g = decodeGrid(c.toModel().data, [3, 1, 1]);
    expect([getCell(g, 1, 0, 0), getCell(g, 2, 0, 0)]).toEqual([1, 2]);
  });

  it('marks emissive colors and keeps the model fields', () => {
    const m = new VoxelCanvas('lamp', 'Lamp', [2, 2, 2], 0.05, true).box(0, 0, 0, 1, 0, 1, 0x333333).emit(0xffeeaa).box(0, 1, 0, 1, 1, 1, 0xffeeaa).toModel();
    expect(m).toMatchObject({ id: 'lamp', name: 'Lamp', size: [2, 2, 2], scale: 0.05, closed: true, emissive: [2] });
  });

  it('ellipsoid is symmetric and fits inside its bounds', () => {
    const c = new VoxelCanvas('e', 'E', [10, 10, 10], 0.1).ellipsoid(5, 5, 5, 4, 3, 2, 1);
    let count = 0;
    for (let y = 0; y < 10; y++) {
      for (let z = 0; z < 10; z++) {
        for (let x = 0; x < 10; x++) {
          if (!c.filled(x, y, z)) continue;
          count++;
          expect(c.filled(9 - x, y, z)).toBe(true);
          expect(c.filled(x, y, 9 - z)).toBe(true);
          expect(Math.abs(x + 0.5 - 5)).toBeLessThanOrEqual(4);
          expect(Math.abs(y + 0.5 - 5)).toBeLessThanOrEqual(3);
        }
      }
    }
    // Close to the volume 4/3·π·4·3·2 ≈ 100.
    expect(count).toBeGreaterThan(70);
    expect(count).toBeLessThan(130);
  });

  it('a higher section exponent fills closer to a rectangle', () => {
    const fill = (e: number): number => {
      const c = new VoxelCanvas('s', 'S', [10, 1, 10], 0.1).profile(0, 0, () => ({ rx: 5, rz: 5, e }), 1);
      return decodeGrid(c.toModel().data, [10, 1, 10]).cells.reduce((n, v) => n + (v ? 1 : 0), 0);
    };
    expect(fill(8)).toBeGreaterThan(fill(2));
    expect(fill(2)).toBeGreaterThan(60);
  });

  it('face paints the frontmost voxel and relief adds one in front of it', () => {
    const c = new VoxelCanvas('f', 'F', [3, 3, 4], 0.1).box(0, 0, 0, 2, 2, 1, 0x101010);
    c.face(1, 1, 1, 1, () => 0x202020).relief(0, 0, 0, 0, () => 0x303030);
    const g = decodeGrid(c.toModel().data, [3, 3, 4]);
    expect(getCell(g, 1, 1, 1)).toBe(2);
    expect(getCell(g, 1, 1, 0)).toBe(1);
    expect(getCell(g, 0, 0, 2)).toBe(3);
    expect(getCell(g, 1, 1, 2)).toBe(0);
  });

  it('repaint only changes filled cells', () => {
    const c = new VoxelCanvas('r', 'R', [2, 1, 1], 0.1).box(0, 0, 0, 0, 0, 0, 1).repaint(() => 0xabcdef);
    expect(c.filled(1, 0, 0)).toBe(false);
    expect(c.toModel().palette).toEqual([0, 1, 0xabcdef]);
  });

  it('refuses more than 255 colors', () => {
    const c = new VoxelCanvas('big', 'Big', [16, 1, 17], 0.1);
    expect(() => c.box(0, 0, 0, 15, 0, 16, (x, _y, z) => 1 + x + z * 16)).toThrow(/big: more than 255 colors/);
  });
});

describe('createHumanoid', () => {
  const project = (built: ReturnType<typeof createHumanoid>[]): Project => ({
    version: 1,
    name: 'T',
    startScene: 's',
    models: [...built.flatMap((b) => b.models), { id: 'room', name: 'Room', size: [1, 1, 1], scale: 1, palette: [0], emissive: [], closed: true, data: '' }],
    figures: built.map((b) => b.figure),
    scenes: [{ id: 's', name: 'S', room: 'room', instances: [], cameras: [{ id: 'c', name: 'C', pos: [0, 1, 0], target: [0, 0, 1], fov: 50, zone: { min: [0, 0], max: [1, 1] } }], lights: [], entities: [{ id: 'p', kind: 'player', name: 'P', pos: [0, 0, 0], heading: 0, figure: built[0]!.figure.id }], ambient: { color: 0, intensity: 1 }, fog: { color: 0, density: 0 } }],
  });

  it('produces a valid rig with the standard parts and clips', () => {
    const a = createHumanoid({ id: 'a' });
    const b = createHumanoid({ id: 'b', hairStyle: 'bun', silhouette: 'curvy', tablet: true, hood: true, strap: true, glasses: true, beard: 0x332211, cap: 0xaa2222, width: 1.1 });
    const c = createHumanoid({ id: 'c', hairStyle: 'long', apron: 0xdddddd });
    const d = createHumanoid({ id: 'd', hairStyle: 'shaved' });
    expect(validate(project([a, b, c, d]))).toEqual([]);
    expect(a.figure.parts.map((p) => p.id)).toEqual([...HUMANOID_PARTS]);
    expect(a.figure.clips.map((x) => x.name)).toEqual([...HUMANOID_CLIPS]);
    expect(a.models.map((m) => m.id)).toEqual(HUMANOID_PARTS.map((p) => `a_${p}`));
    for (const m of [...a.models, ...b.models]) expect(m.palette.length).toBeLessThanOrEqual(256);
  });

  it('is deterministic and only the tablet glows', () => {
    expect(createHumanoid({ id: 'x', hair: 0x112233 })).toEqual(createHumanoid({ id: 'x', hair: 0x112233 }));
    expect(createHumanoid({ id: 'x' }).models.every((m) => m.emissive.length === 0)).toBe(true);
    const t = createHumanoid({ id: 't', tablet: true, tabletScreen: 0x00ffcc });
    const arm = t.models.find((m) => m.id === 't_forearm_l')!;
    expect(arm.emissive.map((i) => arm.palette[i])).toEqual([0x00ffcc]);
  });

  it('style options change the models', () => {
    const base = createHumanoid({ id: 'x' });
    const glasses = createHumanoid({ id: 'x', glasses: true });
    const head = (h: typeof base): string => h.models.find((m) => m.id === 'x_head')!.data;
    expect(head(glasses)).not.toBe(head(base));
    expect(base.models.find((m) => m.id === 'x_torso')!.palette).toContain(0x5a6a80);
  });

  it('options set to undefined fall back to the defaults', () => {
    expect(createHumanoid({ id: 'x', width: undefined, beard: undefined, hairStyle: undefined })).toEqual(createHumanoid({ id: 'x' }));
  });

  it('shade scales channels and clamps', () => {
    expect(shade(0x808080, 0.5)).toBe(0x404040);
    expect(shade(0xc0c0c0, 2)).toBe(0xffffff);
  });
});
