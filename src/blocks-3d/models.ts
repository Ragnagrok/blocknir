/**
 * The voxel models of the default skin, painted in code with `VoxelCanvas`. Original, simple and
 * readable from a three-quarter camera: every item faces +z (the camera) and stands on y = 0.
 * Models are plain data, built once per name and cached.
 */
import type { Clip, Figure, Model, Part, V3 } from '../core/index.js';
import { hash3, noise3, shade, VoxelCanvas, type Paint } from '../paint/index.js';

/** Meters per voxel of items and tiles. */
export const S = 1 / 16;

const cache = new Map<string, Model>();
/** Builds a model once per key. */
export function memo(key: string, build: () => VoxelCanvas): Model {
  let m = cache.get(key);
  if (!m) {
    m = build().toModel();
    cache.set(key, m);
  }
  return m;
}

const canvas = (id: string, size: V3, scale = S): VoxelCanvas => new VoxelCanvas(id, id, size, scale);
/** A base color with gentle blotches of its lighter and darker shades. */
const mottled = (c: number, amount = 0.08, cell = 3): Paint => (x, y, z) => {
  const n = noise3(x, y, z, cell);
  return n > 0.68 ? shade(c, 1 + amount) : n < 0.3 ? shade(c, 1 - amount) : c;
};

// ---------------------------------------------------------------------------------------------
// Terrain tiles: 16 × 6 × 16 voxels (1 × 0.375 × 1 m), top at the last layer
// ---------------------------------------------------------------------------------------------

export interface TileStyle {
  top: number;
  side: number;
  /** Sparse lighter or darker specks on the top. */
  speck?: number;
  speckChance?: number;
  /** Pattern of the top, by voxel: return a color to override. */
  pattern?: (x: number, z: number) => number | undefined;
  /** Layers of top color down the sides. Default 1. */
  rim?: number;
  height?: number;
  /** The top layer has a darker border (the grid lines). Default true. */
  border?: boolean;
}

export function tileModel(id: string, s: TileStyle, shadeIndex: 0 | 1): Model {
  return memo(`tile:${id}:${shadeIndex}`, () => {
    const h = s.height ?? 6;
    const c = canvas(`tile_${id}_${shadeIndex}`, [16, h, 16]);
    const k = shadeIndex ? 0.93 : 1;
    const top = shade(s.top, k);
    c.box(0, 0, 0, 15, h - 1, 15, (x, y, z) => {
      const surface = y === h - 1;
      if (surface) {
        const edge = x === 0 || z === 0 || x === 15 || z === 15;
        const p = s.pattern?.(x, z);
        let col = p !== undefined ? shade(p, k) : top;
        if (p === undefined) {
          const n = noise3(x, 0, z, 3);
          col = n > 0.7 ? shade(top, 1.05) : n < 0.28 ? shade(top, 0.95) : top;
          if (s.speck !== undefined && hash3(x, z, 7) < (s.speckChance ?? 0.06)) col = shade(s.speck, k);
        }
        return edge && s.border !== false ? shade(col, 0.86) : col;
      }
      if (y >= h - (s.rim ?? 1)) return shade(top, 0.9);
      const n = noise3(x, y, z, 2);
      return n > 0.66 ? shade(s.side, 1.08) : n < 0.3 ? shade(s.side, 0.9) : s.side;
    });
    return c;
  });
}

