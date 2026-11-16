/**
 * The default skin: bright island daylight, cute voxel items, a round orange robot for the grid, a
 * green turtle with chalk for the turtle world and a kid (a `createHumanoid` figure) for realtime
 * games. Every model is original and painted in code.
 */
import * as THREE from 'three';
import type { Figure, Model, Project } from '../core/index.js';
import { createHumanoid } from '../paint/index.js';
import * as M from './models.js';
import { figureCharacter, propCharacter, ScreenSprite, textTexture, voxelObject } from './pieces.js';
import { hashColor, hsl, type ActorDef, type CharacterFactory, type ItemContext, type ItemDef, type Skin, type TerrainDef } from './skin.js';

const project = (models: Model[], figure: Figure): Project => ({ version: 1, name: figure.name, startScene: '', models, figures: [figure], scenes: [] });

/** A voxel item that ignores its context. */
const item = (model: () => Model, extra: Partial<ItemDef> = {}, glow: 'soft' | 'bloom' = 'soft'): ItemDef => ({
  create: () => voxelObject(model(), { glow }),
  ...extra,
});

/** Lifts an object a little (things that stand on a thin edge). */
const lifted = (o: THREE.Object3D, y: number): THREE.Object3D => {
  o.position.y += y;
  const g = new THREE.Group();
  g.add(o);
  return g;
};

const scaled = (o: THREE.Object3D, k: number): THREE.Object3D => {
  o.scale.multiplyScalar(k);
  const g = new THREE.Group();
  g.add(o);
  return g;
};

/** A label floating above a marker; its size stays readable on any board. */
export function labelSprite(text: string, height = 0.9): ScreenSprite {
  const t = textTexture(text, 'label');
  const s = new ScreenSprite(t.texture, t.aspect, 0.26, 15, 26);
  s.position.y = height;
  return s;
}

const lampColor = (ctx: ItemContext): number => (ctx.index !== null ? hsl(((ctx.index % 16) + 16) % 16 / 16, 0.9, 0.62) : 0xffd25a);

const ITEMS: Record<string, ItemDef> = {
  lamp: {
    create: (ctx) => voxelObject(M.lampModel(ctx.state === 'on' || ctx.index !== null, lampColor(ctx)), { glow: 'bloom' }),
    glow: (ctx) => (ctx.state === 'on' || ctx.index !== null ? { color: ctx.index !== null ? lampColor(ctx) : 0xffc458, height: 0.93, size: 2.1 } : null),
    pile: 'single',
  },
  apple: item(M.appleModel),
  orange: item(M.orangeModel),
  banana: item(M.bananaModel),
  star: item(() => M.starModel(), { pile: 'stack', stackStep: 0.12 }),
  cheese: item(M.cheeseModel),
  computer: { create: (ctx) => voxelObject(M.computerModel(ctx.state !== 'off'), { glow: 'soft' }), pile: 'single' },
  flag: item(M.flagModel, { pile: 'single' }),
  fish: { create: () => lifted(voxelObject(M.fishModel()), 0.06) },
  food: item(M.foodModel, { pile: 'stack', stackStep: 0.3 }),
  key: { create: () => lifted(voxelObject(M.keyModel()), 0.04) },
  chest: item(M.chestModel, { pile: 'single' }),
  lens: item(M.lensModel, { pile: 'single' }),
  lighthouse: {
    create: (ctx) => voxelObject(M.lighthouseModel(ctx.state === 'on'), { glow: 'bloom' }),
    glow: (ctx) => (ctx.state === 'on' ? { color: 0xffe080, height: 1.1, size: 1.6 } : null),
    pile: 'single',
  },
  coin: item(M.coinModel, { pile: 'stack', stackStep: 0.08 }),
  gem: item(M.gemModel),
  flower: item(M.flowerModel),
  shell: item(M.shellModel),
  crate: item(M.crateModel, { pile: 'stack', stackStep: 0.68 }),
  boat: item(M.boatModel, { pile: 'single' }),
  hammock: item(M.hammockModel, { pile: 'single' }),
  book: item(M.bookModel, { pile: 'stack', stackStep: 0.26 }),
  ball: item(M.ballModel),
  cake: item(M.cakeModel, { pile: 'single' }),
  crumbs: item(M.crumbsModel, { floor: true, pile: 'single' }),
  dock: item(M.dockModel, { floor: true, pile: 'single' }),
  mask: item(M.maskModel, { pile: 'single' }),
  text: { create: (ctx) => voxelObject(M.paperModel(ctx.letter)), pile: 'single' },
  cartridge: item(M.cartridgeModel, { pile: 'stack', stackStep: 0.2 }),
  mushroom: item(M.mushroomModel),
  heart: item(M.heartModel),
  tree: item(M.treeModel, { pile: 'single' }),
  bush: item(M.bushModel, { pile: 'single' }),
  rock: { create: () => scaled(voxelObject(M.boulderModel()), 0.6), pile: 'single' },
  palm: { create: () => scaled(voxelObject(M.palmModel()), 0.55), pile: 'single' },
  coconut: item(M.coconutModel),
  drop: item(M.dropModel),
};

