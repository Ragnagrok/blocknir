/**
 * The realtime world: a tick-based grid arena with actors. The child's program drives the player
 * actor through event handlers (keys, ticks, touches); every other actor runs its own built-in
 * script, written in the same block language. `step(inputs)` advances one tick, deterministically
 * from a seed.
 *
 * Scheduling, per tick:
 *  1. Handlers wake up: `start` (and `main`) on the first tick, `key` for each pressed key,
 *     `tick` handlers whose period divides the tick number. A handler that is still running from an
 *     earlier tick is not started again.
 *  2. Every script that is due runs, in actor order (the player first) and then in start order,
 *     until it ends or pauses. Each round of a loop and each `wait` pauses until a later tick.
 *  3. Touches: actors that start sharing a cell (or swap cells) wake their `touch` handlers, and
 *     actors entering a tile wake `touch <tile>`. Those handlers run right away, in the same tick.
 *  4. The `lose` condition is checked, then `win`, then the tick limit. With `endWhenMainEnds`,
 *     `win` and `lose` are only checked when the player's `main` finishes, and the game ends then:
 *     won if `win` holds (and `lose` does not), lost otherwise.
 * Bumping into walls or the edge is not an error here: the actor just stays (a `bumped` event).
 *
 * Two kinds of questions about touches: `touching(kind)` asks "am I touching one now?": it is true
 * while sharing a cell, every time it is asked, and is never used up (good for `Repetir hasta que`
 * and for conditions checked twice). `touched(kind)` answers yes once per new contact (it is "used
 * up" by the first question of that actor), so a loop that adds points never counts one touch
 * twice; it also catches actors that swapped cells and never shared one. `signal(name)` / `received(name)` work the same way between actors ("a cloud reached
 * the lighthouse"): every signal is answered yes once by each actor that asks.
 */
import type { Handler, Program, Statement } from './ast.js';
import { BlockError, fail, type RunError } from './errors.js';
import { DEFAULT_LABELS, toRunError, type LabelOverrides, type Labels } from './labels.js';
import { execBody, procedureMap, type BlockSpec, type ExecEnv, type Signal, type TraceStep, type VariableStore, type World } from './interpreter.js';
import { Rng } from './rng.js';
import type { CompareOp } from './ast.js';
import { delta, leftOf, opposite, rightOf, type Direction, type Value } from './values.js';
import type { Cell2 } from './grid.js';

/** The static arena. */
export interface ArenaSpec {
  width: number;
  height: number;
  /** Named floor tiles (`water`, `goal`, `bridge`…). Actors entering one wake `touch <tile>` handlers. */
  tiles?: Array<{ x: number; y: number; tile: string }>;
  /** Solid cells. */
  walls?: Cell2[];
}

/** A kind of actor: its built-in script and whether it blocks movement. */
export interface ActorKind {
  script?: Program;
  /** Other actors cannot move into its cell. Default false (they overlap and touch). */
  solid?: boolean;
  /** Initial look (for renderers). */
  look?: string;
}

/** An actor placed in the arena at the start. */
export interface ActorSpec {
  kind: string;
  x: number;
  y: number;
  facing?: Direction;
  /** Stable id. Default: kind plus a number. */
  id?: string;
  look?: string;
}

/** A win or lose condition, as data. */
export type Condition =
  | { type: 'all'; conditions: Condition[] }
  | { type: 'any'; conditions: Condition[] }
  | { type: 'not'; condition: Condition }
  /** A shared variable (or the player's own) compared with a number or value. */
  | { type: 'var'; name: string; op: CompareOp; value: Value }
  /** The player is at a column / row / edge / tile (all given fields must hold). */
  | { type: 'reach'; x?: number; y?: number; edge?: Direction; tile?: string }
  /** The player touches an actor of this kind (same cell, or they crossed this tick). */
  | { type: 'touch'; kind: string }
  /** No actor of this kind is left. */
  | { type: 'none'; kind: string }
  /** At least this many ticks have passed. */
  | { type: 'tick'; atLeast: number }
  /** The player (or any actor of `kind`) has this look. */
  | { type: 'look'; look: string; kind?: string }
  /** The last thing the player said is this value. */
  | { type: 'said'; value: Value };

