/**
 * A minimal fixed-camera adventure on top of the engine: the reference for building a game with it.
 *
 * It plays the project the editor is working on (or `?project=<url of a .json>`):
 * - the player spawns at the start scene's player entity, with that entity's figure;
 * - tank controls: W/S or ↑/↓ walk forward and back, A/D or ←/→ turn, Shift runs;
 * - each scene's fixed cameras switch by zone: the camera whose (x, z) rectangle holds the player;
 * - E (or Enter / Space) uses the closest note, item or door: notes are read, items go to the
 *   inventory, doors check `requires` (an item name) and take the player to `destination`/`entry`;
 * - R restarts. Creatures just stand and play their idle clip: game logic is up to each game.
 */
import * as THREE from 'three';
import {
  buildHeightmap,
  figureOf,
  heightAt,
  modelOf,
  moveBody,
  poseOf,
  sceneOf,
  validate,
  type Camera,
  type Entity,
  type Figure,
  type Heightmap,
  type Project,
  type Scene,
  type V3,
} from '../../src/core/index.js';
import { buildScene, Figure3D, flickerAt, placeModel, View, type BuiltScene } from '../../src/render/index.js';
import { starterProject } from '../../editor/starter.js';
import { loadCurrentProject, parseProject } from '../../editor/storage.js';

const TICK = 1 / 60;
const RADIUS = 0.2;
const HEIGHT = 1.7;
const WALK_SPEED = 1.5;
const RUN_SPEED = 2.9;
const BACK_SPEED = 0.9;
const TURN_SPEED = 2.5;
const USE_RANGE = 1.25;
const MESSAGE_SECONDS = 5;

/** Clip names, in order of preference; projects migrated from the Spanish format keep theirs. */
const CLIPS = {
  idle: ['idle', 'reposo'],
  walk: ['walk', 'andar'],
  run: ['run', 'correr', 'walk', 'andar'],
};

/** The first of `names` the figure has, else its first clip (poseOf falls back to it too). */
function clipFor(f: Figure, names: string[]): string {
  return names.find((n) => f.clips.some((c) => c.name === n)) ?? f.clips[0]?.name ?? '';
}

export interface Input {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  /** True for a single tick per key press. */
  use: boolean;
}

/** A character on screen: where it stands and what it is playing. */
interface Body {
  entity: Entity;
  model: Figure3D;
  pos: V3;
  heading: number;
  clip: string;
  t: number;
}

const inZone = (c: Camera, x: number, z: number): boolean =>
  x >= c.zone.min[0] && x <= c.zone.max[0] && z >= c.zone.min[1] && z <= c.zone.max[1];

export class Adventure {
  scene!: Scene;
  player!: Body;
  creatures: Body[] = [];
  camera: Camera | null = null;
  inventory: string[] = [];
  /** `scene/entity` ids of the items already picked up. */
  taken = new Set<string>();
  message = '';
  private messageLeft = 0;
  private map!: Heightmap;
  private built: BuiltScene | null = null;
  private items = new Map<string, THREE.Object3D>();
  private playerFigure: Figure;
  private time = 0;

  constructor(readonly project: Project, private view: View) {
    const start = sceneOf(project, project.startScene);
    const spawn = start.entities.find((x) => x.kind === 'player');
    if (!spawn?.figure) throw new Error(`The start scene "${start.name}" needs a player entity with a figure`);
    this.playerFigure = figureOf(project, spawn.figure);
    this.restart();
  }

  restart(): void {
    this.inventory = [];
    this.taken.clear();
    this.say('');
    const start = sceneOf(this.project, this.project.startScene);
    this.enter(start, start.entities.find((x) => x.kind === 'player')!);
  }

  say(text: string): void {
    this.message = text;
    this.messageLeft = text ? MESSAGE_SECONDS : 0;
  }

