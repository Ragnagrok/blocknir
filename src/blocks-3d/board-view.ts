/**
 * `BoardView`: renders a block-language world (grid, turtle or realtime) on a canvas from a fixed
 * three-quarter camera that frames the whole board, and animates runs from their traces. Boards too
 * long to show whole at a readable size (a 30 × 1 row on a phone) get a follow camera: the whole
 * board at reset and at the end, a closer view that pans with the character while it runs (see
 * `CameraMode`; levels ask for it with `meta.camera: 'follow'` or `meta.camara: 'sigue'`).
 *
 * ```ts
 * const view = new BoardView(canvas, { onStep: (s) => highlight(s.node) });
 * const result = runCase(level, program, 0);
 * view.reset(result.run.initial, presentation(level));
 * await view.play(result.run, { speed: 2 });
 * ```
 */
import * as THREE from 'three';
import {
  createGridState,
  labelsFor,
  RealtimeGame,
  targetSegments,
  type GridState,
  type Labels,
  type Level,
  type LevelRun,
  type RealtimeSetup,
  type RealtimeState,
  type RunError,
  type Segment,
  type TickResult,
  type TraceStep,
  type TurtleGoal,
  type TurtleState,
} from '../blocks/index.js';
import { glowSprite, View } from '../render/index.js';
import { AssetCache } from './assets.js';
import { defaultSkin } from './default-skin.js';
import { cameraAxes, followBox, frameBox, pixelsPerMeter, type Bounds, type Framing, type Vec3 } from './framing.js';
import { GridStage } from './grid-stage.js';
import { disposeObject, Poof, ScreenSprite, shareTexture } from './pieces.js';
import { RealtimeStage, type RealtimeHud } from './realtime-stage.js';
import type { Environment, Skin } from './skin.js';
import type { Stage, StageContext, StepStage } from './stage.js';
import { DEFAULT_TIMING, parseSpeed, Playhead, type Timing } from './timeline.js';
import { TurtleStage } from './turtle-stage.js';

/** Which world is shown. */
export type WorldKind = 'grid' | 'turtle' | 'realtime';

/** A speed multiplier (0.1 … 16; the UI offers ×0.5 … ×4), or `'instant'`. */
export type Speed = number | 'instant';

/**
 * How the camera behaves. `frame`: it always shows the whole board. `follow`: the whole board at
 * reset and at the end, and a closer view that follows the character while a run plays (or a
 * realtime game runs). `auto` (default): `follow` when the whole board would show its cells smaller
 * than `followBelowPx`, else `frame`.
 */
export type CameraMode = 'auto' | 'follow' | 'frame';

/** What the camera looks at now: the whole board, or the character up close. */
export type CameraShot = 'board' | 'character';

const SPANISH_CAMERA: Record<string, CameraMode> = { sigue: 'follow', seguir: 'follow', fija: 'frame', entera: 'frame', todo: 'frame', auto: 'auto' };

/**
 * The camera mode a level's `meta` asks for: `camera: 'follow' | 'frame' | 'auto'`, or the Spanish
 * `camara: 'sigue' | 'fija' | 'entera' | 'auto'` (`sigue` follows; `fija` and `entera` frame the
 * whole board). Null when it says nothing.
 */
export function cameraModeOf(meta: Record<string, unknown> | undefined): CameraMode | null {
  if (!meta) return null;
  const c = meta.camera;
  if (c === 'follow' || c === 'frame' || c === 'auto') return c;
  const es = meta.camara;
  if (typeof es === 'string') return SPANISH_CAMERA[es.toLowerCase()] ?? null;
  return null;
}