/** The world part of a realtime level. */
export interface RealtimeSetup {
  arena: ArenaSpec;
  /** The actor the child's program drives. Its kind defaults to `player`, its id is `player`. */
  player: Omit<ActorSpec, 'kind' | 'id'> & { kind?: string };
  actors?: ActorSpec[];
  kinds?: Record<string, ActorKind>;
  /** Shared variables and their initial values (`score`, `lives`). Other variables are per actor. */
  variables?: Record<string, Value>;
  /** Keys or buttons the game offers (`left`, `right`, `up`, `down`, `action`). */
  keys?: string[];
  win?: Condition;
  lose?: Condition;
  /** The game ends with `timeout` after this many ticks. Default 600. */
  maxTicks?: number;
  /** Seed of the `random` sensor. Default 1. */
  seed?: number;
  /**
   * Only end the game when the player's `main` (the "main loop") finishes: won if `win` holds then,
   * lost otherwise. For games where the child's loop decides when the game is over (and may say
   * "I won!" after it).
   */
  endWhenMainEnds?: boolean;
}

/** How a game is going. */
export type GameStatus = 'running' | 'won' | 'lost' | 'timeout' | 'error';

/** One actor of the live state. */
export interface ActorState {
  id: string;
  kind: string;
  x: number;
  y: number;
  facing: Direction;
  look: string | null;
  /** The actor's own variables. */
  vars: Record<string, Value>;
  /** The last thing it said. */
  said: Value | null;
  /** Unanswered signals and touches (`touch:<kind>`), by name: how many `received` / `touched` will say yes. */
  inbox: Record<string, number>;
}

/** The live realtime state, plain and serializable (scripts in progress are kept apart). */
export interface RealtimeState {
  tick: number;
  status: GameStatus;
  /** Alive actors, in creation order. */
  actors: ActorState[];
  /** Shared variables. */
  variables: Record<string, Value>;
  /** Sounds of this tick and the previous one. */
  sounds: Array<{ tick: number; actor: string; name: string }>;
  /** Pairs of actor ids in contact (`a|b`). */
  contacts: string[];
  rng: number;
  nextId: number;
}

/** What happened during a tick. */
export type RealtimeEvent =
  | { type: 'moved'; actor: string; from: Cell2; to: Cell2 }
  | { type: 'bumped'; actor: string; dir: Direction }
  | { type: 'turned'; actor: string; from: Direction; to: Direction }
  | { type: 'spawned'; actor: string; kind: string; x: number; y: number; facing: Direction }
  | { type: 'vanished'; actor: string }
  | { type: 'said'; actor: string; value: Value }
  | { type: 'sound'; actor: string; name: string }
  | { type: 'look'; actor: string; look: string }
  | { type: 'signal'; actor: string; name: string }
  /** `actor` is null for shared variables. */
  | { type: 'variable'; actor: string | null; name: string; value: Value }
  | { type: 'touched'; a: string; b: string }
  | { type: 'entered'; actor: string; tile: string }
  | { type: 'ended'; status: Exclude<GameStatus, 'running'> };

/** The result of one tick. */
export interface TickResult {
  tick: number;
  inputs: string[];
  /** Block steps that ran this tick (each with its `actor`), for highlighting. */
  steps: TraceStep<RealtimeEvent>[];
  /** Everything that happened, in order. */
  events: RealtimeEvent[];
  status: GameStatus;
  error: RunError | null;
}

/** Realtime commands. */
export const REALTIME_COMMANDS: Readonly<Record<string, BlockSpec>> = {
  move: { params: [{ type: 'direction' }] },
  forward: { params: [] },
  turnLeft: { params: [] },
  turnRight: { params: [] },
  turnAround: { params: [] },
  face: { params: [{ type: 'direction' }] },
  goTo: { params: [{ type: 'number', name: 'x' }, { type: 'number', name: 'y' }] },
  spawn: { params: [{ type: 'name', name: 'kind' }] },
  vanish: { params: [] },
  say: { params: [{ type: 'any' }] },
  play: { params: [{ type: 'name', name: 'sound' }] },
  look: { params: [{ type: 'name', name: 'look' }] },
  signal: { params: [{ type: 'name', name: 'signal' }] },
  win: { params: [] },
  lose: { params: [] },
};

