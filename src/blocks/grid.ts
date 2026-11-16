/**
 * The grid world: a board of W×H cells, a robot with a position and a facing, items on cells
 * (lamps, fruit, tools…), painted colors, arrows, terrain, walls, an inventory, and level-defined
 * actions. It also serves "scene" puzzles: a few cells as named places and actions as data.
 *
 * Coordinates are screen-like: `x` grows to the right (east), `y` grows down (south), `(0, 0)` is
 * the top-left corner. In board specs a negative coordinate counts from the far side: `x: -1` is
 * the last column, `y: -1` the bottom row.
 */
import type { Program } from './ast.js';
import { fail } from './errors.js';
import type { LabelOverrides } from './labels.js';
import { Runner, type BlockSpec, type ParamSpec, type RunOptions, type RunResult, type World } from './interpreter.js';
import { delta, leftOf, rightOf, type Direction, type Value } from './values.js';

/** A cell position. */
export type Cell2 = [x: number, y: number];

/** Item counts by item name. Missing names mean 0. */
export type Items = Record<string, number>;

/** The off lamp item; `lightLamp` turns one into `LAMP_ON`. */
export const LAMP_OFF = 'lamp';
/** The lit lamp item. */
export const LAMP_ON = 'lampOn';

/** What a board says about one cell. */
export interface CellSpec {
  x: number;
  y: number;
  items?: Items;
  /** Items sensors cannot see until an action with `reveal` uncovers them. */
  hidden?: Items;
  color?: string;
  /** An arrow drawn on the cell. */
  arrow?: Direction;
  /** The cell is solid: the robot cannot enter it. */
  wall?: boolean;
  /** What the floor looks like (`water`, `rock`, `grass`…), for renderers and the `terrainIs` sensor. */
  terrain?: string;
}

/** A wall on one side of a cell (between it and its neighbor). */
export interface WallSpec {
  x: number;
  y: number;
  side: Direction;
}

/** A board as levels describe it. */
export interface GridBoard {
  width: number;
  height: number;
  robot: { x: number; y: number; facing?: Direction };
  cells?: CellSpec[];
  walls?: WallSpec[];
  /** What the robot carries at the start. */
  inventory?: Items;
  /** How many items the robot can carry in total. Unlimited when missing. */
  capacity?: number;
}

/** One cell of the live state. */
export interface CellState {
  items: Items;
  hidden: Items;
  color: string | null;
  arrow: Direction | null;
  wall: boolean;
  terrain: string | null;
}

/** The whole grid state, plain and serializable. */
export interface GridState {
  width: number;
  height: number;
  robot: { x: number; y: number; facing: Direction };
  /** Row by row from the top: cell `(x, y)` is `cells[x + y * width]`. */
  cells: CellState[];
  /** Walls between cells, normalized to the `N` and `W` sides and sorted. */
  walls: WallSpec[];
  inventory: Items;
  capacity: number | null;
  /** Everything the robot said, in order. */
  said: Value[];
}

/** A change of one item count, in a cell, under a cell (hidden) or in the inventory. */
export type ItemChange =
  | { where: 'cell' | 'hidden'; x: number; y: number; item: string; before: number; after: number }
  | { where: 'inventory'; item: string; before: number; after: number };

/** What a grid command did. Item-changing events carry `changes` so a replay can apply them. */
export type GridEvent =
  /** `dir` is null for jumps (actions with `goTo`). */
  | { type: 'moved'; from: Cell2; to: Cell2; dir: Direction | null }
  | { type: 'turned'; from: Direction; to: Direction }
  | { type: 'painted'; x: number; y: number; color: string; previous: string | null }
  | { type: 'lit'; x: number; y: number; on: boolean; changes: ItemChange[] }
  | { type: 'picked'; x: number; y: number; item: string; changes: ItemChange[] }
  | { type: 'dropped'; x: number; y: number; item: string; changes: ItemChange[] }
  | {
      type: 'action';
      action: string;
      args: Value[];
      x: number;
      y: number;
      changes: ItemChange[];
      painted?: { color: string; previous: string | null };
      said?: Value;
      /** Where the action took the robot, if it moved it. */
      moved?: { from: Cell2; to: Cell2 };
    }
  | { type: 'said'; value: Value };

