/**
 * Skins map the names a world uses (items, terrain, actor kinds, colors) to visuals. A skin is a
 * set of factories that return three.js objects; the board view builds each name once and
 * instances it. Unknown names fall back to a labeled marker, so any level renders.
 */
import type * as THREE from 'three';
import { Box3 } from 'three';
import type { Figure, Project } from '../core/index.js';
import { figureCharacter, isCharacter, propCharacter } from './pieces.js';

/** What the view knows about an item name when it asks a skin to build it. */
export interface ItemContext {
  /** The name used by the world: `pcOn`, `textA`, `lamp3`, `apples`. */
  name: string;
  /** The skin key it resolved to (`computer` for `pcOn`), or the name itself for a fallback. */
  key: string;
  /** From an `On` / `Off` suffix (`lampOn`, `pcOff`). */
  state: 'on' | 'off' | null;
  /** From trailing digits (`lamp3` → 3). */
  index: number | null;
  /** From a trailing capital letter (`textA` → `A`). */
  letter: string | null;
  /** Text for labels: the level's name for it (`labels.names`) or the name. */
  label: string;
}

/** A soft additive glow (and maybe a real point light) at a height above the item's base. */
export interface Glow {
  color: number;
  /** Meters above the floor. */
  height: number;
  /** Sprite size in meters. Default 1.1. */
  size?: number;
}

/** How an item looks. Models stand on y = 0, centered on the cell, facing +z (the camera). */
export interface ItemDef {
  create(ctx: ItemContext): THREE.Object3D;
  /** It glows (lit lamps). A function can glow only in some states. */
  glow?: Glow | ((ctx: ItemContext) => Glow | null);
  /** How several copies on one cell look: piled up, scattered, or one model and a number. Default `spread`. */
  pile?: 'stack' | 'spread' | 'single';
  /** Height of one copy, for `stack`. Default 0.18. */
  stackStep?: number;
  /** Lies flat on the floor (crumbs, a rug, a dock): drawn under the other items without taking a slot. */
  floor?: boolean;
  /** Never drawn (state flags such as `lying` or `asleep`). */
  hidden?: boolean;
}

/** One kind of floor. */
export interface TerrainDef {
  /** A 1 × 1 m tile whose top is at y = 0 and that is about 0.4 m deep. `shade` alternates like a checkerboard. */
  tile(shade: 0 | 1): THREE.Object3D;
  /** Height of the top, in meters (water sits lower). Default 0. */
  level?: number;
  /** What stands on the cell when it is a wall cell (a boulder, a bush). Null for nothing (water). */
  block?: (() => THREE.Object3D) | null;
  /** The tiles bob gently (water). */
  wave?: boolean;
}

/** Clip names the view asks characters for; a character falls back to `idle` for the ones it lacks. */
export type CharacterClip = 'idle' | 'walk' | 'jump' | 'pick' | 'drop' | 'light' | 'paint' | 'action' | 'talk' | 'cheer' | 'sad' | 'bump';

/** An animated character: the robot, the turtle, the player and other actors. */
export interface CharacterVisual {
  /** Feet on y = 0, facing +z. */
  object: THREE.Object3D;
  /** Meters, for placing speech bubbles and what it carries. */
  height: number;
  /** Poses it: `clip` at `t` seconds. */
  pose(clip: CharacterClip | string, t: number): void;
  /** Turtle: lowers or raises the chalk, in this color. */
  setPen?(down: boolean, color: number): void;
  /** Turtle: meters in front of the origin where the chalk touches the floor. Default 0. */
  tip?: number;
  /** Realtime: the actor's look changed (`look` command); null is the default look. */
  setLook?(look: string | null): void;
  dispose?(): void;
}

export type CharacterFactory = (ctx: { world: 'grid' | 'turtle' | 'realtime'; kind: string; look: string | null }) => CharacterVisual;

/** What the view knows about a realtime actor kind. */
export interface ActorContext {
  kind: string;
  look: string | null;
  label: string;
}

/** A realtime actor kind. */
export interface ActorDef {
  create(ctx: ActorContext): CharacterVisual | THREE.Object3D;
  /** Small and fast (shots, drops): glides and spins, no walk. */
  projectile?: boolean;
  /** Floats this many meters above the floor (clouds, birds). */
  fly?: number;
  glow?: Glow;
}

