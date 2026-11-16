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

/** Lays out a cell's items. Counts of 0 or less are skipped; more than 9 names keep the first 9. */
export function layoutCell(entries: readonly CellEntry[], maxCopies = 4): { placements: Placement[]; badges: BadgeSpot[] } {
  const placements: Placement[] = [];
  const badges: BadgeSpot[] = [];
  const live = entries.filter((e) => e.count > 0).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of live.filter((e) => e.floor)) placements.push({ name: e.name, x: 0, y: 0, z: 0, scale: 1 });
  const standing = live.filter((e) => !e.floor);
  const { at, scale } = slots(standing.length);
  standing.slice(0, at.length).forEach((e, i) => {
    const [sx, sz] = at[i]!;
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