/**
 * A level-defined command, as data. Requirements are checked first; if any fails the action fails
 * with `actionFailed` (message `labels.errors['actionFailed:<name>']`, or `failMessage`). Then
 * effects apply in this order, on the cell where the action started: consume, add, drop all,
 * cycle, reveal, paint, say; and last the robot moves (`move`, then `goTo`).
 *
 * Examples: "jump a stone" is `{ move: 'E' }`; "back to the edge" is `{ goTo: { x: 0 } }`; "eat an
 * apple" is `{ consumeHere: { apple: 1 } }`; "count an apple" is
 * `{ requireHere: { apple: 1 }, addInventory: { appleCount: 1 } }` with a `tally` goal; a 16-color
 * lamp wheel is `{ cycle: ['lamp0', 'lamp1', …, 'lamp15'] }`.
 *
 * Item names may use `{0}`, `{1}`… for the action's arguments: an action `write` with a `name`
 * parameter and `addHere: { 'letter{0}': 1 }` adds `letterA` when called as `write A`.
 */
export interface CustomAction {
  /** Command name, used in programs and toolboxes. Must not clash with a built-in command. */
  name: string;
  /** Block text (Spanish), with `{0}` for slots. Goes to `labels.blocks[name]`. */
  label?: string;
  params?: ParamSpec[];
  /** Items that must be in the robot's cell (at least these counts). */
  requireHere?: Items;
  /** Items the robot must carry. */
  requireInventory?: Items;
  /** Items that must not be in the cell. */
  forbidHere?: string[];
  /** Items the robot must not carry (state flags: `asleep`, `lyingDown`…). */
  forbidInventory?: string[];
  /** Removed from the cell (and also required). */
  consumeHere?: Items;
  /** Removed from the inventory (and also required). */
  consumeInventory?: Items;
  addHere?: Items;
  addInventory?: Items;
  /** Moves everything the robot carries into the cell ("leave it in the boat"). Needs something carried. */
  dropAll?: boolean;
  /** Replaces the first item of this list found in the cell with the next one (wrapping). One is required. */
  cycle?: string[];
  /** Uncovers the cell's hidden items. */
  reveal?: boolean;
  paint?: string;
  /** The robot says this. */
  say?: Value;
  /** Then the robot moves one cell this way (walls and edges stop it with the usual errors). */
  move?: Direction;
  /** Then the robot jumps to this column and/or row (negative: from the far side). */
  goTo?: { x?: number; y?: number };
  /** Message when a requirement fails. Goes to `labels.errors['actionFailed:<name>']`. */
  failMessage?: string;
}

/** Built-in grid commands. */
export const GRID_COMMANDS: Readonly<Record<string, BlockSpec>> = {
  move: { params: [{ type: 'direction' }] },
  forward: { params: [] },
  turnLeft: { params: [] },
  turnRight: { params: [] },
  paint: { params: [{ type: 'name', name: 'color' }] },
  lightLamp: { params: [] },
  toggleLamp: { params: [] },
  pick: { params: [{ type: 'name', name: 'item' }] },
  drop: { params: [{ type: 'name', name: 'item' }] },
  say: { params: [{ type: 'any' }] },
};

