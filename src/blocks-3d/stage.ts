/** What every stage (grid, turtle, realtime) gets from the board view, and a character mover. */
import * as THREE from 'three';
import type { RunError, TraceStep } from '../blocks/index.js';
import type { AssetCache } from './assets.js';
import type { Bounds, Vec3 } from './framing.js';
import { angleDelta, type Poof } from './pieces.js';
import type { CharacterVisual, PoseInfo } from './skin.js';

export interface StageContext {
  assets: AssetCache;
  poof: Poof;
  /** The few real point lights the view keeps (their count never changes, so shaders stay compiled). */
  lights: THREE.PointLight[];
  /** Playback speed for clip time (finite, capped). */
  rate(): number;
  /** Sizes the screen sprites under an object for the current camera. */
  fit(o: THREE.Object3D): void;
  /** `level.meta`: presentation hints. */
  meta: Record<string, unknown>;
  /** A soft additive glow sprite (its texture is shared). */
  glow(color: number, size: number): THREE.Sprite;
}

export interface Stage {
  readonly root: THREE.Group;
  /** What the camera must show. */
  bounds(): Bounds;
  /** Called every frame with real seconds. */
  update(dt: number, time: number): void;
  /** The character cheers (the host decided the level passed). */
  celebrate(): void;
  /** A bubble over the main character. */
  message(text: string, style: 'say' | 'error'): void;
  /** Where the main character stands now (the follow camera looks at it), or null. */
  focus(): Vec3 | null;
  /** Builds the floor again (the environment changed: sand, decor). */
  rebuildFloor(): void;
  dispose(): void;
}

/** A stage that plays a trace of a step world (grid, turtle). */
export interface StepStage<E> extends Stage {
  /** Seconds each step takes at speed ×1. */
  duration(step: TraceStep<E>): number;
  /** A step starts. `instant`: skip the show, only keep the state right. */
  begin(step: TraceStep<E>, instant: boolean): void;
  /** `t` from 0 to 1 through the step. */
  progress(step: TraceStep<E>, t: number): void;
  /** The step ends: its events are applied to the state. */
  end(step: TraceStep<E>, instant: boolean): void;
  /** The run stopped with an error after the last step: bump, look sad and say why. */
  showError(error: RunError): void;
}

/** Moves and poses a character: position, heading, the clip and its time. */
export class Mover {
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  clip = 'idle';
  clipTime = 0;
  /** What the clip is for (the level action of an `action` clip). */
  info: PoseInfo | undefined = undefined;
  /** What holds between clips (the grid robot's inventory); merged under `info`. */
  rest: PoseInfo | undefined = undefined;
  /** Extra tilt (bumps), radians around x. */
  tilt = 0;
  scale = 1;
  /**
   * Seconds (clip time) a new clip takes to blend in from the pose on screen, so changing clips
   * (walk → idle → light…) never snaps the limbs in one frame. 0 cuts at once.
   */
  blend = 0.14;
  /** After a one-shot clip, go back to this one. */
  private after: { clip: string; at: number } | null = null;
  /** The pose being blended out: every part under the character's object, as it was on screen. */
  private fade: { nodes: THREE.Object3D[]; from: Float32Array; t: number } | null = null;
  private posed = false;

  constructor(readonly visual: CharacterVisual) {}

  play(clip: string, restart = false, info?: PoseInfo): void {
    if (clip !== this.clip || restart) {
      this.clip = clip;
      this.clipTime = 0;
      this.info = info;
      this.fadeOut();
    }
    this.after = null;
  }

  /** Shows the next pose as it is, without blending (a reset, a new run). */
  cut(): void {
    this.fade = null;
  }

  /** Keeps the pose on screen to blend from. */
  private fadeOut(): void {
    if (this.blend <= 0 || !this.posed) return;
    const root = this.visual.object;
    const nodes: THREE.Object3D[] = [];
    root.traverse((o) => {
      if (o !== root) nodes.push(o);
    });
    const from = new Float32Array(nodes.length * 10);
    nodes.forEach((o, i) => {
      o.position.toArray(from, i * 10);
      o.quaternion.toArray(from, i * 10 + 3);
      o.scale.toArray(from, i * 10 + 7);
    });
    this.fade = { nodes, from, t: 0 };
  }

