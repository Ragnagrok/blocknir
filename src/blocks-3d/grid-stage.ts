/**
 * The grid world on screen: terrain tiles, walls, arrows, painted cells, items (instanced per name,
 * with counts), lamps that glow when lit, the robot with its facing and what it carries. Steps of a
 * trace animate here; the state is always replayed with `applyGridEvent`, so it ends exact.
 */
import * as THREE from 'three';
import {
  applyGridEvent,
  cloneGridState,
  describeValue,
  DEFAULT_LABELS,
  type Direction,
  type GridEvent,
  type GridState,
  type ItemChange,
  type RunError,
  type TraceStep,
} from '../blocks/index.js';
import { buildFloor, cellCenter, place, type Floor } from './assets.js';
import { boardBounds, type Bounds } from './framing.js';
import { layoutCell, roomFor, type CellEntry, type Placement, type Room } from './layout.js';
import { angleDelta, badgeTexture, copyObject, Bubble, clamp01, disposeObject, easeInOut, easeOut, easeOutBack, headingOf, InstancedTemplate, ScreenSprite, span } from './pieces.js';
import { labelSprite } from './default-skin.js';
import { Mover, StepShow, type Beat, type StageContext, type StepStage } from './stage.js';
import { colorOf } from './skin.js';
import { DEFAULT_TIMING, gridStepDuration, type Timing } from './timeline.js';

const key = (x: number, y: number, item: string): string => `${x},${y},${item}`;
const DIRS: Record<Direction, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** Item changes that grew a count in a cell (for pop-in effects). */
const grown = (changes: readonly ItemChange[]): Array<{ x: number; y: number; item: string }> =>
  changes.flatMap((c) => (c.where === 'cell' && c.after > c.before ? [{ x: c.x, y: c.y, item: c.item }] : []));

export class GridStage implements StepStage<GridEvent> {
  readonly root = new THREE.Group();
  /** The state as shown (after the steps that ended). */
  state: GridState;
  timing: Timing = DEFAULT_TIMING;

