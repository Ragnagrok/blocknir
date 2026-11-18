/**
 * Where the items of one cell go: one slot per item name (sorted, so slots are stable), copies
 * piled, scattered or shown once with a number badge. Pure; offsets are meters from the cell center.
 */

export interface CellEntry {
  name: string;
  count: number;
  /** Lies on the floor under the rest, without a slot. */
  floor?: boolean;
  pile?: 'stack' | 'spread' | 'single';
  stackStep?: number;
  /** Height of one copy at scale 1, in meters (for the badge). */
  height?: number;
  /** Keeps its slot when the character stands on the cell (a hammock it lies in). */
  stay?: boolean;
}

/**
 * The character on the cell: the items step aside to the cell's corners so they do not stand
 * inside it. `k` goes from 0 (far) to 1 (on the cell); `away` is the side away from where the
 * character came in (`[0, -1]`: the back, `[-1, 0]`: the left), so the items do not cross its path.
 */
export interface Room {
  k: number;
  away: [number, number];
}

export interface Placement {
  name: string;
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface BadgeSpot {
  name: string;
  count: number;
  x: number;
  y: number;
  z: number;
}

const SPREAD: Array<[number, number]> = [
  [0, 0.02],
  [0.17, -0.1],
  [-0.17, -0.08],
  [0.02, 0.16],
];

/** Slot centers and scale for `n` item names in one cell. */
export function slots(n: number): { at: Array<[number, number]>; scale: number } {
  if (n <= 1) return { at: [[0, 0]], scale: 0.85 };
  if (n === 2) return { at: [[-0.22, 0.04], [0.22, -0.04]], scale: 0.66 };
  if (n <= 4) return { at: [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]].slice(0, n) as Array<[number, number]>, scale: 0.56 };
  const at: Array<[number, number]> = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) at.push([(c - 1) * 0.3, (r - 1) * 0.3]);
  return { at: at.slice(0, Math.min(9, n)), scale: 0.4 };
}

/** How far from the cell center the items stand while a character is on it. */
const ASIDE = 0.34;

/** Where `n` items stand while a character is on the cell, and their scale (null: no room is made). */
export function asideSlots(n: number, away: readonly [number, number]): { at: Array<[number, number]>; scale: number } | null {
  const [ax, az] = away;
  const c = ASIDE;
  if (n === 1) {
    // One item: the corner away from the character, toward the back (or the right) of the cell.
    return { at: [[ax !== 0 ? ax * c : c, az !== 0 ? az * c : -c]], scale: 0.72 };
  }
  if (n === 2) {
    // Two: both corners on the far side.
    const at: Array<[number, number]> = ax !== 0 ? [[ax * c, -c], [ax * c, c]] : [[-c, az * c], [c, az * c]];
    return { at, scale: 0.52 };
  }
  if (n <= 4) return { at: [[-c, -c], [c, -c], [-c, c], [c, c]].slice(0, n) as Array<[number, number]>, scale: 0.46 };
  return null;
}

/**
 * How much a cell's items make room for a character `dx, dz` meters from the cell's center: 1 on
 * the cell, 0 a cell away, eased between (undefined: no room). `away` is the side chosen earlier,
 * kept while the character is near; without one, the side away from where it comes in (already on
 * the cell: the back).
 */
export function roomFor(dx: number, dz: number, away?: readonly [number, number]): Room | undefined {
  const d = Math.hypot(dx, dz);
  const t = Math.min(1, Math.max(0, (1 - d) / 0.4));
  const k = t * t * (3 - 2 * t);
  if (k <= 0) return undefined;
  if (away) return { k, away: [away[0], away[1]] };
  return { k, away: d < 0.05 ? [0, -1] : Math.abs(dx) > Math.abs(dz) ? [-Math.sign(dx), 0] : [0, -Math.sign(dz)] };
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * Lays out a cell's items. Counts of 0 or less are skipped; more than 9 names keep the first 9.
 * With `room`, the standing items (not `stay`) move toward the corners as `room.k` grows.
 */
export function layoutCell(entries: readonly CellEntry[], maxCopies = 4, room?: Room): { placements: Placement[]; badges: BadgeSpot[] } {
  const placements: Placement[] = [];
  const badges: BadgeSpot[] = [];
  const live = entries.filter((e) => e.count > 0).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of live.filter((e) => e.floor)) placements.push({ name: e.name, x: 0, y: 0, z: 0, scale: 1 });
  const standing = live.filter((e) => !e.floor);
  const { at, scale: base } = slots(standing.length);
  const moving = standing.filter((e) => !e.stay);
  const k = room && moving.length ? Math.min(1, Math.max(0, room.k)) : 0;
  const aside = k > 0 ? asideSlots(standing.length, room!.away) : null;
  standing.slice(0, at.length).forEach((e, i) => {
    let [sx, sz] = at[i]!;
    let scale = base;
    if (aside && !e.stay) {
      const [tx, tz] = aside.at[i]!;
      sx = lerp(sx, tx, k);
      sz = lerp(sz, tz, k);
      scale = lerp(base, Math.min(base, aside.scale), k);
    }
    const pile = e.pile ?? 'spread';
    const copies = pile === 'single' ? 1 : Math.min(e.count, pile === 'stack' ? maxCopies + 1 : maxCopies);
    const h = (e.height ?? 0.6) * scale;
    let top = h;
    for (let k = 0; k < copies; k++) {
      if (pile === 'stack') {
        const step = (e.stackStep ?? 0.18) * scale;
        placements.push({ name: e.name, x: sx, y: k * step, z: sz, scale });
        top = k * step + h;
      } else {
        const [ox, oz] = copies > 1 ? SPREAD[k]! : [0, 0];
        const k2 = copies > 1 ? scale * 0.8 : scale;
        placements.push({ name: e.name, x: sx + ox * scale, y: 0, z: sz + oz * scale, scale: k2 });
        top = (e.height ?? 0.6) * k2;
      }
    }
    if (e.count > 1) badges.push({ name: e.name, count: e.count, x: sx + 0.12 * scale, y: top + 0.06, z: sz + 0.12 * scale });
  });
  return { placements, badges };
}
