import type { V3 } from '../core/types.js';
import { getCell, type Grid } from '../core/voxel.js';

/** Flat vertex buffers, ready for a three.js BufferGeometry. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/** Emissive voxels go to their own mesh so they can use an unlit material. */
export interface VoxelMeshData {
  solid: MeshData;
  emissive: MeshData;
}

interface Face {
  n: V3;
  u: V3;
  v: V3;
}

// u × v = n, so faces wind counter-clockwise seen from outside.
const FACES: Face[] = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

/** Brightness per ambient occlusion level (0 = fully occluded corner). */
const OCCLUSION = [0.42, 0.62, 0.82, 1];
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function linearPalette(palette: number[]): V3[] {
  return palette.map((c) => [toLinear(((c >> 16) & 255) / 255), toLinear(((c >> 8) & 255) / 255), toLinear((c & 255) / 255)]);
}

/** Stable per-voxel variation, so surfaces do not look flat. */
function grain(x: number, y: number, z: number): number {
  let h = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  h = (h ^ (h >>> 13)) * 1274126177;
  return 0.94 + (((h ^ (h >>> 16)) & 255) / 255) * 0.12;
}

class Accumulator {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  ind: number[] = [];

  finish(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      colors: new Float32Array(this.col),
      indices: new Uint32Array(this.ind),
    };
  }
}

export interface MeshOptions {
  palette: number[];
  emissive: number[];
  /** Skip faces that look out of the grid (rooms). */
  closed: boolean;
  /** First cell of the range, inclusive. */
  from: V3;
  /** End of the range, exclusive. */
  to: V3;
  /** Cells with y greater or equal are not drawn (the editor's cut). */
  cutY?: number;
}

/** Builds the visible faces of the range [from, to), with per-vertex ambient occlusion. Positions are in voxels. */
export function meshVoxels(g: Grid, o: MeshOptions): VoxelMeshData {
  const colors = linearPalette(o.palette);
  const emits = new Set(o.emissive);
  const solid = new Accumulator();
  const emissive = new Accumulator();
  const cut = o.cutY ?? Infinity;

  const filled = (x: number, y: number, z: number): number => (y < cut && getCell(g, x, y, z) !== 0 ? 1 : 0);
  const outside = (x: number, y: number, z: number): boolean => x < 0 || y < 0 || z < 0 || x >= g.x || y >= g.y || z >= g.z;

  for (let y = o.from[1]; y < Math.min(o.to[1], cut); y++) {
    for (let z = o.from[2]; z < o.to[2]; z++) {
      for (let x = o.from[0]; x < o.to[0]; x++) {
        const value = getCell(g, x, y, z);
        if (value === 0) continue;
        const target = emits.has(value) ? emissive : solid;
        const color = colors[value] ?? [1, 0, 1];
        const brightness = emits.has(value) ? 1 : grain(x, y, z);

        for (const { n, u, v } of FACES) {
          const cx = x + n[0];
          const cy = y + n[1];
          const cz = z + n[2];
          if (outside(cx, cy, cz) ? o.closed : filled(cx, cy, cz)) continue;

          const bx = x + Math.max(n[0], 0);
          const by = y + Math.max(n[1], 0);
          const bz = z + Math.max(n[2], 0);
          const ao: number[] = [];
          const base = target.pos.length / 3;

          for (const [su, sv] of CORNERS) {
            const side1 = filled(cx + su * u[0], cy + su * u[1], cz + su * u[2]);
            const side2 = filled(cx + sv * v[0], cy + sv * v[1], cz + sv * v[2]);
            const corner = filled(cx + su * u[0] + sv * v[0], cy + su * u[1] + sv * v[1], cz + su * u[2] + sv * v[2]);
            const level = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
            ao.push(level);
            const mu = su > 0 ? 1 : 0;
            const mv = sv > 0 ? 1 : 0;
            target.pos.push(bx + mu * u[0] + mv * v[0], by + mu * u[1] + mv * v[1], bz + mu * u[2] + mv * v[2]);
            target.nor.push(n[0], n[1], n[2]);
            const light = brightness * (emits.has(value) ? 1 : OCCLUSION[level]!);
            target.col.push(color[0]! * light, color[1]! * light, color[2]! * light);
          }
          // Pick the diagonal that leaves no visible seam in the occlusion.
          if (ao[0]! + ao[2]! >= ao[1]! + ao[3]!) {
            target.ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            target.ind.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
  }
  return { solid: solid.finish(), emissive: emissive.finish() };
}
