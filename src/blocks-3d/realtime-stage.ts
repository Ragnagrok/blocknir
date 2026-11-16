/**
 * The realtime world on screen: the arena (tiles and walls), the player and the other actors,
 * moved smoothly between ticks. The host steps the game on its own timer; each tick result is
 * handed here and animated over the measured tick interval.
 */
import * as THREE from 'three';
import { describeValue, DEFAULT_LABELS, type ActorState, type GameStatus, type RealtimeEvent, type RealtimeSetup, type RealtimeState, type TickResult, type Value } from '../blocks/index.js';
import { buildFloor, cellCenter, place, type Floor } from './assets.js';
import { boardBounds, type Bounds } from './framing.js';
import { Bubble, clamp01, easeInOut, easeOutBack, headingOf, InstancedTemplate } from './pieces.js';
import { Mover, type Stage, type StageContext } from './stage.js';
import { resolveName, type ActorDef } from './skin.js';

/** Values for a DOM HUD. */
export interface RealtimeHud {
  tick: number;
  status: GameStatus;
  /** Shared variables (`points`, `lives`…). */
  variables: Record<string, Value>;
  /** `points` or `score`, if the game has one. */
  score: number | null;
  lives: number | null;
}

interface Live {
  id: string;
  kind: string;
  mover: Mover;
  def: ActorDef;
  player: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  heading: number;
  fromHeading: number;
  moved: boolean;
  /** Seconds since it appeared (pop-in), and since it vanished (shrink), or -1. */
  born: number;
  gone: number;
  bump: { dx: number; dz: number; age: number } | null;
  bubble: Bubble | null;
  look: string | null;
}

