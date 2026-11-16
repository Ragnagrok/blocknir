/**
 * Board variants: the same level on boards that change (random lamps, rows of changing length,
 * an apple or a banana), generated from a seed so every run of `check()` sees the same boards.
 */
import type { CellSpec, GridBoard, Items } from './grid.js';
import { Rng } from './rng.js';
import { delta, type Direction } from './values.js';

/** A rectangle of cells, corners included. Negative coordinates count from the far side. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Contents to put in a cell. */
export interface CellContent {
  items?: Items;
  hidden?: Items;
  color?: string;
  arrow?: Direction;
  wall?: boolean;
  terrain?: string;
}

/**
 * One generation rule. Rules apply in order. Layout rules (`size`, `path`, `rows`) change the board
 * size and must come first. A missing `region` means the whole board; `border` keeps only the
 * region's outline. Cells with walls are skipped by the placing rules.
 */
export type BoardRule =
  /** Picks a width and/or height in [min, max]. */
  | { type: 'size'; width?: [number, number]; height?: [number, number] }
  /**
   * A random path from the robot, `length` steps long, each step one of `dirs` (never revisiting
   * a cell). The board is resized to fit it. Each path cell gets an arrow to the next one (unless
   * `arrows` is false), the last cell gets `end` (default a `flag`), every other cell gets `off`
   * (default water: `{ wall: true, terrain: 'water' }`).
   */
  | { type: 'path'; length: [number, number]; dirs: Direction[]; arrows?: boolean; end?: CellContent; off?: CellContent }
  /**
   * Rows of random length, one per board row (or `count` rows). Each row has a start cell at x = 0
   * (`start`), then `length` cells (picked per row in [min, max]): random `middle` contents and a
   * random `last` one. Cells past a row's end get `off` (default water). With `downOnlyAtStart`,
   * walls between rows leave only the start column open.
   */
  | {
      type: 'rows';
      length: [number, number];
      count?: number;
      start?: CellContent;
      middle?: Array<CellContent | null>;
      last?: Array<CellContent | null>;
      off?: CellContent;
      downOnlyAtStart?: boolean;
    }
  /** Each cell of the region gets `item` with probability `chance`; at least `atLeast` cells get it. */
  | { type: 'scatter'; item: string; chance: number; region?: Region; border?: boolean; atLeast?: number }
  /** Puts `item` on a number of distinct random cells, the number picked in [min, max]. */
  | { type: 'place'; item: string; count: [number, number]; region?: Region; border?: boolean }
  /** Puts a random amount, in [min, max], of `item` in one cell. */
  | { type: 'stack'; x: number; y: number; item: string; count: [number, number] }
  /** Each cell of the region gets one of the options (`null`: nothing), picked at random. */
  | { type: 'choose'; region: Region; options: Array<CellContent | null>; border?: boolean }
  /** Every cell of the region gets the content. */
  | { type: 'fill'; region: Region; content: CellContent; border?: boolean }
  /** Places the robot at a random column / row in [min, max], and/or facing one of the directions. */
  | { type: 'robot'; x?: [number, number]; y?: [number, number]; facing?: Direction[] };

/** How to generate variants of a base board. */
export interface BoardGenerator {
  seed: number;
  /** How many boards to generate. */
  count: number;
  rules: BoardRule[];
  /** Also test the base board itself, before the generated ones. */
  includeBase?: boolean;
}

const resolve = (v: number, size: number): number => (v < 0 ? size + v : v);

/** A board with every negative coordinate resolved and its own copies of all arrays. */
export function resolveBoard(b: GridBoard): GridBoard {
  const w = b.width;
  const h = b.height;
  const out: GridBoard = {
    width: w,
    height: h,
    robot: { ...b.robot, x: resolve(b.robot.x, w), y: resolve(b.robot.y, h) },
    cells: (b.cells ?? []).map((c) => ({ ...JSON.parse(JSON.stringify(c)), x: resolve(c.x, w), y: resolve(c.y, h) }) as CellSpec),
    walls: (b.walls ?? []).map((wl) => ({ ...wl, x: resolve(wl.x, w), y: resolve(wl.y, h) })),
  };
  if (b.inventory) out.inventory = { ...b.inventory };
  if (b.capacity !== undefined) out.capacity = b.capacity;
  return out;
}

