/**
 * The interpreter: runs a program over any world, one step at a time, and records a trace.
 *
 * A world is anything that implements `World`: a table of commands and sensors with their slot
 * types, and two functions that run them. The interpreter owns control flow, procedures,
 * parameters, variables and the safety limits; worlds only know their own rules.
 */
import type { CallStmt, Expr, NodeId, Procedure, Program, Statement } from './ast.js';
import { BlockError, type RunError } from './errors.js';
import { DEFAULT_LABELS, describeValue, toRunError, type Labels } from './labels.js';
import { fitsType, isDirection, leftOf, opposite, rightOf, type Value, type ValueType } from './values.js';

/** One slot of a command or sensor. */
export interface ParamSpec {
  type: ValueType;
  /** A hint for editors (`item`, `color`, `steps`…). */
  name?: string;
}

/** The shape of a world command or sensor: its slots and, for sensors, what it returns. */
export interface BlockSpec {
  params: ParamSpec[];
  /** Sensors only: the type of the answer. */
  returns?: ValueType;
}

/**
 * A world the interpreter can drive. `command` and `sensor` receive arguments already checked
 * against the spec, and report failures by throwing with `fail()`.
 */
export interface World<E> {
  readonly commands: Readonly<Record<string, BlockSpec>>;
  readonly sensors: Readonly<Record<string, BlockSpec>>;
  /** Runs a command and returns what happened, in order. */
  command(name: string, args: Value[]): E[];
  /** Answers a sensor. */
  sensor(name: string, args: Value[]): Value;
}

/** Where variables live. Step worlds use one `MapVariables`; realtime actors combine two. */
export interface VariableStore {
  get(name: string): Value | undefined;
  set(name: string, value: Value): void;
}

/** A plain variable table. */
export class MapVariables implements VariableStore {
  readonly values: Record<string, Value>;

  constructor(initial: Record<string, Value> = {}) {
    this.values = { ...initial };
  }

  get(name: string): Value | undefined {
    return Object.prototype.hasOwnProperty.call(this.values, name) ? this.values[name] : undefined;
  }

  set(name: string, value: Value): void {
    this.values[name] = value;
  }
}

/** What kind of block produced a trace step. */
export type StepKind = 'command' | 'call' | 'repeat' | 'condition' | 'set' | 'change' | 'wait';

/**
 * One step of a run. UIs highlight `node` (and the calls in `stack`); renderers animate `events`.
 *
 * - `command`: a world command ran; `events` says what changed.
 * - `call`: a procedure call started (its body's steps follow, with this call in `stack`).
 * - `repeat`: a `repeat N` started; `value` is N.
 * - `condition`: the condition of an `if` or `repeat until` was checked; `value` is the answer.
 * - `set` / `change`: `variable` now holds `value`.
 * - `wait`: a wait block; `value` is the number of ticks.
 */
export interface TraceStep<E> {
  /** Position in the trace, from 0. */
  index: number;
  node: NodeId;
  kind: StepKind;
  /** Ids of the call blocks being executed, outermost first. */
  stack: NodeId[];
  events: E[];
  value?: Value;
  variable?: string;
  /** Realtime worlds: the actor whose script ran this step. */
  actor?: string;
}

/** A step before it gets its index. */
export type StepData<E> = Omit<TraceStep<E>, 'index'>;

/** What the executor yields: a step, or (realtime) a pause until `ticks` ticks later. */
export type Signal<E> = { type: 'step'; step: StepData<E> } | { type: 'yield'; ticks: number };

/** Default safety limits. */
export const DEFAULT_STEP_LIMIT = 10000;
export const DEFAULT_MAX_DEPTH = 100;

/** Everything a running script needs. One per script (per realtime thread). */
export interface ExecEnv<E> {
  world: World<E>;
  procedures: ReadonlyMap<string, Procedure>;
  vars: VariableStore;
  labels: Labels;
  maxDepth: number;
  /** Work done and allowed: one unit per statement and per loop round. */
  budget: { used: number; limit: number };
  /** Realtime: each loop round and each `wait` hands control back to the scheduler. */
  realtime: boolean;
  stack: NodeId[];
  actor?: string;
}

interface Frame {
  params: ReadonlyMap<string, Value> | null;
  depth: number;
}

