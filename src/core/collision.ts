import { gridOf, modelOf } from './project.js';
import type { Project, Scene, V3 } from './types.js';

/** For each column of the room: where feet rest and what is above. */
export interface Heightmap {
  x: number;
  z: number;
  scale: number;
  floor: Float32Array;
  ceiling: Float32Array;
}

/** Highest step a body climbs without jumping, in meters. */
export const MAX_STEP = 0.3;
const NO_CEILING = 1e6;

/** Rasterizes the room and its solid instances into floor and ceiling heights per room column. */
export function buildHeightmap(p: Project, s: Scene): Heightmap {
  const room = modelOf(p, s.room);
  const base = gridOf(room);
  const cells = base.cells.slice();
  const scale = room.scale;
  const mark = (x: number, y: number, z: number): void => {
    if (x >= 0 && y >= 0 && z >= 0 && x < base.x && y < base.y && z < base.z) {
      cells[x + z * base.x + y * base.x * base.z] = 1;
    }
  };

  for (const inst of s.instances) {
    if (!inst.solid) continue;
    const m = modelOf(p, inst.model);
    const g = gridOf(m);
    const ms = m.scale;
    const cx = (g.x * ms) / 2;
    const cz = (g.z * ms) / 2;
    const turn = ((inst.rot % 4) + 4) % 4;
    const cos = [1, 0, -1, 0][turn]!;
    const sin = [0, 1, 0, -1][turn]!;
    for (let y = 0; y < g.y; y++) {
      for (let z = 0; z < g.z; z++) {
        for (let x = 0; x < g.x; x++) {
          if (!g.cells[x + z * g.x + y * g.x * g.z]) continue;
          const lx0 = x * ms - cx;
          const lx1 = (x + 1) * ms - cx;
          const lz0 = z * ms - cz;
          const lz1 = (z + 1) * ms - cz;
          const xs = [lx0 * cos + lz0 * sin, lx1 * cos + lz1 * sin];
          const zs = [-lx0 * sin + lz0 * cos, -lx1 * sin + lz1 * cos];
          const x0 = Math.floor((Math.min(xs[0]!, xs[1]!) + inst.pos[0]) / scale + 1e-6);
          const x1 = Math.ceil((Math.max(xs[0]!, xs[1]!) + inst.pos[0]) / scale - 1e-6) - 1;
          const z0 = Math.floor((Math.min(zs[0]!, zs[1]!) + inst.pos[2]) / scale + 1e-6);
          const z1 = Math.ceil((Math.max(zs[0]!, zs[1]!) + inst.pos[2]) / scale - 1e-6) - 1;
          const y0 = Math.floor((inst.pos[1] + y * ms) / scale + 1e-6);
          const y1 = Math.ceil((inst.pos[1] + (y + 1) * ms) / scale - 1e-6) - 1;
          for (let wy = y0; wy <= y1; wy++) {
            for (let wz = z0; wz <= z1; wz++) {
              for (let wx = x0; wx <= x1; wx++) mark(wx, wy, wz);
            }
          }
        }
      }
    }
  }

  const floor = new Float32Array(base.x * base.z);
  const ceiling = new Float32Array(base.x * base.z);
  for (let z = 0; z < base.z; z++) {
    for (let x = 0; x < base.x; x++) {
      const col = x + z * base.x;
      let y = 0;
      while (y < base.y && cells[col + y * base.x * base.z]) y++;
      floor[col] = y * scale;
      if (y === base.y) {
        ceiling[col] = 0;
        continue;
      }
      let above = y;
      while (above < base.y && !cells[col + above * base.x * base.z]) above++;
      ceiling[col] = above === base.y ? NO_CEILING : above * scale;
    }
  }
  return { x: base.x, z: base.z, scale, floor, ceiling };
}

