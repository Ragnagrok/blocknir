/**
 * Levels as plain JSON: a world, a toolbox, the boards or trials to test on, and a goal.
 * `check(level, program)` runs every case and says, in the child's language, what worked.
 */
import type { Program, Statement } from './ast.js';
import type { RunError } from './errors.js';
import { evaluateGridGoal, GRID_GOAL_LABELS, type GoalResult, type GridGoal } from './goals.js';
import { checkRequirement, REQUIREMENT_LABELS, type Requirement } from './requirements.js';
import { actionLabels, GRID_LABELS, GRID_SENSORS, gridCommands, runGrid, type CustomAction, type GridBoard, type GridRun } from './grid.js';
import { plainLabel, type BlockSpec, type ParamSpec } from './interpreter.js';
import { DEFAULT_LABELS, formatMessage, mergeLabels, type LabelOverrides, type Labels } from './labels.js';
import { REALTIME_COMMANDS, REALTIME_LABELS, REALTIME_SENSORS, runRealtime, type GameStatus, type RealtimeRun, type RealtimeSetup } from './realtime.js';
import { analyze, countBlocks, entryName, type Catalog, type Issue, type Toolbox, type ToolboxEntry } from './toolbox.js';
import { evaluateTurtleGoal, runTurtle, TURTLE_COMMANDS, TURTLE_LABELS, TURTLE_SENSORS, type TurtleGoal, type TurtleRun, type TurtleStart } from './turtle.js';
import type { Value, ValueType } from './values.js';
import { generateBoards, resolveBoard, type BoardGenerator } from './variants.js';

/** Fields of every level. */
export interface LevelBase {
  id: string;
  /** Free text for the book; the engine does not use it. */
  title?: string;
  toolbox: Toolbox;
  /** Label overrides for this level (block texts, item names, goal reasons…). */
  labels?: LabelOverrides;
  /** Step worlds: work limit per run. Realtime: work limit per script per tick. */
  stepLimit?: number;
  maxDepth?: number;
  /** Requirements on how the program is written, checked by `check()` without running it. */
  requires?: Requirement[];
  /** Free data for editors and renderers (presentation hints like `{ view: 'scene' }`, art keys…). */
  meta?: Record<string, unknown>;
}

/** One explicit test case of a grid level. Missing fields come from the level. */
export interface GridVariant {
  name?: string;
  board?: GridBoard;
  /** Runs this instead of the child's `main`, usually calls of the child's procedures with arguments. */
  main?: Statement[];
  goal?: GridGoal;
}

/**
 * A grid level. The cases tested are `variants` (or the base board when there are none), plus the
 * boards from `generate` (when `generate` is present without `variants`, the base board is only
 * tested with `generate.includeBase`).
 */
export interface GridLevel extends LevelBase {
  world: 'grid';
  board: GridBoard;
  actions?: CustomAction[];
  goal: GridGoal;
  variants?: GridVariant[];
  generate?: BoardGenerator;
}

/** One explicit test case of a turtle level. */
export interface TurtleVariant {
  name?: string;
  start?: TurtleStart;
  main?: Statement[];
  goal?: TurtleGoal;
}

/** A turtle level. */
export interface TurtleLevel extends LevelBase {
  world: 'turtle';
  start?: TurtleStart;
  goal: TurtleGoal;
  variants?: TurtleVariant[];
}

/** A scripted play of a realtime level and the outcome it must have. */
export interface Trial {
  name?: string;
  /** Overrides the level seed. */
  seed?: number;
  /** `inputs[i]`: keys pressed on tick `i + 1`. */
  inputs?: string[][];
  /** Keys pressed on every tick. */
  hold?: string[];
  /** Ticks to play at most. Default: the level's `maxTicks`. */
  ticks?: number;
  expect: 'win' | 'lose' | 'timeout';
}

/** A realtime level. Without trials, `check()` plays once with no input and only looks for errors. */
export interface RealtimeLevel extends LevelBase, RealtimeSetup {
  world: 'realtime';
  trials?: Trial[];
}

/** Any level. */
export type Level = GridLevel | TurtleLevel | RealtimeLevel;

/** A run of any world. */
export type LevelRun = GridRun | TurtleRun | RealtimeRun;