/** Realtime sensors. */
export const REALTIME_SENSORS: Readonly<Record<string, BlockSpec>> = {
  canMove: { params: [{ type: 'direction' }], returns: 'boolean' },
  canMoveForward: { params: [], returns: 'boolean' },
  atEdge: { params: [{ type: 'direction' }], returns: 'boolean' },
  posX: { params: [], returns: 'number' },
  posY: { params: [], returns: 'number' },
  facing: { params: [], returns: 'direction' },
  touching: { params: [{ type: 'name', name: 'kind' }], returns: 'boolean' },
  touched: { params: [{ type: 'name', name: 'kind' }], returns: 'boolean' },
  received: { params: [{ type: 'name', name: 'signal' }], returns: 'boolean' },
  tileHere: { params: [{ type: 'name', name: 'tile' }], returns: 'boolean' },
  heard: { params: [], returns: 'boolean' },
  heardSound: { params: [{ type: 'name', name: 'sound' }], returns: 'boolean' },
  random: { params: [{ type: 'number', name: 'min' }, { type: 'number', name: 'max' }], returns: 'number' },
  directionTo: { params: [{ type: 'name', name: 'kind' }], returns: 'direction' },
  distanceTo: { params: [{ type: 'name', name: 'kind' }], returns: 'number' },
  count: { params: [{ type: 'name', name: 'kind' }], returns: 'number' },
  keyPressed: { params: [{ type: 'name', name: 'key' }], returns: 'boolean' },
  tick: { params: [], returns: 'number' },
};

/** Spanish texts of the realtime world. */
export const REALTIME_LABELS: LabelOverrides = {
  blocks: {
    move: 'Mover {0}',
    forward: 'Avanzar',
    turnLeft: 'Girar a la izquierda',
    turnRight: 'Girar a la derecha',
    turnAround: 'Darse vuelta',
    face: 'Mirar hacia {0}',
    goTo: 'Ir a x {0} y {1}',
    spawn: 'Lanzar {0}',
    vanish: 'Desaparecer',
    say: 'Decir {0}',
    play: 'Hacer sonar {0}',
    look: 'Cambiar el aspecto a {0}',
    signal: 'Avisar {0}',
    win: 'Ganar',
    lose: 'Perder',
    canMove: '¿Puedo moverme {0}?',
    canMoveForward: '¿Puedo avanzar?',
    atEdge: '¿Estoy en el borde {0}?',
    posX: '(mi columna)',
    posY: '(mi fila)',
    facing: '(hacia dónde miro)',
    touching: '¿Estoy tocando {0}?',
    touched: '¿Me tocó {0}?',
    received: '¿Pasó {0}?',
    tileHere: '¿Estoy sobre {0}?',
    heard: '¿Sonó algo?',
    heardSound: '¿Sonó {0}?',
    random: '(número al azar entre {0} y {1})',
    directionTo: '(hacia dónde está {0})',
    distanceTo: '(distancia hasta {0})',
    count: '(cantidad de {0})',
    keyPressed: '¿Botón {0} apretado?',
    tick: '(tic actual)',
  },
  goals: {
    trial: 'había que {expected}, pero {got}.',
    'outcome.win': 'ganar',
    'outcome.lose': 'perder',
    'outcome.timeout': 'aguantar hasta el final',
    'status.won': 'se ganó',
    'status.lost': 'se perdió',
    'status.timeout': 'se terminó el tiempo',
    'status.running': 'el juego no terminó',
    'status.error': 'hubo un error',
  },
};

/** Options of a realtime game. */
export interface RealtimeOptions {
  /** Overrides the setup's seed. */
  seed?: number;
  labels?: Labels;
  /** Work units one script may use in one tick before `stepLimit`. Default 1000. */
  stepLimit?: number;
  maxDepth?: number;
}

interface Thread {
  actor: string;
  /** Handler id, or `main`. */
  key: string;
  gen: Generator<Signal<RealtimeEvent>, void, undefined>;
  env: ExecEnv<RealtimeEvent>;
  resumeAt: number;
  done: boolean;
}

interface Script {
  program: Program;
  procedures: ReturnType<typeof procedureMap>;
}

