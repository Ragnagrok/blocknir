/**
 * Grid goals as data, and their evaluation against a finished run.
 */
import type { CompareOp } from './ast.js';
import { cellAt, countOnBoard, type GridState, type Items } from './grid.js';
import { formatMessage, type LabelOverrides, type Labels } from './labels.js';
import type { Direction, Value } from './values.js';

/** Fields every goal may have. */
export interface GoalBase {
  /** A message that replaces the default failure reason (Spanish, `{param}` placeholders allowed). */
  message?: string;
}

/**
 * What a grid level asks for. Combine with `all`, `any` and `not`. Coordinates may be negative
 * (counted from the far side), so a goal works on boards of changing size.
 */
export type GridGoal = GoalBase &
  (
    | { type: 'all'; goals: GridGoal[] }
    | { type: 'any'; goals: GridGoal[] }
    | { type: 'not'; goal: GridGoal }
    /** No visible `item` left on the board (`{ type: 'noItem', item: 'lamp' }`: all lamps lit). */
    | { type: 'noItem'; item: string }
    /** The board has `count` of `item` (compared with `op`, `=` by default). */
    | { type: 'itemCount'; item: string; count: number; op?: CompareOp }
    /** The robot ends at a column, row, edge or on a cell with an item, and optionally facing a way. */
    | { type: 'robotAt'; x?: number; y?: number; edge?: Direction; onItem?: string; facing?: Direction }
    /** A cell ends with these item counts (only the listed items are checked) and/or this color (`null`: unpainted). */
    | { type: 'cell'; x: number; y: number; items?: Items; color?: string | null }
    /** Mosaics: these cells end painted so; with `exact`, no other cell is painted. */
    | { type: 'colors'; cells: Array<{ x: number; y: number; color: string }>; exact?: boolean }
    /** The robot ends carrying these counts; with `exact`, nothing else. */
    | { type: 'inventory'; items: Items; exact?: boolean }
    /** The last thing the robot said is `value`. */
    | { type: 'said'; value: Value }
    /** The last thing the robot said is how many `item` the board had at the start (counting hidden ones too with `hidden`). */
    | { type: 'saidCount'; item: string; hidden?: boolean }
    /** The robot carries as many `counter` as there were `of` on the board at the start (counting games). */
    | { type: 'tally'; counter: string; of: string; hidden?: boolean }
    /** The commands that ran (only those in `only`, when given) are exactly `commands`, in order. */
    | { type: 'sequence'; commands: string[]; only?: string[] }
  );

/** What a goal is evaluated against. */
export interface GoalInput {
  initial: GridState;
  final: GridState;
  commands: readonly string[];
}

/** The outcome of a goal. */
export interface GoalResult {
  passed: boolean;
  /** Why it failed, in the child's language. Null when it passed. */
  reason: string | null;
}

/** Default Spanish failure reasons of grid goals. Override `goals[key]` or `goals['key:item']`. */
export const GRID_GOAL_LABELS: LabelOverrides = {
  goals: {
    noItem: 'Todavía hay {item} en el tablero (quedan {count}).',
    'noItem:lamp': 'Todavía quedan faroles sin prender ({count}).',
    itemCount: 'Tenía que haber {expected} de {item} en el tablero, y hay {count}.',
    robotAt: 'El robot no terminó donde tenía que terminar.',
    robotFacing: 'El robot tenía que terminar mirando al {expected}.',
    cellItems: 'En la casilla ({x}, {y}) tenía que haber {expected} de {item}, y hay {count}.',
    cellColor: 'La casilla ({x}, {y}) tenía que quedar pintada de {expected}.',
    cellUnpainted: 'La casilla ({x}, {y}) no tenía que quedar pintada.',
    inventory: 'Tenías que terminar llevando {expected} de {item}, y llevás {count}.',
    said: 'Había que decir {expected}, y se dijo {got}.',
    saidNothing: 'Había que decir {expected}, pero no se dijo nada.',
    sequence: 'Las acciones no se hicieron en el orden pedido.',
    tally: 'La cuenta de {item} dio {got}, y había {expected}.',
    any: 'No se cumplió ninguna de las condiciones.',
    not: 'Pasó algo que no tenía que pasar.',
  },
};

const resolve = (v: number, size: number): number => (v < 0 ? size + v : v);

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
  }
}