/** Grid sensors. */
export const GRID_SENSORS: Readonly<Record<string, BlockSpec>> = {
  itemHere: { params: [{ type: 'name', name: 'item' }], returns: 'boolean' },
  countHere: { params: [{ type: 'name', name: 'item' }], returns: 'number' },
  canMove: { params: [{ type: 'direction' }], returns: 'boolean' },
  canMoveForward: { params: [], returns: 'boolean' },
  atEdge: { params: [{ type: 'direction' }], returns: 'boolean' },
  hasArrow: { params: [], returns: 'boolean' },
  arrowHere: { params: [], returns: 'direction' },
  arrowIs: { params: [{ type: 'direction' }], returns: 'boolean' },
  colorHere: { params: [], returns: 'name' },
  colorIs: { params: [{ type: 'name', name: 'color' }], returns: 'boolean' },
  hasItem: { params: [{ type: 'name', name: 'item' }], returns: 'boolean' },
  inventoryCount: { params: [{ type: 'name', name: 'item' }], returns: 'number' },
  facing: { params: [], returns: 'direction' },
  posX: { params: [], returns: 'number' },
  posY: { params: [], returns: 'number' },
  boardWidth: { params: [], returns: 'number' },
  boardHeight: { params: [], returns: 'number' },
  distanceToEdge: { params: [{ type: 'direction' }], returns: 'number' },
  /** How many cells the robot could move this way before a wall, water or the edge. */
  freeCells: { params: [{ type: 'direction' }], returns: 'number' },
  /** How many steps this way to the nearest cell with the item (-1 if none in that line). */
  stepsTo: { params: [{ type: 'name', name: 'item' }, { type: 'direction' }], returns: 'number' },
  terrainIs: { params: [{ type: 'name', name: 'terrain' }], returns: 'boolean' },
};

/** Spanish block texts of the grid world. */
export const GRID_LABELS: LabelOverrides = {
  blocks: {
    move: 'Mover {0}',
    forward: 'Avanzar',
    turnLeft: 'Girar a la izquierda',
    turnRight: 'Girar a la derecha',
    paint: 'Pintar de {0}',
    lightLamp: 'Encender farol',
    toggleLamp: 'Cambiar farol',
    pick: 'Juntar {0}',
    drop: 'Dejar {0}',
    say: 'Decir {0}',
    itemHere: '¿Hay {0}?',
    countHere: '(cantidad de {0} acá)',
    canMove: '¿Puedo moverme {0}?',
    canMoveForward: '¿Puedo avanzar?',
    atEdge: '¿Estoy en el borde {0}?',
    hasArrow: '¿Hay flecha?',
    arrowHere: '(flecha de acá)',
    arrowIs: '¿Flecha {0}?',
    colorHere: '(color de acá)',
    colorIs: '¿Está pintado de {0}?',
    hasItem: '¿Llevo {0}?',
    inventoryCount: '(cantidad de {0} que llevo)',
    facing: '(hacia dónde miro)',
    posX: '(mi columna)',
    posY: '(mi fila)',
    boardWidth: '(ancho del tablero)',
    boardHeight: '(alto del tablero)',
    distanceToEdge: '(casillas hasta el borde {0})',
    freeCells: '(casillas libres hacia {0})',
    stepsTo: '(casillas hasta {0} hacia {1})',
    terrainIs: '¿Estoy sobre {0}?',
  },
};

/** The block texts and failure messages that a list of actions adds to the labels. */
export function actionLabels(actions: readonly CustomAction[]): LabelOverrides {
  const blocks: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const a of actions) {
    if (a.label !== undefined) blocks[a.name] = a.label;
    if (a.failMessage !== undefined) errors[`actionFailed:${a.name}`] = a.failMessage;
  }
  return { blocks, errors };
}

/** The commands of a grid level: built-ins plus its actions. */
export function gridCommands(actions: readonly CustomAction[] = []): Record<string, BlockSpec> {
  const out: Record<string, BlockSpec> = { ...GRID_COMMANDS };
  for (const a of actions) out[a.name] = { params: a.params ?? [] };
  return out;
}

const resolve = (v: number, size: number): number => (v < 0 ? size + v : v);

function emptyCell(): CellState {
  return { items: {}, hidden: {}, color: null, arrow: null, wall: false, terrain: null };
}