const resolve = (v: number, size: number): number => (v < 0 ? size + v : v);
const PLAYER = 'player';

/** A running realtime game. */
export class RealtimeGame {
  readonly setup: RealtimeSetup;
  /** The live state. Treat as read-only; use `snapshot()` for a copy. */
  readonly state: RealtimeState;
  error: RunError | null = null;
  private readonly labels: Labels;
  private readonly rng: Rng;
  private readonly scripts = new Map<string, Script>();
  private threads: Thread[] = [];
  private readonly walls = new Set<string>();
  private readonly tiles = new Map<string, string>();
  private readonly stepLimit: number;
  private readonly maxDepth: number;
  private stepCount = 0;
  private inputs: string[] = [];
  private steps: TraceStep<RealtimeEvent>[] = [];
  private events: RealtimeEvent[] = [];
  private entered = new Set<string>();
  private mainDone = false;

  constructor(setup: RealtimeSetup, program: Program, options: RealtimeOptions = {}) {
    this.setup = setup;
    this.labels = options.labels ?? DEFAULT_LABELS;
    this.stepLimit = options.stepLimit ?? 1000;
    this.maxDepth = options.maxDepth ?? 100;
    this.rng = new Rng(options.seed ?? setup.seed ?? 1);
    const { width, height } = setup.arena;
    for (const [x, y] of setup.arena.walls ?? []) this.walls.add(`${resolve(x, width)},${resolve(y, height)}`);
    for (const t of setup.arena.tiles ?? []) this.tiles.set(`${resolve(t.x, width)},${resolve(t.y, height)}`, t.tile);
    this.state = {
      tick: 0,
      status: 'running',
      actors: [],
      variables: { ...(setup.variables ?? {}) },
      sounds: [],
      contacts: [],
      rng: this.rng.state,
      nextId: 1,
    };
    try {
      this.scripts.set(PLAYER, { program, procedures: procedureMap(program) });
      for (const [kind, k] of Object.entries(setup.kinds ?? {})) {
        if (k.script) this.scripts.set(`kind:${kind}`, { program: k.script, procedures: procedureMap(k.script) });
      }
    } catch (e) {
      this.crash(e);
    }
    const p = setup.player;
    this.addActor({ kind: p.kind ?? PLAYER, x: p.x, y: p.y, facing: p.facing ?? 'E', id: PLAYER, ...(p.look !== undefined ? { look: p.look } : {}) });
    for (const a of setup.actors ?? []) this.addActor(a);
  }

  /** How the game is going. */
  get status(): GameStatus {
    return this.state.status;
  }

  /** A deep copy of the state. */
  snapshot(): RealtimeState {
    return JSON.parse(JSON.stringify(this.state)) as RealtimeState;
  }

  /** The actor with this id, if alive. */
  actor(id: string): ActorState | undefined {
    return this.state.actors.find((a) => a.id === id);
  }

  private addActor(spec: ActorSpec): ActorState {
    const { width, height } = this.setup.arena;
    const id = spec.id ?? `${spec.kind}${this.state.nextId++}`;
    const look = spec.look ?? this.setup.kinds?.[spec.kind]?.look ?? null;
    const a: ActorState = {
      id,
      kind: spec.kind,
      x: resolve(spec.x, width),
      y: resolve(spec.y, height),
      facing: spec.facing ?? 'S',
      look,
      vars: {},
      said: null,
      inbox: {},
    };
    this.state.actors.push(a);
    this.entered.add(id);
    return a;
  }

  private scriptOf(a: ActorState): Script | undefined {
    return a.id === PLAYER ? this.scripts.get(PLAYER) : this.scripts.get(`kind:${a.kind}`);
  }

  private startThread(a: ActorState, key: string, body: readonly Statement[], resumeAt: number): void {
    const script = this.scriptOf(a);
    if (!script) return;
    if (this.threads.some((t) => !t.done && t.actor === a.id && t.key === key)) return;
    const shared = this.state.variables;
    const vars: VariableStore = {
      get: (name) => (name in shared ? shared[name] : Object.prototype.hasOwnProperty.call(a.vars, name) ? a.vars[name] : undefined),
      set: (name, value) => {
        if (name in shared) shared[name] = value;
        else a.vars[name] = value;
      },
    };
    const env: ExecEnv<RealtimeEvent> = {
      world: new ActorWorld(this, a.id),
      procedures: script.procedures,
      vars,
      labels: this.labels,
      maxDepth: this.maxDepth,
      budget: { used: 0, limit: this.stepLimit },
      realtime: true,
      stack: [],
      actor: a.id,
    };
    this.threads.push({ actor: a.id, key, gen: execBody(env, body), env, resumeAt, done: false });
  }