export const TILES: Record<string, TileStyle> = {
  grass: { top: 0x86d460, side: 0xa8784a, speck: 0xb6ec80, speckChance: 0.07, rim: 2 },
  path: { top: 0xecd29c, side: 0xb88c5c, speck: 0xc9a670, speckChance: 0.09 },
  sand: { top: 0xf6e3ac, side: 0xe0c48a, speck: 0xffffff, speckChance: 0.04 },
  water: {
    top: 0x58c4ea,
    side: 0x3aa6d6,
    height: 4,
    border: false,
    pattern: (x, z) => {
      const w = Math.sin(x * 0.9 + z * 0.35) + Math.sin(z * 1.3 - x * 0.2);
      return w > 1.45 ? 0xb8f0ff : w > 0.9 ? 0x84dcf6 : undefined;
    },
  },
  rock: { top: 0xb7b4aa, side: 0x8e8a80, speck: 0x9a968c, speckChance: 0.12 },
  patio: {
    top: 0xf1ead8,
    side: 0xc9bfa6,
    border: false,
    pattern: (x, z) => (x % 8 === 0 || z % 8 === 0 ? 0xddd3bb : hash3(x >> 3, z >> 3, 5) < 0.5 ? 0xf4eedf : undefined),
  },
  wood: {
    top: 0xd09a5e,
    side: 0x9a6a3c,
    border: false,
    pattern: (x, z) => (z % 4 === 3 ? 0x8a5a32 : (x + (z >> 2) * 5) % 16 === 0 ? 0xa8743e : hash3(x, z, 3) < 0.15 ? 0xdca86c : undefined),
  },
  start: {
    top: 0xecd29c,
    side: 0xb88c5c,
    pattern: (x, z) => {
      const d = Math.hypot(x - 7.5, z - 7.5);
      return d > 4.2 && d < 6.2 ? 0xffffff : undefined;
    },
  },
  goal: {
    top: 0xffd75a,
    side: 0xc89a3a,
    pattern: (x, z) => ((x >> 2) + (z >> 2)) % 2 === 0 ? 0xffe68a : undefined,
  },
  flowers: {
    top: 0x86d460,
    side: 0xa8784a,
    rim: 2,
    pattern: (x, z) => {
      const h = hash3(x, z, 11);
      return h < 0.04 ? 0xff7ab8 : h < 0.08 ? 0xfff07a : h < 0.1 ? 0xffffff : undefined;
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Board pieces
// ---------------------------------------------------------------------------------------------

/** A low stone wall, 1 m long along x. */
export const wallModel = (): Model =>
  memo('wall', () => {
    const c = canvas('wall', [16, 9, 4]);
    c.box(0, 0, 0, 15, 7, 3, (x, y) => {
      const row = y >> 1;
      const off = row % 2 ? 2 : 0;
      const mortar = y % 2 === 1 && y < 7 ? false : (x + off) % 4 === 0;
      const base = hash3((x + off) >> 2, row, 1) < 0.5 ? 0xe2ddd0 : 0xcfc9ba;
      return mortar || (y % 2 === 1 && y < 7 && false) ? 0xa59f90 : base;
    });
    c.box(0, 8, 0, 15, 8, 3, 0x9ec46a);
    c.box(0, 7, 0, 15, 7, 3, (x) => (x % 5 === 2 ? 0xb4dc7a : 0xbdb6a6));
    return c;
  });

/** A white arrow on the floor pointing east (+x). */
export const arrowModel = (): Model =>
  memo('arrow', () => {
    const c = canvas('arrow', [14, 1, 14]);
    const inside = (x: number, z: number): boolean => (x >= 1 && x <= 7 && z >= 5 && z <= 8) || (x >= 7 && x <= 13 && Math.abs(z - 6.5) <= 13 - x);
    c.box(0, 0, 0, 13, 0, 13, (x, _y, z) => {
      if (!inside(x, z)) return null;
      const edge = !inside(x - 1, z) || !inside(x + 1, z) || !inside(x, z - 1) || !inside(x, z + 1);
      return edge ? 0xf08a30 : 0xfff6dc;
    });
    return c;
  });

/** A mossy boulder that fills a wall cell. */
export const boulderModel = (): Model =>
  memo('boulder', () => {
    const c = canvas('boulder', [15, 12, 14]);
    c.ellipsoid(7.5, 4.6, 7, 7.2, 5.6, 6.6, (x, y, z) => {
      const n = noise3(x, y, z, 3);
      if (y >= 8 && n > 0.45) return 0x8cc865;
      return n > 0.65 ? 0xc4c0b4 : n < 0.3 ? 0x8f8b80 : 0xaaa69a;
    });
    return c;
  });

/** A round bush with berries. */
export const bushModel = (): Model =>
  memo('bush', () => {
    const c = canvas('bush', [16, 13, 15]);
    c.ellipsoid(8, 5.5, 7.5, 7.6, 5.8, 7, mottled(0x4fae48, 0.14, 2));
    c.ellipsoid(5, 8.2, 8, 4, 4, 4, mottled(0x5cbf50, 0.12, 2));
    c.ellipsoid(11, 7.8, 7, 4, 4, 4, mottled(0x5cbf50, 0.12, 2));
    c.repaint((x, y, z) => (hash3(x, y, z) < 0.035 && y > 3 ? 0xff5a6a : undefined));
    return c;
  });

/** A palm tree for the beach around the board. */
export const palmModel = (): Model =>
  memo('palm', () => {
    const c = canvas('palm', [26, 34, 26]);
    let px = 13;
    for (let y = 0; y < 26; y++) {
      px = 13 + Math.round(Math.sin(y / 9) * 3);
      c.box(px - 1, y, 12, px + 1, y, 14, y % 3 === 0 ? 0x9a6a3a : 0xb88450);
    }
    const top = 26;
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2 + 0.3;
      for (let r = 0; r < 12; r++) {
        const x = Math.round(px + Math.cos(ang) * r);
        const z = Math.round(13 + Math.sin(ang) * r);
        const y = Math.round(top + 3 - (r * r) / 22);
        c.box(x - 1, y, z - 1, x + 1, y, z + 1, r % 4 === 3 ? 0x3e9a3a : 0x52b848);
      }
    }
    c.ellipsoid(px, top, 13, 2.6, 2, 2.6, 0x8a5a2a);
    return c;
  });

/** Wooden planks lying on the floor (a dock). */
export const dockModel = (): Model =>
  memo('dock', () => {
    const c = canvas('dock', [16, 2, 16]);
    c.box(1, 0, 1, 14, 1, 14, (x, y, z) => (y === 0 ? (x === 2 || x === 13 ? 0x7a4a2a : null) : z % 4 === 0 ? 0x8a5a32 : hash3(x >> 2, z >> 2, 1) < 0.5 ? 0xd09a5e : 0xc08a52));
    return c;
  });

/** A few shells and pebbles on the sand. */
export const shellsModel = (): Model =>
  memo('shells', () => {
    const c = canvas('shells', [10, 2, 10]);
    c.box(1, 0, 2, 2, 0, 3, 0xffb4a8).box(6, 0, 6, 7, 1, 7, 0xffffff).box(3, 0, 7, 3, 0, 7, 0xc8c0b0).box(8, 0, 1, 8, 0, 2, 0xffd0a0);
    return c;
  });

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

export const lampModel = (on: boolean, color = 0xffd25a): Model =>
  memo(`lamp:${on}:${color}`, () => {
    const c = canvas(on ? 'lamp_on' : 'lamp_off', [8, 19, 8]);
    const frame = 0x2f5a4a;
    const glass = on ? color : 0x6f8796;
    if (on) c.emit(glass).emit(0xfff2b0);
    c.box(1, 0, 1, 6, 1, 6, (x, y, z) => (y === 1 && (x === 1 || x === 6 || z === 1 || z === 6) ? 0x3d7060 : frame));
    c.box(3, 2, 3, 4, 12, 4, (_x, y) => (y % 4 === 0 ? 0x2a5040 : 0x3d7060));
    c.box(1, 13, 1, 6, 16, 6, (x, y, z) => {
      const corner = (x === 1 || x === 6) && (z === 1 || z === 6);
      if (corner || y === 13) return frame;
      return on && y === 15 && (x === 3 || x === 4 || z === 3 || z === 4) ? 0xfff2b0 : glass;
    });
    c.box(0, 17, 0, 7, 17, 7, frame).box(2, 18, 2, 5, 18, 5, frame);
    return c;
  });

export const appleModel = (): Model =>
  memo('apple', () => {
    const c = canvas('apple', [10, 11, 10]);
    c.ellipsoid(5, 4.4, 5, 4.6, 4.3, 4.6, (x, y, z) => (x < 4 && y > 5 && z > 5 ? 0xff7a66 : y < 2 ? 0xc22a2e : 0xec3a3a));
    c.box(5, 8, 5, 5, 9, 5, 0x6a4428).box(6, 9, 5, 7, 9, 6, 0x5cbf3a).box(7, 10, 5, 7, 10, 5, 0x5cbf3a);
    return c;
  });

export const orangeModel = (): Model =>
  memo('orange', () => {
    const c = canvas('orange', [10, 10, 10]);
    c.ellipsoid(5, 4.4, 5, 4.6, 4.3, 4.6, (x, y, z) => (x < 4 && y > 5 && z > 5 ? 0xffc060 : hash3(x, y, z) < 0.12 ? 0xf08a10 : 0xff9a1f));
    c.box(5, 8, 5, 5, 8, 5, 0x6a4428).box(4, 9, 5, 6, 9, 5, 0x4fae3a);
    return c;
  });

export const bananaModel = (): Model =>
  memo('banana', () => {
    const c = canvas('banana', [14, 9, 6]);
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const x = 1.6 + t * 10.8;
      const y = 1.9 + 4.6 * (2 * t - 1) ** 2;
      const r = 1.9 - Math.abs(2 * t - 1) * 0.8;
      c.ellipsoid(x, y, 3, r, r, r, (_x, yy) => (yy > y + 0.6 ? 0xffe866 : 0xffd23a));
    }
    c.box(0, 6, 2, 1, 7, 3, 0x6a4a20).box(12, 6, 2, 13, 7, 3, 0x6a4a20);
    return c;
  });

/** Point in a five-pointed star centered on (cx, cy). */
function inStar(x: number, y: number, cx: number, cy: number, outer: number, inner: number): boolean {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const starModel = (): Model =>
  memo('star', () => {
    const c = canvas('star', [13, 13, 3]);
    c.box(0, 0, 0, 12, 12, 2, (x, y, z) => {
      if (!inStar(x + 0.5, y + 0.5, 6.5, 6.1, 6.4, 2.7)) return null;
      const edge = !inStar(x + 1.5, y + 0.5, 6.5, 6.1, 6.4, 2.7) || !inStar(x - 0.5, y + 0.5, 6.5, 6.1, 6.4, 2.7) || !inStar(x + 0.5, y - 0.5, 6.5, 6.1, 6.4, 2.7);
      return z === 1 ? (edge ? 0xf2a51a : 0xffd83a) : 0xf2a51a;
    });
    c.box(4, 7, 2, 5, 8, 2, 0xfff4b0);
    return c;
  });

export const cheeseModel = (): Model =>
  memo('cheese', () => {
    const c = canvas('cheese', [12, 7, 10]);
    c.box(0, 0, 0, 11, 6, 9, (x, y, z) => {
      if (x > 11 - z * 1.15) return null;
      const hole = noise3(x, y, z, 2) > 0.74;
      return hole ? 0xe8a828 : y === 6 ? 0xffe070 : 0xffcf3a;
    });
    return c;
  });

export const computerModel = (on: boolean): Model =>
  memo(`computer:${on}`, () => {
    const c = canvas(on ? 'computer_on' : 'computer_off', [12, 12, 10]);
    const screen = on ? 0x7fe8ff : 0x2c3a46;
    if (on) c.emit(screen).emit(0xe0fcff);
    c.box(4, 0, 1, 7, 2, 3, 0xd8ccb4);
    c.box(1, 3, 0, 10, 11, 5, (x, y) => (y === 3 || y === 11 || x === 1 || x === 10 ? 0xe2d8c2 : 0xf2ead8));
    c.box(2, 4, 5, 9, 10, 5, (x, y) => (on && y % 2 === 0 && y < 10 && x > 2 && x < 3 + ((y * 3 + 2) % 6) ? 0xe0fcff : screen));
    c.box(1, 0, 6, 10, 1, 9, (x, y, z) => (y === 1 && (x + z) % 2 === 0 && x > 1 && x < 10 && z > 6 ? 0x8a8a8a : 0xcfcfcf));
    return c;
  });

export const flagModel = (): Model =>
  memo('flag', () => {
    const c = canvas('flag', [11, 19, 4]);
    c.box(0, 0, 0, 3, 1, 3, 0xa8a49a).box(1, 2, 1, 2, 17, 2, 0xe8e8e8).box(1, 18, 1, 2, 18, 2, 0xffcf3a);
    c.box(3, 10, 1, 10, 17, 2, (x, y) => {
      const d = Math.abs(y - 13.5);
      if (x - 3 > 7.5 * (1 - d / 4.2)) return null;
      return (x + y) % 5 === 0 ? 0xff6a50 : 0xff3e34;
    });
    return c;
  });

export const fishModel = (): Model =>
  memo('fish', () => {
    const c = canvas('fish', [14, 9, 5]);
    c.ellipsoid(5.5, 4.5, 2.5, 4.8, 3.4, 2.2, (x) => (x === 6 || x === 7 ? 0xffffff : 0xff8a3a));
    c.box(9, 1, 2, 13, 8, 2, (x, y) => (Math.abs(y - 4.5) <= x - 8.5 ? 0xff6a2a : null));
    c.box(2, 5, 4, 2, 5, 4, 0x1c2630).box(2, 5, 0, 2, 5, 0, 0x1c2630);
    return c;
  });

export const foodModel = (): Model =>
  memo('food', () => {
    const c = canvas('food', [12, 8, 12]);
    c.profile(0, 4, (y) => ({ rx: 3.2 + y * 0.6, rz: 3.2 + y * 0.6 }), (_x, y) => (y === 4 ? 0xff9a7a : 0xff6a4a));
    c.ellipsoid(6, 4.6, 6, 5, 2.6, 5, (x, y, z) => (hash3(x, y, z) < 0.12 ? 0x6ac04a : hash3(z, x, y) < 0.1 ? 0xe85a3a : 0xfff0c8));
    return c;
  });

export const keyModel = (): Model =>
  memo('key', () => {
    const c = canvas('key', [13, 8, 3]);
    c.box(0, 0, 0, 12, 7, 2, (x, y) => {
      const ring = Math.hypot(x - 2.8, y - 4.2);
      if (ring <= 2.9 && ring >= 1.2) return 0xffc83a;
      if (x >= 5 && x <= 12 && y >= 3 && y <= 4) return 0xffd65a;
      if ((x === 9 || x === 11) && y >= 1 && y <= 2) return 0xf0b020;
      return null;
    });
    return c;
  });

export const chestModel = (): Model =>
  memo('chest', () => {
    const c = canvas('chest', [13, 11, 10]);
    c.box(0, 0, 0, 12, 6, 9, (x, y) => (x === 2 || x === 10 ? 0xffc83a : y % 3 === 0 ? 0x8a5430 : 0xb06e3c));
    c.profile(7, 10, (y) => ({ rx: 6.6, rz: Math.max(1, 5 - (y - 7) ** 1.6 * 0.9), e: 3 }), (x, y) => (x === 2 || x === 10 ? 0xffc83a : y === 7 ? 0x8a5430 : 0xc07a44));
    c.box(5, 4, 10, 7, 7, 10, 0xffd65a).box(6, 5, 10, 6, 5, 10, 0x5a3a1a);
    return c;
  });

export const lensModel = (): Model =>
  memo('lens', () => {
    const c = canvas('lens', [10, 12, 3]);
    c.box(4, 0, 0, 5, 1, 2, 0xb08030);
    c.box(0, 2, 0, 9, 11, 2, (x, y, z) => {
      const d = Math.hypot(x - 4.5, y - 6.5);
      if (d > 4.9) return null;
      if (d > 3.6) return 0xe0a83a;
      return z === 1 ? (x < 4 && y > 7 ? 0xffffff : 0xa8e4ff) : null;
    });
    return c;
  });

export const lighthouseModel = (lit: boolean): Model =>
  memo(`lighthouse:${lit}`, () => {
    const c = canvas(lit ? 'lighthouse_on' : 'lighthouse', [10, 22, 10]);
    if (lit) c.emit(0xffe080);
    c.profile(0, 14, (y) => ({ rx: 4.4 - y * 0.08, rz: 4.4 - y * 0.08 }), (_x, y) => ((y >> 2) % 2 ? 0xffffff : 0xf04a3a));
    c.profile(15, 15, () => ({ rx: 4.6, rz: 4.6 }), 0x3a3a46);
    c.profile(16, 18, () => ({ rx: 2.9, rz: 2.9 }), (x, _y, z) => (x === 5 || z === 5 ? 0x3a3a46 : lit ? 0xffe080 : 0xbfe4f0));
    c.profile(19, 21, (y) => ({ rx: 3.6 - (y - 19) * 1.3, rz: 3.6 - (y - 19) * 1.3 }), 0xf04a3a);
    return c;
  });

export const coinModel = (): Model =>
  memo('coin', () => {
    const c = canvas('coin', [10, 10, 3]);
    c.box(0, 0, 0, 9, 9, 2, (x, y, z) => {
      const d = Math.hypot(x - 4.5, y - 4.5);
      if (d > 4.8) return null;
      if (z === 1 && d < 3.4 && inStar(x + 0.5, y + 0.5, 5, 4.7, 3.2, 1.4)) return 0xfff0a0;
      return d > 3.8 ? 0xe8a81a : 0xffcf3a;
    });
    return c;
  });

export const gemModel = (): Model =>
  memo('gem', () => {
    const c = canvas('gem', [9, 10, 9]);
    c.box(0, 0, 0, 8, 9, 8, (x, y, z) => {
      const d = Math.abs(x - 4) + Math.abs(z - 4);
      const r = y < 6 ? (y / 6) * 4.5 : 4.5 - (y - 6) * 1.2;
      if (d > r) return null;
      return y > 6 ? 0xa8f4ff : x < 4 ? 0x5ad8ff : 0x34b4ee;
    });
    return c;
  });

export const flowerModel = (): Model =>
  memo('flower', () => {
    const c = canvas('flower', [11, 14, 5]);
    c.box(5, 0, 2, 5, 8, 2, 0x4fae3a).box(6, 3, 2, 7, 3, 2, 0x5cbf3a).box(3, 5, 2, 4, 5, 2, 0x5cbf3a);
    c.box(1, 7, 1, 9, 13, 3, (x, y, z) => {
      const d = Math.hypot(x - 5, y - 10);
      if (d < 1.6) return z === 3 || z === 2 ? 0xffd23a : null;
      if (d < 4.2 && z === 2) return Math.round((Math.atan2(y - 10, x - 5) / Math.PI) * 3) % 2 ? 0xff8ac0 : 0xff6aa8;
      return null;
    });
    return c;
  });

export const shellModel = (): Model =>
  memo('shell', () => {
    const c = canvas('shell', [11, 8, 4]);
    c.box(0, 0, 0, 10, 7, 3, (x, y, z) => {
      const d = Math.hypot(x - 5, y);
      if (d > 5.8 || (z === 3 && d > 4.8)) return null;
      const a = Math.atan2(y, x - 5);
      return Math.round(a * 4) % 2 ? 0xffc4b4 : 0xff9a8a;
    });
    return c;
  });

export const crateModel = (): Model =>
  memo('crate', () => {
    const c = canvas('crate', [11, 11, 11]);
    c.box(0, 0, 0, 10, 10, 10, (x, y, z) => {
      const ex = x === 0 || x === 10;
      const ey = y === 0 || y === 10;
      const ez = z === 0 || z === 10;
      if ((ex && ey) || (ey && ez) || (ex && ez)) return 0x8a5430;
      return (x + y) % 5 === 0 || (z + y) % 5 === 0 ? 0xb87a44 : 0xd09a5e;
    });
    return c;
  });

export const boatModel = (): Model =>
  memo('boat', () => {
    const c = canvas('boat', [16, 6, 9]);
    c.profile(0, 5, (y) => ({ rx: 5.5 + y * 0.45, rz: 2.4 + y * 0.35, e: 2.2 }), (_x, y) => (y === 5 ? 0xf04a3a : y > 2 ? 0xffffff : 0x3a7cf0));
    c.box(3, 1, 2, 12, 4, 6, null);
    c.box(7, 1, 2, 8, 3, 6, 0xc08a52);
    return c;
  });

export const hammockModel = (): Model =>
  memo('hammock', () => {
    const c = canvas('hammock', [16, 11, 5]);
    c.box(0, 0, 2, 1, 10, 3, 0x9a6a3a).box(14, 0, 2, 15, 10, 3, 0x9a6a3a);
    for (let x = 2; x <= 13; x++) {
      const y = Math.round(3 + ((x - 7.5) / 5.5) ** 2 * 5);
      c.box(x, y, 1, x, y + 1, 3, x % 2 ? 0xff7a5a : 0xffd65a);
    }
    return c;
  });

export const bookModel = (): Model =>
  memo('book', () => {
    const c = canvas('book', [9, 11, 4]);
    c.box(0, 0, 0, 8, 10, 3, (x, y, z) => (z === 3 && x > 1 && x < 7 && y > 6 && y < 9 ? 0xffd65a : x === 0 ? 0x8a2a3a : z === 1 || z === 2 ? (x === 8 ? 0xfaf4e4 : 0xc0384a) : 0xc0384a));
    return c;
  });

export const ballModel = (): Model =>
  memo('ball', () => {
    const c = canvas('ball', [10, 10, 10]);
    c.ellipsoid(5, 5, 5, 4.8, 4.8, 4.8, (x, y, z) => {
      if (y > 8) return 0xffffff;
      const a = Math.atan2(z - 5, x - 5);
      const k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 6);
      return [0xff4a3a, 0xffffff, 0x3a8cf0, 0xffffff, 0xffd23a, 0xffffff][k] ?? 0xffffff;
    });
    return c;
  });

export const cakeModel = (): Model =>
  memo('cake', () => {
    const c = canvas('cake', [12, 11, 12]);
    c.profile(0, 0, () => ({ rx: 5.9, rz: 5.9 }), 0xeeeeee);
    c.profile(1, 7, () => ({ rx: 5, rz: 5 }), (_x, y) => (y === 4 ? 0xfff0f0 : y === 7 ? 0xffb4c8 : 0xa8643a));
    c.repaint((x, y, z) => (y === 6 && hash3(x, z, 2) < 0.4 ? 0xffb4c8 : undefined));
    c.ellipsoid(6, 8.6, 6, 1.4, 1.4, 1.4, 0xe8283a);
    c.box(6, 10, 6, 6, 10, 6, 0x4a8a2a);
    return c;
  });

export const crumbsModel = (): Model =>
  memo('crumbs', () => {
    const c = canvas('crumbs', [14, 1, 14]);
    c.box(0, 0, 0, 13, 0, 13, (x, _y, z) => (hash3(x, z, 4) < 0.09 ? (hash3(z, x, 1) < 0.5 ? 0x8a5430 : 0xc08a52) : null));
    return c;
  });

export const maskModel = (): Model =>
  memo('mask', () => {
    const c = canvas('mask', [13, 13, 3]);
    c.box(6, 0, 1, 6, 6, 1, 0x9a6a3a);
    c.box(0, 6, 0, 12, 11, 2, (x, y, z) => {
      const dx = Math.abs(x - 6);
      if (y === 11 && dx > 4) return null;
      if (y === 6 && dx < 2) return null;
      if (y >= 8 && y <= 9 && (dx === 3 || dx === 2)) return null;
      return z === 2 && hash3(x, y, 3) < 0.15 ? 0xffd65a : 0x9a5ae0;
    });
    return c;
  });

/** A 3 × 5 font for letters and digits on paper. */
const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '111101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', '?': '110001010000010',
};