function normalizeWall(w: WallSpec): WallSpec {
  switch (w.side) {
    case 'S':
      return { x: w.x, y: w.y + 1, side: 'N' };
    case 'E':
      return { x: w.x + 1, y: w.y, side: 'W' };
    default:
      return { x: w.x, y: w.y, side: w.side };
  }
}

function addItems(into: Items, items: Items | undefined): void {
  for (const [k, n] of Object.entries(items ?? {})) {
    const v = (into[k] ?? 0) + n;
    if (v > 0) into[k] = v;
    else delete into[k];
  }
}

/**
 * Builds the live state of a board. Negative coordinates count from the far side. Throws a plain
 * `Error` for broken boards (a level authoring bug, not a child's mistake).
 */
export function createGridState(board: GridBoard): GridState {
  const { width, height } = board;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) {
    throw new Error(`Bad board size ${width}x${height}`);
  }
  const cells: CellState[] = Array.from({ length: width * height }, emptyCell);
  for (const spec of board.cells ?? []) {
    const x = resolve(spec.x, width);
    const y = resolve(spec.y, height);
    if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`Cell (${spec.x}, ${spec.y}) is outside the board`);
    const c = cells[x + y * width]!;
    addItems(c.items, spec.items);
    addItems(c.hidden, spec.hidden);
    if (spec.color !== undefined) c.color = spec.color;
    if (spec.arrow !== undefined) c.arrow = spec.arrow;
    if (spec.wall) c.wall = true;
    if (spec.terrain !== undefined) c.terrain = spec.terrain;
  }
  const keys = new Map<string, WallSpec>();
  for (const w of board.walls ?? []) {
    const n = normalizeWall({ x: resolve(w.x, width), y: resolve(w.y, height), side: w.side });
    keys.set(`${n.x},${n.y},${n.side}`, n);
  }
  const walls = [...keys.values()].sort((a, b) => a.y - b.y || a.x - b.x || a.side.localeCompare(b.side));
  const rx = resolve(board.robot.x, width);
  const ry = resolve(board.robot.y, height);
  if (rx < 0 || ry < 0 || rx >= width || ry >= height) throw new Error('The robot is outside the board');
  const inventory: Items = {};
  addItems(inventory, board.inventory);
  return {
    width,
    height,
    robot: { x: rx, y: ry, facing: board.robot.facing ?? 'E' },
    cells,
    walls,
    inventory,
    capacity: board.capacity ?? null,
    said: [],
  };
}

/** A deep copy of a grid state. */
export function cloneGridState(s: GridState): GridState {
  return JSON.parse(JSON.stringify(s)) as GridState;
}

/** The cell at `(x, y)`, or undefined outside the board. */
export function cellAt(s: GridState, x: number, y: number): CellState | undefined {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return undefined;
  return s.cells[x + y * s.width];
}

/** Whether there is a wall on side `dir` of cell `(x, y)`. */
export function hasWall(s: GridState, x: number, y: number, dir: Direction): boolean {
  const n = normalizeWall({ x, y, side: dir });
  return s.walls.some((w) => w.x === n.x && w.y === n.y && w.side === n.side);
}

/** How many of an item are on the board (visible ones only, unless `hidden`). */
export function countOnBoard(s: GridState, item: string, hidden = false): number {
  let n = 0;
  for (const c of s.cells) n += (c.items[item] ?? 0) + (hidden ? (c.hidden[item] ?? 0) : 0);
  return n;
}

