import type { Model, V3 } from '../core/index.js';
import { cellIndex, createGrid, encodeGrid, type Grid } from '../core/index.js';

/** An RGB color, `null` to empty the cell, `undefined` to leave it as it is. */
export type Color = number | null | undefined;
/** A fixed color, or a function that picks one for each cell. */
export type Paint = Color | ((x: number, y: number, z: number) => Color);

/** A horizontal cross-section: a superellipse centered on (cx, cz) with radii rx and rz. */
export interface Section {
  rx: number;
  rz: number;
  /** Defaults to the middle of the canvas. */
  cx?: number;
  cz?: number;
  /** Superellipse exponent: 2 is an ellipse; higher gets closer to a rectangle. */
  e?: number;
}

/** Deterministic hash of up to three integers, from 0 (inclusive) to 1 (exclusive). */
export const hash3 = (a: number, b = 0, c = 0): number => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Smooth value noise: broad blotches instead of scattered voxels. `cell` is the blotch size; returns 0 to 1. */
export function noise3(x: number, y: number, z: number, cell: number): number {
  const [a, b, c] = [x / cell, y / cell, z / cell];
  const [i, j, k] = [Math.floor(a), Math.floor(b), Math.floor(c)];
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const [u, v, w] = [smooth(a - i), smooth(b - j), smooth(c - k)];
  const mix = (p: number, q: number, t: number): number => p + (q - p) * t;
  return mix(
    mix(mix(hash3(i, j, k), hash3(i + 1, j, k), u), mix(hash3(i, j + 1, k), hash3(i + 1, j + 1, k), u), v),
    mix(mix(hash3(i, j, k + 1), hash3(i + 1, j, k + 1), u), mix(hash3(i, j + 1, k + 1), hash3(i + 1, j + 1, k + 1), u), v),
    w,
  );
}

/**
 * Paints voxels procedurally and exports the result as a `Model`. The palette grows as colors are
 * used (up to 255). Every drawing method clips to the canvas and returns `this`, so calls chain.
 */
export class VoxelCanvas {
  readonly grid: Grid;
  /** RGB colors; index 0 is "empty". */
  palette: number[] = [0];
  private colors = new Map<number, number>();
  private emissive = new Set<number>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly size: V3,
    readonly scale: number,
    readonly closed = false,
  ) {
    this.grid = createGrid(size[0], size[1], size[2]);
  }

  private colorIndex(c: number): number {
    let i = this.colors.get(c);
    if (i === undefined) {
      i = this.palette.length;
      if (i > 255) throw new Error(`${this.id}: more than 255 colors`);
      this.palette.push(c);
      this.colors.set(c, i);
    }
    return i;
  }

  private put(x: number, y: number, z: number, p: Paint): void {
    const c = typeof p === 'function' ? p(x, y, z) : p;
    if (c === undefined) return;
    this.grid.cells[cellIndex(this.grid, x, y, z)] = c === null ? 0 : this.colorIndex(c);
  }

  /** Whether the cell holds a voxel. Cells outside the canvas are empty. */
  filled(x: number, y: number, z: number): boolean {
    const g = this.grid;
    if (x < 0 || y < 0 || z < 0 || x >= g.x || y >= g.y || z >= g.z) return false;
    return g.cells[cellIndex(g, x, y, z)] !== 0;
  }

  /** Marks a color as emissive (it glows and feeds the bloom pass). */
  emit(c: number): this {
    this.emissive.add(this.colorIndex(c));
    return this;
  }

  /** Fills the box between two corners, both inclusive. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, p: Paint): this {
    const g = this.grid;
    for (let y = Math.max(0, y0); y <= Math.min(g.y - 1, y1); y++) {
      for (let z = Math.max(0, z0); z <= Math.min(g.z - 1, z1); z++) {
        for (let x = Math.max(0, x0); x <= Math.min(g.x - 1, x1); x++) this.put(x, y, z, p);
      }
    }
    return this;
  }

  /** Stacks cross-sections from y0 to y1 (inclusive), one per layer: trunks, limbs, heads. */
  profile(y0: number, y1: number, f: (y: number) => Section, p: Paint): this {
    const g = this.grid;
    for (let y = Math.max(0, y0); y <= Math.min(g.y - 1, y1); y++) {
      const s = f(y);
      const cx = s.cx ?? g.x / 2;
      const cz = s.cz ?? g.z / 2;
      const e = s.e ?? 2;
      for (let z = 0; z < g.z; z++) {
        for (let x = 0; x < g.x; x++) {
          const dx = Math.abs(x + 0.5 - cx) / s.rx;
          const dz = Math.abs(z + 0.5 - cz) / s.rz;
          if (dx ** e + dz ** e <= 1) this.put(x, y, z, p);
        }
      }
    }
    return this;
  }

  /** Fills an ellipsoid centered on (cx, cy, cz), in voxel units. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, p: Paint): this {
    return this.profile(
      Math.ceil(cy - ry),
      Math.floor(cy + ry),
      (y) => {
        const k = Math.sqrt(Math.max(0, 1 - ((y + 0.5 - cy) / ry) ** 2));
        return { cx, cz, rx: Math.max(0.01, rx * k), rz: Math.max(0.01, rz * k) };
      },
      p,
    );
  }

  /** Changes the color of the cells that are already filled. */
  repaint(p: (x: number, y: number, z: number) => Color): this {
    const g = this.grid;
    for (let y = 0; y < g.y; y++) {
      for (let z = 0; z < g.z; z++) {
        for (let x = 0; x < g.x; x++) if (this.filled(x, y, z)) this.put(x, y, z, p);
      }
    }
    return this;
  }

  /** The frontmost (highest z) filled cell in that column, or -1. */
  private front(x: number, y: number): number {
    for (let z = this.grid.z - 1; z >= 0; z--) if (this.filled(x, y, z)) return z;
    return -1;
  }

  /** Paints the front surface (as seen from +z) over the screen rectangle (x0, y0)–(x1, y1). */
  face(x0: number, y0: number, x1: number, y1: number, p: (x: number, y: number) => Color): this {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const z = this.front(x, y);
        if (z >= 0) this.put(x, y, z, p(x, y));
      }
    }
    return this;
  }

  /** Adds a layer in front of the front surface, wherever `p` returns a color. */
  relief(x0: number, y0: number, x1: number, y1: number, p: (x: number, y: number) => Color): this {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const z = this.front(x, y);
        if (z < 0 || z + 1 >= this.grid.z) continue;
        this.put(x, y, z + 1, p(x, y));
      }
    }
    return this;
  }

  /** Exports what has been painted so far. */
  toModel(): Model {
    return {
      id: this.id,
      name: this.name,
      size: this.size,
      scale: this.scale,
      closed: this.closed,
      palette: [...this.palette],
      emissive: [...this.emissive],
      data: encodeGrid(this.grid),
    };
  }
}