  /** Builds a scene and puts the player at `at` (an entity of that scene). */
  enter(scene: Scene, at: Entity): void {
    const p = this.project;
    const v = this.view;
    if (this.built) v.scene.remove(this.built.group);
    this.scene = scene;
    this.map = buildHeightmap(p, scene);
    this.built = buildScene(p, scene);
    v.scene.add(this.built.group);
    v.scene.fog = new THREE.FogExp2(scene.fog.color, scene.fog.density);
    v.scene.background = new THREE.Color(0x020203);

    this.items.clear();
    this.creatures = [];
    for (const x of scene.entities) {
      if (x.kind === 'creature' && x.figure) {
        const figure = figureOf(p, x.figure);
        this.creatures.push(this.spawn(x, figure, clipFor(figure, CLIPS.idle)));
      } else if (x.kind !== 'player' && x.model && !this.taken.has(`${scene.id}/${x.id}`)) {
        const o = placeModel(modelOf(p, x.model), x.pos, 0);
        o.rotation.y = x.heading;
        this.built.group.add(o);
        this.items.set(x.id, o);
      }
    }
    this.player = this.spawn(at, this.playerFigure, clipFor(this.playerFigure, CLIPS.idle));
    this.camera = this.pickCamera();
  }

  private spawn(x: Entity, figure: Figure, clip: string): Body {
    const model = new Figure3D(this.project, figure);
    this.built!.group.add(model);
    const pos: V3 = [...x.pos];
    // Stand on the actual floor, whatever height the entity was placed at.
    pos[1] = heightAt(this.map, pos[0], pos[2], 0.01, 1e6, 0) ?? pos[1];
    return { entity: x, model, pos, heading: x.heading, clip, t: 0 };
  }

  /** Keeps the current camera while the player stays in its zone, so overlapping zones do not flicker. */
  private pickCamera(): Camera | null {
    const cams = this.scene.cameras;
    const [x, , z] = this.player.pos;
    if (this.camera && cams.includes(this.camera) && inZone(this.camera, x, z)) return this.camera;
    return cams.find((c) => inZone(c, x, z)) ?? (this.camera && cams.includes(this.camera) ? this.camera : cams[0] ?? null);
  }

  /** The note, item or door within reach, closest first. */
  usable(): Entity | null {
    const [px, , pz] = this.player.pos;
    let best: Entity | null = null;
    let bestDistance = USE_RANGE;
    for (const x of this.scene.entities) {
      if (x.kind !== 'note' && x.kind !== 'item' && x.kind !== 'door') continue;
      if (this.taken.has(`${this.scene.id}/${x.id}`)) continue;
      const d = Math.hypot(x.pos[0] - px, x.pos[2] - pz);
      if (d < bestDistance) {
        bestDistance = d;
        best = x;
      }
    }
    return best;
  }

  private use(x: Entity): void {
    if (x.kind === 'note') {
      this.say(x.text ?? x.name);
    } else if (x.kind === 'item') {
      this.inventory.push(x.name);
      this.taken.add(`${this.scene.id}/${x.id}`);
      const o = this.items.get(x.id);
      if (o) o.visible = false;
      this.say(`You take: ${x.name}`);
    } else if (x.requires && !this.inventory.includes(x.requires)) {
      this.say(x.lockedText ?? 'It is locked.');
    } else {
      this.say(x.text ?? '');
      const destination = this.project.scenes.find((s) => s.id === x.destination);
      const entry = destination?.entities.find((e) => e.id === x.entry);
      if (destination && entry) this.enter(destination, entry);
      else if (!x.text) this.say('It does not open.');
    }
  }

  /** Advances the game one fixed tick. */
  step(input: Input): void {
    this.time += TICK;
    if (this.messageLeft > 0 && (this.messageLeft -= TICK) <= 0) this.message = '';

    const pl = this.player;
    if (input.left) pl.heading += TURN_SPEED * TICK;
    if (input.right) pl.heading -= TURN_SPEED * TICK;
    const forward = input.forward && !input.back;
    const back = input.back && !input.forward;
    const running = forward && input.run;
    const speed = forward ? (running ? RUN_SPEED : WALK_SPEED) : back ? -BACK_SPEED : 0;
    if (speed !== 0) {
      const d = speed * TICK;
      moveBody(this.map, pl.pos, Math.sin(pl.heading) * d, Math.cos(pl.heading) * d, RADIUS, HEIGHT);
    }
    const f = this.playerFigure;
    const clip = running ? clipFor(f, CLIPS.run) : speed !== 0 || input.left || input.right ? clipFor(f, CLIPS.walk) : clipFor(f, CLIPS.idle);
    if (clip !== pl.clip) {
      pl.clip = clip;
      pl.t = 0;
    }
    // Walking backward plays the walk clip in reverse.
    pl.t += back ? -TICK : TICK;
    for (const c of this.creatures) c.t += TICK;

    if (input.use) {
      const x = this.usable();
      if (x) this.use(x);
    }
    this.camera = this.pickCamera();
  }