/** Applies one event to a state, the same way the world did. Renderers can replay a trace with it. */
export function applyGridEvent(s: GridState, e: GridEvent): void {
  const applyChanges = (changes: ItemChange[]): void => {
    for (const ch of changes) {
      const target = ch.where === 'inventory' ? s.inventory : ch.where === 'cell' ? cellAt(s, ch.x, ch.y)!.items : cellAt(s, ch.x, ch.y)!.hidden;
      if (ch.after > 0) target[ch.item] = ch.after;
      else delete target[ch.item];
    }
  };
  switch (e.type) {
    case 'moved':
      s.robot.x = e.to[0];
      s.robot.y = e.to[1];
      break;
    case 'turned':
      s.robot.facing = e.to;
      break;
    case 'painted':
      cellAt(s, e.x, e.y)!.color = e.color;
      break;
    case 'lit':
    case 'picked':
    case 'dropped':
      applyChanges(e.changes);
      break;
    case 'action':
      applyChanges(e.changes);
      if (e.painted) cellAt(s, e.x, e.y)!.color = e.painted.color;
      if (e.said !== undefined) s.said.push(e.said);
      if (e.moved) {
        s.robot.x = e.moved.to[0];
        s.robot.y = e.moved.to[1];
      }
      break;
    case 'said':
      s.said.push(e.value);
      break;
  }
}

const fill = (name: string, args: readonly Value[]): string => name.replace(/\{(\d+)\}/g, (all, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : all));

const fillItems = (items: Items | undefined, args: readonly Value[]): Items => {
  const out: Items = {};
  for (const [k, n] of Object.entries(items ?? {})) out[fill(k, args)] = n;
  return out;
};

/** The grid world. Its `state` changes as commands run. */
export class GridWorld implements World<GridEvent> {
  readonly state: GridState;
  readonly commands: Readonly<Record<string, BlockSpec>>;
  readonly sensors = GRID_SENSORS;
  /** The name of every command that ran, in order (for `sequence` goals). */
  readonly log: string[] = [];
  private readonly actions = new Map<string, CustomAction>();

  constructor(board: GridBoard | GridState, actions: readonly CustomAction[] = []) {
    this.state = 'said' in board ? cloneGridState(board) : createGridState(board);
    for (const a of actions) {
      if (GRID_COMMANDS[a.name]) throw new Error(`Action "${a.name}" clashes with a built-in command`);
      this.actions.set(a.name, a);
    }
    this.commands = gridCommands(actions);
  }

  private here(): CellState {
    return cellAt(this.state, this.state.robot.x, this.state.robot.y)!;
  }

  private carried(): number {
    return Object.values(this.state.inventory).reduce((a, b) => a + b, 0);
  }

  private change(where: 'cell' | 'hidden' | 'inventory', item: string, by: number, out: ItemChange[]): void {
    const { x, y } = this.state.robot;
    const table = where === 'inventory' ? this.state.inventory : where === 'cell' ? this.here().items : this.here().hidden;
    const before = table[item] ?? 0;
    const after = before + by;
    if (after > 0) table[item] = after;
    else delete table[item];
    out.push(where === 'inventory' ? { where, item, before, after } : { where, x, y, item, before, after });
  }

  /** Why moving one cell toward `d` from `(x, y)` is impossible, or null if it is possible. */
  private blocked(d: Direction, x = this.state.robot.x, y = this.state.robot.y): 'wall' | 'outOfBoard' | null {
    const [dx, dy] = delta(d);
    const next = cellAt(this.state, x + dx, y + dy);
    if (!next) return 'outOfBoard';
    if (next.wall || hasWall(this.state, x, y, d)) return 'wall';
    return null;
  }

  private move(d: Direction): GridEvent {
    const why = this.blocked(d);
    if (why) {
      const [dx, dy] = delta(d);
      const terrain = cellAt(this.state, this.state.robot.x + dx, this.state.robot.y + dy)?.terrain;
      fail(why, why === 'wall' && terrain ? { dir: d, key: terrain } : { dir: d });
    }
    const r = this.state.robot;
    const from: Cell2 = [r.x, r.y];
    const [dx, dy] = delta(d);
    r.x += dx;
    r.y += dy;
    return { type: 'moved', from, to: [r.x, r.y], dir: d };
  }

