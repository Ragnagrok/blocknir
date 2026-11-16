/** Builds and caches what a skin makes (one object per name), and the floors shared by every stage. */
import * as THREE from 'three';
import type { Labels } from '../blocks/index.js';
import { hash3 } from '../paint/index.js';
import { decorSpots } from './models.js';
import { disposeObject, InstancedTemplate, isCharacter, propCharacter } from './pieces.js';
import { actorOf, glowOf, itemContext, terrainOf, type CharacterVisual, type ActorDef, type Environment, type Glow, type ItemContext, type ItemDef, type Skin, type TerrainDef } from './skin.js';

export interface ItemAsset {
  ctx: ItemContext;
  def: ItemDef;
  glow: Glow | null;
  object: THREE.Object3D;
  /** Height of the model, in meters. */
  height: number;
  fallback: boolean;
}

/** One per board view: the skin's objects, built on first use and disposed with the view. */
export class AssetCache {
  private items = new Map<string, ItemAsset>();
  private objects = new Map<string, THREE.Object3D | null>();
  /** Sky, sea, sand, light and decor now (the skin's, until the view changes them). */
  environment: Environment;
  /** Whether floors get decor around them. */
  showDecor = true;

  constructor(
    readonly skin: Skin,
    public labels: Labels | null,
  ) {
    this.environment = skin.environment;
  }

  /** Changes the environment; decor objects are rebuilt on next use. */
  setEnvironment(env: Environment): void {
    this.environment = env;
    for (const [k, o] of this.objects) {
      if (!k.startsWith('decor:')) continue;
      if (o) disposeObject(o);
      this.objects.delete(k);
    }
  }

  /** The level's word for a name (`labels.names`), or the name. */
  label(name: string): string {
    return this.labels?.names[name] ?? name;
  }

  item(name: string): ItemAsset {
    let a = this.items.get(name);
    if (!a) {
      const { ctx, def, fallback } = itemContext(this.skin, name, this.label(name));
      const object = def.hidden ? new THREE.Group() : def.create(ctx);
      const box = new THREE.Box3().setFromObject(object, true);
      const height = Number.isFinite(box.max.y) ? Math.max(0.1, box.max.y) : 0.5;
      a = { ctx, def, glow: glowOf(def, ctx), object, height, fallback };
      this.items.set(name, a);
    }
    return a;
  }

  terrain(name: string | null): { key: string; def: TerrainDef } {
    return terrainOf(this.skin, name);
  }

  private once(key: string, build: () => THREE.Object3D | null): THREE.Object3D | null {
    if (!this.objects.has(key)) this.objects.set(key, build());
    return this.objects.get(key)!;
  }

  tile(key: string, shade: 0 | 1): THREE.Object3D {
    return this.once(`tile:${key}:${shade}`, () => this.skin.terrain[key]!.tile(shade))!;
  }

  block(key: string): THREE.Object3D | null {
    return this.once(`block:${key}`, () => this.skin.terrain[key]?.block?.() ?? null);
  }

  wall(): THREE.Object3D {
    return this.once('wall', () => this.skin.wall())!;
  }

  arrow(): THREE.Object3D {
    return this.once('arrow', () => this.skin.arrow())!;
  }

  decor(i: number): THREE.Object3D | null {
    const list = this.environment.decor ?? [];
    if (!list.length) return null;
    const k = ((i % list.length) + list.length) % list.length;
    return this.once(`decor:${k}`, () => list[k]!());
  }

  /** A new character (each stage owns and disposes its characters). */
  character(world: 'grid' | 'turtle' | 'realtime', name?: string, kind = 'player', look: string | null = null): CharacterVisual {
    const key = name && this.skin.characters[name] ? name : this.skin.character[world];
    const f = this.skin.characters[key] ?? Object.values(this.skin.characters)[0];
    if (!f) throw new Error(`Skin ${this.skin.name} has no characters`);
    return f({ world, kind, look });
  }

  /** A new realtime actor of a kind. Characters of the skin can be actors too. */
  actor(kind: string, look: string | null): { visual: CharacterVisual; def: ActorDef } {
    if (this.skin.characters[kind]) {
      return { visual: this.character('realtime', kind, kind, look), def: { create: () => new THREE.Group() } };
    }
    const { def } = actorOf(this.skin, kind, look, this.label(kind));
    const made = def.create({ kind, look, label: this.label(kind) });
    const visual = isCharacter(made) ? made : propCharacter(made, new THREE.Box3().setFromObject(made, true).max.y || 0.6);
    return { visual, def };
  }

  dispose(): void {
    for (const a of this.items.values()) disposeObject(a.object);
    for (const o of this.objects.values()) if (o) disposeObject(o);
    this.items.clear();
    this.objects.clear();
  }
}

