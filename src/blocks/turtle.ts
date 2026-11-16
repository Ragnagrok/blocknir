/**
 * The turtle world: a pen that walks and turns on a plane, drawing segments. Axes are screen-like,
 * as in the grid: `x` grows to the right and `y` grows down. Headings are in degrees, clockwise
 * from east (0 →, 90 ↓, 180 ←, 270 ↑), so `turnRight` (↻) adds degrees. The turtle starts at
 * (0, 0) facing east with the pen down unless the level says otherwise.
 */
import type { Program } from './ast.js';
import { fail } from './errors.js';
import { formatMessage, type LabelOverrides, type Labels } from './labels.js';
import type { GoalBase, GoalResult } from './goals.js';
import { Runner, type BlockSpec, type RunOptions, type RunResult, type World } from './interpreter.js';
import type { Value } from './values.js';

/** A 2D point. */
export type Point = [x: number, y: number];

/** A drawn line. */
export interface Segment {
  from: Point;
  to: Point;
  color: string;
}

/** Where and how the turtle starts. */
export interface TurtleStart {
  x?: number;
  y?: number;
  /** Degrees, clockwise from east. Default 0 (→). */
  heading?: number;
  /** Pen down at the start. Default true. */
  pen?: boolean;
  /** Pen color. Default `black`. */
  color?: string;
  /** The drawing area, from (0, 0). Walking out of it fails with `outOfArea`. Unlimited when missing. */
  area?: { width: number; height: number };
}

/** The live turtle state, plain and serializable. */
export interface TurtleState {
  x: number;
  y: number;
  heading: number;
  pen: boolean;
  color: string;
  segments: Segment[];
}

/** What a turtle command did. */
export type TurtleEvent =
  | { type: 'moved'; from: Point; to: Point; drew: boolean; color: string }
  | { type: 'turned'; from: number; to: number; by: number }
  | { type: 'pen'; down: boolean }
  | { type: 'color'; color: string };

/** Turtle commands. */
export const TURTLE_COMMANDS: Readonly<Record<string, BlockSpec>> = {
  forward: { params: [{ type: 'number', name: 'steps' }] },
  back: { params: [{ type: 'number', name: 'steps' }] },
  turnLeft: { params: [{ type: 'number', name: 'degrees' }] },
  turnRight: { params: [{ type: 'number', name: 'degrees' }] },
  penUp: { params: [] },
  penDown: { params: [] },
  penColor: { params: [{ type: 'name', name: 'color' }] },
};

/** Turtle sensors. */
export const TURTLE_SENSORS: Readonly<Record<string, BlockSpec>> = {
  heading: { params: [], returns: 'number' },
  posX: { params: [], returns: 'number' },
  posY: { params: [], returns: 'number' },
  penIsDown: { params: [], returns: 'boolean' },
};

/** Spanish texts of the turtle world. */
export const TURTLE_LABELS: LabelOverrides = {
  blocks: {
    forward: 'Avanzar {0} pasos',
    back: 'Retroceder {0} pasos',
    turnLeft: 'Girar ↺ {0} grados',
    turnRight: 'Girar ↻ {0} grados',
    penUp: 'Levantar tiza',
    penDown: 'Bajar tiza',
    penColor: 'Tiza de color {0}',
    heading: '(hacia dónde miro)',
    posX: '(mi posición x)',
    posY: '(mi posición y)',
    penIsDown: '¿La tiza está baja?',
  },
  goals: {
    shape: 'El dibujo no es igual al que había que hacer.',
    shapeCount: 'El dibujo tiene {got} líneas, y tenía que tener {expected}.',
    shapeHome: 'El dibujo está bien, pero había que terminar donde se empezó.',
  },
};

const round = (v: number): number => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};
const norm = (deg: number): number => round(((deg % 360) + 360) % 360);

/** A new turtle state. */
export function createTurtleState(start: TurtleStart = {}): TurtleState {
  return {
    x: start.x ?? 0,
    y: start.y ?? 0,
    heading: norm(start.heading ?? 0),
    pen: start.pen ?? true,
    color: start.color ?? 'black',
    segments: [],
  };
}