  private turn(to: Direction): GridEvent {
    const from = this.state.robot.facing;
    this.state.robot.facing = to;
    return { type: 'turned', from, to };
  }

  command(name: string, args: Value[]): GridEvent[] {
    this.log.push(name);
    const r = this.state.robot;
    const changes: ItemChange[] = [];
    switch (name) {
      case 'move':
        return [this.move(args[0] as Direction)];
      case 'forward':
        return [this.move(r.facing)];
      case 'turnLeft':
        return [this.turn(leftOf(r.facing))];
      case 'turnRight':
        return [this.turn(rightOf(r.facing))];
      case 'paint': {
        const cell = this.here();
        const previous = cell.color;
        cell.color = String(args[0]);
        return [{ type: 'painted', x: r.x, y: r.y, color: cell.color, previous }];
      }
      case 'lightLamp':
      case 'toggleLamp': {
        const items = this.here().items;
        if (items[LAMP_OFF]) {
          this.change('cell', LAMP_OFF, -1, changes);
          this.change('cell', LAMP_ON, 1, changes);
          return [{ type: 'lit', x: r.x, y: r.y, on: true, changes }];
        }
        if (name === 'toggleLamp' && items[LAMP_ON]) {
          this.change('cell', LAMP_ON, -1, changes);
          this.change('cell', LAMP_OFF, 1, changes);
          return [{ type: 'lit', x: r.x, y: r.y, on: false, changes }];
        }
        return fail('noLamp');
      }
      case 'pick': {
        const item = String(args[0]);
        if (!this.here().items[item]) fail('noItem', { item });
        if (this.state.capacity !== null && this.carried() >= this.state.capacity) fail('inventoryFull', { capacity: this.state.capacity });
        this.change('cell', item, -1, changes);
        this.change('inventory', item, 1, changes);
        return [{ type: 'picked', x: r.x, y: r.y, item, changes }];
      }
      case 'drop': {
        const item = String(args[0]);
        if (!this.state.inventory[item]) fail('notCarrying', { item });
        this.change('inventory', item, -1, changes);
        this.change('cell', item, 1, changes);
        return [{ type: 'dropped', x: r.x, y: r.y, item, changes }];
      }
      case 'say':
        this.state.said.push(args[0]!);
        return [{ type: 'said', value: args[0]! }];
    }
    const action = this.actions.get(name);
    if (!action) return fail('unknownCommand', { name });
    return [this.runAction(action, args)];
  }

  private runAction(a: CustomAction, args: Value[]): GridEvent {
    const r = this.state.robot;
    const here = this.here();
    const missing = (item: string): never => fail('actionFailed', { action: a.label ? a.label.replace(/\{[^}]*\}/g, '…').trim() : a.name, key: a.name, item });
    const needHere = { ...fillItems(a.requireHere, args) };
    for (const [k, n] of Object.entries(fillItems(a.consumeHere, args))) needHere[k] = Math.max(needHere[k] ?? 0, n);
    for (const [k, n] of Object.entries(needHere)) if ((here.items[k] ?? 0) < n) missing(k);
    const needInv = { ...fillItems(a.requireInventory, args) };
    for (const [k, n] of Object.entries(fillItems(a.consumeInventory, args))) needInv[k] = Math.max(needInv[k] ?? 0, n);
    for (const [k, n] of Object.entries(needInv)) if ((this.state.inventory[k] ?? 0) < n) missing(k);
    for (const k of a.forbidHere ?? []) {
      const item = fill(k, args);
      if (here.items[item]) missing(item);
    }
    for (const k of a.forbidInventory ?? []) {
      const item = fill(k, args);
      if (this.state.inventory[item]) missing(item);
    }
    if (a.dropAll && this.carried() === 0) missing('');
    const cycle = (a.cycle ?? []).map((k) => fill(k, args));
    const cycleAt = cycle.findIndex((k) => (here.items[k] ?? 0) > 0);
    if (cycle.length > 0 && cycleAt < 0) missing(cycle[0]!);
    const addInv = fillItems(a.addInventory, args);
    if (this.state.capacity !== null) {
      const net = Object.values(addInv).reduce((t, n) => t + n, 0) - Object.values(fillItems(a.consumeInventory, args)).reduce((t, n) => t + n, 0);
      if (this.carried() + net > this.state.capacity) fail('inventoryFull', { capacity: this.state.capacity });
    }