/** A sheet of paper standing up, with a big letter (or scribbles). */
export const paperModel = (letter: string | null): Model =>
  memo(`paper:${letter}`, () => {
    const c = canvas('paper', [10, 14, 2]);
    const g = letter ? GLYPHS[letter.toUpperCase()] : undefined;
    c.box(0, 0, 0, 9, 13, 0, 0xd8d2c0);
    c.box(0, 0, 1, 9, 13, 1, (x, y) => {
      if (g) {
        const gx = Math.floor((x - 2) / 2);
        const gy = 4 - Math.floor((y - 2) / 2);
        if (x >= 2 && x <= 7 && y >= 2 && y <= 11 && g[gy * 3 + gx] === '1') return 0x2a3a8a;
      } else if (y % 3 === 0 && y > 1 && y < 12 && x > 1 && x < 3 + ((y * 7) % 7)) {
        return 0x6a7aa0;
      }
      return x === 9 && y === 13 ? 0xe8e2d0 : 0xfdfbf2;
    });
    return c;
  });

export const cartridgeModel = (): Model =>
  memo('cartridge', () => {
    const c = canvas('cartridge', [10, 11, 3]);
    c.box(0, 0, 0, 9, 10, 2, (x, y, z) => {
      if (y === 10 && (x === 0 || x === 9)) return null;
      if (z === 2 && x > 1 && x < 8 && y > 3 && y < 9) return y > 6 ? 0xff4a3a : x < 5 ? 0xffd23a : 0x3a8cf0;
      return y < 2 && x % 2 === 0 ? 0xc8a020 : 0x8a8a96;
    });
    return c;
  });