  /** Mixes the pose just set with the one kept, `k` of the way to the new one. */
  private mix(k: number): void {
    const f = this.fade!;
    const q = Mover.q;
    const v = Mover.v;
    f.nodes.forEach((o, i) => {
      if (!o.parent) return;
      const a = i * 10;
      o.position.copy(v.fromArray(f.from, a).lerp(o.position, k));
      o.quaternion.copy(q.fromArray(f.from, a + 3).slerp(o.quaternion, k));
      o.scale.copy(v.fromArray(f.from, a + 7).lerp(o.scale, k));
    });
  }

  private static readonly q = new THREE.Quaternion();
  private static readonly v = new THREE.Vector3();

  /** Plays `clip` for `seconds` (clip time), then `then`. */
  once(clip: string, seconds: number, then = 'idle', info?: PoseInfo): void {
    this.play(clip, true, info);
    this.after = { clip: then, at: seconds };
  }

  /** Turns toward `target` by a fraction `k` of the way (0..1). */
  turnToward(target: number, k: number): void {
    this.heading += angleDelta(this.heading, target) * Math.min(1, Math.max(0, k));
  }

  update(dt: number): void {
    this.clipTime += dt;
    if (this.after && this.clipTime >= this.after.at) {
      const next = this.after.clip;
      this.after = null;
      this.clip = next;
      this.clipTime = 0;
      this.info = undefined;
      this.fadeOut();
    }
    const o = this.visual.object;
    o.position.set(this.x, this.y, this.z);
    o.rotation.set(this.tilt, this.heading, 0, 'YXZ');
    o.scale.setScalar(this.scale);
    const info = this.rest && this.info ? { ...this.rest, ...this.info } : (this.info ?? this.rest);
    this.visual.pose(this.clip, this.clipTime, info);
    if (this.fade) {
      this.fade.t += dt;
      const k = this.fade.t / this.blend;
      if (k >= 1) this.fade = null;
      else this.mix(k * k * (3 - 2 * k));
    }
    this.posed = true;
  }

  /** Where speech bubbles go. */
  top(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.x, this.y + this.visual.height * this.scale + 0.12, this.z);
  }
}

/** One piece of a step's show: it takes `weight` of the step's time. */
export interface Beat {
  weight: number;
  start?(): void;
  update?(t: number): void;
  /** Always called once, even when the step is skipped. */
  finish(): void;
}

/** Runs the beats of one step over its progress, in order, finishing each exactly once. */
export class StepShow {
  private started = 0;
  private finished = 0;
  private readonly ends: number[] = [];

  constructor(readonly beats: Beat[]) {
    const total = beats.reduce((s, b) => s + b.weight, 0) || 1;
    let acc = 0;
    for (const b of beats) {
      acc += b.weight / total;
      this.ends.push(acc);
    }
  }

  /** Moves to `t` (0..1). */
  run(t: number): void {
    for (let i = this.finished; i < this.beats.length; i++) {
      const b = this.beats[i]!;
      const a = i === 0 ? 0 : this.ends[i - 1]!;
      const e = this.ends[i]!;
      if (i >= this.started) {
        b.start?.();
        this.started = i + 1;
      }
      if (t >= e || i === this.beats.length - 1 && t >= 1) {
        b.update?.(1);
        b.finish();
        this.finished = i + 1;
        continue;
      }
      b.update?.(e > a ? (t - a) / (e - a) : 1);
      return;
    }
  }

  /** Finishes every beat left. */
  end(): void {
    this.run(1);
    for (let i = this.finished; i < this.beats.length; i++) {
      if (i >= this.started) this.beats[i]!.start?.();
      this.beats[i]!.finish();
    }
    this.started = this.finished = this.beats.length;
  }
}
