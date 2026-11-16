/**
 * The turtle world on screen: a patio, the turtle with chalk in its mouth, its trail as thick
 * colored strokes that grow as it walks, and an optional faint target drawing. Turtle units are
 * scaled to meters so the drawing area (or the target and the path) fits a patio of about 8 m.
 */
import * as THREE from 'three';
import { applyTurtleEvent, type Point, type RunError, type Segment, type TraceStep, type TurtleEvent, type TurtleState } from '../blocks/index.js';
import { buildFloor, type Floor } from './assets.js';
import type { Bounds } from './framing.js';
import { Bubble, clamp01, easeInOut, easeOut } from './pieces.js';
import { Mover, StepShow, type Beat, type StageContext, type StepStage } from './stage.js';
import { colorOf } from './skin.js';
import { DEFAULT_TIMING, turtleStepDuration, type Timing } from './timeline.js';

export interface TurtleStageOptions {
  /** The drawing area, as in `TurtleStart.area`. */
  area?: { width: number; height: number };
  /** A faint drawing to trace over (from `targetSegments(goal.target)`), in turtle units. */
  target?: Segment[];
  /**
   * Moves the target so it starts where the turtle starts (right for `translate` and `rigid` goals,
   * whose targets usually start at (0, 0)). Default true; false draws it where it is (`exact` goals).
   */
  anchorTarget?: boolean;
  /** Meters per turtle unit. Default: fits the area, or the target and start, in about 8 m. */
  unit?: number;
}

/** A region of turtle units. */
interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DEG = Math.PI / 180;
/** Heading in radians (0 faces +z) of a turtle heading in degrees clockwise from east. */
export const turtleHeading = (deg: number): number => Math.PI / 2 - deg * DEG;

/** The region a drawing needs: points with a margin. */
export function turtleRegion(points: readonly Point[], area?: { width: number; height: number }): Region {
  if (area) return { x0: 0, y0: 0, x1: area.width, y1: area.height };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return { x0: -50, y0: -50, x1: 50, y1: 50 };
  const size = Math.max(x1 - x0, y1 - y0, 60);
  const pad = size * 0.18 + 10;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const half = Math.max(x1 - x0, size * 0.6) / 2 + pad;
  const halfY = Math.max(y1 - y0, size * 0.6) / 2 + pad;
  return { x0: cx - half, y0: cy - halfY, x1: cx + half, y1: cy + halfY };
}

/** Thick strokes as one instanced box mesh with per-instance colors. */
class Strokes {
  mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly c = new THREE.Color();

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly material: THREE.Material,
    private readonly width: number,
    private readonly thickness: number,
    private capacity = 64,
  ) {
    this.mesh = this.make();
  }

  private make(): THREE.InstancedMesh {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    const m = new THREE.InstancedMesh(g, this.material, this.capacity);
    m.count = 0;
    m.frustumCulled = false;
    m.receiveShadow = true;
    this.parent.add(m);
    return m;
  }

  clear(): void {
    this.count = 0;
    this.mesh.count = 0;
  }

  /** Sets stroke `i` from `a` to `b` (meters on the floor) in `color`. */
  set(i: number, a: THREE.Vector3, b: THREE.Vector3, color: number, y = 0): void {
    if (i >= this.capacity) {
      const old = this.mesh;
      this.capacity = Math.max(i + 1, this.capacity * 2);
      this.mesh = this.make();
      for (let k = 0; k < this.count; k++) {
        old.getMatrixAt(k, this.m);
        this.mesh.setMatrixAt(k, this.m);
        if (old.instanceColor) {
          old.getColorAt(k, this.c);
          this.mesh.setColorAt(k, this.c);
        }
      }
      old.removeFromParent();
      old.geometry.dispose();
      old.dispose();
    }
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dz, dx));
    this.m.compose(new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2), this.q, new THREE.Vector3(len + this.width, this.thickness, this.width));
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, this.c.setHex(color));
    this.count = Math.max(this.count, i + 1);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Keeps only the first `n` strokes. */
  truncate(n: number): void {
    this.count = Math.min(this.count, n);
    this.mesh.count = this.count;
  }

  get size(): number {
    return this.count;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
  }
}

export class TurtleStage implements StepStage<TurtleEvent> {
  readonly root = new THREE.Group();
  state: TurtleState;
  timing: Timing = DEFAULT_TIMING;
  /** Meters per turtle unit. */
  unit: number;

  private region: Region;
  private floor!: Floor;
  private tiles = { w: 1, h: 1 };
  private trail: Strokes;
  private target: Strokes | null = null;
  private mover: Mover;
  private bubble: Bubble;
  private show: StepShow | null = null;
  private extra: Region | null = null;
  private after: { age: number; update: (age: number) => boolean } | null = null;
  private readonly options: TurtleStageOptions;