export const mushroomModel = (): Model =>
  memo('mushroom', () => {
    const c = canvas('mushroom', [11, 10, 11]);
    c.profile(0, 4, () => ({ rx: 1.8, rz: 1.8 }), 0xfff4e0);
    c.ellipsoid(5.5, 5.5, 5.5, 5.2, 3.8, 5.2, (x, y, z) => (y < 5 ? null : hash3(x, y, z) < 0.14 ? 0xffffff : 0xf0403a));
    return c;
  });

export const heartModel = (): Model =>
  memo('heart', () => {
    const c = canvas('heart', [11, 10, 3]);
    c.box(0, 0, 0, 10, 9, 2, (x, y) => {
      const u = (x + 0.5 - 5.5) / 5;
      const v = (y + 0.5 - 5) / 5;
      const f = (u * u + v * v - 0.6) ** 3 - u * u * v * v * v;
      return f <= 0 ? (x < 4 && y > 6 ? 0xff9aa8 : 0xf0384a) : null;
    });
    return c;
  });

export const treeModel = (): Model =>
  memo('tree', () => {
    const c = canvas('tree', [16, 22, 16]);
    c.box(7, 0, 7, 8, 9, 8, 0x9a6a3a);
    c.ellipsoid(8, 14, 8, 7, 6.8, 7, mottled(0x4fae48, 0.14, 2));
    c.repaint((x, y, z) => (y > 9 && hash3(x, y, z) < 0.03 ? 0xff5a4a : undefined));
    return c;
  });

