import { createGrid, encodeGrid, setCell, type Figure, type Grid, type Model, type Project, type Scene, type V3 } from '../src/core/index.js';

/**
 * The project the editor opens on first run and with "New project": a small study with a door to a
 * storage closet, built entirely by code so it doubles as an example of making content with `core`.
 */

/** Fills the cells from `a` to `b` (both inclusive) with `value`. */
function fill(g: Grid, a: V3, b: V3, value: number): void {
  for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) {
    for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) {
      for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) setCell(g, x, y, z, value);
    }
  }
}

/** A model whose cells are drawn by `draw`. `palette` lists colors from index 1; `emissive` are indices. */
function model(
  id: string,
  name: string,
  size: V3,
  scale: number,
  palette: number[],
  draw: (g: Grid) => void,
  options: { closed?: boolean; emissive?: number[] } = {},
): Model {
  const g = createGrid(size[0], size[1], size[2]);
  draw(g);
  return {
    id,
    name,
    size,
    scale,
    palette: [0, ...palette],
    emissive: options.emissive ?? [],
    closed: options.closed ?? false,
    data: encodeGrid(g),
  };
}

/** A closed room: plank floor, walls with a baseboard, and a ceiling. Sizes in voxels. */
function room(id: string, name: string, size: V3, wall: number): Model {
  const [sx, sy, sz] = size;
  return model(id, name, size, 0.2, [0x7a5a3c, 0x684b31, wall, 0x4a3b2e, 0x8c877d], (g) => {
    for (let z = 0; z < sz; z++) {
      for (let x = 0; x < sx; x++) setCell(g, x, 0, z, ((z >> 1) + (x >> 3) * (z & 1)) % 2 ? 2 : 1);
    }
    for (let y = 1; y < sy - 1; y++) {
      const color = y === 1 ? 4 : 3;
      fill(g, [0, y, 0], [sx - 1, y, 0], color);
      fill(g, [0, y, sz - 1], [sx - 1, y, sz - 1], color);
      fill(g, [0, y, 0], [0, y, sz - 1], color);
      fill(g, [sx - 1, y, 0], [sx - 1, y, sz - 1], color);
    }
    fill(g, [0, sy - 1, 0], [sx - 1, sy - 1, sz - 1], 5);
  }, { closed: true });
}

const S = 0.05;

function furniture(): Model[] {
  const table = model('table', 'Table', [24, 15, 14], S, [0x8a5a33, 0x6e4526], (g) => {
    fill(g, [0, 13, 0], [23, 14, 13], 1);
    for (const [x, z] of [[1, 1], [21, 1], [1, 11], [21, 11]] as const) fill(g, [x, 0, z], [x + 1, 12, z + 1], 2);
  });
  const chair = model('chair', 'Chair', [9, 18, 9], S, [0x7b4f2c, 0x5e3b20], (g) => {
    for (const [x, z] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) fill(g, [x, 0, z], [x, 7, z], 2);
    fill(g, [0, 8, 0], [8, 8, 8], 1);
    fill(g, [0, 9, 8], [8, 17, 8], 2);
    fill(g, [1, 11, 8], [7, 15, 8], 1);
  });
  const cabinet = model('cabinet', 'Cabinet', [10, 18, 16], S, [0x5d6b58, 0x46523f, 0xc9b27a], (g) => {
    fill(g, [0, 0, 0], [9, 17, 15], 1);
    // Two drawers on the front (+x) face, with handles.
    for (const y of [3, 11]) {
      fill(g, [9, y, 1], [9, y + 5, 14], 2);
      fill(g, [9, y + 2, 7], [9, y + 3, 8], 3);
    }
  });
  const crate = model('crate', 'Crate', [10, 10, 10], S, [0xa07d4f, 0x7a5c35], (g) => {
    fill(g, [0, 0, 0], [9, 9, 9], 1);
    for (let i = 0; i < 10; i++) {
      for (const [a, b] of [[0, 0], [0, 9], [9, 0], [9, 9]] as const) {
        setCell(g, i, a, b, 2);
        setCell(g, a, i, b, 2);
        setCell(g, a, b, i, 2);
      }
    }
  });
  const lamp = model('lamp', 'Lamp', [5, 9, 5], S, [0x2f2b28, 0xffd890], (g) => {
    fill(g, [0, 0, 0], [4, 0, 4], 1);
    fill(g, [2, 1, 2], [2, 4, 2], 1);
    fill(g, [1, 5, 1], [3, 8, 3], 2);
  }, { emissive: [2] });
  const door = model('door', 'Door', [2, 40, 18], S, [0x6b4a2f, 0x4d3420, 0xd9b44a], (g) => {
    fill(g, [0, 0, 0], [1, 39, 17], 2);
    fill(g, [0, 1, 1], [1, 38, 16], 1);
    fill(g, [0, 20, 13], [0, 21, 14], 3);
  });
  const key = model('key', 'Small key', [5, 1, 2], S, [0xd9b44a], (g) => {
    fill(g, [0, 0, 0], [1, 0, 1], 1);
    fill(g, [2, 0, 0], [4, 0, 0], 1);
    setCell(g, 4, 0, 1, 1);
  });
  const paper = model('paper', 'Paper', [5, 1, 7], S, [0xe8e1cf, 0x8a8478], (g) => {
    fill(g, [0, 0, 0], [4, 0, 6], 1);
    for (const z of [1, 3, 5]) fill(g, [1, 0, z], [3, 0, z], 2);
  });
  return [table, chair, cabinet, crate, lamp, door, key, paper];
}