const ALIASES: Record<string, string> = {
  pc: 'computer',
  laptop: 'computer',
  screen: 'computer',
  fruit: 'apple',
  manzana: 'apple',
  banana: 'banana',
  naranja: 'orange',
  estrella: 'star',
  queso: 'cheese',
  pez: 'fish',
  pescado: 'fish',
  comida: 'food',
  bowl: 'food',
  meal: 'food',
  farol: 'lamp',
  lantern: 'lamp',
  light: 'lamp',
  bandera: 'flag',
  finish: 'flag',
  goal: 'flag',
  llave: 'key',
  cofre: 'chest',
  treasure: 'chest',
  lente: 'lens',
  glass: 'lens',
  faro: 'lighthouse',
  moneda: 'coin',
  gold: 'coin',
  money: 'coin',
  diamond: 'gem',
  jewel: 'gem',
  crystal: 'gem',
  flor: 'flower',
  plant: 'flower',
  seashell: 'shell',
  caracol: 'shell',
  box: 'crate',
  caja: 'crate',
  package: 'crate',
  bote: 'boat',
  barco: 'boat',
  hamaca: 'hammock',
  bed: 'hammock',
  libro: 'book',
  pelota: 'ball',
  torta: 'cake',
  migas: 'crumbs',
  crumb: 'crumbs',
  muelle: 'dock',
  pier: 'dock',
  disguise: 'mask',
  costume: 'mask',
  disfraz: 'mask',
  letter: 'text',
  paper: 'text',
  note: 'text',
  page: 'text',
  game: 'cartridge',
  juego: 'cartridge',
  hongo: 'mushroom',
  life: 'heart',
  corazon: 'heart',
  arbol: 'tree',
  stone: 'rock',
  piedra: 'rock',
  boulder: 'rock',
  coco: 'coconut',
  gota: 'drop',
  rain: 'drop',
  // terrain
  road: 'path',
  dirt: 'path',
  camino: 'path',
  beach: 'sand',
  arena: 'sand',
  sea: 'water',
  lake: 'water',
  river: 'water',
  pond: 'water',
  agua: 'water',
  mountain: 'rock',
  roca: 'rock',
  floor: 'patio',
  tiles: 'patio',
  bridge: 'wood',
  planks: 'wood',
  puente: 'wood',
  exit: 'goal',
  end: 'goal',
  home: 'goal',
  salida: 'goal',
  meta: 'goal',
  garden: 'flowers',
  pasto: 'grass',
  cesped: 'grass',
  // actors
  shot: 'light',
  bullet: 'light',
  laser: 'light',
  spark: 'light',
  fireball: 'light',
  rayo: 'light',
  luz: 'light',
  cangrejo: 'crab',
  gaviota: 'gull',
  bird: 'gull',
  seagull: 'gull',
  nube: 'cloud',
  loro: 'parrot',
};

