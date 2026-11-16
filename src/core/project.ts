import type { Figure, Model, Project, Scene, V3 } from './types.js';
import { createGrid, decodeGrid, encodeGrid, resizeGrid, type Grid } from './voxel.js';

const grids = new WeakMap<Model, Grid>();

/** Decoded cells of a model, cached: edits to the grid stay in memory until `flushGrids`. */
export function gridOf(m: Model): Grid {
  let g = grids.get(m);
  if (!g) {
    g = decodeGrid(m.data, m.size);
    grids.set(m, g);
  }
  return g;
}

/** Writes the in-memory grids back into the savable format. */
export function flushGrids(p: Project): void {
  for (const m of p.models) {
    const g = grids.get(m);
    if (g) m.data = encodeGrid(g);
  }
}

/** An empty model. `palette` lists the colors from index 1 on; index 0 (empty) is added. */
export function newModel(id: string, name: string, size: V3, scale: number, closed: boolean, palette: number[]): Model {
  return {
    id,
    name,
    size,
    scale,
    closed,
    palette: [0, ...palette],
    emissive: [],
    data: encodeGrid(createGrid(size[0], size[1], size[2])),
  };
}

export type Anchor = 'start' | 'center' | 'end';

export const MAX_SIDE = 512;
export const MAX_CELLS = 64_000_000;

/** Replaces a model's cells, keeping size and data consistent. */
export function setGrid(m: Model, g: Grid): void {
  grids.set(m, g);
  m.size = [g.x, g.y, g.z];
  m.data = encodeGrid(g);
}

/** How far the content shifts, depending on which side cells are added to or removed from. */
export function offsetFor(oldSize: V3, newSize: V3, anchors: [Anchor, Anchor, Anchor]): V3 {
  const axis = (i: 0 | 1 | 2): number => {
    const diff = newSize[i] - oldSize[i];
    return anchors[i] === 'start' ? 0 : anchors[i] === 'end' ? diff : Math.trunc(diff / 2);
  };
  return [axis(0), axis(1), axis(2)];
}

/** Compensates scenes and figures so the voxels that remain do not move in the world. */
function rearrange(p: Project, m: Model, oldSize: V3, newSize: V3, d: V3): void {
  const s = m.scale;
  const shift: V3 = [d[0] * s, d[1] * s, d[2] * s];
  const add = (v: V3): V3 => [v[0] + shift[0], v[1] + shift[1], v[2] + shift[2]];
  const lx = ((newSize[0] - oldSize[0]) / 2 - d[0]) * s;
  const lz = ((newSize[2] - oldSize[2]) / 2 - d[2]) * s;
  const compensate = (pos: V3, angle: number): V3 => {
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    return [pos[0] + lx * c + lz * sn, pos[1] - d[1] * s, pos[2] - lx * sn + lz * c];
  };

  for (const f of p.figures) {
    for (const x of f.parts) {
      if (x.model === m.id) x.origin = [x.origin[0] + d[0], x.origin[1] + d[1], x.origin[2] + d[2]];
    }
  }
  for (const sc of p.scenes) {
    for (const i of sc.instances) {
      if (i.model === m.id) i.pos = compensate(i.pos, (i.rot * Math.PI) / 2);
    }
    for (const x of sc.entities) {
      if (x.model === m.id) x.pos = compensate(x.pos, x.heading);
    }
    if (sc.room !== m.id) continue;
    // The room defines the world origin: everything inside shifts with it.
    for (const i of sc.instances) i.pos = add(i.pos);
    for (const x of sc.entities) x.pos = add(x.pos);
    for (const l of sc.lights) {
      l.pos = add(l.pos);
      l.target = add(l.target);
    }
    for (const c of sc.cameras) {
      c.pos = add(c.pos);
      c.target = add(c.target);
      c.zone = {
        min: [c.zone.min[0] + shift[0], c.zone.min[1] + shift[2]],
        max: [c.zone.max[0] + shift[0], c.zone.max[1] + shift[2]],
      };
    }
  }
}

/** Resizes a model and updates everything that uses it. `offset` is the shift applied to the cells. */
export function resizeModel(
  p: Project,
  m: Model,
  size: V3,
  anchors: [Anchor, Anchor, Anchor],
): { before: Grid; after: Grid; offset: V3 } {
  const before = gridOf(m);
  const oldSize: V3 = [...m.size];
  const offset = offsetFor(oldSize, size, anchors);
  const after = resizeGrid(before, size, offset);
  setGrid(m, after);
  rearrange(p, m, oldSize, size, offset);
  return { before, after, offset };
}

export function modelOf(p: Project, id: string): Model {
  const m = p.models.find((x) => x.id === id);
  if (!m) throw new Error(`Model "${id}" does not exist`);
  return m;
}

export function figureOf(p: Project, id: string): Figure {
  const f = p.figures.find((x) => x.id === id);
  if (!f) throw new Error(`Figure "${id}" does not exist`);
  return f;
}

export function sceneOf(p: Project, id: string): Scene {
  const s = p.scenes.find((x) => x.id === id);
  if (!s) throw new Error(`Scene "${id}" does not exist`);
  return s;
}

/** First `prefix_n` (n = 1, 2, ...) not in `used`. */
export function newId(prefix: string, used: Iterable<string>): string {
  const set = new Set(used);
  let n = 1;
  while (set.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

/** Lists whatever would keep the project from being played. Empty when all is well. */
export function validate(p: Project): string[] {
  const errors: string[] = [];
  const models = new Set(p.models.map((m) => m.id));
  const figures = new Set(p.figures.map((f) => f.id));
  const scenes = new Map(p.scenes.map((s) => [s.id, s]));
  if (!scenes.has(p.startScene)) errors.push(`The start scene "${p.startScene}" does not exist`);
  for (const f of p.figures) {
    const parts = new Set(f.parts.map((x) => x.id));
    for (const x of f.parts) {
      if (!models.has(x.model)) errors.push(`${f.name}: part "${x.id}" uses a model that does not exist`);
      if (x.parent && !parts.has(x.parent)) errors.push(`${f.name}: part "${x.id}" has a parent that does not exist`);
    }
  }
  for (const s of p.scenes) {
    if (!models.has(s.room)) errors.push(`${s.name}: the room does not exist`);
    for (const i of s.instances) if (!models.has(i.model)) errors.push(`${s.name}: object with a missing model`);
    if (s.cameras.length === 0) errors.push(`${s.name}: has no cameras`);
    for (const x of s.entities) {
      if ((x.kind === 'player' || x.kind === 'creature') && (!x.figure || !figures.has(x.figure))) {
        errors.push(`${s.name}: "${x.name}" needs a valid figure`);
      }
      if (x.model && !models.has(x.model)) errors.push(`${s.name}: "${x.name}" uses a model that does not exist`);
      if (x.kind === 'door' && x.destination) {
        const destination = scenes.get(x.destination);
        if (!destination) errors.push(`${s.name}: door "${x.name}" leads to a scene that does not exist`);
        else if (!destination.entities.some((d) => d.id === x.entry)) {
          errors.push(`${s.name}: door "${x.name}" has no valid entry in its destination`);
        }
      }
    }
  }
  for (const s of p.scenes) {
    if (s.id === p.startScene && !s.entities.some((x) => x.kind === 'player')) {
      errors.push(`${s.name}: the start scene has no player`);
    }
  }
  return errors;
}