    const changes: ItemChange[] = [];
    for (const [k, n] of Object.entries(fillItems(a.consumeHere, args))) this.change('cell', k, -n, changes);
    for (const [k, n] of Object.entries(fillItems(a.consumeInventory, args))) this.change('inventory', k, -n, changes);
    for (const [k, n] of Object.entries(fillItems(a.addHere, args))) this.change('cell', k, n, changes);
    for (const [k, n] of Object.entries(addInv)) this.change('inventory', k, n, changes);
    if (a.dropAll) {
      for (const [k, n] of Object.entries({ ...this.state.inventory })) {
        this.change('inventory', k, -n, changes);
        this.change('cell', k, n, changes);
      }
    }
    if (cycleAt >= 0) {
      this.change('cell', cycle[cycleAt]!, -1, changes);
      this.change('cell', cycle[(cycleAt + 1) % cycle.length]!, 1, changes);
    }
    if (a.reveal) {
      for (const [k, n] of Object.entries(here.hidden)) {
        this.change('hidden', k, -n, changes);
        this.change('cell', k, n, changes);
      }
    }
    const event: GridEvent = { type: 'action', action: a.name, args, x: r.x, y: r.y, changes };
    if (a.paint !== undefined) {
      event.painted = { color: a.paint, previous: here.color };
      here.color = a.paint;
    }
    if (a.say !== undefined) {
      event.said = a.say;
      this.state.said.push(a.say);
    }
    if (a.move !== undefined || a.goTo !== undefined) {
      const from: Cell2 = [r.x, r.y];
      if (a.move !== undefined) this.move(a.move);
      if (a.goTo) {
        const x = a.goTo.x === undefined ? r.x : resolve(a.goTo.x, this.state.width);
        const y = a.goTo.y === undefined ? r.y : resolve(a.goTo.y, this.state.height);
        const target = cellAt(this.state, x, y);
        if (!target) fail('outOfBoard', { dir: r.facing });
        if (target.wall) fail('wall', target.terrain ? { dir: r.facing, key: target.terrain } : { dir: r.facing });
        r.x = x;
        r.y = y;
      }
      event.moved = { from, to: [r.x, r.y] };
    }
    return event;
  }

  sensor(name: string, args: Value[]): Value {
    const s = this.state;
    const r = s.robot;
    const here = this.here();
    switch (name) {
      case 'itemHere':
        return (here.items[String(args[0])] ?? 0) > 0;
      case 'countHere':
        return here.items[String(args[0])] ?? 0;
      case 'canMove':
        return this.blocked(args[0] as Direction) === null;
      case 'canMoveForward':
        return this.blocked(r.facing) === null;
      case 'atEdge': {
        const [dx, dy] = delta(args[0] as Direction);
        return !cellAt(s, r.x + dx, r.y + dy);
      }
      case 'hasArrow':
        return here.arrow !== null;
      case 'arrowHere':
        if (here.arrow === null) fail('noArrow');
        return here.arrow;
      case 'arrowIs':
        return here.arrow === args[0];
      case 'colorHere':
        return here.color ?? 'none';
      case 'colorIs':
        return here.color === args[0];
      case 'hasItem':
        return (s.inventory[String(args[0])] ?? 0) > 0;
      case 'inventoryCount':
        return s.inventory[String(args[0])] ?? 0;
      case 'facing':
        return r.facing;
      case 'posX':
        return r.x;
      case 'posY':
        return r.y;
      case 'boardWidth':
        return s.width;
      case 'boardHeight':
        return s.height;
      case 'distanceToEdge': {
        const d = args[0] as Direction;
        return d === 'N' ? r.y : d === 'S' ? s.height - 1 - r.y : d === 'E' ? s.width - 1 - r.x : r.x;
      }
      case 'freeCells': {
        const d = args[0] as Direction;
        const [dx, dy] = delta(d);
        let n = 0;
        while (this.blocked(d, r.x + dx * n, r.y + dy * n) === null) n++;
        return n;
      }
      case 'stepsTo': {
        const [dx, dy] = delta(args[1] as Direction);
        for (let n = 1; ; n++) {
          const c = cellAt(s, r.x + dx * n, r.y + dy * n);
          if (!c) return -1;
          if ((c.items[String(args[0])] ?? 0) > 0) return n;
        }
      }
      case 'terrainIs':
        return here.terrain === args[0];
    }
    return fail('unknownSensor', { name });
  }
}