/** Center of cell (x, y) in meters, for a board of `width` × `height` cells centered on the origin. */
export const cellCenter = (x: number, y: number, width: number, height: number): [number, number] => [x - (width - 1) / 2, y - (height - 1) / 2];

export interface Floor {
  group: THREE.Group;
  /** Tiles that bob (water). */
  waves: THREE.Group;
  /** Floor height of each cell. */
  level: (x: number, y: number) => number;
  dispose(): void;
}

const q = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);

/** Matrix for a position, a turn around y and a uniform scale. */
export function place(x: number, y: number, z: number, rotY = 0, scale = 1, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rotY), new THREE.Vector3(scale, scale, scale));
}

/**
 * Tiles for every cell (instanced per terrain and shade), blocks on wall cells, the beach around
 * the board and some decor on it.
 */
export function buildFloor(
  assets: AssetCache,
  width: number,
  height: number,
  terrainAt: (x: number, y: number) => string | null,
  wallAt: (x: number, y: number) => boolean,
  options: { rim?: number; decor?: boolean } = {},
): Floor {
  const group = new THREE.Group();
  const waves = new THREE.Group();
  group.add(waves);
  const templates: InstancedTemplate[] = [];
  const batches = new Map<string, { object: THREE.Object3D; wave: boolean; matrices: THREE.Matrix4[] }>();
  const add = (key: string, object: THREE.Object3D, wave: boolean, m: THREE.Matrix4): void => {
    let b = batches.get(key);
    if (!b) batches.set(key, (b = { object, wave, matrices: [] }));
    b.matrices.push(m);
  };
  const levels: number[] = [];
  const skin = assets.skin;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wall = wallAt(x, y);
      const name = terrainAt(x, y) ?? (wall ? skin.wallTerrain : null);
      const t = assets.terrain(name);
      const level = t.def.level ?? 0;
      levels[x + y * width] = level;
      const [cx, cz] = cellCenter(x, y, width, height);
      const shade = ((x + y) % 2) as 0 | 1;
      add(`tile:${t.key}:${shade}`, assets.tile(t.key, shade), !!t.def.wave, place(cx, level, cz));
      if (wall) {
        const block = assets.block(t.key);
        if (block) add(`block:${t.key}`, block, false, place(cx, level, cz, (Math.floor(hash3(x, y, 5) * 4) * Math.PI) / 2, 0.92 + hash3(y, x, 2) * 0.12));
      }
    }
  }
  for (const b of batches.values()) {
    const it = new InstancedTemplate(b.object);
    it.set(b.matrices);
    (b.wave ? waves : group).add(it.group);
    templates.push(it);
  }
  // The beach: a slab under the board, a bit larger, and a wet edge below it.
  const rim = options.rim ?? 0.7;
  const sand = new THREE.Mesh(
    new THREE.BoxGeometry(width + rim * 2, 0.5, height + rim * 2),
    new THREE.MeshStandardMaterial({ color: assets.environment.sand, roughness: 0.95 }),
  );
  sand.position.y = -0.36 - 0.25 + 0.12;
  sand.receiveShadow = true;
  group.add(sand);
  const wet = new THREE.Mesh(
    new THREE.BoxGeometry(width + rim * 2 + 0.6, 0.3, height + rim * 2 + 0.6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(assets.environment.sand).multiplyScalar(0.86), roughness: 0.9 }),
  );
  wet.position.y = -0.62;
  wet.receiveShadow = true;
  group.add(wet);
  if (options.decor !== false && assets.showDecor) {
    // Decor order (see `Environment.decor`): entries 0 and 1 only behind the board, 2 and 3 anywhere.
    const kinds = new Map<number, THREE.Matrix4[]>();
    for (const s of decorSpots(width, height, rim)) {
      // Tall decor (palms) only at the back, so nothing hides the board.
      const front = s.z > -height / 2;
      const kind = front ? 2 + (s.kind % 2) : s.kind % 4;
      const list = kinds.get(kind) ?? [];
      list.push(place(s.x, -0.24, s.z, s.rot, 0.85 + (s.kind % 7) * 0.04));
      kinds.set(kind, list);
    }
    for (const [kind, matrices] of kinds) {
      const o = assets.decor(kind);
      if (!o) continue;
      const it = new InstancedTemplate(o);
      it.set(matrices);
      group.add(it.group);
      templates.push(it);
    }
  }
  return {
    group,
    waves,
    level: (x, y) => levels[x + y * width] ?? 0,
    dispose: () => {
      for (const t of templates) t.dispose();
      sand.geometry.dispose();
      (sand.material as THREE.Material).dispose();
      wet.geometry.dispose();
      (wet.material as THREE.Material).dispose();
    },
  };
}