/** Height of the feet if the body fits there; null if it does not. */
export function heightAt(m: Heightmap, x: number, z: number, radius: number, feet: number, height: number): number | null {
  const x0 = Math.floor((x - radius) / m.scale);
  const x1 = Math.floor((x + radius) / m.scale);
  const z0 = Math.floor((z - radius) / m.scale);
  const z1 = Math.floor((z + radius) / m.scale);
  if (x0 < 0 || z0 < 0 || x1 >= m.x || z1 >= m.z) return null;
  let floor = -Infinity;
  let ceiling = Infinity;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const col = cx + cz * m.x;
      floor = Math.max(floor, m.floor[col]!);
      ceiling = Math.min(ceiling, m.ceiling[col]!);
    }
  }
  if (floor > feet + MAX_STEP || ceiling - floor < height) return null;
  return floor;
}

/** Moves `pos` in place one axis at a time, so bodies slide along walls. */
export function moveBody(m: Heightmap, pos: V3, dx: number, dz: number, radius: number, height: number): void {
  const atX = heightAt(m, pos[0] + dx, pos[2], radius, pos[1], height);
  if (atX !== null) {
    pos[0] += dx;
    pos[1] = atX;
  }
  const atZ = heightAt(m, pos[0], pos[2] + dz, radius, pos[1], height);
  if (atZ !== null) {
    pos[2] += dz;
    pos[1] = atZ;
  }
}

export interface NavGrid {
  map: Heightmap;
  /** 1 where a body of `radius` fits standing on the column's floor. */
  free: Uint8Array;
  radius: number;
}

export function buildNavGrid(m: Heightmap, radius: number, height: number): NavGrid {
  const free = new Uint8Array(m.x * m.z);
  for (let z = 0; z < m.z; z++) {
    for (let x = 0; x < m.x; x++) {
      const col = x + z * m.x;
      const cx = (x + 0.5) * m.scale;
      const cz = (z + 0.5) * m.scale;
      if (heightAt(m, cx, cz, radius, m.floor[col]!, height) !== null) free[col] = 1;
    }
  }
  return { map: m, free, radius };
}

/** Distance in cells from each column to the target (breadth-first); -1 where it cannot be reached. */
export function distanceField(r: NavGrid, target: V3): Int32Array {
  const m = r.map;
  const dist = new Int32Array(m.x * m.z).fill(-1);
  const queue = new Int32Array(m.x * m.z);
  let head = 0;
  let tail = 0;
  const ox = Math.floor(target[0] / m.scale);
  const oz = Math.floor(target[2] / m.scale);
  // The target may stand right against furniture: seed the free cells around it.
  const reach = Math.ceil(r.radius / m.scale) + 2;
  for (let z = oz - reach; z <= oz + reach; z++) {
    for (let x = ox - reach; x <= ox + reach; x++) {
      if (x < 0 || z < 0 || x >= m.x || z >= m.z) continue;
      const col = x + z * m.x;
      if (r.free[col]) {
        dist[col] = 0;
        queue[tail++] = col;
      }
    }
  }
  while (head < tail) {
    const c = queue[head++]!;
    const x = c % m.x;
    const z = (c - x) / m.x;
    const d = dist[c]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= m.x || nz >= m.z) continue;
      const v = nx + nz * m.x;
      if (dist[v] !== -1 || !r.free[v]) continue;
      if (Math.abs(m.floor[v]! - m.floor[c]!) > MAX_STEP) continue;
      dist[v] = d + 1;
      queue[tail++] = v;
    }
  }
  return dist;
}

/** Heading (radians) that gets closest to the target along `field`; null if there is no path. */
export function headingToward(r: NavGrid, field: Int32Array, pos: V3): number | null {
  const m = r.map;
  const px = Math.floor(pos[0] / m.scale);
  const pz = Math.floor(pos[2] / m.scale);
  let best = Infinity;
  let heading: number | null = null;
  const reach = 6;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    // Only points reachable in a straight line count, so thin walls are not crossed.
    let d = -1;
    for (let k = 1; k <= reach; k++) {
      const x = Math.round(px + Math.sin(a) * k);
      const z = Math.round(pz + Math.cos(a) * k);
      if (x < 0 || z < 0 || x >= m.x || z >= m.z || field[x + z * m.x]! < 0) {
        d = -1;
        break;
      }
      d = field[x + z * m.x]!;
    }
    if (d >= 0 && d < best) {
      best = d;
      heading = a;
    }
  }
  return heading;
}
