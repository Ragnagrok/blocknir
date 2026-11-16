/** A character on a flat floor (the player or an NPC). It can walk to a point and turn to look at something. */
import * as THREE from 'three';
import { figureOf, poseOf, type Project } from '../core/index.js';
import { Figure3D } from '../render/index.js';

/** Default walking speed, in meters per second. */
export const WALK_SPEED = 3.2;

export interface ActorOptions {
  /** Scale of the whole figure. */
  height?: number;
  /** Height of the floor the actor stands on, in meters. */
  floorY?: number;
  /** Walking speed in m/s; scripted walks (`walkTo`) default to 70% of it. */
  speed?: number;
  /** Clip played when standing still. */
  idleClip?: string;
  /** Clip played while walking; `onStep` fires twice per loop of it. */
  walkClip?: string;
  castShadow?: boolean;
  /** Passed to `Figure3D`: whether the figure's lantern makes a light. */
  light?: boolean;
}

interface Target {
  x: number;
  z: number;
  speed: number;
  resolve: () => void;
}

export class Actor {
  figure: Figure3D;
  /** Position on the floor: x is x, y is z. */
  readonly pos = new THREE.Vector2();
  /** Radians; 0 looks toward +z. */
  heading = 0;
  floorY: number;
  speed: number;
  readonly idleClip: string;
  readonly walkClip: string;
  /**
   * Clip played while not walking to a target: idle, talking, and so on. Player control sets it to
   * the walk clip while the player moves.
   */
  restClip: string;
  private clip: string;
  private clipTime = 0;
  private targets: Target[] = [];
  private turn: number | null = null;
  private readonly castShadow: boolean;
  /** Called each time a foot touches the floor. */
  onStep: () => void = () => {};

  constructor(p: Project, figureId: string, options: ActorOptions = {}) {
    this.floorY = options.floorY ?? 0;
    this.speed = options.speed ?? WALK_SPEED;
    this.idleClip = options.idleClip ?? 'idle';
    this.walkClip = options.walkClip ?? 'walk';
    this.restClip = this.clip = this.idleClip;
    this.castShadow = options.castShadow ?? true;
    this.figure = new Figure3D(p, figureOf(p, figureId), { light: options.light });
    this.figure.scale.setScalar(options.height ?? 1);
    this.shadows(this.figure);
  }

  private shadows(f: Figure3D): void {
    if (this.castShadow) f.traverse((o) => (o.castShadow = true));
  }

  /** Swaps the body (for example after picking a new look) and returns the old one, to remove from the scene. */
  swapFigure(f: Figure3D): Figure3D {
    const old = this.figure;
    f.scale.copy(old.scale);
    f.visible = old.visible;
    this.shadows(f);
    this.figure = f;
    return old;
  }

  /** Whether it is walking toward a target. */
  get walking(): boolean {
    return this.targets.length > 0;
  }

  /** Teleports; pending walks resolve right away. */
  place(x: number, z: number, heading?: number): void {
    this.pos.set(x, z);
    if (heading !== undefined) this.heading = heading;
    for (const t of this.targets) t.resolve();
    this.targets = [];
  }

  /** Walks in a straight line to (x, z), after any walks already queued. Resolves on arrival. */
  walkTo(x: number, z: number, speed = this.speed * 0.7): Promise<void> {
    return new Promise((resolve) => this.targets.push({ x, z, speed, resolve }));
  }

  /** Turns little by little until it faces the point. */
  lookAt(x: number, z: number): void {
    this.turn = Math.atan2(x - this.pos.x, z - this.pos.y);
  }

  /** Changes the clip right away, without a target (for player control). */
  play(clip: string): void {
    if (this.clip !== clip) {
      this.clip = clip;
      this.clipTime = 0;
    }
  }

  /** Eases the heading toward `target` (radians) along the shortest way. */
  turnToward(target: number, dt: number): void {
    let d = target - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * Math.min(1, dt * 12);
  }

  update(dt: number): void {
    this.clipTime += dt;
    const t = this.targets[0];
    if (t) {
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.y;
      const length = Math.hypot(dx, dz);
      const step = t.speed * dt;
      if (length <= step) {
        this.pos.set(t.x, t.z);
        this.targets.shift();
        t.resolve();
      } else {
        this.pos.x += (dx / length) * step;
        this.pos.y += (dz / length) * step;
        this.turnToward(Math.atan2(dx, dz), dt);
      }
      this.play(this.walkClip);
      this.turn = null;
    } else {
      this.play(this.restClip);
    }
    // A foot lands twice per walk cycle.
    if (this.clip === this.walkClip) {
      const cycle = this.figure.figure.clips.find((c) => c.name === this.walkClip)?.duration ?? 0.8;
      const half = cycle / 2;
      if (half > 0 && Math.floor((this.clipTime - dt) / half) !== Math.floor(this.clipTime / half)) this.onStep();
    }
    if (this.turn !== null) {
      this.turnToward(this.turn, dt);
      if (Math.abs(Math.atan2(Math.sin(this.turn - this.heading), Math.cos(this.turn - this.heading))) < 0.01) this.turn = null;
    }
  }

  /** Moves the figure to the actor's place and poses it. Call once per frame, after `update`. */
  draw(): void {
    this.figure.position.set(this.pos.x, this.floorY, this.pos.y);
    this.figure.rotation.y = this.heading;
    this.figure.applyPose(poseOf(this.figure.figure, this.clip, this.clipTime));
  }
}