function regionCells(b: GridBoard, region: Region | undefined, border: boolean | undefined): Array<[number, number]> {
  const r = region ?? { x0: 0, y0: 0, x1: -1, y1: -1 };
  const x0 = Math.max(0, Math.min(resolve(r.x0, b.width), resolve(r.x1, b.width)));
  const x1 = Math.min(b.width - 1, Math.max(resolve(r.x0, b.width), resolve(r.x1, b.width)));
  const y0 = Math.max(0, Math.min(resolve(r.y0, b.height), resolve(r.y1, b.height)));
  const y1 = Math.min(b.height - 1, Math.max(resolve(r.y0, b.height), resolve(r.y1, b.height)));
  const walls = new Set((b.cells ?? []).filter((c) => c.wall).map((c) => `${resolve(c.x, b.width)},${resolve(c.y, b.height)}`));
  const out: Array<[number, number]> = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (border && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      if (!walls.has(`${x},${y}`)) out.push([x, y]);
    }
  }
  return out;
}

function put(b: GridBoard, x: number, y: number, content: CellContent): void {
  const c: CellSpec = { x, y };
  if (content.items) c.items = { ...content.items };
  if (content.hidden) c.hidden = { ...content.hidden };
  if (content.color !== undefined) c.color = content.color;
  if (content.arrow !== undefined) c.arrow = content.arrow;
  if (content.wall) c.wall = true;
  if (content.terrain !== undefined) c.terrain = content.terrain;
  (b.cells ??= []).push(c);
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

/** Generates one board from a base, consuming numbers from `rng`. */
export function generateBoard(base: GridBoard, rules: readonly BoardRule[], rng: Rng): GridBoard {
  // Sizes first, so negative coordinates of the base resolve against the new size.
  let b: GridBoard = JSON.parse(JSON.stringify(base)) as GridBoard;
  let resolved = false;
  for (const rule of rules) {
    if (rule.type === 'size' || rule.type === 'path' || rule.type === 'rows') {
      if (resolved) throw new Error('Layout rules (size, path, rows) must come before the other rules');
      if (rule.type === 'size') {
        if (rule.width) b.width = rng.int(rule.width[0], rule.width[1]);
        if (rule.height) b.height = rng.int(rule.height[0], rule.height[1]);
      } else if (rule.type === 'path') b = layoutPath(b, rule, rng);
      else b = layoutRows(b, rule, rng);
      continue;
    }
    if (!resolved) {
      Object.assign(b, resolveBoard(b));
      resolved = true;
    }
    switch (rule.type) {
      case 'scatter': {
        const cells = regionCells(b, rule.region, rule.border);
        const left: Array<[number, number]> = [];
        let placed = 0;
        for (const [x, y] of cells) {
          if (rng.chance(rule.chance)) {
            put(b, x, y, { items: { [rule.item]: 1 } });
            placed++;
          } else left.push([x, y]);
        }
        shuffle(left, rng);
        for (let i = 0; placed < (rule.atLeast ?? 0) && i < left.length; i++, placed++) {
          put(b, left[i]![0], left[i]![1], { items: { [rule.item]: 1 } });
        }
        break;
      }
      case 'place': {
        const cells = shuffle(regionCells(b, rule.region, rule.border), rng);
        const n = Math.min(cells.length, rng.int(rule.count[0], rule.count[1]));
        for (let i = 0; i < n; i++) put(b, cells[i]![0], cells[i]![1], { items: { [rule.item]: 1 } });
        break;
      }
      case 'stack': {
        const n = rng.int(rule.count[0], rule.count[1]);
        if (n > 0) put(b, resolve(rule.x, b.width), resolve(rule.y, b.height), { items: { [rule.item]: n } });
        break;
      }
      case 'choose': {
        for (const [x, y] of regionCells(b, rule.region, rule.border)) {
          const pick = rng.pick(rule.options);
          if (pick) put(b, x, y, pick);
        }
        break;
      }
      case 'fill': {
        for (const [x, y] of regionCells(b, rule.region, rule.border)) put(b, x, y, rule.content);
        break;
      }
      case 'robot': {
        if (rule.x) b.robot.x = rng.int(resolve(rule.x[0], b.width), resolve(rule.x[1], b.width));
        if (rule.y) b.robot.y = rng.int(resolve(rule.y[0], b.height), resolve(rule.y[1], b.height));
        if (rule.facing && rule.facing.length > 0) b.robot.facing = rng.pick(rule.facing);
        break;
      }
    }
  }
  return resolved ? b : resolveBoard(b);
}

const WATER: CellContent = { wall: true, terrain: 'water' };

function layoutPath(base: GridBoard, rule: Extract<BoardRule, { type: 'path' }>, rng: Rng): GridBoard {
  const start = resolveBoard(base).robot;
  const cells: Array<[number, number]> = [[start.x, start.y]];
  const dirs: Direction[] = [];
  const seen = new Set([`${start.x},${start.y}`]);
  const steps = rng.int(rule.length[0], rule.length[1]);
  for (let i = 0; i < steps; i++) {
    const [x, y] = cells[cells.length - 1]!;
    const options = rule.dirs.filter((d) => {
      const [dx, dy] = delta(d);
      return !seen.has(`${x + dx},${y + dy}`);
    });
    if (options.length === 0) break;
    const d = rng.pick(options);
    const [dx, dy] = delta(d);
    cells.push([x + dx, y + dy]);
    dirs.push(d);
    seen.add(`${x + dx},${y + dy}`);
  }
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  const width = Math.max(...cells.map((c) => c[0])) - minX + 1;
  const height = Math.max(...cells.map((c) => c[1])) - minY + 1;
  const out: GridBoard = { ...base, width, height, robot: { ...start, x: start.x - minX, y: start.y - minY }, cells: [], walls: [] };
  const onPath = new Map(cells.map((c, i) => [`${c[0] - minX},${c[1] - minY}`, i]));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = onPath.get(`${x},${y}`);
      if (i === undefined) put(out, x, y, rule.off ?? WATER);
      else if (i === cells.length - 1) put(out, x, y, rule.end ?? { items: { flag: 1 } });
      else if (rule.arrows !== false) put(out, x, y, { arrow: dirs[i]! });
    }
  }
  return out;
}