/** The labels of a level: defaults, its world's texts, its actions, then its overrides. */
export function labelsFor(level: Level, base: Labels = DEFAULT_LABELS): Labels {
  switch (level.world) {
    case 'grid':
      return mergeLabels(base, REQUIREMENT_LABELS, GRID_LABELS, GRID_GOAL_LABELS, actionLabels(level.actions ?? []), level.labels);
    case 'turtle':
      return mergeLabels(base, REQUIREMENT_LABELS, TURTLE_LABELS, level.labels);
    case 'realtime':
      return mergeLabels(base, REQUIREMENT_LABELS, REALTIME_LABELS, level.labels);
  }
}

/** The commands and sensors of a level's world (all of them, not only the toolbox's). */
export function catalogFor(level: Level): Catalog {
  switch (level.world) {
    case 'grid':
      return { commands: gridCommands(level.actions ?? []), sensors: GRID_SENSORS };
    case 'turtle':
      return { commands: TURTLE_COMMANDS, sensors: TURTLE_SENSORS };
    case 'realtime':
      return { commands: REALTIME_COMMANDS, sensors: REALTIME_SENSORS };
  }
}

/** A resolved grid case. */
export interface GridCase {
  name?: string;
  board: GridBoard;
  main?: Statement[];
  goal: GridGoal;
}

/**
 * The concrete cases of a grid level, boards resolved (no negative coordinates). `seed` replaces
 * the generator's seed, so a UI can draw new boards on every run.
 */
export function gridCases(level: GridLevel, seed?: number): GridCase[] {
  const out: GridCase[] = [];
  const explicit = level.variants ?? (level.generate ? [] : [{}]);
  for (const v of explicit) {
    const c: GridCase = { board: resolveBoard(v.board ?? level.board), goal: v.goal ?? level.goal };
    if (v.name !== undefined) c.name = v.name;
    if (v.main) c.main = v.main;
    out.push(c);
  }
  if (level.generate) {
    const gen = seed === undefined ? level.generate : { ...level.generate, seed };
    for (const board of generateBoards(level.board, gen)) out.push({ board, goal: level.goal });
  }
  return out;
}

/** How many cases `check()` runs for a level. */
export function caseCount(level: Level): number {
  switch (level.world) {
    case 'grid':
      return (level.variants?.length ?? (level.generate ? 0 : 1)) + (level.generate ? level.generate.count + (level.generate.includeBase ? 1 : 0) : 0);
    case 'turtle':
      return Math.max(1, level.variants?.length ?? 0);
    case 'realtime':
      return Math.max(1, level.trials?.length ?? 0);
  }
}

/** Options of `runCase` and `check`. */
export interface CaseOptions {
  /** Grid: record a state snapshot after every step. */
  snapshots?: boolean;
  /** Base labels (the level's overrides still apply on top). */
  labels?: Labels;
  /** Grid: replaces the board generator's seed (new random boards). */
  seed?: number;
}

/** One case's outcome. */
export interface CaseResult {
  index: number;
  name?: string;
  passed: boolean;
  /** Why it failed, in the child's language. */
  reason: string | null;
  error: RunError | null;
  run: LevelRun;
}

