/**
 * `BoardView`: renders a block-language world (grid, turtle or realtime) on a canvas from a fixed
 * three-quarter camera that frames the whole board, and animates runs from their traces.
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
import { frameBox, type Bounds, type Framing } from './framing.js';
import { GridStage } from './grid-stage.js';
import { disposeObject, Poof, ScreenSprite, shareTexture } from './pieces.js';
import { RealtimeStage, type RealtimeHud } from './realtime-stage.js';
import type { Skin } from './skin.js';
import type { Stage, StageContext, StepStage } from './stage.js';
import { DEFAULT_TIMING, parseSpeed, Playhead, type Timing } from './timeline.js';
import { TurtleStage } from './turtle-stage.js';

/** Which world is shown. */
export type WorldKind = 'grid' | 'turtle' | 'realtime';

/** A speed multiplier (0.1 … 16; the UI offers ×0.5 … ×4), or `'instant'`. */
export type Speed = number | 'instant';

export interface BoardViewOptions {
  /** How names look. Default: `defaultSkin()`. */
  skin?: Skin;
  /** Texts for bubbles and fallback markers (`labelsFor(level)`). */
  labels?: Labels;
  /** `level.meta`: `character` (a skin character name), `places` (`{"x,y": name}` labels on cells). */
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
  private framing: Framing | null = null;
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
    const env = this.skin.environment;
    const scene = this.view.scene;
    scene.background = new THREE.Color(env.sky);
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
        stage.begin(s, instant);
        this.onStep?.(s);
      } else if (t.type === 'end') {
        stage.end(this.steps[t.index]!, instant);
      } else {
        if (this.runError) stage.showError(this.runError);
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

  /** Points the camera at the whole board for the current aspect. */
  private reframe(): void {
    const cam = this.view.camera;
    cam.aspect = this.size.w / this.size.h;
    const bounds: Bounds = this.stage?.bounds() ?? { min: [-2, 0, -2], max: [2, 1, 2] };
    const f = frameBox(bounds, { fov: cam.fov, aspect: cam.aspect, margin: 0.03 });
    this.framing = f;
    cam.position.set(...f.position);
    cam.lookAt(...f.target);
    cam.far = Math.max(60, f.distance * 4);
    cam.updateProjectionMatrix();
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
    if (this.stage) this.fit(this.stage.root);
  }

  /** Pixels per meter at the board's center, for screen-sized sprites. */
  private pxPerMeter(): number {
    const d = this.framing?.distance ?? 10;
    return this.size.h / (2 * Math.tan(((this.view.camera.fov * Math.PI) / 180) / 2) * d);
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
    this.poof.update(dt);
    if (this.visible) this.view.render(this.time);
  }

  /** Draws a frame now (for screenshots right after a change). */
  render(): void {
    this.stage?.update(0, this.time);
    this.view.render(this.time);
  }

  /** Stops the loop and frees everything the view made (the canvas stays). */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopTrace();
    this.view.renderer.setAnimationLoop(null);
    this.observer?.disconnect();
    this.visibility?.disconnect();
    this.stage?.dispose();
    this.stage = null;
    this.assets.dispose();
    this.poof.dispose();
    this.sea.geometry.dispose();
    (this.sea.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
    this.sun.dispose();
    for (const l of this.lights) l.dispose();
    disposeObject(this.view.scene);
    this.view.scene.clear();
    this.view.dispose();
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