/** The procedures of a program by name. Throws `duplicateProcedure` on a repeated name. */
export function procedureMap(program: Program): Map<string, Procedure> {
  const map = new Map<string, Procedure>();
  for (const p of program.procedures ?? []) {
    if (map.has(p.name)) throw new BlockError('duplicateProcedure', { name: p.name }, p.id);
    map.set(p.name, p);
  }
  return map;
}

/** A block label without its slots, for messages: `mover hacia el {0}` becomes `mover hacia el …`. */
export function plainLabel(key: string, labels: Labels): string {
  const t = labels.blocks[key];
  if (t === undefined) return key;
  return t.replace(/\{[^}]*\}/g, '…').replace(/\s+/g, ' ').trim();
}

/** Runs a list of statements as a generator of signals. Used by `Runner` and realtime threads. */
export function* execBody<E>(env: ExecEnv<E>, body: readonly Statement[]): Generator<Signal<E>, void, undefined> {
  yield* execList(env, body, { params: null, depth: 0 });
}

function* execList<E>(env: ExecEnv<E>, list: readonly Statement[], frame: Frame): Generator<Signal<E>, void, undefined> {
  for (const s of list) yield* execStmt(env, s, frame);
}

function spend<E>(env: ExecEnv<E>, node: NodeId): void {
  if (++env.budget.used > env.budget.limit) throw new BlockError('stepLimit', { limit: env.budget.limit }, node);
}

function step<E>(env: ExecEnv<E>, data: Omit<StepData<E>, 'stack' | 'actor'>): Signal<E> {
  const s: StepData<E> = { ...data, stack: [...env.stack] };
  if (env.actor !== undefined) s.actor = env.actor;
  return { type: 'step', step: s };
}

/** Runs `fn`, tagging any `BlockError` without a node with `node`. */
function at<T>(node: NodeId, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BlockError && e.nodeId === null) e.nodeId = node;
    throw e;
  }
}

function* execStmt<E>(env: ExecEnv<E>, s: Statement, frame: Frame): Generator<Signal<E>, void, undefined> {
  spend(env, s.id);
  switch (s.kind) {
    case 'command': {
      const spec = env.world.commands[s.command];
      if (!spec) throw new BlockError('unknownCommand', { name: s.command }, s.id);
      const args = evalArgs(env, s.args, frame, spec, s.command, s.id);
      const events = at(s.id, () => env.world.command(s.command, args));
      yield step(env, { node: s.id, kind: 'command', events });
      return;
    }
    case 'call': {
      yield* execCall(env, s, frame);
      return;
    }
    case 'repeat': {
      const n = evalNumber(env, s.times, frame);
      if (!Number.isInteger(n) || n < 0) throw new BlockError('badCount', { count: n }, s.times.id);
      yield step(env, { node: s.id, kind: 'repeat', events: [], value: n });
      for (let i = 0; i < n; i++) {
        if (i > 0) spend(env, s.id);
        yield* execList(env, s.body, frame);
        if (env.realtime) yield { type: 'yield', ticks: 1 };
      }
      return;
    }
    case 'repeatUntil': {
      for (let round = 0; ; round++) {
        if (round > 0) spend(env, s.id);
        const done = evalBoolean(env, s.until, frame);
        yield step(env, { node: s.id, kind: 'condition', events: [], value: done });
        if (done) return;
        yield* execList(env, s.body, frame);
        if (env.realtime) yield { type: 'yield', ticks: 1 };
      }
    }
    case 'if': {
      const c = evalBoolean(env, s.condition, frame);
      yield step(env, { node: s.id, kind: 'condition', events: [], value: c });
      if (c) yield* execList(env, s.then, frame);
      else if (s.else) yield* execList(env, s.else, frame);
      return;
    }
    case 'set': {
      const v = evalExpr(env, s.value, frame);
      env.vars.set(s.variable, v);
      yield step(env, { node: s.id, kind: 'set', events: [], variable: s.variable, value: v });
      return;
    }
    case 'change': {
      const by = evalNumber(env, s.by, frame);
      const cur = env.vars.get(s.variable) ?? 0;
      if (typeof cur !== 'number') throw new BlockError('notNumber', { name: s.variable }, s.id);
      const v = s.op === '-' ? cur - by : cur + by;
      env.vars.set(s.variable, v);
      yield step(env, { node: s.id, kind: 'change', events: [], variable: s.variable, value: v });
      return;
    }
    case 'wait': {
      const t = evalNumber(env, s.ticks, frame);
      if (!Number.isInteger(t) || t < 0) throw new BlockError('badCount', { count: t }, s.ticks.id);
      yield step(env, { node: s.id, kind: 'wait', events: [], value: t });
      if (env.realtime && t > 0) yield { type: 'yield', ticks: t };
      return;
    }
    default:
      throw new BlockError('unknownBlock', {}, (s as { id?: string }).id ?? null);
  }
}