/** The fallback marker: a little wooden sign post. */
export const signModel = (color: number): Model =>
  memo(`sign:${color}`, () => {
    const c = canvas('sign', [10, 12, 3]);
    c.box(4, 0, 1, 5, 6, 1, 0x9a6a3a);
    c.box(0, 6, 0, 9, 11, 1, (x, y) => (x === 0 || x === 9 || y === 6 || y === 11 ? shade(color, 0.75) : color));
    return c;
  });

// ---------------------------------------------------------------------------------------------
// Realtime actors
// ---------------------------------------------------------------------------------------------

export const crabModel = (): Model =>
  memo('crab', () => {
    const c = canvas('crab', [16, 9, 12]);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) c.box(8 + side * 5, 0, 3 + i * 2, 8 + side * 6, 2, 3 + i * 2, 0xc8382a);
      c.ellipsoid(8 + side * 5.5, 3.5, 9.5, 2, 1.6, 1.8, 0xff6a4a);
      c.box(8 + side * 2 - (side > 0 ? 1 : 0), 5, 7, 8 + side * 2 - (side > 0 ? 1 : 0), 7, 7, 0xf05a3a);
      c.box(8 + side * 2 - (side > 0 ? 1 : 0), 8, 7, 8 + side * 2 - (side > 0 ? 1 : 0), 8, 7, 0x1c2630);
    }
    c.ellipsoid(8, 3.4, 5.5, 5, 2.6, 4, (x, y, z) => (y > 4 && x < 7 && z > 5 ? 0xff8a6a : 0xf05a3a));
    c.box(7, 3, 9, 8, 3, 9, 0x8a2a20);
    return c;
  });

export const gullModel = (): Model =>
  memo('gull', () => {
    const c = canvas('gull', [18, 7, 12]);
    c.ellipsoid(9, 3, 6, 3, 2.4, 4.6, (_x, y) => (y < 2 ? 0xe8eef2 : 0xffffff));
    c.box(1, 3, 4, 17, 3, 7, (x) => (Math.abs(x - 9) < 3 ? 0xffffff : Math.abs(x - 9) > 6 ? 0x5a6068 : 0xb8c0c8));
    c.ellipsoid(9, 4.6, 10, 1.8, 1.6, 1.6, 0xffffff);
    c.box(9, 4, 11, 9, 4, 11, 0xffa02a).box(8, 5, 11, 8, 5, 11, 0x1c2630).box(10, 5, 11, 10, 5, 11, 0x1c2630);
    return c;
  });

