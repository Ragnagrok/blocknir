/**
 * From a trace to an animation timeline: how long each step takes on screen, and a playhead that
 * advances through the steps with a speed multiplier, pauses, single-steps and jumps to the end.
 * Pure: no three.js, no clocks (the caller passes the elapsed time).
 */
import type { GridEvent, TraceStep, TurtleEvent } from '../blocks/index.js';

/** Seconds each kind of step takes at speed ×1. */
export interface Timing {
  move: number;
  /** Jumps of actions with `goTo` (and moves of more than one cell). */
  jump: number;
  turn: number;
  light: number;
  pick: number;
  drop: number;
  paint: number;
  say: number;
  action: number;
  /** Control steps (repeat, if, set…): a short beat so the highlight can be seen. */
  control: number;
  call: number;
  wait: number;
  /** Turtle: seconds per meter walked on the patio, plus `move` as a base. */
  perMeter: number;
}

export const DEFAULT_TIMING: Timing = {
  move: 0.42,
  jump: 0.7,
  turn: 0.3,
  light: 0.6,
  pick: 0.55,
  drop: 0.55,
  paint: 0.45,
  say: 1.1,
  action: 0.7,
  control: 0.16,
  call: 0.2,
  wait: 0.35,
  perMeter: 0.22,
};

/** On-screen duration of a grid step at speed ×1. */
export function gridStepDuration(step: TraceStep<GridEvent>, timing: Timing = DEFAULT_TIMING): number {
  if (step.kind === 'call') return timing.call;
  if (step.kind === 'wait') return timing.wait;
  if (step.kind !== 'command') return timing.control;
  let d = 0;
  for (const e of step.events) {
    switch (e.type) {
      case 'moved': {
        const far = Math.abs(e.to[0] - e.from[0]) + Math.abs(e.to[1] - e.from[1]) > 1;
        d += e.dir === null || far ? timing.jump : timing.move;
        break;
      }
      case 'turned':
        d += timing.turn;
        break;
      case 'lit':
        d += timing.light;
        break;
      case 'picked':
        d += timing.pick;
        break;
      case 'dropped':
        d += timing.drop;
        break;
      case 'painted':
        d += timing.paint;
        break;
      case 'said':
        d += timing.say;
        break;
      case 'action':
        d += timing.action + (e.moved ? timing.jump * 0.6 : 0) + (e.said !== undefined ? timing.say * 0.6 : 0);
        break;
    }
  }
  return Math.max(d, timing.control);
}

/** On-screen duration of a turtle step at speed ×1. `metersPerUnit` converts turtle steps to meters. */
export function turtleStepDuration(step: TraceStep<TurtleEvent>, metersPerUnit: number, timing: Timing = DEFAULT_TIMING): number {
  if (step.kind === 'call') return timing.call;
  if (step.kind !== 'command') return timing.control;
  let d = 0;
  for (const e of step.events) {
    if (e.type === 'moved') {
      const len = Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) * metersPerUnit;
      d += Math.min(1.6, timing.move * 0.6 + len * timing.perMeter);
    } else if (e.type === 'turned') {
      d += Math.min(0.9, timing.turn * (0.5 + Math.abs(e.by) / 180));
    } else {
      d += timing.paint;
    }
  }
  return Math.max(d, timing.control);
}

/** A playhead change: a step started, or a step finished. */
export type Transition = { type: 'begin'; index: number } | { type: 'end'; index: number } | { type: 'done' };

export type PlayheadState = 'idle' | 'playing' | 'paused' | 'done';

/**
 * Walks a list of step durations. `advance(dt, speed)` moves time forward and returns the steps
 * that began and ended meanwhile, in order. `speed` is a multiplier; `Infinity` plays everything at
 * once. `step()` plays exactly one step and then pauses.
 */
export class Playhead {
  /** The step being animated, or -1 between steps. */
  index = -1;
  /** 0 to 1 through the current step. */
  progress = 0;
  state: PlayheadState = 'idle';
  /** Steps fully played. */
  played = 0;
  private stopAt = Infinity;

  constructor(readonly durations: readonly number[]) {
    if (durations.length === 0) this.state = 'done';
  }

  get length(): number {
    return this.durations.length;
  }

  play(): void {
    if (this.state === 'done') return;
    this.stopAt = Infinity;
    this.state = 'playing';
  }

  pause(): void {
    if (this.state === 'playing') this.state = 'paused';
  }

  /** Plays one step (the current one to its end, or the next one) and pauses after it. */
  step(): void {
    if (this.state === 'done') return;
    this.stopAt = this.index >= 0 ? this.index + 1 : this.played + 1;
    this.state = 'playing';
  }

  /** Moves time forward by `dt` seconds at `speed`. */
  advance(dt: number, speed: number): Transition[] {
    const out: Transition[] = [];
    if (this.state !== 'playing') return out;
    let budget = speed === Infinity ? Infinity : Math.max(0, dt * speed);
    for (let guard = 0; guard < 100000; guard++) {
      if (this.index < 0) {
        if (this.played >= this.durations.length) {
          this.state = 'done';
          out.push({ type: 'done' });
          return out;
        }
        if (this.played >= this.stopAt) {
          this.state = 'paused';
          return out;
        }
        this.index = this.played;
        this.progress = 0;
        out.push({ type: 'begin', index: this.index });
      }
      const duration = this.durations[this.index]!;
      const left = (1 - this.progress) * duration;
      if (budget >= left) {
        budget -= left;
        this.progress = 1;
        out.push({ type: 'end', index: this.index });
        this.index = -1;
        this.played++;
        if (this.played >= this.durations.length) {
          this.state = 'done';
          out.push({ type: 'done' });
          return out;
        }
        if (this.played >= this.stopAt) {
          this.state = 'paused';
          return out;
        }
        if (budget <= 0) return out;
      } else {
        this.progress += duration > 0 ? budget / duration : 1;
        return out;
      }
    }
    return out;
  }

  /** Total seconds left at speed ×1. */
  remaining(): number {
    let t = 0;
    for (let i = this.played; i < this.durations.length; i++) t += this.durations[i]! * (i === this.index ? 1 - this.progress : 1);
    return t;
  }
}

/** Reads a speed: a multiplier, or `'instant'` (Infinity). Clamped to 0.1 … 16 otherwise. */
export function parseSpeed(speed: number | 'instant' | undefined, fallback = 1): number {
  if (speed === 'instant' || speed === Infinity) return Infinity;
  if (speed === undefined || !Number.isFinite(speed) || speed <= 0) return fallback;
  return Math.min(16, Math.max(0.1, speed));
}