/** Options of `runGrid`. */
export interface GridRunOptions extends RunOptions {
  actions?: readonly CustomAction[];
  /** Also record the state after every step in `snapshots` (for scrubbing UIs). */
  snapshots?: boolean;
}

/** A finished grid run: the trace plus the states before and after. */
export interface GridRun extends RunResult<GridEvent> {
  initial: GridState;
  final: GridState;
  /** Every command that ran, by name, in order. */
  commands: string[];
  /** With `snapshots`: `snapshots[i]` is the state after step `i`. */
  snapshots?: GridState[];
}

/** Runs a program on a board to the end. */
export function runGrid(board: GridBoard | GridState, program: Program, options: GridRunOptions = {}): GridRun {
  const world = new GridWorld(board, options.actions);
  const initial = cloneGridState(world.state);
  const runner = new Runner(program, world, options);
  const snapshots: GridState[] | undefined = options.snapshots ? [] : undefined;
  while (runner.next()) snapshots?.push(cloneGridState(world.state));
  const out: GridRun = { ...runner.result(), initial, final: cloneGridState(world.state), commands: [...world.log] };
  if (snapshots) out.snapshots = snapshots;
  return out;
}

/** Legend entry of `boardFromRows`: what a character means. */
export interface RowLegend {
  items?: Items;
  hidden?: Items;
  color?: string;
  arrow?: Direction;
  wall?: boolean;
  terrain?: string;
  /** The robot starts here, facing this way. */
  robot?: Direction;
}

/**
 * Builds a board from text rows, the first row being the top one (`y = 0`). Each character is a cell;
 * characters not in the legend (like `.`) are empty cells.
 *
 *     boardFromRows(['..L', 'R.L'], { L: { items: { lamp: 1 } }, R: { robot: 'E' } })
 */
export function boardFromRows(rows: readonly string[], legend: Record<string, RowLegend>, extra: Partial<GridBoard> = {}): GridBoard {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => [...r].length));
  const cells: CellSpec[] = [];
  let robot: GridBoard['robot'] = { x: 0, y: 0 };
  rows.forEach((row, i) => {
    const y = i;
    [...row].forEach((ch, x) => {
      const l = legend[ch];
      if (!l) return;
      if (l.robot) robot = { x, y, facing: l.robot };
      const c: CellSpec = { x, y };
      if (l.items) c.items = { ...l.items };
      if (l.hidden) c.hidden = { ...l.hidden };
      if (l.color !== undefined) c.color = l.color;
      if (l.arrow) c.arrow = l.arrow;
      if (l.wall) c.wall = true;
      if (l.terrain !== undefined) c.terrain = l.terrain;
      if (c.items || c.hidden || c.color !== undefined || c.arrow || c.wall || c.terrain !== undefined) cells.push(c);
    });
  });
  return { width, height, robot, cells, ...extra };
}