/** A blocky humanoid: torso, head, two arms and two legs, 1.7 m tall, looking toward +z. */
function walker(): { models: Model[]; figure: Figure } {
  const SKIN = 1;
  const SHIRT = 2;
  const PANTS = 3;
  const HAIR = 4;
  const SHOES = 5;
  const EYES = 6;
  const colors = [0xd7a27c, 0x3f7a8c, 0x3b3f52, 0x3a2a1e, 0x22201e, 0x15161a];
  const torso = model('walker_torso', 'Walker torso', [8, 12, 4], S, colors, (g) => {
    fill(g, [0, 0, 0], [7, 11, 3], SHIRT);
    fill(g, [0, 0, 0], [7, 1, 3], PANTS);
  });
  const head = model('walker_head', 'Walker head', [6, 6, 6], S, colors, (g) => {
    fill(g, [0, 0, 0], [5, 5, 5], SKIN);
    fill(g, [0, 4, 0], [5, 5, 5], HAIR);
    fill(g, [0, 1, 0], [5, 5, 1], HAIR);
    setCell(g, 1, 3, 5, EYES);
    setCell(g, 4, 3, 5, EYES);
  });
  const arm = model('walker_arm', 'Walker arm', [3, 12, 3], S, colors, (g) => {
    fill(g, [0, 0, 0], [2, 11, 2], SKIN);
    fill(g, [0, 7, 0], [2, 11, 2], SHIRT);
  });
  const leg = model('walker_leg', 'Walker leg', [3, 16, 3], S, colors, (g) => {
    fill(g, [0, 0, 0], [2, 15, 2], PANTS);
    fill(g, [0, 0, 0], [2, 1, 2], SHOES);
    setCell(g, 1, 0, 3, SHOES);
  });

  const swing = (legL: number, armL: number, lean = 0): Record<string, V3> => ({
    torso: [lean, 0, 0],
    leg_l: [legL, 0, 0],
    leg_r: [-legL, 0, 0],
    arm_l: [armL, 0, 0.04],
    arm_r: [-armL, 0, -0.04],
  });
  const figure: Figure = {
    id: 'walker',
    name: 'Walker',
    parts: [
      { id: 'torso', model: torso.id, parent: null, pivot: [0, 0.8, 0], origin: [4, 0, 2] },
      { id: 'head', model: head.id, parent: 'torso', pivot: [0, 0.6, 0], origin: [3, 0, 3] },
      { id: 'arm_l', model: arm.id, parent: 'torso', pivot: [0.275, 0.58, 0], origin: [1.5, 12, 1.5] },
      { id: 'arm_r', model: arm.id, parent: 'torso', pivot: [-0.275, 0.58, 0], origin: [1.5, 12, 1.5] },
      { id: 'leg_l', model: leg.id, parent: 'torso', pivot: [0.1, 0, 0], origin: [1.5, 16, 1.5] },
      { id: 'leg_r', model: leg.id, parent: 'torso', pivot: [-0.1, 0, 0], origin: [1.5, 16, 1.5] },
    ],
    clips: [
      {
        name: 'idle',
        duration: 2.4,
        loop: true,
        keys: [
          { t: 0, rot: { arm_l: [0, 0, 0.04], arm_r: [0, 0, -0.04] } },
          { t: 1.2, rot: { head: [0.06, 0.1, 0], torso: [0.02, 0, 0], arm_l: [0.05, 0, 0.08], arm_r: [0.05, 0, -0.08] } },
        ],
      },
      { name: 'walk', duration: 0.9, loop: true, keys: [{ t: 0, rot: swing(-0.5, 0.4) }, { t: 0.45, rot: swing(0.5, -0.4) }] },
      { name: 'run', duration: 0.56, loop: true, keys: [{ t: 0, rot: swing(-0.85, 0.8, 0.12) }, { t: 0.28, rot: swing(0.85, -0.8, 0.12) }] },
    ],
  };
  return { models: [torso, head, arm, leg], figure };
}

const FLOOR = 0.2;