export const cloudModel = (): Model =>
  memo('cloud', () => {
    const c = canvas('cloud', [20, 10, 12]);
    const puff: Paint = (_x, y) => (y < 3 ? 0xdde6ee : 0xffffff);
    c.ellipsoid(10, 4.5, 6, 6.5, 4, 5, puff).ellipsoid(5, 3.6, 6, 4, 3.2, 4, puff).ellipsoid(15, 3.8, 6, 4.2, 3.4, 4, puff);
    c.box(8, 4, 11, 8, 5, 11, 0x5a6a7a).box(12, 4, 11, 12, 5, 11, 0x5a6a7a);
    return c;
  });

export const dropModel = (): Model =>
  memo('drop', () => {
    const c = canvas('drop', [6, 9, 6]);
    c.profile(0, 8, (y) => {
      const r = y < 4 ? Math.sqrt(Math.max(0, 1 - ((y - 3) / 3.2) ** 2)) * 2.8 : 2.8 * (1 - (y - 3) / 6);
      return { rx: Math.max(0.4, r), rz: Math.max(0.4, r) };
    }, (x, y, z) => (x < 3 && y > 3 && z > 3 ? 0xc8f0ff : 0x4aa8f0));
    return c;
  });

export const sparkModel = (color: number): Model =>
  memo(`spark:${color}`, () => {
    const c = canvas('spark', [6, 6, 6]);
    c.emit(color).emit(0xffffff);
    c.ellipsoid(3, 3, 3, 2.8, 2.8, 2.8, (x, y, z) => (Math.hypot(x - 2.5, y - 2.5, z - 2.5) < 1.6 ? 0xffffff : color));
    return c;
  });

export const coconutModel = (): Model =>
  memo('coconut', () => {
    const c = canvas('coconut', [8, 8, 8]);
    c.ellipsoid(4, 4, 4, 3.8, 3.8, 3.8, (x, y, z) => (y > 5 && x > 2 && x < 5 && z > 5 ? 0x3a2414 : noise3(x, y, z, 2) > 0.6 ? 0x6a4420 : 0x8a5a2a));
    return c;
  });

export const parrotModel = (): Model =>
  memo('parrot', () => {
    const c = canvas('parrot', [10, 15, 10]);
    c.box(1, 0, 4, 8, 1, 5, 0x9a6a3a);
    c.ellipsoid(5, 6, 5, 3, 4.4, 3, (x, y) => (y < 4 && (x < 3 || x > 6) ? 0x3a8cf0 : 0x3ec45a));
    c.ellipsoid(5, 11, 5.5, 2.8, 2.6, 2.8, 0xf0403a);
    c.box(5, 10, 8, 5, 11, 9, 0xffd23a).box(3, 12, 7, 3, 12, 7, 0x1c2630).box(7, 12, 7, 7, 12, 7, 0x1c2630);
    c.box(4, 2, 1, 6, 4, 2, 0xffd23a);
    return c;
  });

/** A round critter in any color, for actor kinds the skin does not know. */
export const blobModel = (color: number): Model =>
  memo(`blob:${color}`, () => {
    const c = canvas('blob', [12, 11, 12]);
    c.ellipsoid(6, 4.8, 6, 5.4, 4.8, 5.4, (x, y, z) => (x < 5 && y > 6 && z > 6 ? shade(color, 1.2) : y < 2 ? shade(color, 0.8) : color));
    c.box(3, 6, 11, 4, 7, 11, 0xffffff).box(7, 6, 11, 8, 7, 11, 0xffffff).box(4, 6, 11, 4, 6, 11, 0x1c2630).box(8, 6, 11, 8, 6, 11, 0x1c2630);
    return c;
  });

// ---------------------------------------------------------------------------------------------
// Characters as rigged figures
// ---------------------------------------------------------------------------------------------

const key = (t: number, rot: Record<string, V3>): { t: number; rot: Record<string, V3> } => ({ t, rot });
const clip = (name: string, duration: number, loop: boolean, keys: Array<{ t: number; rot: Record<string, V3> }>): Clip => ({ name, duration, loop, keys });

/** Meters per voxel of the robot. */
export const ROBOT_SCALE = 1 / 36;