/** Evaluates a grid goal. */
export function evaluateGridGoal(goal: GridGoal, input: GoalInput, labels: Labels): GoalResult {
  const ok: GoalResult = { passed: true, reason: null };
  const no = (key: string, params: Record<string, Value> = {}, specific?: string): GoalResult => {
    const template = goal.message ?? (specific !== undefined ? labels.goals[`${key}:${specific}`] : undefined) ?? labels.goals[key] ?? key;
    return { passed: false, reason: formatMessage(template, params, labels) };
  };
  const s = input.final;
  switch (goal.type) {
    case 'all': {
      for (const g of goal.goals) {
        const r = evaluateGridGoal(g, input, labels);
        if (!r.passed) return goal.message ? no('all') : r;
      }
      return ok;
    }
    case 'any': {
      let first: GoalResult | null = null;
      for (const g of goal.goals) {
        const r = evaluateGridGoal(g, input, labels);
        if (r.passed) return ok;
        first ??= r;
      }
      return goal.message || !first ? no('any') : first;
    }
    case 'not':
      return evaluateGridGoal(goal.goal, input, labels).passed ? no('not') : ok;
    case 'noItem': {
      const count = countOnBoard(s, goal.item);
      return count === 0 ? ok : no('noItem', { item: goal.item, count }, goal.item);
    }
    case 'itemCount': {
      const count = countOnBoard(s, goal.item);
      return compare(count, goal.op ?? '=', goal.count) ? ok : no('itemCount', { item: goal.item, count, expected: goal.count }, goal.item);
    }
    case 'robotAt': {
      const r = s.robot;
      if (goal.x !== undefined && r.x !== resolve(goal.x, s.width)) return no('robotAt');
      if (goal.y !== undefined && r.y !== resolve(goal.y, s.height)) return no('robotAt');
      if (goal.edge !== undefined) {
        const e = goal.edge;
        const at = e === 'N' ? r.y === 0 : e === 'S' ? r.y === s.height - 1 : e === 'E' ? r.x === s.width - 1 : r.x === 0;
        if (!at) return no('robotAt');
      }
      if (goal.onItem !== undefined && !(cellAt(s, r.x, r.y)!.items[goal.onItem] ?? 0)) return no('robotAt');
      if (goal.facing !== undefined && r.facing !== goal.facing) return no('robotFacing', { expected: goal.facing, got: r.facing });
      return ok;
    }
    case 'cell': {
      const x = resolve(goal.x, s.width);
      const y = resolve(goal.y, s.height);
      const c = cellAt(s, x, y);
      if (!c) return no('robotAt');
      for (const [item, expected] of Object.entries(goal.items ?? {})) {
        const count = c.items[item] ?? 0;
        if (count !== expected) return no('cellItems', { x, y, item, expected, count }, item);
      }
      if (goal.color !== undefined && c.color !== goal.color) {
        return goal.color === null ? no('cellUnpainted', { x, y }) : no('cellColor', { x, y, expected: goal.color });
      }
      return ok;
    }
    case 'colors': {
      const want = new Map<number, string>();
      for (const t of goal.cells) want.set(resolve(t.x, s.width) + resolve(t.y, s.height) * s.width, t.color);
      for (const [i, color] of want) {
        if (s.cells[i]?.color !== color) return no('cellColor', { x: i % s.width, y: Math.floor(i / s.width), expected: color });
      }
      if (goal.exact) {
        for (let i = 0; i < s.cells.length; i++) {
          if (!want.has(i) && s.cells[i]!.color !== null && s.cells[i]!.color !== input.initial.cells[i]!.color) {
            return no('cellUnpainted', { x: i % s.width, y: Math.floor(i / s.width) });
          }
        }
      }
      return ok;
    }
    case 'inventory': {
      for (const [item, expected] of Object.entries(goal.items)) {
        const count = s.inventory[item] ?? 0;
        if (count !== expected) return no('inventory', { item, expected, count }, item);
      }
      if (goal.exact) {
        for (const [item, count] of Object.entries(s.inventory)) {
          if (goal.items[item] === undefined) return no('inventory', { item, expected: 0, count }, item);
        }
      }
      return ok;
    }
    case 'said':
    case 'saidCount': {
      const expected = goal.type === 'said' ? goal.value : countOnBoard(input.initial, goal.item, goal.hidden ?? false);
      const got = s.said[s.said.length - 1];
      if (got === undefined) return no('saidNothing', { expected });
      const same = typeof got === 'number' && typeof expected === 'number' ? Math.abs(got - expected) < 1e-9 : got === expected;
      return same ? ok : no('said', { expected, got });
    }
    case 'tally': {
      const expected = countOnBoard(input.initial, goal.of, goal.hidden ?? false);
      const got = s.inventory[goal.counter] ?? 0;
      return got === expected ? ok : no('tally', { item: goal.of, got, expected }, goal.of);
    }
    case 'sequence': {
      const only = goal.only;
      const ran = only ? input.commands.filter((c) => only.includes(c)) : input.commands;
      const same = ran.length === goal.commands.length && ran.every((c, i) => c === goal.commands[i]);
      return same ? ok : no('sequence');
    }
  }
}
