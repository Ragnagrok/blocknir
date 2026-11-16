/** What every stage (grid, turtle, realtime) gets from the board view, and a character mover. */
import * as THREE from 'three';
import type { RunError, TraceStep } from '../blocks/index.js';
import type { AssetCache } from './assets.js';
import type { Bounds } from './framing.js';
import { angleDelta, type Poof } from './pieces.js';
import type { CharacterVisual } from './skin.js';

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
  /** Extra tilt (bumps), radians around x. */
  tilt = 0;
  scale = 1;
  /** After a one-shot clip, go back to this one. */
  private after: { clip: string; at: number } | null = null;

  constructor(readonly visual: CharacterVisual) {}

  play(clip: string, restart = false): void {
    if (clip !== this.clip || restart) {
      this.clip = clip;
      this.clipTime = 0;
    }
    this.after = null;
  }

  /** Plays `clip` for `seconds` (clip time), then `then`. */
  once(clip: string, seconds: number, then = 'idle'): void {
    this.play(clip, true);
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
    }
    const o = this.visual.object;
    o.position.set(this.x, this.y, this.z);
    o.rotation.set(this.tilt, this.heading, 0, 'YXZ');
    o.scale.setScalar(this.scale);
    this.visual.pose(this.clip, this.clipTime);
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