const tile = (key: string, extra: Partial<TerrainDef> = {}): TerrainDef => ({
  tile: (shade) => {
    // The model stands on y = 0; the tile's top must be at y = 0.
    const o = voxelObject(M.tileModel(key, M.TILES[key]!, shade), { center: true });
    o.position.y = -(M.TILES[key]!.height ?? 6) * M.S;
    const g = new THREE.Group();
    g.add(o);
    return g;
  },
  block: () => voxelObject(M.boulderModel()),
  ...extra,
});

const TERRAIN: Record<string, TerrainDef> = {
  grass: tile('grass', { block: () => voxelObject(M.bushModel()) }),
  path: tile('path'),
  sand: tile('sand'),
  water: tile('water', { level: -0.16, block: null, wave: true }),
  rock: tile('rock'),
  patio: tile('patio'),
  wood: tile('wood', { block: () => voxelObject(M.crateModel()) }),
  start: tile('start'),
  goal: tile('goal'),
  flowers: tile('flowers', { block: () => voxelObject(M.bushModel()) }),
};

const soft = (model: () => Model, extra: Partial<ActorDef> = {}, glow: 'soft' | 'bloom' = 'soft'): ActorDef => ({
  create: () => voxelObject(model(), { glow }),
  ...extra,
});

const ACTORS: Record<string, ActorDef> = {
  crab: soft(M.crabModel),
  gull: soft(M.gullModel, { fly: 0.75 }),
  cloud: soft(M.cloudModel, { fly: 1.45 }),
  drop: soft(M.dropModel, { projectile: true }),
  light: { create: () => voxelObject(M.sparkModel(0xffd25a), { glow: 'bloom' }), projectile: true, fly: 0.35, glow: { color: 0xffd25a, height: 0.2, size: 0.9 } },
  coconut: soft(M.coconutModel, { projectile: true }),
  rock: { create: () => scaled(voxelObject(M.boulderModel()), 0.45), projectile: true },
  parrot: soft(M.parrotModel),
};

function robot(body?: number): CharacterFactory {
  return () => {
    const { models, figure } = M.robotFigure(body);
    return figureCharacter(project(models, figure), figure, { scale: 1.3, height: 1.12 });
  };
}

function turtle(): CharacterFactory {
  return () => {
    const { models, figure } = M.turtleFigure();
    let down = true;
    const chalkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const chalk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), chalkMat);
    chalk.castShadow = true;
    const c = figureCharacter(project(models, figure), figure, {
      height: 0.5,
      extra: (_clip, _t, f) => {
        const head = f.joints.get('head');
        if (head) head.rotation.x += down ? 0.32 : -0.3;
      },
    });
    const head = c.figure.joints.get('head');
    chalk.position.set(0, -0.05, 0.27);
    chalk.rotation.x = 0.85;
    head?.add(chalk);
    return {
      ...c,
      tip: 0.62,
      setPen(d, color) {
        down = d;
        chalkMat.color.setHex(color);
      },
    };
  };
}

function kid(): CharacterFactory {
  return () => {
    const { models, figure } = createHumanoid({
      id: 'kid',
      name: 'Kid',
      clothes: 0xff8a3a,
      pants: 0x3a6ad0,
      skin: 0xc88a62,
      hair: 0x3a2418,
      cap: 0x2ab0a0,
      shoes: 0xf4f4f4,
      hairStyle: 'short',
    });
    const scale = 0.5;
    return figureCharacter(project(models, figure), figure, {
      scale,
      height: 0.95,
      extra: (clip, t, f) => {
        f.position.y = clip === 'cheer' ? Math.abs(Math.sin(t * 8)) * 0.18 : 0;
        const head = f.joints.get('head');
        if (clip === 'sad' && head) head.rotation.x = 0.45;
        if (clip === 'cheer') {
          f.joints.get('arm_l')?.rotation.set(-2.7, 0, 0.3);
          f.joints.get('arm_r')?.rotation.set(-2.7, 0, -0.3);
        }
        if (clip === 'bump' && head) head.rotation.y = Math.sin(t * 16) * 0.3;
      },
    });
  };
}