  render(): void {
    const v = this.view;
    for (const b of [this.player, ...this.creatures]) {
      b.model.position.set(...b.pos);
      b.model.rotation.y = b.heading;
      b.model.applyPose(poseOf(b.model.figure, b.clip, b.t));
    }
    const k = this.camera;
    if (k) {
      v.camera.position.set(...k.pos);
      v.camera.lookAt(...k.target);
      if (v.camera.fov !== k.fov) {
        v.camera.fov = k.fov;
        v.camera.updateProjectionMatrix();
      }
    }
    for (const l of this.built?.lights ?? []) {
      l.object.intensity = l.data.intensity * flickerAt(this.time + l.data.pos[0], l.data.flicker);
    }
    const lantern = this.player.model.light;
    if (lantern) lantern.intensity = this.playerFigure.lantern!.intensity * flickerAt(this.time, 1);
    v.render(this.time);
  }
}

// ---------------------------------------------------------------------------------------------
// The page: loading, keyboard, HUD and the main loop.

const $ = (id: string): HTMLElement => document.getElementById(id)!;

async function loadProject(): Promise<Project> {
  const url = new URLSearchParams(location.search).get('project');
  if (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Could not load ${url}: ${r.status} ${r.statusText}`);
    return parseProject(await r.json());
  }
  return (await loadCurrentProject()).project ?? starterProject();
}

async function main(): Promise<void> {
  const project = await loadProject();
  const problems = validate(project);
  if (problems.length) console.warn(`Project warnings:\n${problems.join('\n')}`);

  const view = new View($('canvas') as HTMLCanvasElement);
  const game = new Adventure(project, view);
  const frame = $('frame');
  const resize = (): void => {
    const r = frame.getBoundingClientRect();
    view.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
  };
  window.addEventListener('resize', resize);
  resize();

  const keys = new Set<string>();
  let use = false;
  window.addEventListener('keydown', (ev) => {
    if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
    if (ev.repeat) return;
    keys.add(ev.code);
    if (ev.code === 'KeyE' || ev.code === 'Enter' || ev.code === 'Space') use = true;
    if (ev.code === 'KeyR') game.restart();
  });
  window.addEventListener('keyup', (ev) => keys.delete(ev.code));
  window.addEventListener('blur', () => keys.clear());
  const held = (...codes: string[]): boolean => codes.some((c) => keys.has(c));

  let shownInventory = '-';
  const hud = (): void => {
    $('message').textContent = game.message;
    const near = game.usable();
    $('prompt').textContent = near && !game.message ? `E · ${near.name}` : '';
    const inventory = game.inventory.join('|');
    if (inventory !== shownInventory) {
      shownInventory = inventory;
      $('inventory').replaceChildren(
        ...game.inventory.map((name) => Object.assign(document.createElement('div'), { className: 'slot', textContent: name })),
      );
    }
  };

  let previous = performance.now();
  let pending = 0;
  const loop = (now: number): void => {
    requestAnimationFrame(loop);
    pending += Math.min(0.1, (now - previous) / 1000);
    previous = now;
    while (pending >= TICK) {
      pending -= TICK;
      game.step({
        forward: held('KeyW', 'ArrowUp'),
        back: held('KeyS', 'ArrowDown'),
        left: held('KeyA', 'ArrowLeft'),
        right: held('KeyD', 'ArrowRight'),
        run: held('ShiftLeft', 'ShiftRight'),
        use,
      });
      use = false;
    }
    game.render();
    hud();
  };
  requestAnimationFrame(loop);

  if (import.meta.env.DEV) Object.assign(window, { __adventure: game });
  document.body.dataset.ready = '1';
}

main().catch((e: unknown) => {
  const el = $('error');
  el.style.display = 'grid';
  el.textContent = `The game could not start.\n\n${String(e)}`;
});