function* execCall<E>(env: ExecEnv<E>, s: CallStmt, frame: Frame): Generator<Signal<E>, void, undefined> {
  const p = env.procedures.get(s.procedure);
  if (!p) throw new BlockError('unknownProcedure', { name: s.procedure }, s.id);
  if (s.args.length !== p.params.length) {
    throw new BlockError('paramCount', { name: p.name, expected: p.params.length, got: s.args.length }, s.id);
  }
  if (frame.depth + 1 > env.maxDepth) throw new BlockError('recursionDepth', { limit: env.maxDepth }, s.id);
  const params = new Map<string, Value>();
  p.params.forEach((name, i) => {
    const v = evalExpr(env, s.args[i]!, frame);
    const t = p.types?.[i]?.type ?? 'any';
    if (!fitsType(v, t)) throw new BlockError('argType', { name: p.name, expected: env.labels.types[t], position: i + 1 }, s.args[i]!.id);
    params.set(name, v);
  });
  yield step(env, { node: s.id, kind: 'call', events: [] });
  env.stack.push(s.id);
  try {
    yield* execList(env, p.body, { params, depth: frame.depth + 1 });
  } finally {
    env.stack.pop();
  }
}

function evalArgs<E>(env: ExecEnv<E>, args: readonly Expr[], frame: Frame, spec: BlockSpec, key: string, node: NodeId): Value[] {
  if (args.length !== spec.params.length) {
    throw new BlockError('paramCount', { name: plainLabel(key, env.labels), expected: spec.params.length, got: args.length }, node);
  }
  return args.map((a, i) => {
    const v = evalExpr(env, a, frame);
    const t = spec.params[i]!.type;
    if (!fitsType(v, t)) {
      throw new BlockError('argType', { name: plainLabel(key, env.labels), expected: env.labels.types[t], position: i + 1 }, a.id);
    }
    return v;
  });
}

function evalNumber<E>(env: ExecEnv<E>, e: Expr, frame: Frame): number {
  const v = evalExpr(env, e, frame);
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new BlockError('notNumber', { got: describeValue(v, env.labels) }, e.id);
  return v;
}

function evalBoolean<E>(env: ExecEnv<E>, e: Expr, frame: Frame): boolean {
  const v = evalExpr(env, e, frame);
  if (typeof v !== 'boolean') throw new BlockError('notBoolean', { got: describeValue(v, env.labels) }, e.id);
  return v;
}

const EPSILON = 1e-9;

function equal(a: Value, b: Value): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < EPSILON;
  return a === b;
}

function evalExpr<E>(env: ExecEnv<E>, e: Expr, frame: Frame): Value {
  switch (e.kind) {
    case 'number':
    case 'boolean':
    case 'direction':
    case 'name':
      return e.value;
    case 'param': {
      const v = frame.params?.get(e.name);
      if (v === undefined) throw new BlockError('unknownParam', { name: e.name }, e.id);
      return v;
    }
    case 'var': {
      const v = env.vars.get(e.name);
      if (v === undefined) throw new BlockError('unknownVariable', { name: e.name }, e.id);
      return v;
    }
    case 'sensor': {
      const spec = env.world.sensors[e.sensor];
      if (!spec) throw new BlockError('unknownSensor', { name: e.sensor }, e.id);
      const args = evalArgs(env, e.args, frame, spec, e.sensor, e.id);
      return at(e.id, () => env.world.sensor(e.sensor, args));
    }
    case 'arith': {
      const a = evalNumber(env, e.left, frame);
      const b = evalNumber(env, e.right, frame);
      switch (e.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          if (b === 0) throw new BlockError('divisionByZero', {}, e.id);
          return a / b;
        case '%':
          if (b === 0) throw new BlockError('divisionByZero', {}, e.id);
          return ((a % b) + b) % b;
      }
      break;
    }
    case 'compare': {
      if (e.op === '=' || e.op === '!=') {
        const eq = equal(evalExpr(env, e.left, frame), evalExpr(env, e.right, frame));
        return e.op === '=' ? eq : !eq;
      }
      const a = evalNumber(env, e.left, frame);
      const b = evalNumber(env, e.right, frame);
      switch (e.op) {
        case '<':
          return a < b - EPSILON;
        case '<=':
          return a <= b + EPSILON;
        case '>':
          return a > b + EPSILON;
        case '>=':
          return a >= b - EPSILON;
      }
      break;
    }
    case 'and':
      return evalBoolean(env, e.left, frame) && evalBoolean(env, e.right, frame);
    case 'or':
      return evalBoolean(env, e.left, frame) || evalBoolean(env, e.right, frame);
    case 'not':
      return !evalBoolean(env, e.operand, frame);
    case 'dirOp': {
      const d = evalExpr(env, e.operand, frame);
      if (!isDirection(d)) {
        throw new BlockError('argType', { name: plainLabel(e.op, env.labels), expected: env.labels.types.direction, position: 1 }, e.operand.id);
      }
      return e.op === 'opposite' ? opposite(d) : e.op === 'left' ? leftOf(d) : rightOf(d);
    }
  }
  throw new BlockError('unknownBlock', {}, (e as { id?: string }).id ?? null);
}