  private floor: Floor;
  private statics: InstancedTemplate[] = [];
  private items = new Map<string, InstancedTemplate>();
  private paint: THREE.InstancedMesh;
  private badges: ScreenSprite[] = [];
  private glows: THREE.Sprite[] = [];
  /** Warm pools of light on the floor under lit lamps (they read as "on" even in daylight). */
  private pools: THREE.Mesh[] = [];
  private poolGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private labels: THREE.Object3D[] = [];
  private mover: Mover;
  private bubble: Bubble;
  private carried = new THREE.Group();
  private carriedDirty = true;
  private carriedFrozen = false;
  private dirty = true;
  /** Copies in a cell that are not drawn yet (an item still falling into it). */
  private hold = new Map<string, number>();
  /** Items that just appeared, by cell and name: age in seconds. */
  private pops = new Map<string, number>();
  /** A cell whose paint is fading in. */
  private fades = new Map<number, { from: number | null; to: number; t: number }>();
  /** Lamps in the order they were lit (for the few real lights). */
  private litOrder: string[] = [];
  /** Loose objects in flight (picked or dropped items). */
  private flying: THREE.Object3D[] = [];
  private show: StepShow | null = null;
  /** Cells whose items stand aside for the character: the side chosen when it came in. */
  private away = new Map<number, [number, number]>();
  /** The room the last rebuild used, to rebuild only when it changes. */
  private roomKey = '';
  private time = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(
    private readonly ctx: StageContext,
    state: GridState,
  ) {
    this.state = cloneGridState(state);
    const s = this.state;
    this.floor = this.makeFloor();
    this.root.add(this.floor.group);
    this.buildStatics();
    const paintMat = new THREE.MeshStandardMaterial({ roughness: 0.75, color: 0xffffff });
    this.paint = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.03, 0.9), paintMat, Math.max(1, s.width * s.height));
    this.paint.receiveShadow = true;
    this.paint.count = 0;
    this.paint.frustumCulled = false;
    this.root.add(this.paint);
    const character = typeof ctx.meta.character === 'string' ? ctx.meta.character : undefined;
    this.mover = new Mover(ctx.assets.character('grid', character));
    this.root.add(this.mover.visual.object);
    this.root.add(this.carried);
    this.bubble = new Bubble(this.root, ctx.fit);
    this.placeRobot();
    this.mover.heading = headingOf(s.robot.facing);
    this.mover.update(0);
  }

  /** Terrain never changes during a run, so the floor is built from the first state. */
  private makeFloor(): Floor {
    const s = this.state;
    const { width, height } = s;
    const cells = s.cells.map((c) => ({ terrain: c.terrain, wall: c.wall }));
    return buildFloor(this.ctx.assets, width, height, (x, y) => cells[x + y * width]!.terrain, (x, y) => cells[x + y * width]!.wall);
  }

  rebuildFloor(): void {
    this.floor.dispose();
    this.floor.group.removeFromParent();
    this.floor = this.makeFloor();
    this.root.add(this.floor.group);
  }

  focus(): [number, number, number] {
    return [this.mover.x, this.mover.y, this.mover.z];
  }

  private cell(x: number, y: number): [number, number, number] {
    const [cx, cz] = cellCenter(x, y, this.state.width, this.state.height);
    return [cx, this.floor.level(x, y), cz];
  }

  private placeRobot(): void {
    const [x, y, z] = this.cell(this.state.robot.x, this.state.robot.y);
    this.mover.x = x;
    this.mover.y = y;
    this.mover.z = z;
  }

  /** Walls between cells, arrows and the labels of named places: they never change during a run. */
  private buildStatics(): void {
    const s = this.state;
    const a = this.ctx.assets;
    const walls: THREE.Matrix4[] = [];
    for (const w of s.walls) {
      const [cx, cz] = cellCenter(w.x, w.y, s.width, s.height);
      if (w.side === 'N') walls.push(place(cx, 0, cz - 0.5, 0));
      else if (w.side === 'W') walls.push(place(cx - 0.5, 0, cz, Math.PI / 2));
      else if (w.side === 'S') walls.push(place(cx, 0, cz + 0.5, 0));
      else walls.push(place(cx + 0.5, 0, cz, Math.PI / 2));
    }
    if (walls.length) {
      const it = new InstancedTemplate(a.wall());
      it.set(walls);
      this.root.add(it.group);
      this.statics.push(it);
    }
    const arrows: THREE.Matrix4[] = [];
    const rot: Record<Direction, number> = { E: 0, N: Math.PI / 2, W: Math.PI, S: -Math.PI / 2 };
    s.cells.forEach((c, i) => {
      if (!c.arrow) return;
      const x = i % s.width;
      const y = Math.floor(i / s.width);
      const [cx, cy, cz] = this.cell(x, y);
      arrows.push(place(cx, cy + 0.02, cz, rot[c.arrow]));
    });
    if (arrows.length) {
      const it = new InstancedTemplate(a.arrow());
      it.set(arrows);
      this.root.add(it.group);
      this.statics.push(it);
    }
    const places = this.ctx.meta.places;
    if (places && typeof places === 'object') {
      for (const [at, name] of Object.entries(places as Record<string, unknown>)) {
        const m = /^(-?\d+),(-?\d+)$/.exec(at);
        if (!m || typeof name !== 'string') continue;
        let x = Number(m[1]);
        let y = Number(m[2]);
        if (x < 0) x += s.width;
        if (y < 0) y += s.height;
        if (x < 0 || y < 0 || x >= s.width || y >= s.height) continue;
        const [cx, cy, cz] = this.cell(x, y);
        const l = labelSprite(a.label(name), 0);
        l.position.set(cx, cy + 0.02, cz + 0.42);
        l.center.set(0.5, 0.5);
        this.root.add(l);
        this.labels.push(l);
      }
    }
  }

  bounds(): Bounds {
    const extra = this.state.height <= 2 ? 1.5 : 1.3;
    return boardBounds(this.state.width, this.state.height, { top: extra });
  }

  /** Replaces the shown state at once (no animation). */
  reset(state: GridState): void {
    this.state = cloneGridState(state);
    this.hold.clear();
    this.pops.clear();
    this.fades.clear();
    this.litOrder = [];
    this.away.clear();
    this.roomKey = '';
    this.show = null;
    this.clearFlying();
    this.bubble.clear();
    this.placeRobot();
    this.mover.heading = headingOf(this.state.robot.facing);
    this.mover.tilt = 0;
    this.mover.play('idle', true);
    this.mover.cut();
    this.mover.rest = { inventory: this.state.inventory };
    this.carriedFrozen = false;
    this.dirty = this.carriedDirty = true;
  }

  private clearFlying(): void {
    for (const f of this.flying) f.removeFromParent();
    this.flying = [];
  }

  // -------------------------------------------------------------------------------------------
  // Steps
  // -------------------------------------------------------------------------------------------

  duration(step: TraceStep<GridEvent>): number {
    return gridStepDuration(step, this.timing);
  }

  begin(step: TraceStep<GridEvent>, instant: boolean): void {
    this.show?.end();
    const beats: Beat[] = [];
    for (const e of step.events) beats.push(instant ? { weight: 1, finish: () => this.apply(e) } : this.beat(e));
    if (!beats.length) beats.push({ weight: 1, finish: () => {} });
    this.show = new StepShow(beats);
    if (!instant) this.show.run(0);
  }

  progress(_step: TraceStep<GridEvent>, t: number): void {
    this.show?.run(t);
  }

  end(_step: TraceStep<GridEvent>, _instant: boolean): void {
    this.show?.end();
    this.show = null;
  }

  /** Applies an event to the shown state. `place: false` leaves the robot where the animation has it. */
  private apply(e: GridEvent, place = true): void {
    applyGridEvent(this.state, e);
    this.mover.rest = { inventory: this.state.inventory };
    this.dirty = true;
    if (e.type === 'lit' && e.on) this.litOrder.unshift(`${e.x},${e.y}`);
    if (e.type === 'picked' || e.type === 'dropped' || e.type === 'action') this.carriedDirty = true;
    if (place && (e.type === 'moved' || (e.type === 'action' && e.moved))) this.placeRobot();
  }

  private beat(e: GridEvent): Beat {
    const m = this.mover;
    const t = this.timing;
    const pos = (x: number, y: number): THREE.Vector3 => new THREE.Vector3(...this.cell(x, y));
    switch (e.type) {
      case 'moved': {
        const from = pos(...e.from);
        const to = pos(...e.to);
        const far = Math.abs(e.to[0] - e.from[0]) + Math.abs(e.to[1] - e.from[1]) > 1;
        const jump = e.dir === null || far;
        const heading = e.dir ? headingOf(e.dir) : Math.atan2(to.x - from.x, to.z - from.z);
        let h0 = 0;
        return {
          weight: jump ? t.jump : t.move,
          start: () => {
            m.play(jump ? 'jump' : 'walk', jump);
            h0 = m.heading;
          },
          update: (k) => {
            // Turns toward where it goes in the first third of the step, smoothly (no snap at the end).
            m.heading = h0 + angleDelta(h0, heading) * easeInOut(span(k, 0, 0.3));
            const p = jump ? easeInOut(span(k, 0.1, 0.9)) : easeInOut(k);
            m.x = from.x + (to.x - from.x) * p;
            m.z = from.z + (to.z - from.z) * p;
            const arc = jump ? Math.sin(p * Math.PI) * (0.55 + 0.1 * Math.hypot(to.x - from.x, to.z - from.z)) : Math.abs(Math.sin(p * Math.PI * 2)) * 0.04;
            m.y = from.y + (to.y - from.y) * p + arc;
          },
          finish: () => {
            this.apply(e);
            m.heading = heading;
            m.play('idle');
          },
        };
      }
      case 'turned': {
        const a = headingOf(e.from);
        const b = a + angleTo(e.from, e.to);
        return {
          weight: t.turn,
          start: () => m.play('walk'),
          update: (k) => (m.heading = a + (b - a) * easeInOut(k)),
          finish: () => {
            this.apply(e);
            m.heading = headingOf(e.to);
            m.play('idle');
          },
        };
      }
      case 'lit': {
        let done = false;
        return {
          weight: t.light,
          start: () => m.once(e.on ? 'light' : 'action', 0.8),
          update: (k) => {
            if (!done && k >= 0.45) {
              done = true;
              this.apply(e);
              const [x, y, z] = this.cell(e.x, e.y);
              this.ctx.poof.burst(x, y + 0.7, z, e.on ? 0xffe27a : 0xb0b8c8);
              this.pops.set(key(e.x, e.y, e.on ? 'lampOn' : 'lamp'), 0);
            }
          },
          finish: () => {
            if (!done) this.apply(e);
          },
        };
      }
      case 'picked': {
        let loose: THREE.Object3D | null = null;
        const start = pos(e.x, e.y);
        return {
          weight: t.pick,
          start: () => {
            m.once('pick', 0.9);
            this.carriedFrozen = true;
            loose = this.loose(e.item);
            // From where the item stands (aside, in a corner of the cell), not from the cell center.
            const spot = this.spotOf(e.x, e.y, e.item);
            if (spot) start.set(start.x + spot.x, start.y + spot.y, start.z + spot.z);
            loose.position.copy(start);
            this.apply(e);
          },
          update: (k) => {
            if (!loose) return;
            const top = m.top();
            const p = easeInOut(span(k, 0.25, 0.95));
            loose.position.set(start.x + (top.x - start.x) * p, start.y + (top.y - 0.1 - start.y) * p + Math.sin(p * Math.PI) * 0.4, start.z + (top.z - start.z) * p);
            loose.scale.setScalar(1 - p * 0.6);
          },
          finish: () => {
            if (!loose) this.apply(e);
            else this.dropLoose(loose);
            this.carriedFrozen = false;
            this.carriedDirty = true;
          },
        };
      }
      case 'dropped': {
        let loose: THREE.Object3D | null = null;
        const end = pos(e.x, e.y);
        const hk = key(e.x, e.y, e.item);
        return {
          weight: t.drop,
          start: () => {
            m.once('drop', 0.8);
            loose = this.loose(e.item);
            loose.position.copy(m.top());
            this.hold.set(hk, (this.hold.get(hk) ?? 0) + 1);
            this.apply(e);
            // It lands where the layout puts it (aside, while the character stands there).
            const spot = this.spotOf(e.x, e.y, e.item, true);
            if (spot) end.set(end.x + spot.x, end.y + spot.y, end.z + spot.z);
          },
          update: (k) => {
            if (!loose) return;
            const top = m.top();
            const p = easeInOut(span(k, 0.15, 0.85));
            loose.position.set(top.x + (end.x - top.x) * p, top.y - 0.1 + (end.y - top.y + 0.1) * p + Math.sin(p * Math.PI) * 0.25, top.z + (end.z - top.z) * p);
            loose.scale.setScalar(0.4 + p * 0.6);
          },
          finish: () => {
            if (!loose) this.apply(e);
            else {
              this.dropLoose(loose);
              const n = (this.hold.get(hk) ?? 1) - 1;
              if (n > 0) this.hold.set(hk, n);
              else this.hold.delete(hk);
              this.dirty = true;
              this.pops.set(hk, 0.15);
            }
          },
        };
      }
      case 'painted': {
        return {
          weight: t.paint,
          start: () => {
            m.play('paint', true);
            const i = e.x + e.y * this.state.width;
            this.fades.set(i, { from: e.previous ? colorOf(this.ctx.assets.skin, e.previous) : null, to: colorOf(this.ctx.assets.skin, e.color), t: 0 });
            this.apply(e);
            const [x, y, z] = this.cell(e.x, e.y);
            this.ctx.poof.burst(x, y, z, colorOf(this.ctx.assets.skin, e.color));
          },
          update: (k) => {
            const f = this.fades.get(e.x + e.y * this.state.width);
            if (f) f.t = easeOut(k);
          },
          finish: () => {
            if (!this.fades.delete(e.x + e.y * this.state.width)) this.apply(e);
            this.dirty = true;
            m.play('idle');
          },
        };
      }
      case 'said': {
        return {
          weight: t.say,
          start: () => {
            m.once('talk', t.say * 0.9);
            this.bubble.show(this.describe(e.value), 'say', t.say * 1.4);
          },
          finish: () => {},
        };
      }
      case 'action': {
        let applied = false;
        const from = e.moved ? pos(...e.moved.from) : null;
        const to = e.moved ? pos(...e.moved.to) : null;
        const doApply = (): void => {
          if (applied) return;
          applied = true;
          // The jump that follows still starts from the old cell: the robot lands in `finish`.
          this.apply(e, false);
          const [x, y, z] = this.cell(e.x, e.y);
          const visible = e.changes.some((c) => c.where === 'cell') || e.painted;
          if (visible) this.ctx.poof.burst(x, y + 0.3, z, e.painted ? colorOf(this.ctx.assets.skin, e.painted.color) : 0xfff4c8);
          for (const g of grown(e.changes)) this.pops.set(key(g.x, g.y, g.item), 0);
          if (e.said !== undefined) this.bubble.show(this.describe(e.said), 'say', t.say * 1.2);
        };
        const w = t.action + (e.moved ? t.jump * 0.6 : 0) + (e.said !== undefined ? t.say * 0.6 : 0);
        const split = e.moved ? 0.4 : 1;
        return {
          weight: w,
          start: () => m.once('action', t.action * 0.8, e.moved ? 'jump' : 'idle', { action: e.action, args: e.args }),
          update: (k) => {
            if (k >= split * 0.6) doApply();
            if (from && to && k > split) {
              const p = easeInOut(span(k, split, 1));
              if (p > 0) m.turnToward(Math.atan2(to.x - from.x, to.z - from.z), 0.25);
              m.x = from.x + (to.x - from.x) * p;
              m.z = from.z + (to.z - from.z) * p;
              m.y = from.y + (to.y - from.y) * p + Math.sin(p * Math.PI) * 0.6;
            }
          },
          finish: () => {
            doApply();
            this.placeRobot();
            m.play('idle');
          },
        };
      }
    }
  }

  private describe(v: unknown): string {
    if (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string') return String(v);
    return describeValue(v, this.ctx.assets.labels ?? DEFAULT_LABELS);
  }

  /** A copy of an item's model to animate on its own. */
  private loose(name: string): THREE.Object3D {
    const a = this.ctx.assets.item(name);
    const o = new THREE.Group();
    o.add(copyObject(a.object));
    this.root.add(o);
    this.flying.push(o);
    return o;
  }

  private dropLoose(o: THREE.Object3D): void {
    o.removeFromParent();
    this.flying = this.flying.filter((f) => f !== o);
  }

  showError(error: RunError): void {
    this.show?.end();
    this.show = null;
    const m = this.mover;
    const dir = typeof error.params.dir === 'string' && error.params.dir in DIRS ? (error.params.dir as Direction) : null;
    const bumps = error.code === 'wall' || error.code === 'outOfBoard';
    const home = { x: m.x, y: m.y, z: m.z };
    this.bubble.show(error.message, 'error', Infinity);
    if (bumps && dir) {
      const [dx, dz] = DIRS[dir];
      m.heading = headingOf(dir);
      m.once('bump', 0.9, 'sad');
      this.after = { age: 0, update: (age) => {
        const k = clamp01(age / 0.55);
        const push = k < 0.35 ? easeOut(k / 0.35) * 0.32 : 0.32 * (1 - easeInOut((k - 0.35) / 0.65));
        m.x = home.x + dx * push;
        m.z = home.z + dz * push;
        m.y = home.y + Math.sin(Math.min(1, k * 2) * Math.PI) * 0.06;
        m.tilt = k < 0.35 ? -push * 0.6 : 0;
        if (k >= 1) {
          m.tilt = 0;
          return true;
        }
        if (k > 0.3 && k < 0.36) {
          this.ctx.poof.burst(home.x + dx * 0.5, home.y + 0.4, home.z + dz * 0.5, 0xffffff);
        }
        return false;
      } };
    } else {
      m.once('bump', 0.6, 'sad');
    }
  }

  /** A small extra animation after the run (the bump). Returns true when it is over. */
  private after: { age: number; update: (age: number) => boolean } | null = null;

  celebrate(): void {
    this.mover.play('cheer', true);
    const top = this.mover.top();
    [0xffd23a, 0x3ec45a, 0xff7ab8].forEach((c, i) => this.ctx.poof.burst(top.x + (i - 1) * 0.3, top.y - 0.1 * (i % 2), top.z, c));
  }

  message(text: string, style: 'say' | 'error'): void {
    this.bubble.show(text, style, style === 'error' ? Infinity : 2.5);
  }

  /** What the robot carries, by name (state flags included). */
  get inventory(): Record<string, number> {
    return { ...this.state.inventory };
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  update(dt: number, time: number): void {
    this.time = time;
    const rate = this.ctx.rate();
    if (this.after && this.after.update((this.after.age += dt))) this.after = null;
    for (const [k, age] of this.pops) {
      const next = age + dt * Math.min(rate, 3);
      if (next > 0.45) this.pops.delete(k);
      else this.pops.set(k, next);
    }
    const rk = this.roomSignature();
    if (rk !== this.roomKey) this.dirty = true;
    if (this.dirty || this.pops.size || this.fades.size) this.rebuild();
    this.dirty = false;
    if (this.carriedDirty && !this.carriedFrozen) this.rebuildCarried();
    this.mover.update(dt * rate);
    const top = this.mover.top();
    this.carried.position.copy(top);
    this.carried.position.y -= 0.02;
    this.carried.rotation.y = Math.sin(time * 1.3) * 0.15;
    const n = this.carried.children.length;
    this.bubble.update(dt, top.add(new THREE.Vector3(0, n ? 0.42 : 0, 0)));
    this.floor.waves.position.y = Math.sin(time * 1.6) * 0.025;
    for (const g of this.glows) {
      const base = g.userData.size as number;
      g.scale.setScalar(base * (1 + Math.sin(time * 2.1 + g.position.x) * 0.04));
    }
  }

  /** Lays out items, badges, paint, glows and lights from the state. */
  private rebuild(): void {
    const s = this.state;
    const a = this.ctx.assets;
    const matrices = new Map<string, THREE.Matrix4[]>();
    const badges: Array<{ text: string; x: number; y: number; z: number }> = [];
    const lit: Array<{ x: number; y: number; z: number; floor: number; color: number; size: number; key: string }> = [];
    const m4 = new THREE.Matrix4();
    this.roomKey = this.roomSignature();
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const entries = this.entriesAt(x, y);
        if (!entries.length) continue;
        const [cx, cy, cz] = this.cell(x, y);
        const { placements, badges: b } = layoutCell(entries, undefined, this.roomAt(x, y));
        for (const p of placements) {
          const age = this.pops.get(key(x, y, p.name));
          const pop = age === undefined ? 1 : easeOutBack(clamp01(age / 0.4));
          const list = matrices.get(p.name) ?? [];
          list.push(place(cx + p.x, cy + p.y, cz + p.z, 0, p.scale * Math.max(0.01, pop), m4.clone()));
          matrices.set(p.name, list);
          const asset = a.item(p.name);
          if (asset.glow) lit.push({ x: cx + p.x, y: cy + p.y + asset.glow.height * p.scale, z: cz + p.z, floor: cy, color: asset.glow.color, size: (asset.glow.size ?? 1.1) * p.scale, key: `${x},${y}` });
        }
        for (const bb of b) badges.push({ text: String(bb.count), x: cx + bb.x, y: cy + bb.y, z: cz + bb.z });
      }
    }
    for (const [name, it] of this.items) if (!matrices.has(name)) it.set([]);
    for (const [name, list] of matrices) {
      let it = this.items.get(name);
      if (!it) {
        it = new InstancedTemplate(a.item(name).object);
        this.items.set(name, it);
        this.root.add(it.group);
      }
      it.set(list);
    }
    // Number badges.
    while (this.badges.length < badges.length) {
      const b = badgeTexture('0');
      const sp = new ScreenSprite(b.texture, b.aspect, 0.24, 18, 30, { onTop: true });
      this.badges.push(sp);
      this.root.add(sp);
    }
    this.badges.forEach((sp, i) => {
      const b = badges[i];
      sp.visible = !!b;
      if (!b) return;
      const t = badgeTexture(b.text);
      if (sp.material.map !== t.texture) {
        sp.material.map = t.texture;
        sp.material.needsUpdate = true;
        sp.aspect = t.aspect;
      }
      sp.position.set(b.x, b.y, b.z);
      this.ctx.fit(sp);
    });
    // Paint.
    let n = 0;
    s.cells.forEach((c, i) => {
      const fade = this.fades.get(i);
      if (!c.color && !fade) return;
      const x = i % s.width;
      const y = Math.floor(i / s.width);
      const [cx, cy, cz] = this.cell(x, y);
      const to = fade ? fade.to : colorOf(a.skin, c.color!);
      const k = fade ? fade.t : 1;
      const from = fade ? fade.from : null;
      const grow = from === null ? 0.3 + 0.7 * k : 1;
      this.paint.setMatrixAt(n, place(cx, cy + 0.005, cz, 0, grow, m4));
      this.tmpColor.setHex(to);
      if (from !== null) this.tmpColor.lerpColors(new THREE.Color(from), new THREE.Color(to), k);
      this.paint.setColorAt(n, this.tmpColor);
      n++;
    });
    this.paint.count = n;
    this.paint.instanceMatrix.needsUpdate = true;
    if (this.paint.instanceColor) this.paint.instanceColor.needsUpdate = true;
    // Glows of lit lamps, and the few real lights for the latest ones.
    while (this.glows.length < lit.length) {
      const g = this.ctx.glow(0xffffff, 1);
      this.glows.push(g);
      this.root.add(g);
    }
    this.glows.forEach((g, i) => {
      const l = lit[i];
      g.visible = !!l;
      if (!l) return;
      g.position.set(l.x, l.y, l.z);
      g.material.color.setHex(l.color);
      g.userData.size = l.size;
      g.scale.setScalar(l.size);
    });
    while (this.pools.length < lit.length) {
      const map = this.glows[0]!.material.map;
      const mat = new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
      const pool = new THREE.Mesh(this.poolGeometry, mat);
      pool.renderOrder = 2;
      this.pools.push(pool);
      this.root.add(pool);
    }
    this.pools.forEach((p, i) => {
      const l = lit[i];
      p.visible = !!l;
      if (!l) return;
      p.position.set(l.x, l.floor + 0.015, l.z);
      p.scale.setScalar(l.size * 0.8);
      (p.material as THREE.MeshBasicMaterial).color.setHex(l.color);
    });
    const order = [...lit].sort((p, q) => rank(this.litOrder, p.key) - rank(this.litOrder, q.key));
    this.ctx.lights.forEach((light, i) => {
      const l = order[i];
      light.intensity = l ? 2.2 : 0;
      if (l) {
        light.color.setHex(l.color);
        light.position.set(l.x, l.y + 0.15, l.z + 0.1);
      }
    });
  }

  /** The items drawn in a cell, for the layout. `held`: also the copies still falling into it. */
  private entriesAt(x: number, y: number, held = false): CellEntry[] {
    const a = this.ctx.assets;
    const cell = this.state.cells[x + y * this.state.width]!;
    const entries: CellEntry[] = [];
    for (const [name, count0] of Object.entries(cell.items)) {
      const count = count0 - (held ? 0 : this.hold.get(key(x, y, name)) ?? 0);
      if (count <= 0) continue;
      const asset = a.item(name);
      if (asset.def.hidden) continue;
      const e: CellEntry = { name, count, height: asset.height };
      if (asset.def.floor) e.floor = true;
      if (asset.def.pile) e.pile = asset.def.pile;
      if (asset.def.stackStep !== undefined) e.stackStep = asset.def.stackStep;
      if (asset.def.stay) e.stay = true;
      entries.push(e);
    }
    return entries;
  }

  /** Where an item stands in its cell, from the cell center (the first copy). */
  private spotOf(x: number, y: number, name: string, held = false): Placement | null {
    const { placements } = layoutCell(this.entriesAt(x, y, held), undefined, this.roomAt(x, y));
    return placements.find((p) => p.name === name) ?? null;
  }

  /**
   * How much the items of a cell make room for the character: 1 while it stands on the cell, 0 once
   * it is a cell away, eased between, so the items slide aside as it walks in and back as it leaves.
   * The side they go to is chosen when it comes near (away from where it comes from) and kept.
   */
  private roomAt(x: number, y: number): Room | undefined {
    const [cx, , cz] = this.cell(x, y);
    const i = x + y * this.state.width;
    const r = roomFor(this.mover.x - cx, this.mover.z - cz, this.away.get(i));
    if (r) this.away.set(i, r.away);
    else this.away.delete(i);
    return r;
  }

  /** The room of the cells around the character that have items to move, rounded (changes trigger a rebuild). */
  private roomSignature(): string {
    const s = this.state;
    const [w, h] = [s.width, s.height];
    const parts: string[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const items = s.cells[x + y * w]!.items;
        let any = false;
        for (const n in items) if ((items[n] ?? 0) > 0) any = true;
        if (!any) continue;
        const r = this.roomAt(x, y);
        if (r) parts.push(`${x},${y}:${r.k.toFixed(3)}`);
      }
    }
    return parts.join(' ');
  }

  /** The items the robot carries, small, above its head. */
  private rebuildCarried(): void {
    this.carriedDirty = false;
    for (const c of [...this.carried.children]) {
      c.removeFromParent();
      if (c instanceof ScreenSprite) c.material.dispose();
    }
    const a = this.ctx.assets;
    const list = Object.entries(this.state.inventory)
      .filter(([name, n]) => n > 0 && !a.item(name).def.hidden && !a.item(name).fallback)
      .sort(([p], [q]) => (p < q ? -1 : 1))
      .slice(0, 4);
    const k = 0.42;
    list.forEach(([name, count], i) => {
      const asset = a.item(name);
      const g = new THREE.Group();
      g.add(copyObject(asset.object));
      const s = k / Math.max(1, asset.height * 1.4);
      g.scale.setScalar(s);
      g.position.x = (i - (list.length - 1) / 2) * 0.36;
      this.carried.add(g);
      if (count > 1) {
        const b = badgeTexture(String(count));
        const sp = new ScreenSprite(b.texture, b.aspect, 0.2, 16, 26, { onTop: true });
        sp.position.set(g.position.x + 0.14, 0.26, 0.05);
        this.carried.add(sp);
        this.ctx.fit(sp);
      }
    });
  }

  dispose(): void {
    this.floor.dispose();
    for (const it of this.statics) it.dispose();
    for (const it of this.items.values()) it.dispose();
    this.paint.geometry.dispose();
    (this.paint.material as THREE.Material).dispose();
    this.paint.dispose();
    for (const b of this.badges) b.material.dispose();
    for (const g of this.glows) g.material.dispose();
    for (const p of this.pools) (p.material as THREE.Material).dispose();
    this.poolGeometry.dispose();
    for (const l of this.labels) disposeObject(l);
    for (const c of this.carried.children) if (c instanceof ScreenSprite) c.material.dispose();
    this.bubble.clear();
    this.clearFlying();
    this.mover.visual.dispose?.();
    for (const light of this.ctx.lights) light.intensity = 0;
    this.root.clear();
    void this.time;
  }
}

const rank = (order: string[], k: string): number => {
  const i = order.indexOf(k);
  return i < 0 ? 1e6 : i;
};

/** The signed turn from one facing to another: ±90° for a quarter turn, 180° for a half turn. */
function angleTo(from: Direction, to: Direction): number {
  const order: Direction[] = ['N', 'E', 'S', 'W'];
  const d = (order.indexOf(to) - order.indexOf(from) + 4) % 4;
  // Clockwise on screen (N → E) turns the heading by −90° (heading 0 faces +z, the camera).
  return d === 1 ? -Math.PI / 2 : d === 3 ? Math.PI / 2 : d === 2 ? -Math.PI : 0;
}