/** A cheerful round robot: orange body, cream head with a screen face, an antenna. About 0.86 m tall. */
export function robotFigure(body = 0xff9940): { models: Model[]; figure: Figure } {
  const R = ROBOT_SCALE;
  const id = `robot_${body.toString(16)}`;
  const m = (part: string, size: V3, paint: (c: VoxelCanvas) => void): Model =>
    memo(`${id}:${part}`, () => {
      const c = new VoxelCanvas(`${id}_${part}`, part, size, R);
      paint(c);
      return c;
    });
  const light = shade(body, 1.18);
  const models = [
    m('body', [12, 10, 10], (c) => {
      c.profile(0, 9, (y) => ({ rx: 5.6 - (y < 2 ? (2 - y) * 0.5 : 0), rz: 4.6, e: 3 }), mottled(body, 0.06, 3));
      c.face(3, 2, 8, 7, (x, y) => (Math.hypot(x - 5.5, y - 4.5) < 1.3 ? 0xff5a6a : 0xfff3dc));
      c.profile(9, 9, () => ({ rx: 5, rz: 4.2, e: 3 }), light);
    }),
    m('head', [15, 15, 13], (c) => {
      c.profile(0, 10, (y) => ({ rx: 7.2 - (y === 0 || y === 10 ? 0.6 : 0), rz: 6.2 - (y === 0 || y === 10 ? 0.6 : 0), e: 3.4 }), 0xf6f1e8);
      c.face(2, 2, 12, 8, (x, y) => {
        if ((x === 2 || x === 12) && (y === 2 || y === 8)) return undefined;
        const eye = (y >= 4 && y <= 6 && (x === 4 || x === 5 || x === 9 || x === 10));
        if (eye) return y === 6 && (x === 4 || x === 9) ? 0xffffff : 0x8ff4ff;
        if (y === 3 && x >= 6 && x <= 8) return 0x8ff4ff;
        return 0x26323e;
      });
      c.face(1, 3, 1, 3, () => 0xff9aa8).face(13, 3, 13, 3, () => 0xff9aa8);
      c.emit(0x8ff4ff);
      c.box(7, 11, 6, 7, 12, 6, 0x8a8a96);
      c.box(6, 13, 5, 8, 14, 7, 0xff4a4a);
      c.box(0, 4, 5, 0, 6, 7, light).box(14, 4, 5, 14, 6, 7, light);
    }),
    m('arm', [4, 8, 4], (c) => {
      c.profile(2, 7, () => ({ rx: 1.7, rz: 1.7 }), body);
      c.profile(0, 2, () => ({ rx: 2, rz: 2 }), 0xf6f1e8);
    }),
    m('leg', [5, 6, 6], (c) => {
      c.profile(2, 5, () => ({ rx: 1.8, rz: 1.8, cz: 2.5 }), 0x5a6570);
      c.box(0, 0, 0, 4, 1, 5, (_x, y) => (y === 0 ? 0x2e3640 : 0x3e4650));
    }),
  ];
  const [mb, mh, ma, ml] = models as [Model, Model, Model, Model];
  const part = (pid: string, model: Model, parent: string | null, pivot: V3, origin: V3): Part => ({
    id: pid,
    model: model.id,
    parent,
    pivot: [pivot[0] * R, pivot[1] * R, pivot[2] * R],
    origin,
  });
  const parts: Part[] = [
    part('body', mb, null, [0, 6, 0], [6, 0, 5]),
    part('head', mh, 'body', [0, 10, 0], [7.5, 0, 6.5]),
    part('arm_l', ma, 'body', [6.6, 8.5, 0], [2, 8, 2]),
    part('arm_r', ma, 'body', [-6.6, 8.5, 0], [2, 8, 2]),
    part('leg_l', ml, 'body', [2.8, 0, 0], [2.5, 6, 2.5]),
    part('leg_r', ml, 'body', [-2.8, 0, 0], [2.5, 6, 2.5]),
  ];
  const rest: Record<string, V3> = { arm_l: [0, 0, 0.12], arm_r: [0, 0, -0.12] };
  const figure: Figure = {
    id,
    name: 'Robot',
    parts,
    clips: [
      clip('idle', 2.4, true, [
        key(0, { ...rest, head: [0, 0, 0.05] }),
        key(1.2, { arm_l: [0, 0, 0.2], arm_r: [0, 0, -0.2], head: [0.04, 0, -0.05], body: [0.02, 0, 0] }),
      ]),
      clip('walk', 0.5, true, [
        key(0, { leg_l: [-0.7, 0, 0], leg_r: [0.7, 0, 0], arm_l: [0.6, 0, 0.15], arm_r: [-0.6, 0, -0.15], body: [0.1, 0.08, 0], head: [-0.05, -0.06, 0] }),
        key(0.25, { leg_l: [0.7, 0, 0], leg_r: [-0.7, 0, 0], arm_l: [-0.6, 0, 0.15], arm_r: [0.6, 0, -0.15], body: [0.1, -0.08, 0], head: [-0.05, 0.06, 0] }),
      ]),
      clip('jump', 0.6, false, [
        key(0, { leg_l: [-0.5, 0, 0], leg_r: [-0.5, 0, 0], arm_l: [-2.2, 0, 0.4], arm_r: [-2.2, 0, -0.4], head: [-0.2, 0, 0] }),
        key(0.6, { ...rest }),
      ]),
      clip('pick', 0.9, false, [
        key(0, { ...rest }),
        key(0.3, { body: [0.55, 0, 0], arm_l: [-1.3, 0, 0.1], arm_r: [-1.3, 0, -0.1], head: [0.2, 0, 0], leg_l: [-0.3, 0, 0], leg_r: [-0.3, 0, 0] }),
        key(0.7, { body: [0, 0, 0], arm_l: [-2.4, 0, 0.3], arm_r: [-2.4, 0, -0.3], head: [-0.25, 0, 0] }),
        key(0.9, { ...rest }),
      ]),
      clip('drop', 0.8, false, [
        key(0, { arm_l: [-1.2, 0, 0.1], arm_r: [-1.2, 0, -0.1] }),
        key(0.35, { body: [0.45, 0, 0], arm_l: [-1.1, 0, 0.1], arm_r: [-1.1, 0, -0.1], head: [0.2, 0, 0] }),
        key(0.8, { ...rest }),
      ]),
      clip('light', 0.8, false, [
        key(0, { ...rest }),
        key(0.25, { arm_r: [-2.9, 0, -0.25], head: [-0.3, 0, 0], arm_l: [0, 0, 0.3] }),
        key(0.55, { arm_r: [-2.7, 0, -0.35], head: [-0.25, 0, 0], arm_l: [0, 0, 0.3] }),
        key(0.8, { ...rest }),
      ]),
      clip('paint', 0.45, true, [
        key(0, { body: [0.3, 0, 0], arm_r: [-1.4, 0.5, -0.2], arm_l: [-0.4, 0, 0.2], head: [0.25, 0, 0] }),
        key(0.22, { body: [0.3, 0, 0], arm_r: [-1.4, -0.5, -0.2], arm_l: [-0.4, 0, 0.2], head: [0.25, 0, 0] }),
      ]),
      clip('action', 0.5, true, [
        key(0, { arm_l: [-1.4, 0, 0.1], arm_r: [-1.0, 0, -0.1], head: [0.15, 0, 0], body: [0.12, 0, 0] }),
        key(0.25, { arm_l: [-1.0, 0, 0.1], arm_r: [-1.4, 0, -0.1], head: [0.15, 0, 0], body: [0.12, 0, 0] }),
      ]),
      clip('talk', 0.7, true, [
        key(0, { ...rest, arm_r: [-0.9, 0.3, -0.4], head: [0.08, 0.1, 0] }),
        key(0.35, { ...rest, arm_r: [-1.2, 0.3, -0.6], head: [-0.08, -0.1, 0] }),
      ]),
      clip('cheer', 0.5, true, [
        key(0, { arm_l: [-2.8, 0, 0.4], arm_r: [-2.8, 0, -0.4], head: [-0.2, 0, 0.1] }),
        key(0.25, { arm_l: [-2.5, 0, 0.75], arm_r: [-2.5, 0, -0.75], head: [-0.2, 0, -0.1] }),
      ]),
      clip('sad', 1.6, true, [
        key(0, { head: [0.45, 0, 0.05], body: [0.15, 0, 0], arm_l: [0.1, 0, 0.05], arm_r: [0.1, 0, -0.05] }),
        key(0.8, { head: [0.45, 0, -0.05], body: [0.15, 0, 0], arm_l: [0.1, 0, 0.05], arm_r: [0.1, 0, -0.05] }),
      ]),
      clip('bump', 0.9, false, [
        key(0, { ...rest }),
        key(0.12, { body: [-0.4, 0, 0], head: [-0.35, 0, 0], arm_l: [-0.6, 0, 0.9], arm_r: [-0.6, 0, -0.9] }),
        key(0.45, { body: [0.05, 0, 0], head: [0.1, 0.35, 0], arm_l: [0, 0, 0.3], arm_r: [0, 0, -0.3] }),
        key(0.65, { head: [0.1, -0.35, 0] }),
        key(0.9, { head: [0.35, 0, 0] }),
      ]),
    ],
  };
  return { models, figure };
}