/** Options of a step-by-step run. */
export interface RunOptions {
  /** Maximum work units (statements and loop rounds) before `stepLimit`. Default 10000. */
  stepLimit?: number;
  /** Maximum nested procedure calls before `recursionDepth`. Default 100. */
  maxDepth?: number;
  labels?: Labels;
  /** Initial variables. */
  variables?: Record<string, Value>;
  /** Runs these statements instead of `program.main` (level harnesses that call the child's procedures). */
  main?: Statement[];
}

/** How a run ended. */
export type RunStatus = 'running' | 'done' | 'error';

/** The result of a finished run. */
export interface RunResult<E> {
  status: Exclude<RunStatus, 'running'>;
  steps: TraceStep<E>[];
  error: RunError | null;
  variables: Record<string, Value>;
}

/**
 * Runs a program over a step world. Call `next()` for one step at a time (a UI's "step" button),
 * or `run()` to the end. The world is changed in place as steps run.
 */
export class Runner<E> {
  readonly steps: TraceStep<E>[] = [];
  status: RunStatus = 'running';
  error: RunError | null = null;
  readonly variables: MapVariables;
  private readonly labels: Labels;
  private readonly gen: Generator<Signal<E>, void, undefined> | null;

  constructor(program: Program, world: World<E>, options: RunOptions = {}) {
    this.labels = options.labels ?? DEFAULT_LABELS;
    this.variables = new MapVariables(options.variables);
    let procedures: Map<string, Procedure>;
    try {
      procedures = procedureMap(program);
    } catch (e) {
      this.fail(e);
      this.gen = null;
      return;
    }
    const env: ExecEnv<E> = {
      world,
      procedures,
      vars: this.variables,
      labels: this.labels,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      budget: { used: 0, limit: options.stepLimit ?? DEFAULT_STEP_LIMIT },
      realtime: false,
      stack: [],
    };
    this.gen = execBody(env, options.main ?? program.main);
  }

  /** Runs one step and returns it, or null when the run has finished (see `status`). */
  next(): TraceStep<E> | null {
    if (this.status !== 'running' || !this.gen) return null;
    try {
      for (;;) {
        const r = this.gen.next();
        if (r.done) {
          this.status = 'done';
          return null;
        }
        if (r.value.type === 'step') {
          const s: TraceStep<E> = { index: this.steps.length, ...r.value.step };
          this.steps.push(s);
          return s;
        }
      }
    } catch (e) {
      this.fail(e);
      return null;
    }
  }

  /** Runs to the end and returns the result. */
  run(): RunResult<E> {
    while (this.next());
    return this.result();
  }

  /** The result so far (call after the run finished). */
  result(): RunResult<E> {
    return {
      status: this.status === 'running' ? 'done' : this.status,
      steps: this.steps,
      error: this.error,
      variables: { ...this.variables.values },
    };
  }

  private fail(e: unknown): void {
    if (!(e instanceof BlockError)) throw e;
    this.status = 'error';
    this.error = toRunError(e, this.labels);
  }
}
