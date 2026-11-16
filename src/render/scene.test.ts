import { describe, expect, it } from 'vitest';
import { newModel, type Project } from '../core/index.js';
import { buildScene } from './scene.js';
import { VoxelMesh } from './voxel-mesh.js';

const project = (): Project => ({
  version: 1,
  name: 'test',
  startScene: 's',
  models: [newModel('room', 'Room', [4, 4, 4], 0.25, true, [0x888888]), newModel('box', 'Box', [2, 2, 2], 0.25, false, [0xaa5533])],
  figures: [],
  scenes: [
    {
      id: 's',
      name: 'S',
      room: 'room',
      instances: [
        { id: 'a', model: 'box', pos: [0.2, 0, 0.2], rot: 0, solid: true },
        { id: 'b', model: 'box', pos: [0.6, 0, 0.6], rot: 1, solid: false },
      ],
      cameras: [],
      lights: [],
      entities: [],
      ambient: { color: 0xffffff, intensity: 1 },
      fog: { color: 0, density: 0 },
    },
  ],
});

describe('buildScene', () => {
  it('returns the room and one holder per instance, in order', () => {
    const p = project();
    const built = buildScene(p, p.scenes[0]!);
    expect(built.instances).toHaveLength(2);
    expect(built.instances[1]!.position.x).toBeCloseTo(0.6);
    expect(built.instances[1]!.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(built.group.children).toContain(built.room);
    for (const h of built.instances) expect(built.group.children).toContain(h);
  });
});

describe('VoxelMesh', () => {
  it('takes cutY in the constructor', () => {
    const m = new VoxelMesh(newModel('m', 'M', [2, 2, 2], 1, false, [0xffffff]), { cutY: 1 });
    expect(m.cutY).toBe(1);
  });
});
