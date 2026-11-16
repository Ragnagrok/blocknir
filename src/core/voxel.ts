import type { V3 } from './types.js';

export interface Grid {
  x: number;
  y: number;
  z: number;
  cells: Uint8Array;
}

export function createGrid(x: number, y: number, z: number): Grid {
  return { x, y, z, cells: new Uint8Array(x * y * z) };
}

export const cellIndex = (g: Grid, x: number, y: number, z: number): number => x + z * g.x + y * g.x * g.z;

export const inBounds = (g: Grid, x: number, y: number, z: number): boolean =>
  x >= 0 && y >= 0 && z >= 0 && x < g.x && y < g.y && z < g.z;

/** Cell value, or 0 outside the grid. */
export const getCell = (g: Grid, x: number, y: number, z: number): number =>
  inBounds(g, x, y, z) ? g.cells[cellIndex(g, x, y, z)]! : 0;

/** Writes a cell; does nothing outside the grid. */
export function setCell(g: Grid, x: number, y: number, z: number, value: number): void {
  if (inBounds(g, x, y, z)) g.cells[cellIndex(g, x, y, z)] = value;
}

/** Run-length encodes into (varint length, value) pairs, then base64. */
export function encodeGrid(g: Grid): string {
  const out: number[] = [];
  const c = g.cells;
  let i = 0;
  while (i < c.length) {
    const value = c[i]!;
    let j = i + 1;
    while (j < c.length && c[j] === value) j++;
    let length = j - i;
    while (length >= 128) {
      out.push((length & 127) | 128);
      length >>>= 7;
    }
    out.push(length, value);
    i = j;
  }
  let binary = '';
  for (let k = 0; k < out.length; k += 8192) {
    binary += String.fromCharCode(...out.slice(k, k + 8192));
  }
  return btoa(binary);
}

/** Inverse of `encodeGrid`. Throws if the data does not fill exactly `size`. */
export function decodeGrid(data: string, size: V3): Grid {
  const g = createGrid(size[0], size[1], size[2]);
  const binary = atob(data);
  let p = 0;
  let i = 0;
  while (p < binary.length) {
    let length = 0;
    let shift = 0;
    let b = binary.charCodeAt(p++);
    while (b & 128) {
      length |= (b & 127) << shift;
      shift += 7;
      b = binary.charCodeAt(p++);
    }
    length |= b << shift;
    const value = binary.charCodeAt(p++);
    if (i + length > g.cells.length) throw new Error('Voxel data is longer than the model');
    g.cells.fill(value, i, i + length);
    i += length;
  }
  if (i !== g.cells.length) throw new Error('Voxel data is shorter than the model');
  return g;
}

/** Copies the grid into a new size, shifting the content by `d` cells. Whatever falls outside is lost. */
export function resizeGrid(g: Grid, size: V3, d: V3): Grid {
  const n = createGrid(size[0], size[1], size[2]);
  for (let y = Math.max(0, -d[1]); y < Math.min(g.y, n.y - d[1]); y++) {
    for (let z = Math.max(0, -d[2]); z < Math.min(g.z, n.z - d[2]); z++) {
      for (let x = Math.max(0, -d[0]); x < Math.min(g.x, n.x - d[0]); x++) {
        n.cells[cellIndex(n, x + d[0], y + d[1], z + d[2])] = g.cells[cellIndex(g, x, y, z)]!;
      }
    }
  }
  return n;
}

/** How many filled voxels would fall outside with that resize. */
export function lostCells(g: Grid, size: V3, d: V3): number {
  let lost = 0;
  for (let y = 0; y < g.y; y++) {
    for (let z = 0; z < g.z; z++) {
      for (let x = 0; x < g.x; x++) {
        if (g.cells[cellIndex(g, x, y, z)] === 0) continue;
        const nx = x + d[0];
        const ny = y + d[1];
        const nz = z + d[2];
        if (nx < 0 || ny < 0 || nz < 0 || nx >= size[0] || ny >= size[1] || nz >= size[2]) lost++;
      }
    }
  }
  return lost;
}

export interface Hit {
  cell: V3;
  /** Empty cell right before the hit. */
  previous: V3;
  normal: V3;
}

export interface RaycastOptions {
  /** Ignores solid cells the ray crosses before passing through an empty one (to see rooms from outside). */
  skipExterior?: boolean;
  ignore?: (x: number, y: number, z: number) => boolean;
}

/** Walks the grid cell by cell (DDA). Origin and direction in voxel units. */
export function raycast(g: Grid, o: V3, d: V3, options: RaycastOptions = {}): Hit | null {
  let tMin = 0;
  let tMax = Infinity;
  const bounds: V3 = [g.x, g.y, g.z];
  let entryAxis = -1;
  for (let e = 0; e < 3; e++) {
    if (Math.abs(d[e]!) < 1e-9) {
      if (o[e]! < 0 || o[e]! > bounds[e]!) return null;
      continue;
    }
    let a = (0 - o[e]!) / d[e]!;
    let b = (bounds[e]! - o[e]!) / d[e]!;
    if (a > b) [a, b] = [b, a];
    if (a > tMin) {
      tMin = a;
      entryAxis = e;
    }
    tMax = Math.min(tMax, b);
  }
  if (tMin > tMax) return null;

  const p: V3 = [o[0] + d[0] * (tMin + 1e-6), o[1] + d[1] * (tMin + 1e-6), o[2] + d[2] * (tMin + 1e-6)];
  const cell: V3 = [
    Math.min(g.x - 1, Math.max(0, Math.floor(p[0]))),
    Math.min(g.y - 1, Math.max(0, Math.floor(p[1]))),
    Math.min(g.z - 1, Math.max(0, Math.floor(p[2]))),
  ];
  const step: V3 = [Math.sign(d[0]), Math.sign(d[1]), Math.sign(d[2])];
  const delta: V3 = [Math.abs(1 / d[0]), Math.abs(1 / d[1]), Math.abs(1 / d[2])];
  const next: V3 = [0, 0, 0];
  for (let e = 0; e < 3; e++) {
    if (step[e] === 0) next[e] = Infinity;
    else next[e] = step[e]! > 0 ? (cell[e]! + 1 - p[e]!) * delta[e]! : (p[e]! - cell[e]!) * delta[e]!;
  }

  const normal: V3 = [0, 0, 0];
  if (entryAxis >= 0) normal[entryAxis] = -step[entryAxis]!;
  let previous: V3 = [cell[0] + normal[0], cell[1] + normal[1], cell[2] + normal[2]];
  let crossedEmpty = !options.skipExterior;

  while (inBounds(g, cell[0], cell[1], cell[2])) {
    const ignored = options.ignore?.(cell[0], cell[1], cell[2]) ?? false;
    const solid = !ignored && g.cells[cellIndex(g, cell[0], cell[1], cell[2])] !== 0;
    if (solid && crossedEmpty) {
      return { cell: [...cell], previous, normal: [...normal] };
    }
    if (!solid) crossedEmpty = true;
    previous = [...cell];
    let e = 0;
    if (next[1] < next[e]!) e = 1;
    if (next[2] < next[e]!) e = 2;
    cell[e] = cell[e]! + step[e]!;
    next[e] = next[e]! + delta[e]!;
    normal[0] = normal[1] = normal[2] = 0;
    normal[e] = -step[e]!;
  }
  return null;
}