const DIRS: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export class RealtimeStage implements Stage {
  readonly root = new THREE.Group();
  state: RealtimeState;
  /** Seconds between ticks, as measured by the view. */
  interval = 1 / 6;

  private floor: Floor;
  private readonly floorOf: () => Floor;
  private props: InstancedTemplate[] = [];
  private actors = new Map<string, Live>();
  private age = 0;
  private ended: Exclude<GameStatus, 'running'> | null = null;
  private time = 0;

  constructor(
    private readonly ctx: StageContext,
    readonly setup: RealtimeSetup,
    state: RealtimeState,
  ) {
    this.state = structuredClone(state);
    const { width, height } = setup.arena;
    const tiles = new Map<string, string>();
    for (const t of setup.arena.tiles ?? []) tiles.set(`${t.x},${t.y}`, t.tile);
    const walls = new Set((setup.arena.walls ?? []).map(([x, y]) => `${x},${y}`));
    const skin = ctx.assets.skin;
    const isTerrain = (name: string): boolean => resolveName(name, (k) => Object.prototype.hasOwnProperty.call(skin.terrain, k), skin.aliases).key !== null;
    // Tiles that are not floors (a `star`, a `door`) stand on the default floor as items.
    const props = new Map<string, THREE.Matrix4[]>();
    for (const [at, name] of tiles) {
      if (isTerrain(name)) continue;
      const [x, y] = at.split(',').map(Number) as [number, number];
      const [cx, cz] = cellCenter(x, y, width, height);
      const list = props.get(name) ?? [];
      list.push(place(cx, 0, cz));
      props.set(name, list);
    }
    this.floorOf = () =>
      buildFloor(
        ctx.assets,
        width,
        height,
        (x, y) => {
          const t = tiles.get(`${x},${y}`);
          return t && isTerrain(t) ? t : null;
        },
        (x, y) => walls.has(`${x},${y}`),
      );
    this.floor = this.floorOf();
    this.root.add(this.floor.group);
    for (const [name, list] of props) {
      const it = new InstancedTemplate(ctx.assets.item(name).object);
      it.set(list);
      this.root.add(it.group);
      this.props.push(it);
    }
    this.reset(state);
  }

  private cell(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    const [cx, cz] = cellCenter(x, y, this.setup.arena.width, this.setup.arena.height);
    return out.set(cx, Math.max(0, this.floor.level(x, y)), cz);
  }

  rebuildFloor(): void {
    this.floor.dispose();
    this.floor.group.removeFromParent();
    this.floor = this.floorOf();
    this.root.add(this.floor.group);
  }

  focus(): [number, number, number] | null {
    const p = this.actors.get('player');
    return p ? [p.mover.x, p.mover.y, p.mover.z] : null;
  }

  bounds(): Bounds {
    return boardBounds(this.setup.arena.width, this.setup.arena.height, { top: 1.3 });
  }

  /** Shows a state at once (a new game). */
  reset(state: RealtimeState): void {
    for (const a of this.actors.values()) this.remove(a);
    this.actors.clear();
    this.state = structuredClone(state);
    this.ended = null;
    for (const s of this.state.actors) this.add(s, false);
    this.age = 1e3;
  }

  private add(s: ActorState, pop: boolean): Live {
    const player = s.id === 'player';
    const character = typeof this.ctx.meta.character === 'string' ? this.ctx.meta.character : undefined;
    const made = player
      ? { visual: this.ctx.assets.character('realtime', character, s.kind, s.look), def: { create: () => new THREE.Group() } as ActorDef }
      : this.ctx.assets.actor(s.kind, s.look);
    const mover = new Mover(made.visual);
    const at = this.cell(s.x, s.y);
    const live: Live = {
      id: s.id,
      kind: s.kind,
      mover,
      def: made.def,
      player,
      from: at.clone(),
      to: at.clone(),
      heading: headingOf(s.facing),
      fromHeading: headingOf(s.facing),
      moved: false,
      born: pop ? 0 : 1e3,
      gone: -1,
      bump: null,
      bubble: null,
      look: s.look,
    };
    mover.heading = live.heading;
    mover.x = at.x;
    mover.z = at.z;
    mover.y = at.y + (made.def.fly ?? 0);
    made.visual.setLook?.(s.look);
    this.root.add(made.visual.object);
    if (made.def.glow) {
      // Glowing actors (shots of light) carry a soft sprite; no real light.
      const g = this.ctx.glow(made.def.glow.color, made.def.glow.size ?? 0.9);
      g.position.y = made.def.glow.height;
      made.visual.object.add(g);
    }
    mover.update(0);
    this.actors.set(s.id, live);
    return live;
  }

  private remove(a: Live): void {
    a.bubble?.clear();
    a.mover.visual.object.removeFromParent();
    a.mover.visual.dispose?.();
  }

  /** Animates one tick toward its new state. */
  tick(result: TickResult, state: RealtimeState): void {
    // Finish the previous tick where it was going.
    for (const a of this.actors.values()) {
      a.from.copy(a.to);
      a.fromHeading = a.heading;
      a.moved = false;
    }
    this.state = structuredClone(state);
    for (const e of result.events) this.event(e);
    const alive = new Set(this.state.actors.map((a) => a.id));
    for (const s of this.state.actors) {
      let a = this.actors.get(s.id);
      if (!a) a = this.add(s, true);
      const to = this.cell(s.x, s.y);
      if (!a.to.equals(to)) {
        a.moved = true;
        a.to.copy(to);
      }
      a.heading = a.fromHeading + angleDelta(a.fromHeading, headingOf(s.facing));
      if (s.look !== a.look) {
        a.look = s.look;
        a.mover.visual.setLook?.(s.look);
      }
    }
    for (const a of this.actors.values()) {
      if (!alive.has(a.id) && a.gone < 0) {
        a.gone = 0;
        const p = a.mover;
        this.ctx.poof.burst(p.x, p.y + 0.2, p.z, a.def.projectile ? 0xfff2a0 : 0xffffff);
      }
    }
    this.age = 0;
  }

  private event(e: RealtimeEvent): void {
    switch (e.type) {
      case 'bumped': {
        const a = this.actors.get(e.actor);
        const d = DIRS[e.dir];
        if (a && d && !a.def.projectile) a.bump = { dx: d[0], dz: d[1], age: 0 };
        break;
      }
      case 'said': {
        const a = this.actors.get(e.actor);
        if (!a) break;
        a.bubble ??= new Bubble(this.root, this.ctx.fit);
        a.bubble.show(describeValue(e.value, this.ctx.assets.labels ?? DEFAULT_LABELS), 'say', 1.8);
        break;
      }
      case 'touched': {
        const a = this.actors.get(e.a);
        const b = this.actors.get(e.b);
        if (a && b && (a.player || b.player)) {
          const p = (a.player ? b : a).to;
          this.ctx.poof.burst(p.x, p.y + 0.3, p.z, 0xffffff);
        }
        break;
      }
      case 'ended':
        this.end(e.status);
        break;
      default:
        break;
    }
  }

  /** The win or lose moment. */
  private end(status: Exclude<GameStatus, 'running'>): void {
    this.ended = status;
    const p = this.actors.get('player');
    if (!p) return;
    if (status === 'won') {
      p.mover.play('cheer', true);
      [0xffd23a, 0x3ec45a, 0xff7ab8, 0x3a7cf0].forEach((c, i) => this.ctx.poof.burst(p.to.x + (i - 1.5) * 0.35, p.to.y + 1, p.to.z, c));
    } else {
      p.mover.once('bump', 0.9, 'sad');
    }
  }

  get status(): GameStatus {
    return this.ended ?? this.state.status;
  }

  hud(): RealtimeHud {
    const v = this.state.variables;
    const num = (x: Value | undefined): number | null => (typeof x === 'number' ? x : null);
    return {
      tick: this.state.tick,
      status: this.state.status,
      variables: { ...v },
      score: num(v.points) ?? num(v.score) ?? num(v.puntos),
      lives: num(v.lives) ?? num(v.vidas),
    };
  }

  celebrate(): void {
    this.end('won');
  }

  message(text: string, style: 'say' | 'error'): void {
    const p = this.actors.get('player');
    if (!p) return;
    p.bubble ??= new Bubble(this.root, this.ctx.fit);
    p.bubble.show(text, style, style === 'error' ? Infinity : 2.5);
  }

  update(dt: number, time: number): void {
    this.time = time;
    this.age += dt;
    const k = clamp01(this.age / Math.max(0.05, this.interval));
    const rate = Math.max(1, Math.min(2, (1 / 6) / Math.max(0.05, this.interval)));
    const tmp = new THREE.Vector3();
    for (const a of [...this.actors.values()]) {
      const m = a.mover;
      const fly = a.def.fly ?? 0;
      const p = a.def.projectile ? k : easeInOut(k);
      tmp.lerpVectors(a.from, a.to, p);
      m.x = tmp.x;
      m.z = tmp.z;
      m.y = tmp.y + fly + (a.def.fly ? Math.sin(time * 3 + a.from.x) * 0.05 : 0);
      if (a.from.distanceToSquared(a.to) > 2.5) {
        // Teleports (goTo, wrap-around) do not slide across the arena.
        m.x = a.to.x;
        m.z = a.to.z;
      }
      m.heading = a.fromHeading + (a.heading - a.fromHeading) * clamp01(k * 2);
      if (a.bump) {
        a.bump.age += dt;
        const b = clamp01(a.bump.age / 0.3);
        const push = Math.sin(b * Math.PI) * 0.22;
        m.x += a.bump.dx * push;
        m.z += a.bump.dz * push;
        if (b >= 1) a.bump = null;
      }
      if (!this.ended || !a.player) {
        if (a.moved && k < 1) m.play('walk');
        else if (m.clip === 'walk') m.play('idle');
      }
      let scale = 1;
      if (a.born < 1e3) {
        a.born += dt;
        scale = a.born < 0.3 ? Math.max(0.01, easeOutBack(a.born / 0.3)) : 1;
        if (a.born >= 0.3) a.born = 1e3;
      }
      if (a.gone >= 0) {
        a.gone += dt;
        scale = Math.max(0.01, 1 - a.gone / 0.25);
        if (a.gone >= 0.25) {
          this.remove(a);
          this.actors.delete(a.id);
          continue;
        }
      }
      m.scale = scale;
      m.update(dt * rate);
      if (a.def.projectile) m.visual.object.rotation.z = time * 6;
      a.bubble?.update(dt, m.top());
    }
    this.floor.waves.position.y = Math.sin(time * 1.6) * 0.025;
  }

  dispose(): void {
    for (const a of this.actors.values()) this.remove(a);
    this.actors.clear();
    this.floor.dispose();
    for (const p of this.props) p.dispose();
    this.root.clear();
    void this.time;
  }
}

const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));