/** Sky, sea and light. */
export interface Environment {
  sky: number;
  sea: number;
  /** The beach around the board. */
  sand: number;
  sun: { color: number; intensity: number };
  ambient: { sky: number; ground: number; intensity: number };
  /** Props scattered on the beach around the board (palms, rocks). */
  decor?: Array<() => THREE.Object3D>;
}

export interface Skin {
  name: string;
  items: Record<string, ItemDef>;
  /** Other names for items: `{ pc: 'computer', apples: 'apple' }`. */
  aliases?: Record<string, string>;
  /** Builds the look of an item no entry matches (a labeled marker). */
  fallbackItem(ctx: ItemContext): ItemDef;
  terrain: Record<string, TerrainDef>;
  /** Floor of cells without terrain. */
  defaultTerrain: string;
  /** Floor under wall cells without terrain (their `block` stands on it). */
  wallTerrain: string;
  /** Turtle floor. */
  patioTerrain: string;
  /** A wall between two cells: 1 m long along x, centered on the origin. */
  wall(): THREE.Object3D;
  /** An arrow lying on the floor, pointing east (+x). */
  arrow(): THREE.Object3D;
  characters: Record<string, CharacterFactory>;
  /** Which character each world uses (a level picks another with `meta.character`). */
  character: { grid: string; turtle: string; realtime: string };
  actors: Record<string, ActorDef>;
  fallbackActor(ctx: ActorContext): ActorDef;
  /** Paint and chalk colors by name. Unknown names get a stable color from their hash. */
  colors: Record<string, number>;
  environment: Environment;
}

/** A partial skin to lay over another one with `mergeSkin` (strict entries; see `extendSkin` for shorthands). */
export type SkinOverrides = Partial<Omit<Skin, 'items' | 'aliases' | 'terrain' | 'characters' | 'actors' | 'colors' | 'character' | 'environment'>> & {
  items?: Record<string, ItemDef>;
  aliases?: Record<string, string>;
  terrain?: Record<string, TerrainDef>;
  characters?: Record<string, CharacterFactory>;
  actors?: Record<string, ActorDef>;
  colors?: Record<string, number>;
  character?: Partial<Skin['character']>;
  environment?: Partial<Environment>;
};

/** A skin with some entries replaced or added: `mergeSkin(defaultSkin(), { items: { apple: myApple } })`. */
export function mergeSkin(base: Skin, over: SkinOverrides): Skin {
  return {
    ...base,
    ...over,
    items: { ...base.items, ...over.items },
    aliases: { ...base.aliases, ...over.aliases },
    terrain: { ...base.terrain, ...over.terrain },
    characters: { ...base.characters, ...over.characters },
    actors: { ...base.actors, ...over.actors },
    colors: { ...base.colors, ...over.colors },
    character: { ...base.character, ...over.character },
    environment: { ...base.environment, ...over.environment },
  };
}

/** How a name was understood. `key` is null when nothing matched. */
export interface ResolvedName {
  key: string | null;
  state: 'on' | 'off' | null;
  index: number | null;
  letter: string | null;
}

/**
 * Finds the entry for a world name in a table: exactly, through `aliases`, ignoring case, and then
 * after peeling common decorations: `On` / `Off` suffixes (`pcOn`), trailing digits (`lamp3`), a
 * trailing capital letter (`textA`), plurals (`apples`, `boxes`) and camel-case words (`lensPlaced`
 * → `lens`, `bigApple` → `apple`). Pure.
 */