export interface BoardViewOptions {
  /** How names look. Default: `defaultSkin()`. */
  skin?: Skin;
  /** Texts for bubbles and fallback markers (`labelsFor(level)`). */
  labels?: Labels;
  /**
   * `level.meta`: `character` (a skin character name), `places` (`{"x,y": name}` labels on cells),
   * `camera` (`'follow' | 'frame' | 'auto'`, or the Spanish `camara: 'sigue' | 'fija'`).
   */
  meta?: Record<string, unknown>;
  /** Playback speed. Default 1. */
  speed?: Speed;
  /** Seconds per kind of step at ×1. */
  timing?: Partial<Timing>;
  /** A step starts on screen: highlight `step.node` (and `step.stack`). */
  onStep?: (step: TraceStep<unknown>) => void;
  /** A trace finished playing (with the run's error, if any), or a realtime game ended. */
  onDone?: (result: { error: RunError | null; status?: string }) => void;
  /** After each realtime tick: values for a DOM HUD. */
  onTick?: (hud: RealtimeHud, result: TickResult) => void;
  /** Pixel density cap. Default 2, or 1.25 on touch devices. */
  maxPixelRatio?: number;
  /** Shadow map size (0 turns shadows off). Default 2048, or 1024 on touch devices. */
  shadowMapSize?: number;
  /** MSAA samples. Default 4, or 2 on touch devices. */
  samples?: number;
  /** The engine's film finish (vignette, grain). Default false. */
  finish?: boolean;
  /** Bloom strength on emissive voxels (lit lamps). Default 0.6; 0 turns it off. */
  bloom?: number;
  /** Palms, bushes and shells on the beach around the board. Default true. */
  decor?: boolean;
  /** Keeps the last frame readable (screenshots, tests). Default false. */
  preserveDrawingBuffer?: boolean;
  /** Follows the canvas size with a ResizeObserver. Default true; otherwise call `resize()`. */
  autoResize?: boolean;
  /** Vertical field of view, in degrees. Default 36. */
  fov?: number;
  /** Camera mode when neither `reset` nor `level.meta` (`camera`, `camara`) says. Default `auto`. */
  camera?: CameraMode;
  /** `auto` follows the character when the whole board would show a cell smaller than this, in CSS pixels. Default 28. */
  followBelowPx?: number;
  /** Size of a cell while following, in CSS pixels. Default: a seventh of the canvas's shorter side, between 44 and 72. */
  followCellPx?: number;
}

/** Presentation options of `reset`. */
export interface ResetOptions {
  meta?: Record<string, unknown>;
  labels?: Labels;
  /** Turtle: a faint target drawing, in turtle units. */
  target?: Segment[];
  /** Turtle: move the target to the turtle's start. Default true. */
  anchorTarget?: boolean;
  /** Turtle: the drawing area. */
  area?: { width: number; height: number };
  /** Turtle: meters per turtle unit. */
  unit?: number;
  /** The camera for this world (over `meta.camera` / `meta.camara` and the view's `camera` option). */
  camera?: CameraMode;
}

/** What `reset` shows: a grid or turtle state, a live realtime game, or a realtime setup and state. */
export type WorldInput = GridState | TurtleState | RealtimeGame | { setup: RealtimeSetup; state: RealtimeState };

/**
 * A trace to play: a run result (`runCase(...).run`, `runGrid`, `runTurtle`) or plain steps.
 * (Realtime runs are not traces: step a live game with `step(keys)`.)
 */
export type TraceInput = readonly TraceStep<unknown>[] | { steps: readonly TraceStep<unknown>[]; error?: RunError | null; initial?: unknown } | LevelRun;

/** The reset options a level implies: its meta, labels and (turtle) target and area. */
export function presentation(level: Level): ResetOptions {
  const out: ResetOptions = { labels: labelsFor(level) };
  if (level.meta) out.meta = level.meta;
  if (level.world === 'turtle') {
    const shape = findShape(level.goal);
    if (shape) {
      out.target = targetSegments(shape.target);
      if (shape.match === 'exact') out.anchorTarget = false;
    }
    if (level.start?.area) out.area = level.start.area;
  }
  return out;
}