function layoutRows(base: GridBoard, rule: Extract<BoardRule, { type: 'rows' }>, rng: Rng): GridBoard {
  const count = rule.count ?? base.height;
  const lengths = Array.from({ length: count }, () => rng.int(rule.length[0], rule.length[1]));
  const width = Math.max(...lengths) + 1;
  const out: GridBoard = { ...resolveBoard({ ...base, height: count, width }), cells: [], walls: [] };
  lengths.forEach((len, y) => {
    if (rule.start) put(out, 0, y, rule.start);
    for (let x = 1; x <= len; x++) {
      const pick = x === len ? (rule.last ? rng.pick(rule.last) : null) : rule.middle ? rng.pick(rule.middle) : null;
      if (pick) put(out, x, y, pick);
    }
    for (let x = len + 1; x < width; x++) put(out, x, y, rule.off ?? WATER);
    if (rule.downOnlyAtStart && y < count - 1) for (let x = 1; x < width; x++) out.walls!.push({ x, y, side: 'S' });
  });
  return out;
}

/** Generates `gen.count` boards (plus the base first, with `includeBase`). Same seed, same boards. */
export function generateBoards(base: GridBoard, gen: BoardGenerator): GridBoard[] {
  const rng = new Rng(gen.seed);
  const out: GridBoard[] = gen.includeBase ? [resolveBoard(base)] : [];
  for (let i = 0; i < gen.count; i++) out.push(generateBoard(base, gen.rules, rng));
  return out;
}