/** Runs one case of a level (a UI's "play" button) and evaluates its goal. */
export function runCase(level: Level, program: Program, index = 0, options: CaseOptions = {}): CaseResult {
  const labels = labelsFor(level, options.labels);
  const limits = {
    labels,
    ...(level.stepLimit !== undefined ? { stepLimit: level.stepLimit } : {}),
    ...(level.maxDepth !== undefined ? { maxDepth: level.maxDepth } : {}),
  };
  const done = (run: LevelRun, error: RunError | null, goal: { passed: boolean; reason: string | null } | null, name?: string): CaseResult => {
    const r: CaseResult = {
      index,
      passed: !error && (goal?.passed ?? true),
      reason: error ? error.message : (goal?.reason ?? null),
      error,
      run,
    };
    if (name !== undefined) r.name = name;
    return r;
  };
  switch (level.world) {
    case 'grid': {
      const c = gridCases(level, options.seed)[index];
      if (!c) throw new Error(`Level ${level.id} has no case ${index}`);
      const run = runGrid(c.board, program, {
        ...limits,
        actions: level.actions ?? [],
        ...(c.main ? { main: c.main } : {}),
        ...(options.snapshots ? { snapshots: true } : {}),
      });
      const goal = run.error ? null : evaluateGridGoal(c.goal, run, labels);
      return done(run, run.error, goal, c.name);
    }
    case 'turtle': {
      const v: TurtleVariant | undefined = level.variants?.length ? level.variants[index] : index === 0 ? {} : undefined;
      if (!v) throw new Error(`Level ${level.id} has no case ${index}`);
      const run = runTurtle(v.start ?? level.start ?? {}, program, { ...limits, ...(v.main ? { main: v.main } : {}) });
      const goal = run.error ? null : evaluateTurtleGoal(v.goal ?? level.goal, run.final, labels, run.initial);
      return done(run, run.error, goal, v.name);
    }
    case 'realtime': {
      const trials = level.trials ?? [];
      if (index >= Math.max(1, trials.length)) throw new Error(`Level ${level.id} has no case ${index}`);
      const t: Trial | undefined = trials[index];
      const run = runRealtime(
        level,
        program,
        { ...(t?.inputs ? { inputs: t.inputs } : {}), ...(t?.hold ? { hold: t.hold } : {}), ...(t?.ticks !== undefined ? { ticks: t.ticks } : {}) },
        { labels, ...(t?.seed !== undefined ? { seed: t.seed } : {}), ...(level.stepLimit !== undefined ? { stepLimit: level.stepLimit } : {}) },
      );
      if (!t) return done(run, run.error, null);
      const want: Record<Trial['expect'], GameStatus> = { win: 'won', lose: 'lost', timeout: 'timeout' };
      const passed = run.status === want[t.expect];
      const reason = passed
        ? null
        : formatMessage(
            labels.goals.trial ?? 'trial',
            { expected: labels.goals[`outcome.${t.expect}`] ?? t.expect, got: labels.goals[`status.${run.status}`] ?? run.status },
            labels,
          );
      return done(run, run.error, { passed, reason }, t.name);
    }
  }
}

/** The outcome of `check()`. */
export interface CheckResult {
  /** Every case passed, no block outside the toolbox, and within par when `strictPar`. */
  passed: boolean;
  /** A summary for the child. */
  message: string;
  blocks: number;
  par: number | null;
  withinPar: boolean;
  /** Static problems (blocks not allowed, unknown names…). */
  issues: Issue[];
  /** One result per level requirement, in order. */
  requirements: GoalResult[];
  cases: CaseResult[];
}

/** Runs a program on every case of a level and reports. */
export function check(level: Level, program: Program, options: CaseOptions = {}): CheckResult {
  const labels = labelsFor(level, options.labels);
  const issues = analyze(program, catalogFor(level), level.toolbox, labels);
  const blocks = countBlocks(program, level.toolbox.parScope ?? 'main');
  const par = level.toolbox.par ?? null;
  const withinPar = par === null || blocks <= par;
  const cases: CaseResult[] = [];
  const n = caseCount(level);
  for (let i = 0; i < n; i++) cases.push(runCase(level, program, i, options));
  const invalid = issues.some((x) => x.code === 'notAllowed' || x.code === 'duplicateProcedure');
  const requirements = (level.requires ?? []).map((r) => checkRequirement(r, program, labels));
  const unmet = requirements.find((r) => !r.passed);
  const allPass = cases.every((c) => c.passed);
  const strictFail = !withinPar && !!level.toolbox.strictPar;
  const params: Record<string, Value> = { blocks, par: par ?? 0 };
  let message: string;
  if (invalid) message = formatMessage(labels.check.invalid ?? 'invalid', params, labels);
  else if (!allPass) {
    const first = cases.find((c) => !c.passed)!;
    const detail = formatMessage(labels.check.caseFailed ?? '{reason}', { n: first.index + 1, reason: first.reason ?? '' }, labels);
    message = `${formatMessage(labels.check.fail ?? 'fail', params, labels)} ${detail}`;
  } else if (unmet) message = formatMessage(labels.check.requirement ?? '{reason}', { ...params, reason: unmet.reason ?? '' }, labels);
  else if (strictFail) message = formatMessage(labels.check.overPar ?? 'overPar', params, labels);
  else if (!withinPar) message = formatMessage(labels.check.passOverPar ?? 'passOverPar', params, labels);
  else message = formatMessage(labels.check.pass ?? 'pass', params, labels);
  return { passed: allPass && !invalid && !strictFail && !unmet, message, blocks, par, withinPar, issues, requirements, cases };
}