/** The skin every world renders with when none is given. */
export function defaultSkin(): Skin {
  return {
    name: 'island',
    items: { ...ITEMS },
    aliases: { ...ALIASES },
    fallbackItem: (ctx) => ({
      create: () => {
        const g = new THREE.Group();
        g.add(voxelObject(M.signModel(hashColor(ctx.key))));
        g.add(labelSprite(ctx.letter ? `${ctx.label}` : ctx.label, 0.85));
        return g;
      },
      pile: 'single',
    }),
    terrain: { ...TERRAIN },
    defaultTerrain: 'grass',
    wallTerrain: 'rock',
    patioTerrain: 'patio',
    wall: () => voxelObject(M.wallModel()),
    arrow: () => {
      const o = voxelObject(M.arrowModel(), { shadow: false });
      o.position.y = 0.005;
      return o;
    },
    characters: { robot: robot(), turtle: turtle(), kid: kid(), robotBlue: robot(0x4aa8f0), robotGreen: robot(0x5cc46a) },
    character: { grid: 'robot', turtle: 'turtle', realtime: 'kid' },
    actors: { ...ACTORS },
    fallbackActor: (ctx) => ({
      create: () => {
        const g = new THREE.Group();
        g.add(voxelObject(M.blobModel(hashColor(ctx.kind))));
        g.add(labelSprite(ctx.label, 0.8));
        return propCharacter(g, 0.7);
      },
    }),
    colors: {
      red: 0xf0473a,
      blue: 0x3a7cf0,
      green: 0x3ec45a,
      yellow: 0xffd23a,
      orange: 0xff8a2a,
      purple: 0x9a5ae0,
      violet: 0x9a5ae0,
      pink: 0xff7ab8,
      white: 0xffffff,
      black: 0x2a2a35,
      brown: 0x8a5a32,
      gray: 0x9a9a9a,
      grey: 0x9a9a9a,
      cyan: 0x3ad6e0,
      lightblue: 0x8fd0ff,
      rojo: 0xf0473a,
      azul: 0x3a7cf0,
      verde: 0x3ec45a,
      amarillo: 0xffd23a,
      naranja: 0xff8a2a,
      violeta: 0x9a5ae0,
      morado: 0x9a5ae0,
      rosa: 0xff7ab8,
      blanco: 0xffffff,
      negro: 0x2a2a35,
      marrón: 0x8a5a32,
      marron: 0x8a5a32,
      gris: 0x9a9a9a,
      celeste: 0x8fd0ff,
      turquesa: 0x3ad6e0,
    },
    environment: {
      sky: 0xa6def4,
      sea: 0x3fbcd8,
      sand: 0xf4dea4,
      sun: { color: 0xfff0d6, intensity: 2.7 },
      ambient: { sky: 0xd4f0ff, ground: 0xf2dcae, intensity: 1.35 },
      decor: [
        () => scaled(voxelObject(M.palmModel()), 0.6),
        () => scaled(voxelObject(M.bushModel()), 0.55),
        () => voxelObject(M.shellsModel(), { shadow: false }),
        () => scaled(voxelObject(M.boulderModel()), 0.45),
      ],
    },
  };
}

/** Names of the default skin's items, terrain, characters and actors (for docs and tests). */
export function defaultCatalogue(): { items: string[]; terrain: string[]; characters: string[]; actors: string[]; colors: string[] } {
  const s = defaultSkin();
  return {
    items: Object.keys(s.items),
    terrain: Object.keys(s.terrain),
    characters: Object.keys(s.characters),
    actors: Object.keys(s.actors),
    colors: Object.keys(s.colors),
  };
}