/** Applies one event to a state, as the world did. */
export function applyTurtleEvent(s: TurtleState, e: TurtleEvent): void {
  switch (e.type) {
    case 'moved':
      s.x = e.to[0];
      s.y = e.to[1];
      if (e.drew) s.segments.push({ from: [...e.from], to: [...e.to], color: e.color });
      break;
    case 'turned':
      s.heading = e.to;
      break;
    case 'pen':
      s.pen = e.down;
      break;
    case 'color':
      s.color = e.color;
      break;
  }
}

/** The turtle world. */
export class TurtleWorld implements World<TurtleEvent> {
  readonly state: TurtleState;
  readonly commands = TURTLE_COMMANDS;
  readonly sensors = TURTLE_SENSORS;
  private readonly area: TurtleStart['area'];

  constructor(start: TurtleStart = {}) {
    this.state = createTurtleState(start);
    this.area = start.area;
  }

  command(name: string, args: Value[]): TurtleEvent[] {
    const s = this.state;
    let e: TurtleEvent;
    switch (name) {
      case 'forward':
      case 'back': {
        const n = (args[0] as number) * (name === 'back' ? -1 : 1);
        const a = (s.heading * Math.PI) / 180;
        const from: Point = [s.x, s.y];
        const to: Point = [round(s.x + Math.cos(a) * n), round(s.y + Math.sin(a) * n)];
        const ar = this.area;
        if (ar && (to[0] < -1e-6 || to[1] < -1e-6 || to[0] > ar.width + 1e-6 || to[1] > ar.height + 1e-6)) fail('outOfArea');
        e = { type: 'moved', from, to, drew: s.pen && n !== 0, color: s.color };
        break;
      }
      case 'turnLeft':
      case 'turnRight': {
        const by = (args[0] as number) * (name === 'turnLeft' ? -1 : 1);
        e = { type: 'turned', from: s.heading, to: norm(s.heading + by), by };
        break;
      }
      case 'penUp':
      case 'penDown':
        e = { type: 'pen', down: name === 'penDown' };
        break;
      case 'penColor':
        e = { type: 'color', color: String(args[0]) };
        break;
      default:
        return [];
    }
    applyTurtleEvent(s, e);
    return [e];
  }

  sensor(name: string): Value {
    const s = this.state;
    switch (name) {
      case 'heading':
        return s.heading;
      case 'posX':
        return s.x;
      case 'posY':
        return s.y;
      default:
        return s.pen;
    }
  }
}

/** A finished turtle run. */
export interface TurtleRun extends RunResult<TurtleEvent> {
  initial: TurtleState;
  final: TurtleState;
}

/** Runs a program with the turtle to the end. */
export function runTurtle(start: TurtleStart, program: Program, options: RunOptions = {}): TurtleRun {
  const world = new TurtleWorld(start);
  const initial = JSON.parse(JSON.stringify(world.state)) as TurtleState;
  const result = new Runner(program, world, options).run();
  return { ...result, initial, final: JSON.parse(JSON.stringify(world.state)) as TurtleState };
}

// ---------------------------------------------------------------------------------------------
// Shapes and the shape goal
// ---------------------------------------------------------------------------------------------

/** A target drawing: explicit segments, or a regular polygon or star drawn turtle-style. */
export type TurtleTarget =
  | { segments: Array<{ from: Point; to: Point; color?: string }> }
  | {
      polygon: {
        sides: number;
        side: number;
        /** Star polygons: `{sides/step}`, for example 5 and 2 for a five-pointed star. Default 1. */
        step?: number;
        start?: Point;
        heading?: number;
        color?: string;
      };
    };

/**
 * The drawing must match the target. Segments are compared as a set: order and direction do not
 * matter, and collinear pieces are merged (two `forward 50` equal one `forward 100`).
 */
export type TurtleGoal = GoalBase &
  (
    | ShapeGoal
    /** Any of these goals (for example "five squares, apart or touching"). */
    | { type: 'any'; goals: TurtleGoal[] }
  );