// ---------------------------------------------------------------------------------------------
// Palette: what an editor shows
// ---------------------------------------------------------------------------------------------

/** Groups of blocks in an editor palette. */
export type PaletteCategory = 'command' | 'sensor' | 'control' | 'operator' | 'variable' | 'procedure' | 'event';

/** One block an editor should offer. */
export interface PaletteEntry {
  /** The block key (see `blockKey`): a command or sensor name, `repeat`, `+`, `event.key`… */
  key: string;
  category: PaletteCategory;
  /** Spanish template with `{0}` slots. */
  label: string;
  /** Slots. */
  params: ParamSpec[];
  /** Reporters: what they give. */
  returns?: ValueType;
  /** Preset blocks (`Mover ↑`, `¿Hay manzana?`): the fixed arguments for the slots. */
  args?: Value[];
}

/** The blocks a level's toolbox offers, in a stable order, with their labels and slot types. */
export function palette(level: Level, base: Labels = DEFAULT_LABELS): PaletteEntry[] {
  const labels = labelsFor(level, base);
  const cat = catalogFor(level);
  const tb = level.toolbox;
  const out: PaletteEntry[] = [];
  const add = (key: string, category: PaletteCategory, spec: BlockSpec): void => {
    const e: PaletteEntry = { key, category, label: labels.blocks[key] ?? key, params: spec.params };
    if (spec.returns) e.returns = spec.returns;
    out.push(e);
  };
  const entries = (list: readonly ToolboxEntry[], category: PaletteCategory, specs: Readonly<Record<string, BlockSpec>>): void => {
    for (const e of list) {
      const name = entryName(e);
      const spec = specs[name];
      if (!spec) continue;
      add(name, category, spec);
      if (typeof e !== 'string') {
        const last = out[out.length - 1]!;
        if (e.label !== undefined) last.label = e.label;
        if (e.args) last.args = [...e.args];
      }
    }
  };
  entries(tb.commands, 'command', cat.commands);
  entries(tb.sensors ?? [], 'sensor', cat.sensors);
  const n: ParamSpec = { type: 'number' };
  const b: ParamSpec = { type: 'boolean' };
  const any: ParamSpec = { type: 'any' };
  const d: ParamSpec = { type: 'direction' };
  for (const c of tb.control ?? []) add(c, 'control', { params: c === 'repeat' || c === 'wait' ? [n] : [b] });
  for (const o of tb.operators ?? []) {
    if (o === 'and' || o === 'or') add(o, 'operator', { params: [b, b], returns: 'boolean' });
    else if (o === 'not') add(o, 'operator', { params: [b], returns: 'boolean' });
    else if (o === 'opposite' || o === 'left' || o === 'right') add(o, 'operator', { params: [d], returns: 'direction' });
    else if (o === '=' || o === '!=') add(o, 'operator', { params: [any, any], returns: 'boolean' });
    else if (o === '<' || o === '<=' || o === '>' || o === '>=') add(o, 'operator', { params: [n, n], returns: 'boolean' });
    else add(o, 'operator', { params: [n, n], returns: 'number' });
  }
  if (tb.variables) {
    add('set', 'variable', { params: [any] });
    add('change', 'variable', { params: [n] });
    add('subtract', 'variable', { params: [n] });
    add('var', 'variable', { params: [], returns: 'any' });
  }
  if (tb.procedures) {
    add('procedure', 'procedure', { params: [] });
    add('call', 'procedure', { params: [] });
    if (tb.parameters) add('param', 'procedure', { params: [], returns: 'any' });
  }
  for (const e of tb.events ?? []) {
    const key = `event.${e}`;
    add(key, 'event', { params: e === 'key' || e === 'touch' ? [{ type: 'name' }] : [] });
  }
  return out;
}

/** A block's label with slots shown as `…`, for messages and tooltips. */
export function blockText(level: Level, key: string): string {
  return plainLabel(key, labelsFor(level));
}