  constructor(
    private readonly ctx: StageContext,
    state: TurtleState,
    options: TurtleStageOptions = {},
  ) {
    const first = options.target?.[0];
    if (first && options.anchorTarget !== false) {
      const dx = state.x - first.from[0];
      const dy = state.y - first.from[1];
      options = { ...options, target: options.target!.map((s) => ({ ...s, from: [s.from[0] + dx, s.from[1] + dy], to: [s.to[0] + dx, s.to[1] + dy] })) };
    }
    this.options = options;
    this.state = structuredClone(state);
    const pts: Point[] = [[state.x, state.y]];
    for (const s of [...(options.target ?? []), ...state.segments]) pts.push(s.from, s.to);
    this.region = turtleRegion(pts, options.area);
    const size = Math.max(this.region.x1 - this.region.x0, this.region.y1 - this.region.y0);
    this.unit = options.unit ?? 8 / Math.max(1, size);
    this.buildFloor();
    const chalk = new THREE.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff });
    this.trail = new Strokes(this.root, chalk, 0.13, 0.035);
    if (options.target?.length) {
      const faint = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
      this.target = new Strokes(this.root, faint, 0.24, 0.012);
      options.target.forEach((s, i) => this.target!.set(i, this.at(s.from), this.at(s.to), 0xc9b48e, 0.002));
      this.target.mesh.receiveShadow = false;
    }
    const character = typeof ctx.meta.character === 'string' ? ctx.meta.character : undefined;
    this.mover = new Mover(ctx.assets.character('turtle', character));
    this.root.add(this.mover.visual.object);
    this.bubble = new Bubble(this.root, ctx.fit);
    this.reset(state);
  }

  private buildFloor(): void {
    this.floor?.dispose();
    this.floor?.group.removeFromParent();
    const r = this.region;
    const w = Math.max(3, Math.ceil((r.x1 - r.x0) * this.unit));
    const h = Math.max(3, Math.ceil((r.y1 - r.y0) * this.unit));
    this.tiles = { w, h };
    const patio = this.ctx.assets.skin.patioTerrain;
    this.floor = buildFloor(this.ctx.assets, w, h, () => patio, () => false);
    this.root.add(this.floor.group);
  }

  /** Turtle units to meters on the floor. */
  at(p: Point, out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.region;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    return out.set((p[0] - cx) * this.unit, 0.002, (p[1] - cy) * this.unit);
  }

  bounds(): Bounds {
    const hw = this.tiles.w / 2 + 0.3;
    const hh = this.tiles.h / 2 + 0.3;
    const b: Bounds = { min: [-hw, -0.3, -hh], max: [hw, 0.8, hh] };
    if (this.extra) {
      const a = this.at([this.extra.x0, this.extra.y0]);
      const c = this.at([this.extra.x1, this.extra.y1]);
      b.min[0] = Math.min(b.min[0], a.x - 0.6);
      b.min[2] = Math.min(b.min[2], a.z - 0.6);
      b.max[0] = Math.max(b.max[0], c.x + 0.6);
      b.max[2] = Math.max(b.max[2], c.z + 0.6);
    }
    return b;
  }

  /** Makes room in the camera for the whole path of a trace (the turtle may leave the patio). */
  prepare(steps: readonly TraceStep<TurtleEvent>[]): void {
    if (this.options.area) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const s of steps) {
      for (const e of s.events) {
        if (e.type !== 'moved') continue;
        x0 = Math.min(x0, e.to[0]);
        y0 = Math.min(y0, e.to[1]);
        x1 = Math.max(x1, e.to[0]);
        y1 = Math.max(y1, e.to[1]);
      }
    }
    this.extra = Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }

  reset(state: TurtleState): void {
    this.state = structuredClone(state);
    this.show = null;
    this.after = null;
    this.bubble.clear();
    this.trail.clear();
    this.state.segments.forEach((s, i) => this.trail.set(i, this.at(s.from), this.at(s.to), colorOf(this.ctx.assets.skin, s.color)));
    this.mover.heading = turtleHeading(state.heading);
    this.mover.tilt = 0;
    this.placeTurtle(this.at([state.x, state.y]));
    this.mover.play('idle', true);
    this.mover.visual.setPen?.(state.pen, colorOf(this.ctx.assets.skin, state.color));
  }

  /** Puts the turtle so its chalk touches `p`. */
  private placeTurtle(p: THREE.Vector3): void {
    const tip = this.mover.visual.tip ?? 0;
    this.mover.x = p.x - Math.sin(this.mover.heading) * tip;
    this.mover.z = p.z - Math.cos(this.mover.heading) * tip;
    this.mover.y = 0;
  }

  duration(step: TraceStep<TurtleEvent>): number {
    return turtleStepDuration(step, this.unit, this.timing);
  }

  begin(step: TraceStep<TurtleEvent>, instant: boolean): void {
    this.show?.end();
    const beats: Beat[] = step.events.map((e) => (instant ? { weight: 1, finish: () => this.apply(e) } : this.beat(e)));
    if (!beats.length) beats.push({ weight: 1, finish: () => {} });
    this.show = new StepShow(beats);
    if (!instant) this.show.run(0);
  }

  progress(_step: TraceStep<TurtleEvent>, t: number): void {
    this.show?.run(t);
  }

  end(): void {
    this.show?.end();
    this.show = null;
  }

  private apply(e: TurtleEvent): void {
    applyTurtleEvent(this.state, e);
    const skin = this.ctx.assets.skin;
    if (e.type === 'moved') {
      if (e.drew) {
        const s = this.state.segments[this.state.segments.length - 1]!;
        this.trail.set(this.state.segments.length - 1, this.at(s.from), this.at(s.to), colorOf(skin, s.color));
      }
      this.placeTurtle(this.at(e.to));
    } else if (e.type === 'turned') {
      this.mover.heading = turtleHeading(e.to);
      this.placeTurtle(this.at([this.state.x, this.state.y]));
    } else {
      this.mover.visual.setPen?.(this.state.pen, colorOf(skin, this.state.color));
    }
  }

  private beat(e: TurtleEvent): Beat {
    const m = this.mover;
    const skin = this.ctx.assets.skin;
    switch (e.type) {
      case 'moved': {
        const a = this.at(e.from);
        const b = this.at(e.to);
        const len = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) * this.unit;
        const index = this.state.segments.length;
        const color = colorOf(skin, e.color);
        const p = new THREE.Vector3();
        return {
          weight: Math.min(1.6, this.timing.move * 0.6 + len * this.timing.perMeter),
          start: () => m.play('walk'),
          update: (k) => {
            const t = easeInOut(k);
            p.lerpVectors(a, b, t);
            this.placeTurtle(p);
            if (e.drew && t > 0) this.trail.set(index, a, p, color);
          },
          finish: () => {
            this.apply(e);
            m.play('idle');
          },
        };
      }
      case 'turned': {
        const from = turtleHeading(e.from);
        const by = -e.by * DEG;
        return {
          weight: Math.min(0.9, this.timing.turn * (0.5 + Math.abs(e.by) / 180)),
          start: () => m.play('walk'),
          update: (k) => {
            m.heading = from + by * easeInOut(k);
            this.placeTurtle(this.at([this.state.x, this.state.y]));
          },
          finish: () => {
            this.apply(e);
            m.play('idle');
          },
        };
      }
      default:
        return {
          weight: this.timing.paint,
          start: () => {
            const tip = this.at([this.state.x, this.state.y]);
            const c = e.type === 'color' ? colorOf(skin, e.color) : 0xffffff;
            this.apply(e);
            this.ctx.poof.burst(tip.x, 0.05, tip.z, c);
          },
          finish: () => {},
        };
    }
  }

  showError(error: RunError): void {
    this.show?.end();
    this.show = null;
    const m = this.mover;
    this.bubble.show(error.message, 'error', Infinity);
    const home = { x: m.x, z: m.z };
    const fx = Math.sin(m.heading);
    const fz = Math.cos(m.heading);
    m.once('bump', 0.8, 'sad');
    if (error.code !== 'outOfArea') return;
    this.after = {
      age: 0,
      update: (age) => {
        const k = clamp01(age / 0.5);
        const push = k < 0.35 ? easeOut(k / 0.35) * 0.3 : 0.3 * (1 - easeInOut((k - 0.35) / 0.65));
        m.x = home.x + fx * push;
        m.z = home.z + fz * push;
        return k >= 1;
      },
    };
  }

  celebrate(): void {
    this.mover.play('cheer', true);
    const top = this.mover.top();
    [0xffd23a, 0x3ec45a, 0xff7ab8].forEach((c, i) => this.ctx.poof.burst(top.x + (i - 1) * 0.3, top.y, top.z, c));
  }

  message(text: string, style: 'say' | 'error'): void {
    this.bubble.show(text, style, style === 'error' ? Infinity : 2.5);
  }

  update(dt: number, time: number): void {
    if (this.after && this.after.update((this.after.age += dt))) this.after = null;
    this.mover.update(dt * this.ctx.rate());
    this.bubble.update(dt, this.mover.top());
    void time;
  }

  dispose(): void {
    this.floor.dispose();
    this.trail.dispose();
    this.target?.dispose();
    this.bubble.clear();
    this.mover.visual.dispose?.();
    this.root.clear();
  }
}