function study(): Scene {
  return {
    id: 'study',
    name: 'Study',
    room: 'study_room',
    instances: [
      { id: 'table', model: 'table', pos: [2.4, FLOOR, 2.6], rot: 0, solid: true },
      { id: 'chair_1', model: 'chair', pos: [2.4, FLOOR, 3.4], rot: 0, solid: true },
      { id: 'chair_2', model: 'chair', pos: [1.4, FLOOR, 2.6], rot: 3, solid: true },
      { id: 'cabinet', model: 'cabinet', pos: [0.45, FLOOR, 1.3], rot: 0, solid: true },
      { id: 'lamp', model: 'lamp', pos: [2.85, 0.95, 2.45], rot: 0, solid: false },
      { id: 'door', model: 'door', pos: [4.55, FLOOR, 3.6], rot: 0, solid: false },
    ],
    cameras: [
      { id: 'cam_front', name: 'Front half', pos: [4.35, 2.35, 4.35], target: [1.7, 0.5, 0.9], fov: 55, zone: { min: [0, 0], max: [4.8, 2.4] } },
      { id: 'cam_back', name: 'Back half', pos: [0.45, 2.35, 0.45], target: [3.1, 0.5, 3.6], fov: 55, zone: { min: [0, 2.4], max: [4.8, 4.8] } },
    ],
    lights: [
      {
        id: 'lamp',
        name: 'Table lamp',
        kind: 'point',
        pos: [2.85, 1.3, 2.45],
        target: [2.85, 0, 2.45],
        color: 0xffc98a,
        intensity: 5,
        range: 7,
        angle: 0.5,
        shadow: true,
        flicker: 0.15,
      },
      {
        id: 'fill',
        name: 'Ceiling fill',
        kind: 'point',
        pos: [2.4, 2.35, 1.4],
        target: [2.4, 0, 1.4],
        color: 0xdfe3f5,
        intensity: 2.5,
        range: 7,
        angle: 0.5,
        shadow: false,
        flicker: 0,
      },
    ],
    entities: [
      { id: 'player', kind: 'player', name: 'Player start', pos: [1.6, FLOOR, 0.9], heading: 0, figure: 'walker' },
      { id: 'key', kind: 'item', name: 'Small key', pos: [2.0, 0.95, 2.7], heading: 0.4, model: 'key' },
      {
        id: 'note',
        kind: 'note',
        name: 'Note',
        pos: [0.45, 1.1, 1.3],
        heading: 0.2,
        model: 'paper',
        text: 'This room was made by code, as the starter project. Take the key from the table and try the door.',
      },
      {
        id: 'door_closet',
        kind: 'door',
        name: 'Closet door',
        pos: [4.1, FLOOR, 3.6],
        heading: -Math.PI / 2,
        requires: 'Small key',
        lockedText: 'It is locked. There must be a key somewhere.',
        text: 'The key turns. The door opens.',
        destination: 'closet',
        entry: 'door_back',
      },
    ],
    ambient: { color: 0x737888, intensity: 1.8 },
    fog: { color: 0x0a0b10, density: 0.02 },
  };
}

function closet(): Scene {
  return {
    id: 'closet',
    name: 'Closet',
    room: 'closet_room',
    instances: [
      { id: 'crate', model: 'crate', pos: [2.9, FLOOR, 0.65], rot: 0, solid: true },
      { id: 'lamp', model: 'lamp', pos: [2.9, 0.7, 0.65], rot: 0, solid: false },
      { id: 'door', model: 'door', pos: [0.25, FLOOR, 1.4], rot: 2, solid: false },
    ],
    cameras: [{ id: 'cam_closet', name: 'Closet', pos: [3.25, 2.3, 2.45], target: [1.1, 0.8, 1.0], fov: 60, zone: { min: [0, 0], max: [3.6, 2.8] } }],
    lights: [
      {
        id: 'lamp',
        name: 'Crate lamp',
        kind: 'point',
        pos: [2.9, 1.05, 0.65],
        target: [2.9, 0, 0.65],
        color: 0xffc98a,
        intensity: 2.5,
        range: 6,
        angle: 0.5,
        shadow: false,
        flicker: 0.15,
      },
    ],
    entities: [
      {
        id: 'door_back',
        kind: 'door',
        name: 'Back to the study',
        pos: [0.7, FLOOR, 1.4],
        heading: Math.PI / 2,
        destination: 'study',
        entry: 'door_closet',
      },
    ],
    ambient: { color: 0x737888, intensity: 1.6 },
    fog: { color: 0x0a0b10, density: 0.02 },
  };
}

/** A fresh copy of the starter project. */
export function starterProject(): Project {
  const w = walker();
  return {
    version: 1,
    name: 'Starter project',
    startScene: 'study',
    models: [room('study_room', 'Study (room)', [24, 14, 24], 0xb8b2a2), room('closet_room', 'Closet (room)', [18, 14, 14], 0x9fae9a), ...furniture(), ...w.models],
    figures: [w.figure],
    scenes: [study(), closet()],
  };
}