  private handlers(a: ActorState): Handler[] {
    return this.scriptOf(a)?.program.handlers ?? [];
  }

  private startScripts(a: ActorState, resumeAt: number): void {
    const script = this.scriptOf(a);
    if (!script) return;
    if (script.program.main.length > 0) this.startThread(a, 'main', script.program.main, resumeAt);
    for (const h of this.handlers(a)) if (h.event.type === 'start') this.startThread(a, h.id, h.body, resumeAt);
  }

  private crash(e: unknown): void {
    if (!(e instanceof BlockError)) throw e;
    this.error = toRunError(e, this.labels);
    this.state.status = 'error';
  }

  private end(status: Exclude<GameStatus, 'running'>): void {
    if (this.state.status !== 'running') return;
    this.state.status = status;
    this.events.push({ type: 'ended', status });
  }

  /** Records an event from a command (called by actor worlds). */
  emit(e: RealtimeEvent): void {
    this.events.push(e);
  }

  /** Runs a thread until it pauses or ends. */
  private runThread(t: Thread): void {
    t.env.budget.used = 0;
    try {
      for (;;) {
        if (this.state.status !== 'running') return;
        if (!this.actor(t.actor)) {
          t.done = true;
          return;
        }
        const r = t.gen.next();
        if (r.done) {
          t.done = true;
          if (t.actor === PLAYER && t.key === 'main') this.mainDone = true;
          return;
        }
        const sig = r.value;
        if (sig.type === 'yield') {
          t.resumeAt = this.state.tick + sig.ticks;
          return;
        }
        const s: TraceStep<RealtimeEvent> = { index: this.stepCount++, ...sig.step };
        this.steps.push(s);
        if (s.variable !== undefined && s.value !== undefined) {
          this.events.push({ type: 'variable', actor: s.variable in this.state.variables ? null : t.actor, name: s.variable, value: s.value });
        }
      }
    } catch (e) {
      t.done = true;
      this.crash(e);
    }
  }

  private runDue(list: Thread[]): void {
    for (const t of list) {
      if (this.state.status !== 'running') return;
      if (!t.done && t.resumeAt <= this.state.tick) this.runThread(t);
    }
  }