/** The shape goal. */
export interface ShapeGoal {
  type: 'shape';
  target: TurtleTarget;
  /** Max distance between matching endpoints. Default 0.5. */
  tolerance?: number;
  /**
   * `exact`: same place. `translate`: anywhere. `rigid` (default): anywhere and in any rotation
   * (a mirror image of a regular polygon is one of its rotations).
   */
  match?: 'exact' | 'translate' | 'rigid';
  /** Also compare colors. Default false. */
  colors?: boolean;
  /** The turtle must also end where it started (within the tolerance). */
  returnHome?: boolean;
}

/** The segments of a regular polygon (or star with `step` > 1), turning right (↻) from `start`. */
export function polygonSegments(sides: number, side: number, step = 1, start: Point = [0, 0], heading = 0, color = 'black'): Segment[] {
  const out: Segment[] = [];
  let [x, y] = start;
  let h = heading;
  for (let i = 0; i < sides; i++) {
    const a = (h * Math.PI) / 180;
    const nx = round(x + Math.cos(a) * side);
    const ny = round(y + Math.sin(a) * side);
    out.push({ from: [x, y], to: [nx, ny], color });
    x = nx;
    y = ny;
    h += (360 * step) / sides;
  }
  return out;
}

/** The segments of a target. */
export function targetSegments(t: TurtleTarget): Segment[] {
  if ('segments' in t) return t.segments.map((s) => ({ from: s.from, to: s.to, color: s.color ?? 'black' }));
  const p = t.polygon;
  return polygonSegments(p.sides, p.side, p.step ?? 1, p.start ?? [0, 0], p.heading ?? 0, p.color ?? 'black');
}

/**
 * Normalizes a drawing: drops dots, and merges collinear segments that overlap or touch (per color
 * when `colors`). The result is independent of drawing order and direction.
 */
export function normalizeSegments(segs: readonly Segment[], tolerance = 0.5, colors = false): Segment[] {
  interface Piece {
    angle: number;
    offset: number;
    t0: number;
    t1: number;
    color: string;
  }
  const pieces: Piece[] = [];
  for (const s of segs) {
    const dx = s.to[0] - s.from[0];
    const dy = s.to[1] - s.from[1];
    const len = Math.hypot(dx, dy);
    if (len < tolerance) continue;
    let angle = Math.atan2(dy, dx);
    if (angle < 0) angle += Math.PI;
    if (angle >= Math.PI - 1e-6) angle -= Math.PI;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const ta = s.from[0] * ux + s.from[1] * uy;
    const tb = s.to[0] * ux + s.to[1] * uy;
    pieces.push({ angle, offset: -s.from[0] * uy + s.from[1] * ux, t0: Math.min(ta, tb), t1: Math.max(ta, tb), color: colors ? s.color : '' });
  }
  const groups: Piece[][] = [];
  const sameLine = (a: Piece, b: Piece): boolean => {
    let da = Math.abs(a.angle - b.angle);
    da = Math.min(da, Math.PI - da);
    return da < 1e-3 && Math.abs(a.offset - b.offset) < tolerance / 2 && a.color === b.color;
  };
  for (const p of pieces) {
    const g = groups.find((g) => sameLine(g[0]!, p));
    if (g) g.push(p);
    else groups.push([p]);
  }
  const out: Segment[] = [];
  for (const g of groups) {
    const { angle, offset, color } = g[0]!;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const at = (t: number): Point => [round(t * ux - offset * uy), round(t * uy + offset * ux)];
    g.sort((a, b) => a.t0 - b.t0);
    let cur = { t0: g[0]!.t0, t1: g[0]!.t1 };
    const flush = (): void => {
      out.push({ from: at(cur.t0), to: at(cur.t1), color: colors ? color : 'black' });
    };
    for (const p of g.slice(1)) {
      if (p.t0 <= cur.t1 + tolerance / 2) cur.t1 = Math.max(cur.t1, p.t1);
      else {
        flush();
        cur = { t0: p.t0, t1: p.t1 };
      }
    }
    flush();
  }
  return out;
}

const close = (a: Point, b: Point, tol: number): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