function findShape(g: TurtleGoal): Extract<TurtleGoal, { type: 'shape' }> | null {
  if (g.type === 'shape') return g;
  if (g.type === 'any') for (const x of g.goals) {
    const s = findShape(x);
    if (s) return s;
  }
  return null;
}

/** The state a level case starts from (grid: the board of that case; turtle: its start). */
export function isGridState(w: unknown): w is GridState {
  return !!w && typeof w === 'object' && 'cells' in w && 'robot' in w;
}
export function isTurtleState(w: unknown): w is TurtleState {
  return !!w && typeof w === 'object' && 'segments' in w && 'heading' in w;
}

const isTouch = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export class BoardView {
  readonly view: View;
  readonly skin: Skin;
  /** Called when a step starts, a trace ends, a tick is shown. Can be replaced at any time. */
  onStep: BoardViewOptions['onStep'];
  onDone: BoardViewOptions['onDone'];
  onTick: BoardViewOptions['onTick'];

  private assets: AssetCache;
  private poof = new Poof(10);
  private stage: Stage | null = null;
  private kind: WorldKind | null = null;
  private game: RealtimeGame | null = null;
  private meta: Record<string, unknown> = {};
  private resetOptions: ResetOptions = {};
  private steps: readonly TraceStep<unknown>[] = [];
  private runError: RunError | null = null;
  private playhead: Playhead | null = null;
  private waiters: Array<() => void> = [];
  private speedValue: number;
  private timing: Timing;
  /** The framing of the whole board. */
  private framing: Framing | null = null;
  /** The camera now (it eases toward the board or the character). */
  private cam = { target: new THREE.Vector3(), distance: 10, fitted: -1 };
  private shotValue: CameraShot = 'board';
  private cameraOverride: CameraMode | null = null;
  /** The environment's backdrop, and what it was built for. */
  private backdrop: { object: THREE.Object3D; env: Environment; key: string } | null = null;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private lights: THREE.PointLight[] = [];
  private sea: THREE.Mesh;
  private observer: ResizeObserver | null = null;
  private visible = true;
  private visibility: IntersectionObserver | null = null;
  private last = -1;
  private time = 0;
  private lastTick = -1;
  private size = { w: 1, h: 1 };
  private readonly options: BoardViewOptions;
  private destroyed = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: BoardViewOptions = {},
  ) {
    this.options = options;
    const touch = isTouch();
    this.skin = options.skin ?? defaultSkin();
    this.assets = new AssetCache(this.skin, options.labels ?? null);
    this.onStep = options.onStep;
    this.onDone = options.onDone;
    this.onTick = options.onTick;
    this.speedValue = parseSpeed(options.speed);
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.meta = options.meta ?? {};
    this.assets.showDecor = options.decor !== false;
    const bloom = options.bloom ?? 0.8;
    this.view = new View(canvas, {
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      finish: options.finish ?? false,
      bloom: { strength: bloom, radius: 0.45, threshold: 1.35 },
      samples: options.samples ?? (touch ? 2 : 4),
    });
    const r = this.view.renderer;
    r.toneMappingExposure = 1.0;
    const shadowSize = options.shadowMapSize ?? (touch ? 1024 : 2048);
    r.shadowMap.enabled = shadowSize > 0;
    const env = this.assets.environment;
    const scene = this.view.scene;
    this.view.camera.fov = options.fov ?? 36;
    this.view.camera.near = 0.1;
    this.view.camera.far = 200;
    this.hemi = new THREE.HemisphereLight(env.ambient.sky, env.ambient.ground, env.ambient.intensity);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(env.sun.color, env.sun.intensity);
    this.sun.castShadow = shadowSize > 0;
    this.sun.shadow.mapSize.set(shadowSize || 1, shadowSize || 1);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffd080, 0, 3.2, 2);
      this.lights.push(l);
      scene.add(l);
    }
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: env.sea }));
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -0.62;
    scene.add(this.sea);
    scene.fog = new THREE.Fog(env.sky, 40, 120);
    this.applyEnvironment(env);
    scene.add(this.poof.mesh);
    this.poof.mesh.renderOrder = 5;

    if (options.autoResize !== false && typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.visibility = new IntersectionObserver((entries) => {
        for (const e of entries) this.visible = e.isIntersecting;
      });
      this.visibility.observe(canvas);
    }
    this.resize();
    r.setAnimationLoop((ms) => this.frame(ms / 1000));
  }

  // -------------------------------------------------------------------------------------------
  // Worlds
  // -------------------------------------------------------------------------------------------

  /** The world being shown. */
  get world(): WorldKind | null {
    return this.kind;
  }

  /** The state as shown now (after the steps played so far). */
  get state(): GridState | TurtleState | RealtimeState | null {
    const s = this.stage;
    if (s instanceof GridStage || s instanceof TurtleStage || s instanceof RealtimeStage) return s.state;
    return null;
  }

  /** Grid: what the robot carries now. */
  get inventory(): Record<string, number> {
    return this.stage instanceof GridStage ? this.stage.inventory : {};
  }

  /** Realtime: score, lives, tick and status for a DOM HUD. */
  get hud(): RealtimeHud | null {
    return this.stage instanceof RealtimeStage ? this.stage.hud() : null;
  }

  /** The live realtime game, if one is shown. */
  get realtime(): RealtimeGame | null {
    return this.game;
  }

  /**
   * Shows a world at once and forgets any trace. A grid state (`createGridState(board)`,
   * `run.initial`), a turtle state, or a realtime game (`new RealtimeGame(level, program)`).
   */
  reset(world: WorldInput, options: ResetOptions = {}): void {
    this.stopTrace();
    this.resetOptions = options;
    if (options.meta) this.meta = options.meta;
    this.cameraOverride = options.camera ?? null;
    this.shotValue = 'board';
    if (options.labels) this.assets.labels = options.labels;
    this.stage?.dispose();
    this.stage?.root.removeFromParent();
    this.stage = null;
    this.game = null;
    this.lastTick = -1;
    const ctx = this.context();
    if (world instanceof RealtimeGame) {
      this.game = world;
      this.kind = 'realtime';
      this.stage = new RealtimeStage(ctx, world.setup, world.state);
    } else if ('setup' in world && 'state' in world) {
      this.kind = 'realtime';
      this.stage = new RealtimeStage(ctx, world.setup, world.state);
    } else if (isGridState(world)) {
      this.kind = 'grid';
      const g = new GridStage(ctx, world);
      g.timing = this.timing;
      this.stage = g;
    } else if (isTurtleState(world)) {
      this.kind = 'turtle';
      const t = new TurtleStage(ctx, world, options);
      t.timing = this.timing;
      this.stage = t;
    } else {
      throw new Error('BoardView.reset: not a grid state, a turtle state or a realtime game');
    }
    this.view.scene.add(this.stage.root);
    this.reframe();
  }

  /** Grid shortcut: `reset(createGridState(board))`. */
  resetBoard(board: Parameters<typeof createGridState>[0], options?: ResetOptions): void {
    this.reset(createGridState(board), options);
  }

  private context(): StageContext {
    return {
      assets: this.assets,
      poof: this.poof,
      lights: this.lights,
      rate: () => (Number.isFinite(this.speedValue) ? Math.min(4, Math.max(0.5, this.speedValue)) : 4),
      fit: (o) => this.fit(o),
      meta: this.meta,
      glow: (color, size) => {
        const s = glowSprite(color, size);
        if (s.material.map) shareTexture(s.material.map);
        return s;
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Traces
  // -------------------------------------------------------------------------------------------

  /** Playback speed: a multiplier, or `'instant'`. Takes effect at once, even mid-step. */
  get speed(): Speed {
    return this.speedValue === Infinity ? 'instant' : this.speedValue;
  }
  set speed(s: Speed) {
    this.speedValue = parseSpeed(s, this.speedValue === Infinity ? 1 : this.speedValue);
  }

  /** Whether a trace is playing. */
  get playing(): boolean {
    return this.playhead?.state === 'playing';
  }

  /** Index of the step on screen (or the last one played), -1 before the first. */
  get index(): number {
    const p = this.playhead;
    if (!p) return -1;
    return p.index >= 0 ? p.index : p.played - 1;
  }

  /**
   * Loads a trace without playing it: a run result with `initial` resets to it first; plain steps
   * play from the state shown. Then `play()`, `step()`, `pause()`.
   */
  load(trace: TraceInput): void {
    if (this.kind === 'realtime' || (!Array.isArray(trace) && 'ticks' in (trace as object))) {
      throw new Error('BoardView.load: realtime games are stepped live with step(keys)');
    }
    const run = Array.isArray(trace)
      ? { steps: trace as readonly TraceStep<unknown>[] }
      : (trace as { steps: readonly TraceStep<unknown>[]; error?: RunError | null; initial?: unknown });
    if ('initial' in run && run.initial !== undefined && (isGridState(run.initial) || isTurtleState(run.initial))) {
      this.restage(run.initial);
    }
    this.stopTrace();
    this.steps = run.steps;
    this.runError = ('error' in run ? run.error : null) ?? null;
    if (this.stage instanceof TurtleStage) {
      this.stage.prepare(this.steps as TraceStep<never>[]);
      this.reframe();
    }
    const stage = this.stage as StepStage<unknown> | null;
    if (!stage) throw new Error('BoardView.load: call reset() first');
    this.playhead = new Playhead(this.steps.map((s) => stage.duration(s)));
  }

  /** Shows a state of the same world without rebuilding the board when it has the same shape. */
  private restage(initial: GridState | TurtleState): void {
    const s = this.stage;
    if (s instanceof GridStage && isGridState(initial) && sameBoard(s.state, initial)) {
      s.reset(initial);
      return;
    }
    if (s instanceof TurtleStage && isTurtleState(initial)) {
      s.reset(initial);
      return;
    }
    this.reset(initial, this.resetOptions);
  }

  /**
   * Plays a trace (or resumes the loaded one without arguments). Resolves when it ends, is reset,
   * or the view is destroyed. With `speed: 'instant'` the final state is shown at once.
   */
  play(trace?: TraceInput, options: { speed?: Speed } = {}): Promise<void> {
    if (options.speed !== undefined) this.speed = options.speed;
    if (trace) this.load(trace);
    const p = this.playhead;
    if (!p) return Promise.resolve();
    const done = new Promise<void>((resolve) => this.waiters.push(resolve));
    if (p.state === 'done') {
      this.settle();
      return done;
    }
    p.play();
    if (this.speedValue === Infinity) this.pump(0);
    return done;
  }

  /** Pauses the trace mid-step. */
  pause(): void {
    this.playhead?.pause();
  }

  /**
   * Trace: plays one step and pauses. Realtime: advances the live game one tick with these keys
   * held, animates it and returns the tick's result.
   */
  step(keys: readonly string[] = []): TickResult | null {
    if (this.kind === 'realtime') {
      if (!this.game) throw new Error('BoardView.step(keys): reset() with a RealtimeGame first');
      if (this.game.status !== 'running') return null;
      const r = this.game.step(keys);
      this.tick(r, this.game.state);
      return r;
    }
    const p = this.playhead;
    if (!p) return null;
    p.step();
    if (this.speedValue === Infinity) this.pump(0);
    return null;
  }

  /** Jumps to the end of the trace (the final state, and the error if there is one). */
  finish(): void {
    const p = this.playhead;
    if (!p || p.state === 'done') return;
    p.play();
    this.advance(0, Infinity);
  }

  /** Realtime: shows a tick the host ran itself (`game.step(keys)`), with the state after it. */
  tick(result: TickResult, state?: RealtimeState): void {
    const s = this.stage;
    if (!(s instanceof RealtimeStage)) return;
    const now = this.time;
    if (this.lastTick >= 0) {
      const measured = Math.min(0.6, Math.max(0.06, now - this.lastTick));
      s.interval = s.interval * 0.6 + measured * 0.4;
    }
    this.lastTick = now;
    s.tick(result, state ?? this.game?.state ?? s.state);
    this.shotValue = result.status === 'running' ? 'character' : 'board';
    for (const st of result.steps) this.onStep?.(st);
    const hud = s.hud();
    this.onTick?.(hud, result);
    if (result.status !== 'running') this.onDone?.({ error: result.error, status: result.status });
  }

  /** The character cheers (call it when the host knows the level passed). */
  celebrate(): void {
    this.stage?.celebrate();
  }

  /** A speech bubble over the main character. */
  message(text: string, style: 'say' | 'error' = 'say'): void {
    this.stage?.message(text, style);
  }

  private stopTrace(): void {
    this.playhead = null;
    this.steps = [];
    this.runError = null;
    this.settle();
  }

  private settle(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Advances the trace by `dt` seconds at the current speed. */
  private pump(dt: number): void {
    this.advance(dt, this.speedValue);
  }

  private advance(dt: number, speed: number): void {
    const p = this.playhead;
    const stage = this.stage as StepStage<unknown> | null;
    if (!p || !stage || !('begin' in stage)) return;
    const instant = speed === Infinity;
    for (const t of p.advance(dt, speed)) {
      if (t.type === 'begin') {
        const s = this.steps[t.index]!;
        if (!instant) this.shotValue = 'character';
        stage.begin(s, instant);
        this.onStep?.(s);
      } else if (t.type === 'end') {
        stage.end(this.steps[t.index]!, instant);
      } else {
        if (this.runError) stage.showError(this.runError);
        this.shotValue = 'board';
        this.onDone?.({ error: this.runError });
        this.settle();
      }
    }
    if (p.index >= 0) stage.progress(this.steps[p.index]!, p.progress);
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  /** Follows the canvas's CSS size (automatic with `autoResize`). */
  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    if (w === this.size.w && h === this.size.h && this.framing) return;
    this.size = { w, h };
    this.view.resize(w, h, this.options.maxPixelRatio ?? (isTouch() ? 1.25 : 2));
    this.reframe();
  }

  /** Points the camera at the whole board for the current aspect (or at the character, when following). */
  private reframe(): void {
    const cam = this.view.camera;
    cam.aspect = this.size.w / this.size.h;
    const bounds: Bounds = this.stage?.bounds() ?? { min: [-2, 0, -2], max: [2, 1, 2] };
    const f = frameBox(bounds, { fov: cam.fov, aspect: cam.aspect, margin: 0.03, minExtent: 1.5 });
    this.framing = f;
    // The sun: from the upper left, a bit in front, with a shadow box that just covers the board.
    const sx = bounds.max[0] - bounds.min[0];
    const sz = bounds.max[2] - bounds.min[2];
    const r = Math.hypot(sx, sz) / 2 + 1.5;
    const c = new THREE.Vector3((bounds.min[0] + bounds.max[0]) / 2, 0, (bounds.min[2] + bounds.max[2]) / 2);
    this.sun.position.set(c.x - r * 0.55, r * 1.6 + 3, c.z + r * 0.75);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 0.5;
    sc.far = r * 5 + 10;
    sc.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
    this.placeBackdrop(bounds);
    // A new board or a new size: no easing, the camera is where it should be at once.
    const goal = this.cameraGoal();
    this.cam.target.set(...goal.target);
    this.cam.distance = goal.distance;
    this.cam.fitted = -1;
    this.applyCamera();
  }

  // -------------------------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------------------------

  /** The camera mode in effect for this world: from `reset`, else `level.meta`, else the view's option. */
  get cameraMode(): CameraMode {
    return this.cameraOverride ?? cameraModeOf(this.meta) ?? this.options.camera ?? 'auto';
  }
  /** Changes the camera mode for the world shown (until the next `reset`). */
  set cameraMode(mode: CameraMode) {
    this.cameraOverride = mode;
  }

  /** Whether the camera follows the character in this world (always for `follow`; for `auto`, when the board is too big to show whole at a readable size). */
  get follows(): boolean {
    const mode = this.cameraMode;
    if (mode !== 'auto') return mode === 'follow';
    const f = this.framing;
    if (!f) return false;
    return pixelsPerMeter(f.distance, this.view.camera.fov, this.size.h) < (this.options.followBelowPx ?? 28);
  }

  /** What the camera looks at now. The view switches by itself: the character while a run plays, the board at reset and at the end. */
  get shot(): CameraShot {
    return this.shotValue;
  }

  /**
   * Moves the camera to the whole board or to the character (when the view follows), easing there,
   * or at once with `instant`. The view keeps switching by itself as runs start and end.
   */
  showShot(shot: CameraShot, options: { instant?: boolean } = {}): void {
    this.shotValue = shot;
    if (options.instant) {
      const goal = this.cameraGoal();
      this.cam.target.set(...goal.target);
      this.cam.distance = goal.distance;
      this.applyCamera();
    }
  }

  /** Cell size while following, in CSS pixels. */
  private followCellPx(): number {
    return this.options.followCellPx ?? Math.max(44, Math.min(72, Math.min(this.size.w, this.size.h) / 7));
  }

  /** Where the camera should be now. */
  private cameraGoal(): Framing {
    const full = this.framing!;
    if (this.shotValue !== 'character' || !this.stage || !this.follows) return full;
    const focus: Vec3 | null = this.stage.focus();
    if (!focus) return full;
    const cam = this.view.camera;
    return followBox(this.stage.bounds(), focus, { fov: cam.fov, aspect: cam.aspect, margin: 0.03, viewportHeight: this.size.h, cellPx: this.followCellPx(), full });
  }

  /** Eases the camera toward its goal. */
  private updateCamera(dt: number): void {
    if (!this.framing) return;
    const goal = this.cameraGoal();
    const rate = 2.6 + 1.2 * Math.min(4, Number.isFinite(this.speedValue) ? this.speedValue : 4);
    const k = 1 - Math.exp(-dt * rate);
    const t = this.cam.target;
    t.x += (goal.target[0] - t.x) * k;
    t.y += (goal.target[1] - t.y) * k;
    t.z += (goal.target[2] - t.z) * k;
    this.cam.distance += (goal.distance - this.cam.distance) * k;
    this.applyCamera();
  }

  private applyCamera(): void {
    const cam = this.view.camera;
    const f = this.framing;
    if (!f) return;
    const { forward } = cameraAxes(f.pitch);
    const d = this.cam.distance;
    const t = this.cam.target;
    cam.position.set(t.x - forward[0] * d, t.y - forward[1] * d, t.z - forward[2] * d);
    cam.lookAt(t);
    const far = Math.max(60, d * 4);
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    // Screen-sized sprites and fog follow the distance (refit only when it changed enough).
    if (this.cam.fitted < 0 || Math.abs(d - this.cam.fitted) > this.cam.fitted * 0.01) {
      this.cam.fitted = d;
      const fog = this.view.scene.fog;
      if (fog instanceof THREE.Fog) {
        fog.near = Math.max(40, d * 1.5 + 10);
        fog.far = fog.near + 80;
      }
      if (this.stage) this.fit(this.stage.root);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------------------------

  /** Sky, sea, sand, light and decor now. */
  get environment(): Environment {
    return this.assets.environment;
  }

  /**
   * Changes sky, sea, sand, light or decor live (a new background theme) without recreating the
   * view or the world: the lights and colors change at once and the floor around the board is
   * rebuilt. Fields left out keep their current value; the skin itself is not changed.
   */
  setEnvironment(env: Partial<Environment>): void {
    const next: Environment = { ...this.assets.environment, ...env };
    this.assets.setEnvironment(next);
    this.applyEnvironment(next);
    this.stage?.rebuildFloor();
    if (this.stage) this.placeBackdrop(this.stage.bounds());
  }

  /** Builds the environment's backdrop for this board (once per environment and board size) and places it. */
  private placeBackdrop(bounds: Bounds): void {
    const env = this.assets.environment;
    const width = bounds.max[0] - bounds.min[0];
    const depth = bounds.max[2] - bounds.min[2];
    const key = `${this.kind}:${width.toFixed(3)}x${depth.toFixed(3)}`;
    const b = this.backdrop;
    if (b && (b.env !== env || b.key !== key || !this.stage)) {
      b.object.removeFromParent();
      disposeObject(b.object);
      this.backdrop = null;
    }
    if (!this.backdrop && env.backdrop && this.stage && this.kind) {
      const object = env.backdrop({ width, depth, world: this.kind });
      this.view.scene.add(object);
      this.backdrop = { object, env, key };
    }
    this.backdrop?.object.position.set((bounds.min[0] + bounds.max[0]) / 2, this.sea.position.y, bounds.min[2]);
  }

  private applyEnvironment(env: Environment): void {
    const scene = this.view.scene;
    if (scene.background instanceof THREE.Color) scene.background.setHex(env.sky);
    else scene.background = new THREE.Color(env.sky);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(env.sky);
    this.hemi.color.setHex(env.ambient.sky);
    this.hemi.groundColor.setHex(env.ambient.ground);
    this.hemi.intensity = env.ambient.intensity;
    this.sun.color.setHex(env.sun.color);
    this.sun.intensity = env.sun.intensity;
    (this.sea.material as THREE.MeshLambertMaterial).color.setHex(env.sea);
  }

  /** Pixels per meter at the camera's target, for screen-sized sprites. */
  private pxPerMeter(): number {
    return pixelsPerMeter(this.cam.distance, this.view.camera.fov, this.size.h);
  }

  private fit(o: THREE.Object3D): void {
    const k = this.pxPerMeter();
    o.traverse((c) => {
      if (c instanceof ScreenSprite) c.fit(k);
    });
  }

  private frame(seconds: number): void {
    if (this.destroyed) return;
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, seconds - this.last));
    this.last = seconds;
    this.time += dt;
    if (this.playhead && this.playhead.state === 'playing') this.pump(dt);
    this.stage?.update(dt, this.time);
    this.updateCamera(dt);
    this.poof.update(dt);
    if (this.visible) this.view.render(this.time);
  }

  /** Draws a frame now (for screenshots right after a change). */
  render(): void {
    this.stage?.update(0, this.time);
    this.applyCamera();
    this.view.render(this.time);
  }

  /**
   * Stops the loop and frees everything the view made, and releases the WebGL context (browsers
   * allow only a few at once), so a host can create and destroy many views. The canvas stays in the
   * page, but its context is lost: give a new view a new canvas, or pass `{ loseContext: false }`.
   */
  destroy(options: { loseContext?: boolean } = {}): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopTrace();
    this.view.renderer.setAnimationLoop(null);
    this.observer?.disconnect();
    this.visibility?.disconnect();
    this.stage?.dispose();
    this.stage = null;
    if (this.backdrop) disposeObject(this.backdrop.object);
    this.backdrop = null;
    this.assets.dispose();
    this.poof.dispose();
    this.sea.geometry.dispose();
    (this.sea.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    for (const l of this.lights) l.dispose();
    disposeObject(this.view.scene);
    this.view.scene.clear();
    this.view.dispose(options);
  }
}

function sameBoard(a: GridState, b: GridState): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (JSON.stringify(a.walls) !== JSON.stringify(b.walls)) return false;
  return a.cells.every((c, i) => {
    const d = b.cells[i]!;
    return c.terrain === d.terrain && c.wall === d.wall && c.arrow === d.arrow;
  });
}