export function resolveName(name: string, has: (key: string) => boolean, aliases: Record<string, string> = {}): ResolvedName {
  const lowerKeys = new Map<string, string>();
  const find = (n: string): string | null => {
    if (!n) return null;
    if (has(n)) return n;
    const a = aliases[n];
    if (a !== undefined && has(a)) return a;
    const lower = n.toLowerCase();
    if (lowerKeys.size === 0) {
      for (const k of Object.keys(aliases)) lowerKeys.set(k.toLowerCase(), aliases[k]!);
    }
    const viaAlias = lowerKeys.get(lower);
    if (viaAlias !== undefined && has(viaAlias)) return viaAlias;
    if (has(lower)) return lower;
    return null;
  };
  const out: ResolvedName = { key: null, state: null, index: null, letter: null };
  const direct = find(name);
  if (direct) return { ...out, key: direct };
  let base = name;
  // `lampOn`, `pcOff`, `pc_off`; not `bacon` or `moon`.
  const state = /^(.*[a-z0-9])(On|Off)$/.exec(base) ?? /^(.+)[-_](on|off)$/i.exec(base);
  if (state) {
    base = state[1]!;
    out.state = state[2]!.toLowerCase() as 'on' | 'off';
  }
  const digits = /^(.*?[^\d])(\d+)$/.exec(base);
  if (digits) {
    base = digits[1]!;
    out.index = Number(digits[2]);
  }
  const letter = /^([a-z][a-zA-Z]*?[a-z])([A-Z0-9])$/.exec(base);
  if (letter) {
    const tried = find(letter[1]!);
    if (tried) return { ...out, key: tried, letter: letter[2]! };
  }
  const candidates: string[] = [base];
  if (/ies$/.test(base)) candidates.push(base.replace(/ies$/, 'y'));
  if (/(s|x|z|ch|sh)es$/.test(base)) candidates.push(base.replace(/es$/, ''));
  if (/s$/.test(base) && !/ss$/.test(base)) candidates.push(base.replace(/s$/, ''));
  const words = base.split(/(?=[A-Z])|[-_ ]+/).filter(Boolean);
  if (words.length > 1) {
    candidates.push(words[words.length - 1]!.toLowerCase(), words[0]!.toLowerCase());
    const last = words[words.length - 1]!.toLowerCase();
    if (/s$/.test(last)) candidates.push(last.replace(/s$/, ''));
  }
  for (const c of candidates) {
    const k = find(c);
    if (k) return { ...out, key: k };
  }
  if (letter) {
    // No base matched, but keep the letter for the fallback marker.
    out.letter = letter[2]!;
  }
  return out;
}

/** The item context for a name in a skin (without building anything). */
export function itemContext(skin: Skin, name: string, label?: string): { ctx: ItemContext; def: ItemDef; fallback: boolean } {
  const r = resolveName(name, (k) => Object.prototype.hasOwnProperty.call(skin.items, k), skin.aliases);
  const ctx: ItemContext = { name, key: r.key ?? name, state: r.state, index: r.index, letter: r.letter, label: label ?? name };
  if (r.key) return { ctx, def: skin.items[r.key]!, fallback: false };
  return { ctx, def: skin.fallbackItem(ctx), fallback: true };
}

/** The glow of an item in a context, if it has one. */
export function glowOf(def: ItemDef, ctx: ItemContext): Glow | null {
  if (!def.glow) return null;
  return typeof def.glow === 'function' ? def.glow(ctx) : def.glow;
}

/** The terrain entry for a name, falling back to the default terrain. */
export function terrainOf(skin: Skin, name: string | null): { key: string; def: TerrainDef } {
  if (name) {
    const r = resolveName(name, (k) => Object.prototype.hasOwnProperty.call(skin.terrain, k), skin.aliases);
    if (r.key) return { key: r.key, def: skin.terrain[r.key]! };
  }
  const key = skin.defaultTerrain;
  const def = skin.terrain[key];
  if (!def) throw new Error(`Skin ${skin.name} has no default terrain ${key}`);
  return { key, def };
}

/** The actor entry for a kind: the actor table, then the item table (falling apples), then the fallback. */
export function actorOf(skin: Skin, kind: string, look: string | null, label?: string): { def: ActorDef; source: 'actor' | 'item' | 'fallback' } {
  const ctx: ActorContext = { kind, look, label: label ?? kind };
  const a = resolveName(kind, (k) => Object.prototype.hasOwnProperty.call(skin.actors, k), skin.aliases);
  if (a.key) return { def: skin.actors[a.key]!, source: 'actor' };
  const i = resolveName(kind, (k) => Object.prototype.hasOwnProperty.call(skin.items, k), skin.aliases);
  if (i.key) {
    const item = skin.items[i.key]!;
    const ictx: ItemContext = { name: kind, key: i.key, state: i.state, index: i.index, letter: i.letter, label: ctx.label };
    const glow = glowOf(item, ictx);
    return { def: { create: () => item.create(ictx), ...(glow ? { glow } : {}) }, source: 'item' };
  }
  return { def: skin.fallbackActor(ctx), source: 'fallback' };
}

/** A stable, friendly color for any name: its hash picks a hue. */
export function hashColor(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 360;
  return hsl(hue, 0.62, 0.56);
}