function matchSets(drawn: readonly Segment[], target: readonly Segment[], tol: number, colors: boolean): boolean {
  if (drawn.length !== target.length) return false;
  const used = new Array<boolean>(drawn.length).fill(false);
  for (const t of target) {
    const i = drawn.findIndex(
      (d, k) =>
        !used[k] &&
        (!colors || d.color === t.color) &&
        ((close(d.from, t.from, tol) && close(d.to, t.to, tol)) || (close(d.from, t.to, tol) && close(d.to, t.from, tol))),
    );
    if (i < 0) return false;
    used[i] = true;
  }
  return true;
}

function centered(segs: readonly Segment[]): Segment[] {
  let cx = 0;
  let cy = 0;
  for (const s of segs) {
    cx += s.from[0] + s.to[0];
    cy += s.from[1] + s.to[1];
  }
  const n = Math.max(1, segs.length * 2);
  cx /= n;
  cy /= n;
  return segs.map((s) => ({ ...s, from: [s.from[0] - cx, s.from[1] - cy], to: [s.to[0] - cx, s.to[1] - cy] }));
}

function rotated(segs: readonly Segment[], a: number): Segment[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = (p: Point): Point => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  return segs.map((g) => ({ ...g, from: r(g.from), to: r(g.to) }));
}

/** Whether two drawings are the same shape under the chosen match mode. */
export function sameDrawing(
  drawn: readonly Segment[],
  target: readonly Segment[],
  options: { tolerance?: number; match?: 'exact' | 'translate' | 'rigid'; colors?: boolean } = {},
): boolean {
  const tol = options.tolerance ?? 0.5;
  const colors = options.colors ?? false;
  const a = normalizeSegments(drawn, tol, colors);
  const b = normalizeSegments(target, tol, colors);
  if (a.length !== b.length) return false;
  const match = options.match ?? 'rigid';
  if (match === 'exact') return matchSets(a, b, tol, colors);
  const ca = centered(a);
  const cb = centered(b);
  if (match === 'translate') return matchSets(ca, cb, tol, colors);
  if (cb.length === 0) return ca.length === 0;
  const b0 = cb[0]!;
  const lb = Math.hypot(b0.to[0] - b0.from[0], b0.to[1] - b0.from[1]);
  const ab = Math.atan2(b0.to[1] - b0.from[1], b0.to[0] - b0.from[0]);
  for (const d of ca) {
    if (Math.abs(Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) - lb) > tol) continue;
    const ad = Math.atan2(d.to[1] - d.from[1], d.to[0] - d.from[0]);
    for (const phi of [ad - ab, ad - ab + Math.PI]) {
      if (matchSets(ca, rotated(cb, phi), tol, colors)) return true;
    }
  }
  return false;
}

/** Evaluates a turtle goal against the final drawing (and the start, for `returnHome`). */
export function evaluateTurtleGoal(goal: TurtleGoal, final: TurtleState, labels: Labels, initial?: TurtleState): GoalResult {
  if (goal.type === 'any') {
    let first: GoalResult | null = null;
    for (const g of goal.goals) {
      const r = evaluateTurtleGoal(g, final, labels, initial);
      if (r.passed) return r;
      first ??= r;
    }
    return first && !goal.message ? first : { passed: false, reason: formatMessage(goal.message ?? labels.goals.shape ?? 'shape', {}, labels) };
  }
  const target = targetSegments(goal.target);
  const opts = { tolerance: goal.tolerance ?? 0.5, match: goal.match ?? 'rigid', colors: goal.colors ?? false } as const;
  if (sameDrawing(final.segments, target, opts)) {
    if (goal.returnHome && initial && Math.hypot(final.x - initial.x, final.y - initial.y) > opts.tolerance) {
      return { passed: false, reason: formatMessage(goal.message ?? labels.goals.shapeHome ?? 'shapeHome', {}, labels) };
    }
    return { passed: true, reason: null };
  }
  const got = normalizeSegments(final.segments, opts.tolerance, opts.colors).length;
  const expected = normalizeSegments(target, opts.tolerance, opts.colors).length;
  const key = got !== expected ? 'shapeCount' : 'shape';
  return { passed: false, reason: formatMessage(goal.message ?? labels.goals[key] ?? key, { got, expected }, labels) };
}
