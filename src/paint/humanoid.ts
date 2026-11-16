/**
 * A parametric voxel humanoid: every character made with it shares the same skeleton and clips, so
 * they can swap bodies, and only the style changes how they look.
 */
import type { Clip, Figure, Model, Part, V3 } from '../core/index.js';
import { noise3, VoxelCanvas } from './canvas.js';

/** Meters per voxel of every humanoid part. */
export const HUMANOID_SCALE = 0.03;
const E = HUMANOID_SCALE;

/** Multiplies each RGB channel: above 1 lightens, below 1 darkens. */
export function shade(color: number, k: number): number {
  const channel = (s: number): number => Math.max(0, Math.min(255, Math.round(((color >> s) & 255) * k)));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

const clip = (name: string, duration: number, keys: [number, Record<string, V3>][]): Clip => ({
  name,
  duration,
  loop: true,
  keys: keys.map(([t, rot]) => ({ t, rot })),
});

const mix = (a: number, b: number, t: number): number => a + (b - a) * Math.min(1, Math.max(0, t));

/**
 * short: tousled with bangs. long: down to the shoulders. bun: tied up at the back. shaved: almost
 * nothing.
 */
export type HairStyle = 'short' | 'long' | 'bun' | 'shaved';

/** How a humanoid looks. Colors are RGB; the light and dark tones default to shades of the base. */
export interface HumanoidStyle {
  /** Figure id and prefix of its model ids; must be unique in the project. */
  id: string;
  name?: string;
  /** Top (shirt, hoodie, jacket). */
  clothes?: number;
  clothesLight?: number;
  clothesDark?: number;
  skin?: number;
  skinDark?: number;
  hair?: number;
  hairLight?: number;
  pants?: number;
  shoes?: number;
  /** Belt and strap color. */
  belt?: number;
  hairStyle?: HairStyle;
  hood?: boolean;
  /** A strap across the chest. */
  strap?: boolean;
  /** Apron color (instead of a belt). */
  apron?: number;
  /** Cap color. */
  cap?: number;
  /** Beard color. */
  beard?: number;
  glasses?: boolean;
  /** Holds a glowing tablet in the left hand. */
  tablet?: boolean;
  /** Color of the tablet's screen (emissive). */
  tabletScreen?: number;
  /**
   * Overall scale, 1 by default. It is not baked into the parts: scale the whole figure with it
   * (for example `new Actor(project, id, { height })`).
   */
  height?: number;
  /** Body width, 1 by default. */
  width?: number;
  /** curvy: marked waist, wider hips, narrower shoulders and eyelashes. */
  silhouette?: 'straight' | 'curvy';
}

/** Neutral defaults: grey-blue top, dark trousers, brown short hair, medium skin. */
export const DEFAULT_HUMANOID: Required<Omit<HumanoidStyle, 'id' | 'clothesLight' | 'clothesDark' | 'skinDark' | 'hairLight' | 'apron' | 'cap' | 'beard'>> = {
  name: 'Humanoid',
  clothes: 0x5a6a80,
  skin: 0xd8a47e,
  hair: 0x6a4428,
  pants: 0x3a3a42,
  shoes: 0x2a2420,
  belt: 0x6a4428,
  hairStyle: 'short',
  hood: false,
  strap: false,
  glasses: false,
  tablet: false,
  tabletScreen: 0x8ff0e0,
  height: 1,
  width: 1,
  silhouette: 'straight',
};

/** Clip names of every humanoid figure. */
export const HUMANOID_CLIPS = ['idle', 'walk', 'inspect', 'talk'] as const;

/** Part ids of every humanoid figure. */
export const HUMANOID_PARTS = [
  'pelvis',
  'torso',
  'head',
  'arm_l',
  'arm_r',
  'forearm_l',
  'forearm_r',
  'thigh_l',
  'thigh_r',
  'shin_l',
  'shin_r',
] as const;

/**
 * Builds the models and the rigged figure of a humanoid about 1.8 m tall. Clips: `idle`, `walk`
 * (0.8 s, a footfall every 0.4 s), `inspect` (looks at the left hand) and `talk` (gestures with the
 * right hand). The figure's id is `style.id` and its models are `${style.id}_<part>`.
 */
export function createHumanoid(style: HumanoidStyle): { models: Model[]; figure: Figure } {
  // Options set to undefined fall back to the defaults too.
  const given = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as HumanoidStyle;
  const s = { ...DEFAULT_HUMANOID, ...given };
  const clothesLight = s.clothesLight ?? shade(s.clothes, 1.22);
  const clothesDark = s.clothesDark ?? shade(s.clothes, 0.74);
  const skinDark = s.skinDark ?? shade(s.skin, 0.85);
  const hairLight = s.hairLight ?? shade(s.hair, 1.25);
  const k = s.width;
  const curvy = s.silhouette === 'curvy';
  const cloth = (x: number, y: number, z: number): number => {
    const n = noise3(x, y, z, 4);
    return n > 0.66 ? clothesLight : n < 0.3 ? clothesDark : s.clothes;
  };
  const m = (suffix: string): string => `${s.id}_${suffix}`;

  const pelvis = new VoxelCanvas(m('pelvis'), `${s.name}: pelvis`, [14, 5, 10], E).profile(
    0,
    4,
    () => ({ rx: (curvy ? 6.9 : 6.4) * k, rz: curvy ? 4.7 : 4.4, e: 2.6 }),
    (_x, y) => (y >= 3 ? (s.apron ?? s.belt) : s.pants),
  );
  if (!s.apron) pelvis.box(6, 3, 8, 7, 4, 9, 0xc9a060);

  const torso = new VoxelCanvas(m('torso'), `${s.name}: torso`, [18, 16, 16], E);
  // Straight: widens evenly toward the shoulders. Curvy: narrow waist, smaller chest and shoulders.
  const across = (y: number): number => (curvy ? (y < 4 ? mix(6.4, 5.5, y / 4) : mix(5.5, 7.1, (y - 4) / 7)) : mix(6.6, 8, y / 11));
  const depth = (y: number): number => (curvy ? 4.6 + 0.6 * Math.max(0, 1 - Math.abs(y - 8.5) / 2.5) : 4.8);
  torso.profile(0, 13, (y) => ({ cz: 8, rx: across(y) * k, rz: depth(y), e: 2.8 }), cloth);
  torso.profile(0, 1, () => ({ cz: 8, rx: 6.9 * k, rz: 5.1, e: 2.8 }), clothesDark);
  torso.face(8, 6, 9, 12, () => clothesDark);
  if (s.apron) {
    // Bib and straps.
    torso.relief(5, 0, 12, 9, (x, y) => (y > 6 && (x < 6 || x > 11) ? undefined : s.apron));
  } else if (s.hood) {
    // Front pocket.
    torso.face(5, 2, 12, 5, (x, y) => (y === 5 || x === 5 || x === 12 ? clothesDark : undefined));
  }
  if (s.hood) {
    torso.profile(11, 15, (y) => ({ cz: 6.5, rx: mix(6.6, 4.6, (y - 11) / 4), rz: mix(5.4, 4, (y - 11) / 4) }), (x, y, z) =>
      z < 9 || y < 13 ? ((x + y) % 4 === 0 ? clothesDark : s.clothes) : undefined,
    );
    torso.box(5, 7, 1, 12, 13, 3, (_x, y) => (y === 7 ? clothesDark : s.clothes));
  } else {
    torso.profile(13, 14, () => ({ cz: 8, rx: 3, rz: 2.6 }), s.skin);
  }
  if (s.strap) for (let y = 1; y <= 12; y++) torso.face(3 + Math.round(y * 0.9), y, 4 + Math.round(y * 0.9), y, () => s.belt);

  const head = new VoxelCanvas(m('head'), `${s.name}: head`, [14, 16, 14], E);
  head.profile(0, 1, () => ({ rx: 2.6, rz: 2.6 }), skinDark);
  head.profile(1, 10, (y) => ({ rx: mix(4, 5.2, y / 4), rz: mix(4.2, 5.4, y / 4), e: 2.4 }), s.skin);
  const hair = (x: number, y: number, z: number): number => (noise3(x, y, z, 4) > 0.62 ? hairLight : s.hair);
  if (s.hairStyle === 'short') {
    head.profile(5, 13, (y) => ({ cz: 6.6, rx: mix(6.1, 3.2, (y - 10) / 3), rz: mix(6.5, 3.6, (y - 10) / 3) }), (x, y, z) =>
      z < 9 || y > 8 || noise3(x, y, z, 2) > 0.62 ? hair(x, y, z) : undefined,
    );
  } else if (s.hairStyle === 'long' || s.hairStyle === 'bun') {
    // Covers the nape and the sides; long hair falls to the shoulders.
    head.profile(s.hairStyle === 'long' ? 0 : 4, 12, (y) => ({ cz: 6.4, rx: mix(6, 3.6, (y - 9) / 3), rz: mix(6.4, 4, (y - 9) / 3) }), (x, y, z) =>
      z < 9 || y > 9 ? hair(x, y, z) : undefined,
    );
    if (s.hairStyle === 'bun') head.ellipsoid(7, 12.5, 3, 2.4, 2, 2.2, hair);
  } else {
    head.profile(9, 11, (y) => ({ cz: 6.4, rx: mix(5.6, 4.2, (y - 9) / 2), rz: mix(5.8, 4.4, (y - 9) / 2) }), (x, y, z) =>
      z < 7 || (y < 11 && (x < 3 || x > 10)) ? hair(x, y, z) : undefined,
    );
  }
  // Eyes, eyebrows, eyelashes and mouth.
  head.face(4, 5, 5, 5, () => 0x1c2630).face(8, 5, 9, 5, () => 0x1c2630);
  head.face(4, 6, 5, 6, () => s.hair).face(8, 6, 9, 6, () => s.hair);
  if (curvy) head.face(3, 5, 3, 6, () => 0x1c2630).face(10, 5, 10, 6, () => 0x1c2630);
  head.face(6, 2, 7, 2, () => (curvy ? 0xa8505a : 0x9a5a48));
  if (s.glasses) head.relief(3, 5, 10, 5, (x) => (x === 6 || x === 7 ? 0x2a2a2a : x === 3 || x === 10 ? 0x2a2a2a : 0x9fc8d8));
  if (s.beard) head.relief(3, 0, 10, 3, (x, y) => (y === 2 && x > 5 && x < 8 ? undefined : s.beard));
  if (s.cap) {
    head.profile(10, 13, () => ({ cz: 6.8, rx: 5.6, rz: 5.8 }), s.cap);
    head.box(3, 10, 11, 10, 10, 13, s.cap);
  }

  const sleeve = (id: string): VoxelCanvas =>
    new VoxelCanvas(id, id, [6, 10, 6], E).profile(0, 9, (y) => ({ rx: mix(2.2, 2.7, y / 9), rz: mix(2.2, 2.7, y / 9) }), cloth);

  const forearm = (id: string): VoxelCanvas => {
    const c = new VoxelCanvas(id, id, [7, 11, 7], E);
    c.profile(3, 10, () => ({ rx: 2.2, rz: 2.2 }), cloth);
    c.profile(3, 4, () => ({ rx: 2.5, rz: 2.5 }), clothesDark);
    c.profile(0, 2, () => ({ rx: 2, rz: 1.7 }), s.skin);
    return c;
  };

  /** The forearm that holds the tablet, its screen always lit. */
  const withTablet = (id: string): VoxelCanvas => {
    const c = new VoxelCanvas(id, id, [11, 16, 9], E);
    c.profile(8, 15, () => ({ cx: 5.5, cz: 3.5, rx: 2.2, rz: 2.2 }), cloth);
    c.profile(8, 9, () => ({ cx: 5.5, cz: 3.5, rx: 2.5, rz: 2.5 }), clothesDark);
    c.profile(5, 7, () => ({ cx: 5.5, cz: 3.5, rx: 2, rz: 1.8 }), s.skin);
    c.emit(s.tabletScreen);
    c.box(1, 0, 6, 10, 9, 6, 0x1d2420);
    c.box(2, 1, 7, 9, 8, 7, (x, y) => (y === 8 || (y % 2 === 1 && x < 3 + ((y * 5) % 6)) ? 0xe8fff8 : s.tabletScreen));
    c.box(4, 5, 7, 6, 6, 7, s.skin);
    return c;
  };

  const thigh = (id: string): VoxelCanvas =>
    new VoxelCanvas(id, id, [7, 13, 7], E).profile(0, 12, (y) => ({ rx: mix(2.6, 3.1, y / 12), rz: mix(2.6, 3.1, y / 12) }), (x, y, z) =>
      noise3(x, y, z, 3) > 0.7 ? 0x46443f : s.pants,
    );

  const shin = (id: string): VoxelCanvas => {
    const c = new VoxelCanvas(id, id, [7, 14, 10], E);
    c.profile(5, 13, () => ({ cz: 3.5, rx: 2.4, rz: 2.4 }), s.pants);
    c.profile(1, 6, () => ({ cz: 3.5, rx: 2.8, rz: 2.8 }), s.shoes);
    c.profile(0, 2, (y) => ({ cz: 5, rx: 2.8, rz: mix(4.8, 3.6, y / 2), e: 2.5 }), (_x, y) => (y === 0 ? 0x231710 : s.shoes));
    return c;
  };

  const canvases = [
    pelvis,
    torso,
    head,
    sleeve(m('arm_l')),
    sleeve(m('arm_r')),
    s.tablet ? withTablet(m('forearm_l')) : forearm(m('forearm_l')),
    forearm(m('forearm_r')),
    thigh(m('thigh_l')),
    thigh(m('thigh_r')),
    shin(m('shin_l')),
    shin(m('shin_r')),
  ];

  const p = (id: string, parent: string | null, pivot: V3, origin: V3): Part => ({
    id,
    model: m(id),
    parent,
    pivot: [pivot[0] * E, pivot[1] * E, pivot[2] * E],
    origin,
  });
  const parts: Part[] = [
    p('pelvis', null, [0, 27, 0], [7, 0, 5]),
    p('torso', 'pelvis', [0, 4, 0], [9, 0, 8]),
    p('head', 'torso', [0, 14, 0], [7, 0, 7]),
    p('arm_l', 'torso', [(curvy ? 8.6 : 9.6) * k, 13, 0], [3, 10, 3]),
    p('arm_r', 'torso', [(curvy ? -8.6 : -9.6) * k, 13, 0], [3, 10, 3]),
    p('forearm_l', 'arm_l', [0, -10, 0], s.tablet ? [5.5, 16, 3.5] : [3.5, 11, 3.5]),
    p('forearm_r', 'arm_r', [0, -10, 0], [3.5, 11, 3.5]),
    p('thigh_l', 'pelvis', [3.4, 0, 0], [3.5, 13, 3.5]),
    p('thigh_r', 'pelvis', [-3.4, 0, 0], [3.5, 13, 3.5]),
    p('shin_l', 'thigh_l', [0, -13, 0], [3.5, 14, 3.5]),
    p('shin_r', 'thigh_r', [0, -13, 0], [3.5, 14, 3.5]),
  ];

  // With the tablet, the left arm holds it out in front; without it, the arm hangs.
  const fl: V3 = s.tablet ? [-0.8, 0.3, 0] : [-0.3, 0, 0];
  const stride = (q: number): Record<string, V3> => ({
    thigh_l: [-0.55 * q, 0, 0],
    shin_l: [q > 0 ? 0.15 : 0.6, 0, 0],
    thigh_r: [0.55 * q, 0, 0],
    shin_r: [q > 0 ? 0.6 : 0.15, 0, 0],
    arm_l: [s.tablet ? 0.2 * q - 0.1 : 0.5 * q, 0, 0.12],
    forearm_l: fl,
    arm_r: [-0.5 * q, 0, -0.08],
    forearm_r: [-0.35, 0, 0],
    torso: [0.06, 0.08 * q, 0],
  });
  const passing: Record<string, V3> = {
    shin_l: [0.3, 0, 0],
    shin_r: [0.3, 0, 0],
    arm_l: [-0.1, 0, 0.12],
    arm_r: [0, 0, -0.08],
    forearm_l: fl,
    forearm_r: [-0.3, 0, 0],
    torso: [0.06, 0, 0],
  };
  const inspect: Record<string, V3> = {
    arm_l: [-0.7, 0.35, 0.2],
    forearm_l: [-1.2, 0.2, 0],
    head: [0.35, 0.15, 0],
    arm_r: [0, 0, -0.08],
    forearm_r: [-0.15, 0, 0],
  };
  const restL: V3 = s.tablet ? [-0.9, 0.3, 0] : [-0.2, 0, 0];
  // While talking, the free hand gestures.
  const gesture = (q: number): Record<string, V3> => ({
    arm_l: [s.tablet ? -0.15 : -0.05, 0, 0.12],
    forearm_l: restL,
    arm_r: [-0.5 - 0.25 * q, 0.2, -0.3],
    forearm_r: [-1 - 0.3 * q, 0.3, 0],
    head: [0.05 * q, 0.12 * q, 0],
    torso: [0.03, 0.04 * q, 0],
  });

  const figure: Figure = {
    id: s.id,
    name: s.name,
    parts,
    clips: [
      clip('idle', 3.2, [
        [0, { arm_l: [-0.15, 0, 0.12], arm_r: [0, 0, -0.08], forearm_l: restL, forearm_r: [-0.15, 0, 0] }],
        [
          1.6,
          {
            arm_l: [-0.12, 0, 0.14],
            arm_r: [0.03, 0, -0.1],
            forearm_l: [restL[0] - 0.05, restL[1], 0],
            forearm_r: [-0.2, 0, 0],
            torso: [0.03, 0, 0],
            head: [0.06, 0.2, 0],
          },
        ],
      ]),
      clip('walk', 0.8, [
        [0, stride(1)],
        [0.2, passing],
        [0.4, stride(-1)],
        [0.6, passing],
      ]),
      clip('inspect', 2, [
        [0, inspect],
        [1, { ...inspect, head: [0.4, 0.05, 0] }],
      ]),
      clip('talk', 1.4, [
        [0, gesture(1)],
        [0.7, gesture(-1)],
      ]),
    ],
  };
  return { models: canvases.map((c) => c.toModel()), figure };
}