  /** Advances one tick with the keys pressed during it, and returns what happened. */
  step(inputs: readonly string[] = []): TickResult {
    const s = this.state;
    this.steps = [];
    this.events = [];
    if (s.status !== 'running') return this.result([]);
    s.tick++;
    const tick = s.tick;
    const allowed = this.setup.keys;
    this.inputs = [...new Set(inputs)].filter((k) => !allowed || allowed.includes(k));
    s.sounds = s.sounds.filter((x) => x.tick >= tick - 1);
    const before = new Map(s.actors.map((a) => [a.id, [a.x, a.y] as Cell2]));

    // 1. Wake handlers.
    for (const a of [...s.actors]) {
      if (tick === 1) this.startScripts(a, tick);
      for (const h of this.handlers(a)) {
        const ev = h.event;
        if ((ev.type === 'key' && this.inputs.includes(ev.key)) || (ev.type === 'tick' && tick % Math.max(1, ev.every ?? 1) === 0)) {
          this.startThread(a, h.id, h.body, tick);
        }
      }
    }
    // 2. Run every due script.
    this.runDue([...this.threads]);

    // 3. Touches.
    if (s.status === 'running') {
      const fresh: Thread[] = [];
      const count = this.threads.length;
      const now = new Set<string>();
      const alive = s.actors;
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i]!;
          const b = alive[j]!;
          const pa = before.get(a.id);
          const pb = before.get(b.id);
          const same = a.x === b.x && a.y === b.y;
          const swapped = !!pa && !!pb && pa[0] === b.x && pa[1] === b.y && pb[0] === a.x && pb[1] === a.y && !same;
          if (same || swapped) now.add(`${a.id}|${b.id}`);
        }
      }
      const old = new Set(s.contacts);
      for (const key of now) {
        if (old.has(key)) continue;
        const [ia, ib] = key.split('|') as [string, string];
        const a = this.actor(ia)!;
        const b = this.actor(ib)!;
        this.events.push({ type: 'touched', a: a.id, b: b.id });
        a.inbox[`touch:${b.kind}`] = (a.inbox[`touch:${b.kind}`] ?? 0) + 1;
        b.inbox[`touch:${a.kind}`] = (b.inbox[`touch:${a.kind}`] ?? 0) + 1;
        for (const h of this.handlers(a)) if (h.event.type === 'touch' && h.event.what === b.kind) this.startThread(a, h.id, h.body, tick);
        for (const h of this.handlers(b)) if (h.event.type === 'touch' && h.event.what === a.kind) this.startThread(b, h.id, h.body, tick);
      }
      s.contacts = [...now].sort();
      for (const a of [...alive]) {
        const p = before.get(a.id);
        const moved = !p || p[0] !== a.x || p[1] !== a.y || this.entered.has(a.id);
        const tile = this.tiles.get(`${a.x},${a.y}`);
        if (!moved || tile === undefined) continue;
        this.events.push({ type: 'entered', actor: a.id, tile });
        for (const h of this.handlers(a)) if (h.event.type === 'touch' && h.event.what === tile) this.startThread(a, h.id, h.body, tick);
      }
      this.entered.clear();
      fresh.push(...this.threads.slice(count));
      this.runDue(fresh);
    }
    this.threads = this.threads.filter((t) => !t.done && this.actor(t.actor));

    // 4. End conditions.
    if (s.status === 'running') {
      const lost = !!this.setup.lose && this.holds(this.setup.lose);
      const won = !!this.setup.win && this.holds(this.setup.win);
      if (this.setup.endWhenMainEnds) {
        if (this.mainDone) this.end(!lost && won ? 'won' : 'lost');
      } else if (lost) this.end('lost');
      else if (won) this.end('won');
      if (s.status === 'running' && tick >= (this.setup.maxTicks ?? 600)) this.end('timeout');
    }
    s.rng = this.rng.state;
    return this.result(this.inputs);
  }

  private result(inputs: string[]): TickResult {
    return { tick: this.state.tick, inputs, steps: this.steps, events: this.events, status: this.state.status, error: this.error };
  }

  /** Whether a condition holds now. */
  holds(c: Condition): boolean {
    const s = this.state;
    const p = this.actor(PLAYER);
    const { width, height } = this.setup.arena;
    switch (c.type) {
      case 'all':
        return c.conditions.every((x) => this.holds(x));
      case 'any':
        return c.conditions.some((x) => this.holds(x));
      case 'not':
        return !this.holds(c.condition);
      case 'var': {
        const v = c.name in s.variables ? s.variables[c.name] : p?.vars[c.name];
        if (v === undefined) return false;
        if (c.op === '=') return v === c.value;
        if (c.op === '!=') return v !== c.value;
        if (typeof v !== 'number' || typeof c.value !== 'number') return false;
        return c.op === '<' ? v < c.value : c.op === '<=' ? v <= c.value : c.op === '>' ? v > c.value : v >= c.value;
      }
      case 'reach': {
        if (!p) return false;
        if (c.x !== undefined && p.x !== resolve(c.x, width)) return false;
        if (c.y !== undefined && p.y !== resolve(c.y, height)) return false;
        if (c.edge !== undefined) {
          const e = c.edge;
          if (!(e === 'N' ? p.y === 0 : e === 'S' ? p.y === height - 1 : e === 'E' ? p.x === width - 1 : p.x === 0)) return false;
        }
        if (c.tile !== undefined && this.tiles.get(`${p.x},${p.y}`) !== c.tile) return false;
        return true;
      }
      case 'touch':
        return s.contacts.some((k) => {
          const [a, b] = k.split('|') as [string, string];
          const other = a === PLAYER ? b : b === PLAYER ? a : null;
          return other !== null && this.actor(other)?.kind === c.kind;
        });
      case 'none':
        return !s.actors.some((a) => a.kind === c.kind);
      case 'tick':
        return s.tick >= c.atLeast;
      case 'look':
        return c.kind === undefined ? p?.look === c.look : s.actors.some((a) => a.kind === c.kind && a.look === c.look);
      case 'said':
        return p?.said === c.value;
    }
  }

  // ------------------------------------------------------------------- actor commands and sensors

  private free(x: number, y: number, self: ActorState): boolean {
    const { width, height } = this.setup.arena;
    if (x < 0 || y < 0 || x >= width || y >= height || this.walls.has(`${x},${y}`)) return false;
    return !this.state.actors.some((o) => o !== self && o.x === x && o.y === y && this.setup.kinds?.[o.kind]?.solid);
  }

  /** Runs a command for an actor. Called by the actor's world. */
  command(id: string, name: string, args: Value[]): RealtimeEvent[] {
    const a = this.actor(id);
    if (!a) return [];
    const out: RealtimeEvent[] = [];
    const turn = (to: Direction): void => {
      if (to !== a.facing) out.push({ type: 'turned', actor: id, from: a.facing, to });
      a.facing = to;
    };
    const go = (d: Direction): void => {
      turn(d);
      const [dx, dy] = delta(d);
      if (!this.free(a.x + dx, a.y + dy, a)) {
        out.push({ type: 'bumped', actor: id, dir: d });
        return;
      }
      const from: Cell2 = [a.x, a.y];
      a.x += dx;
      a.y += dy;
      out.push({ type: 'moved', actor: id, from, to: [a.x, a.y] });
    };
    switch (name) {
      case 'move':
        go(args[0] as Direction);
        break;
      case 'forward':
        go(a.facing);
        break;
      case 'turnLeft':
        turn(leftOf(a.facing));
        break;
      case 'turnRight':
        turn(rightOf(a.facing));
        break;
      case 'turnAround':
        turn(opposite(a.facing));
        break;
      case 'face':
        turn(args[0] as Direction);
        break;
      case 'goTo': {
        const x = Math.round(args[0] as number);
        const y = Math.round(args[1] as number);
        if (!this.free(x, y, a)) out.push({ type: 'bumped', actor: id, dir: a.facing });
        else {
          const from: Cell2 = [a.x, a.y];
          a.x = x;
          a.y = y;
          out.push({ type: 'moved', actor: id, from, to: [x, y] });
        }
        break;
      }
      case 'spawn': {
        const kind = String(args[0]);
        if (!this.setup.kinds?.[kind]) fail('unknownCommand', { name: kind });
        const b = this.addActor({ kind, x: a.x, y: a.y, facing: a.facing });
        out.push({ type: 'spawned', actor: b.id, kind, x: b.x, y: b.y, facing: b.facing });
        this.startScripts(b, this.state.tick + 1);
        break;
      }
      case 'vanish':
        this.state.actors = this.state.actors.filter((o) => o !== a);
        out.push({ type: 'vanished', actor: id });
        break;
      case 'say':
        a.said = args[0]!;
        out.push({ type: 'said', actor: id, value: args[0]! });
        break;
      case 'play': {
        const sound = String(args[0]);
        this.state.sounds.push({ tick: this.state.tick, actor: id, name: sound });
        out.push({ type: 'sound', actor: id, name: sound });
        break;
      }
      case 'look':
        a.look = String(args[0]);
        out.push({ type: 'look', actor: id, look: a.look });
        break;
      case 'signal': {
        const sig = String(args[0]);
        for (const o of this.state.actors) o.inbox[sig] = (o.inbox[sig] ?? 0) + 1;
        out.push({ type: 'signal', actor: id, name: sig });
        break;
      }
      case 'win':
      case 'lose':
        this.events.push(...out);
        this.end(name === 'win' ? 'won' : 'lost');
        return [];
    }
    this.events.push(...out);
    return out;
  }

  private nearest(a: ActorState, kind: string): ActorState | null {
    let best: ActorState | null = null;
    let bd = Infinity;
    for (const o of this.state.actors) {
      if (o === a || o.kind !== kind) continue;
      const d = Math.abs(o.x - a.x) + Math.abs(o.y - a.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Answers a sensor for an actor. Called by the actor's world. */
  sensor(id: string, name: string, args: Value[]): Value {
    const a = this.actor(id);
    const s = this.state;
    const { width, height } = this.setup.arena;
    if (!a) return false;
    switch (name) {
      case 'canMove': {
        const [dx, dy] = delta(args[0] as Direction);
        return this.free(a.x + dx, a.y + dy, a);
      }
      case 'canMoveForward': {
        const [dx, dy] = delta(a.facing);
        return this.free(a.x + dx, a.y + dy, a);
      }
      case 'atEdge': {
        const d = args[0] as Direction;
        return d === 'N' ? a.y === 0 : d === 'S' ? a.y === height - 1 : d === 'E' ? a.x === width - 1 : a.x === 0;
      }
      case 'posX':
        return a.x;
      case 'posY':
        return a.y;
      case 'facing':
        return a.facing;
      case 'touching':
        return s.actors.some((o) => o !== a && o.kind === args[0] && o.x === a.x && o.y === a.y);
      case 'tileHere':
        return this.tiles.get(`${a.x},${a.y}`) === args[0];
      case 'touched':
      case 'received': {
        const key = name === 'touched' ? `touch:${String(args[0])}` : String(args[0]);
        const n = a.inbox[key] ?? 0;
        if (n <= 0) return false;
        if (n === 1) delete a.inbox[key];
        else a.inbox[key] = n - 1;
        return true;
      }
      case 'heard':
        return s.sounds.length > 0;
      case 'heardSound':
        return s.sounds.some((x) => x.name === args[0]);
      case 'random': {
        const v = this.rng.int(args[0] as number, args[1] as number);
        s.rng = this.rng.state;
        return v;
      }
      case 'directionTo': {
        const o = this.nearest(a, String(args[0]));
        if (!o || (o.x === a.x && o.y === a.y)) return a.facing;
        const dx = o.x - a.x;
        const dy = o.y - a.y;
        if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'E' : 'W';
        return dy > 0 ? 'S' : 'N'; // y grows down
      }
      case 'distanceTo': {
        const o = this.nearest(a, String(args[0]));
        return o ? Math.abs(o.x - a.x) + Math.abs(o.y - a.y) : -1;
      }
      case 'count':
        return s.actors.filter((o) => o.kind === args[0]).length;
      case 'keyPressed':
        return this.inputs.includes(String(args[0]));
      case 'tick':
        return s.tick;
    }
    return fail('unknownSensor', { name });
  }
}

/** The world seen from one actor's script. */
class ActorWorld implements World<RealtimeEvent> {
  readonly commands = REALTIME_COMMANDS;
  readonly sensors = REALTIME_SENSORS;

  constructor(
    private readonly game: RealtimeGame,
    private readonly id: string,
  ) {}

  command(name: string, args: Value[]): RealtimeEvent[] {
    // Events are recorded on the game as they happen; the step carries them too.
    return this.game.command(this.id, name, args);
  }

  sensor(name: string, args: Value[]): Value {
    return this.game.sensor(this.id, name, args);
  }
}

/** Inputs for a scripted run: `inputs[i]` are the keys of tick `i + 1`; `hold` keys are pressed every tick. */
export interface InputScript {
  inputs?: string[][];
  hold?: string[];
  /** Stop after this many ticks even if the game goes on. Default: the setup's `maxTicks`. */
  ticks?: number;
}

/** A finished scripted run. */
export interface RealtimeRun {
  status: GameStatus;
  error: RunError | null;
  ticks: TickResult[];
  initial: RealtimeState;
  final: RealtimeState;
}

/** Plays a game with scripted inputs until it ends (or `ticks` run out). */
export function runRealtime(setup: RealtimeSetup, program: Program, script: InputScript = {}, options: RealtimeOptions = {}): RealtimeRun {
  const game = new RealtimeGame(setup, program, options);
  const initial = game.snapshot();
  const ticks: TickResult[] = [];
  const limit = script.ticks ?? setup.maxTicks ?? 600;
  for (let i = 0; i < limit && game.status === 'running'; i++) {
    const keys = [...(script.inputs?.[i] ?? []), ...(script.hold ?? [])];
    ticks.push(game.step(keys));
  }
  return { status: game.status, error: game.error, ticks, initial, final: game.snapshot() };
}