/** HSL (0..1 each) to RGB. */
export function hsl(h: number, s: number, l: number): number {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** A paint or chalk color: the skin's table (any case), a `#rrggbb` code, or a stable hashed color. */
export function colorOf(skin: Pick<Skin, 'colors'>, name: string): number {
  const c = skin.colors[name] ?? skin.colors[name.toLowerCase()];
  if (c !== undefined) return c;
  const hex = /^#?([0-9a-f]{6})$/i.exec(name);
  if (hex) return parseInt(hex[1]!, 16);
  return hashColor(name);
}

// ---------------------------------------------------------------------------------------------
// Extending skins with shorthands
// ---------------------------------------------------------------------------------------------

/** An item: a full definition, or just a factory (`() => myAppleObject`). */
export type ItemLike = ItemDef | ((ctx: ItemContext) => THREE.Object3D);

/** A rigged figure from the editor or `createHumanoid`, as a character. */
export interface FigureSpec {
  project: Project;
  /** The figure, or its id in `project`. */
  figure: Figure | string;
  /** Uniform scale of the whole figure. Default 1. */
  scale?: number;
  /** Standing height in meters after scaling (for bubbles). Default 1. */
  height?: number;
}

/** A character: a full factory, a factory of a plain object (it bobs and squashes), or a figure. */
export type CharacterLike = CharacterFactory | ((ctx: Parameters<CharacterFactory>[0]) => THREE.Object3D | CharacterVisual) | FigureSpec;

/** An actor kind: a full definition, or a factory of an object or a character. */
export type ActorLike = ActorDef | ((ctx: ActorContext) => THREE.Object3D | CharacterVisual);

/** A terrain: a full definition, or a tile factory. */
export type TerrainLike = TerrainDef | ((shade: 0 | 1) => THREE.Object3D);

/** What `extendSkin` takes: like `SkinOverrides`, with shorthands for every entry. */
export type SkinExtension = Omit<SkinOverrides, 'items' | 'characters' | 'actors' | 'terrain'> & {
  items?: Record<string, ItemLike>;
  characters?: Record<string, CharacterLike>;
  actors?: Record<string, ActorLike>;
  terrain?: Record<string, TerrainLike>;
};

/** The full definition of an item shorthand. */
export const toItemDef = (v: ItemLike): ItemDef => (typeof v === 'function' ? { create: v } : v);

/** The full definition of a terrain shorthand. */
export const toTerrainDef = (v: TerrainLike): TerrainDef => (typeof v === 'function' ? { tile: v } : v);

/** The full definition of an actor shorthand. */
export const toActorDef = (v: ActorLike): ActorDef => (typeof v === 'function' ? { create: v } : v);

/** The full factory of a character shorthand. */
export function toCharacterFactory(v: CharacterLike): CharacterFactory {
  if (typeof v !== 'function') {
    const spec = v;
    return () => {
      const figure = typeof spec.figure === 'string' ? spec.project.figures.find((f) => f.id === spec.figure) : spec.figure;
      if (!figure) throw new Error(`No figure ${String(spec.figure)} in project ${spec.project.name}`);
      return figureCharacter(spec.project, figure, { scale: spec.scale ?? 1, height: spec.height ?? 1 });
    };
  }
  return (ctx) => {
    const made = v(ctx);
    if (isCharacter(made)) return made;
    const box = new Box3().setFromObject(made, true);
    return propCharacter(made, Number.isFinite(box.max.y) ? box.max.y : 0.8);
  };
}

const mapValues = <A, B>(r: Record<string, A> | undefined, f: (a: A) => B): Record<string, B> | undefined =>
  r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, f(v)])) : undefined;

/**
 * A skin with some entries replaced or added, by name. Entries may be shorthands:
 *
 * ```ts
 * const skin = extendSkin(defaultSkin, {
 *   items: { apple: () => myApple(), lamp: { create: myLamp, glow: { color: 0xffcc66, height: 0.9 } } },
 *   characters: { robot: { project, figure: 'bolo', scale: 0.5, height: 0.9 } },
 *   actors: { gull: () => myGull() },
 *   aliases: { manzanita: 'apple' },
 * });
 * ```
 */
export function extendSkin(base: Skin | (() => Skin), ext: SkinExtension): Skin {
  const b = typeof base === 'function' ? base() : base;
  const { items, characters, actors, terrain, ...rest } = ext;
  const over: SkinOverrides = { ...rest };
  const i = mapValues(items, toItemDef);
  const c = mapValues(characters, toCharacterFactory);
  const a = mapValues(actors, toActorDef);
  const t = mapValues(terrain, toTerrainDef);
  if (i) over.items = i;
  if (c) over.characters = c;
  if (a) over.actors = a;
  if (t) over.terrain = t;
  return mergeSkin(b, over);
}