/** Meters per voxel of the turtle. */
export const TURTLE_SCALE = 1 / 32;

/** A green turtle that draws with chalk in its mouth. About 0.45 m tall and 1 m long. */
export function turtleFigure(): { models: Model[]; figure: Figure } {
  const T = TURTLE_SCALE;
  const m = (part: string, size: V3, paint: (c: VoxelCanvas) => void): Model =>
    memo(`turtle:${part}`, () => {
      const c = new VoxelCanvas(`turtle_${part}`, part, size, T);
      paint(c);
      return c;
    });
  const skin = 0x9ed36a;
  const models = [
    m('shell', [22, 11, 26], (c) => {
      c.profile(0, 2, () => ({ rx: 10.6, rz: 12.6, e: 2.2 }), (_x, y) => (y === 0 ? 0xd8c890 : 0xc8a060));
      c.ellipsoid(11, 2.5, 13, 10, 8.5, 12, (x, y, z) => {
        if (y < 3) return undefined;
        const hx = Math.round((x - 11) / 4.5);
        const hz = Math.round((z - 13 + (hx % 2) * 2.2) / 4.4);
        const d = Math.hypot(x - 11 - hx * 4.5, z - 13 + (hx % 2) * 2.2 - hz * 4.4);
        return d > 1.9 ? 0x3f9448 : y > 8 ? 0x76c87a : 0x58b860;
      });
    }),
    m('head', [9, 8, 10], (c) => {
      c.ellipsoid(4.5, 4, 5.5, 3.8, 3.4, 4.2, skin);
      c.box(1, 5, 7, 2, 6, 8, 0xffffff).box(7, 5, 7, 7, 6, 8, 0xffffff);
      c.box(1, 5, 8, 1, 5, 8, 0x1c2630).box(7, 5, 8, 7, 5, 8, 0x1c2630);
      c.box(3, 2, 9, 5, 2, 9, 0x5a8a3a);
    }),
    m('leg', [6, 5, 7], (c) => c.ellipsoid(3, 2.5, 3.5, 2.6, 2.4, 3.2, (x, y, z) => (y === 0 && z > 4 ? 0x7ab04a : skin))),
    m('tail', [4, 3, 5], (c) => c.ellipsoid(2, 1.5, 2.5, 1.6, 1.4, 2.4, skin)),
  ];
  const [ms, mh, ml, mt] = models as [Model, Model, Model, Model];
  const part = (pid: string, model: Model, parent: string | null, pivot: V3, origin: V3): Part => ({ id: pid, model: model.id, parent, pivot: [pivot[0] * T, pivot[1] * T, pivot[2] * T], origin });
  const parts: Part[] = [
    part('shell', ms, null, [0, 3, 0], [11, 0, 13]),
    part('head', mh, 'shell', [0, 4, 11], [4.5, 3, 1]),
    part('leg_fl', ml, 'shell', [8, 2, 7], [3, 4, 3.5]),
    part('leg_fr', ml, 'shell', [-8, 2, 7], [3, 4, 3.5]),
    part('leg_bl', ml, 'shell', [8, 2, -8], [3, 4, 3.5]),
    part('leg_br', ml, 'shell', [-8, 2, -8], [3, 4, 3.5]),
    part('tail', mt, 'shell', [0, 2, -12], [2, 1.5, 4]),
  ];
  const figure: Figure = {
    id: 'turtle',
    name: 'Turtle',
    parts,
    clips: [
      clip('idle', 3, true, [key(0, { head: [0, 0.25, 0], tail: [0, 0.2, 0] }), key(1.5, { head: [0.05, -0.25, 0], tail: [0, -0.2, 0] })]),
      clip('walk', 0.6, true, [
        key(0, { leg_fl: [-0.55, 0.2, 0], leg_br: [-0.55, -0.2, 0], leg_fr: [0.45, 0, 0], leg_bl: [0.45, 0, 0], head: [0.05, 0.06, 0], shell: [0, 0, 0.03], tail: [0, 0.3, 0] }),
        key(0.3, { leg_fl: [0.45, 0, 0], leg_br: [0.45, 0, 0], leg_fr: [-0.55, -0.2, 0], leg_bl: [-0.55, 0.2, 0], head: [0.05, -0.06, 0], shell: [0, 0, -0.03], tail: [0, -0.3, 0] }),
      ]),
      clip('cheer', 0.5, true, [key(0, { head: [-0.4, 0, 0], leg_fl: [-0.9, 0, 0.4], leg_fr: [-0.9, 0, -0.4] }), key(0.25, { head: [-0.2, 0, 0], leg_fl: [-0.4, 0, 0.8], leg_fr: [-0.4, 0, -0.8] })]),
      clip('sad', 2, true, [key(0, { head: [0.4, 0, 0] }), key(1, { head: [0.4, 0.15, 0] })]),
      clip('bump', 0.8, false, [key(0, {}), key(0.15, { head: [-0.5, 0, 0], shell: [-0.15, 0, 0] }), key(0.5, { head: [0.2, 0.3, 0] }), key(0.8, { head: [0.3, 0, 0] })]),
    ],
  };
  return { models, figure };
}

/** Arc points for a palm-like decor; exported for tests of determinism. */
export const decorSpots = (width: number, height: number, rim: number): Array<{ x: number; z: number; kind: number; rot: number }> => {
  const out: Array<{ x: number; z: number; kind: number; rot: number }> = [];
  const hw = width / 2 + rim * 0.55;
  const hh = height / 2 + rim * 0.55;
  const perimeter = 2 * (width + height);
  const count = Math.max(4, Math.min(14, Math.round(perimeter / 3)));
  for (let i = 0; i < count; i++) {
    const t = (i + hash3(i, width, height) * 0.6) / count;
    let d = t * perimeter;
    let x: number;
    let z: number;
    if (d < width) {
      x = -width / 2 + d;
      z = -hh;
    } else if ((d -= width) < height) {
      x = hw;
      z = -height / 2 + d;
    } else if ((d -= height) < width) {
      x = width / 2 - d;
      z = hh;
    } else {
      d -= width;
      x = -hw;
      z = height / 2 - d;
    }
    out.push({ x, z, kind: Math.floor(hash3(i, 3, width * 7 + height) * 100), rot: hash3(i, 9, 1) * Math.PI * 2 });
  }
  return out;
};
