/** three.js building blocks shared by the stages: instancing, text sprites, figures, easing, disposal. */
import * as THREE from 'three';
import { poseOf, type Figure, type Model, type Project } from '../core/index.js';
import { emissiveMaterial, Figure3D, solidMaterial, VoxelMesh } from '../render/index.js';
import type { CharacterVisual, PoseInfo } from './skin.js';

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
export const easeOutBack = (t: number): number => {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** `t` remapped so that `a` → 0 and `b` → 1, clamped. */
export const span = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
/** Shortest signed angle from `a` to `b`. */
export const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Materials shared by many objects; never disposed by the views. */
const SHARED = new Set<THREE.Material>([solidMaterial, emissiveMaterial]);
export function shareMaterial<M extends THREE.Material>(m: M): M {
  SHARED.add(m);
  return m;
}

/** An unlit bright material for screens and eyes that should look lit without blooming. */
export const softGlowMaterial = shareMaterial(new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.15, 1.15, 1.15) }));

/**
 * A voxel model as an object standing on its base center. `glow: 'soft'` swaps emissive voxels to
 * an unlit material that does not bloom (screens); `'bloom'` keeps them blooming (lamps).
 */
export function voxelObject(m: Model, options: { glow?: 'soft' | 'bloom'; shadow?: boolean; center?: boolean } = {}): THREE.Group {
  const mesh = new VoxelMesh(m);
  if (options.center !== false) mesh.position.set((-m.size[0] * m.scale) / 2, 0, (-m.size[2] * m.scale) / 2);
  if (options.glow !== 'bloom') {
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === emissiveMaterial) o.material = softGlowMaterial;
    });
  }
  if (options.shadow === false) mesh.traverse((o) => (o.castShadow = false));
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

/**
 * A copy of an object tree that shares geometries and materials. Unlike `Object3D.clone()`, it
 * works on subclasses whose constructors need arguments (`VoxelMesh`, `Figure3D`): every node
 * becomes a plain `Group`, `Mesh`, `Sprite` or (other objects) a `clone()`.
 */
export function copyObject(o: THREE.Object3D): THREE.Object3D {
  let c: THREE.Object3D;
  if (o instanceof THREE.InstancedMesh) c = o.clone();
  else if (o instanceof THREE.Mesh) {
    const m = new THREE.Mesh(o.geometry, o.material);
    m.castShadow = o.castShadow;
    m.receiveShadow = o.receiveShadow;
    c = m;
  } else if (o instanceof THREE.Sprite) {
    const sp = new THREE.Sprite(o.material);
    sp.center.copy(o.center);
    c = sp;
  } else if (o.constructor === THREE.Object3D || o instanceof THREE.Group) c = new THREE.Group();
  else c = o.clone(false);
  c.name = o.name;
  c.position.copy(o.position);
  c.quaternion.copy(o.quaternion);
  c.scale.copy(o.scale);
  c.visible = o.visible;
  c.renderOrder = o.renderOrder;
  for (const child of o.children) c.add(copyObject(child));
  return c;
}

/** Frees geometries, materials and textures under `root` (shared materials stay). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
    for (const mat of mats) {
      if (SHARED.has(mat)) continue;
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map && !SHARED_TEXTURES.has(map)) map.dispose();
      mat.dispose();
    }
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
}

const SHARED_TEXTURES = new Set<THREE.Texture>();

/** Marks a texture as shared, so `disposeObject` leaves it alone. */
export function shareTexture<T extends THREE.Texture>(t: T): T {
  SHARED_TEXTURES.add(t);
  return t;
}

/**
 * Many copies of one template object, drawn with one `InstancedMesh` per mesh of the template.
 * Templates made of anything other than meshes (sprites, lights) are cloned instead.
 */
export class InstancedTemplate {
  readonly group = new THREE.Group();
  private parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4; cast: boolean; receive: boolean }> = [];
  private meshes: THREE.InstancedMesh[] = [];
  private clones: THREE.Object3D[] = [];
  private capacity = 0;
  readonly instanced: boolean;
  private readonly tmp = new THREE.Matrix4();

  constructor(readonly template: THREE.Object3D) {
    template.updateMatrixWorld(true);
    let plain = true;
    const inverse = template.matrixWorld.clone().invert();
    template.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !(o instanceof THREE.SkinnedMesh)) {
        this.parts.push({
          geometry: o.geometry,
          material: o.material,
          local: inverse.clone().multiply(o.matrixWorld),
          cast: o.castShadow,
          receive: o.receiveShadow,
        });
      } else if (!(o instanceof THREE.Group) && o.type !== 'Object3D') {
        plain = false;
      }
    });
    this.instanced = plain;
  }

  /** Shows one copy per matrix (each places the template's origin). */
  set(matrices: readonly THREE.Matrix4[]): void {
    if (!this.instanced) {
      while (this.clones.length < matrices.length) {
        const c = copyObject(this.template);
        c.matrixAutoUpdate = false;
        this.clones.push(c);
        this.group.add(c);
      }
      this.clones.forEach((c, i) => {
        const m = matrices[i];
        c.visible = !!m;
        if (m) c.matrix.copy(m);
      });
      return;
    }
    if (matrices.length > this.capacity) {
      for (const m of this.meshes) {
        this.group.remove(m);
        m.dispose();
      }
      this.capacity = Math.max(matrices.length, Math.ceil(this.capacity * 1.5), 4);
      this.meshes = this.parts.map((p) => {
        const m = new THREE.InstancedMesh(p.geometry, p.material, this.capacity);
        m.castShadow = p.cast;
        m.receiveShadow = p.receive;
        m.frustumCulled = false;
        this.group.add(m);
        return m;
      });
    }
    this.meshes.forEach((mesh, k) => {
      const local = this.parts[k]!.local;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, this.tmp.multiplyMatrices(m, local)));
      mesh.count = matrices.length;
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** A plain copy for animating on its own (shares geometry). */
  loose(): THREE.Object3D {
    return copyObject(this.template);
  }

  /** Frees the instance buffers. The template (and its geometry) belongs to whoever built it. */
  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes = [];
    this.clones = [];
    this.group.clear();
    this.group.removeFromParent();
  }
}

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

const hasDom = (): boolean => typeof document !== 'undefined';

function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number): void {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + h, r);
  x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}

const FONT = '"Nunito", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/** Splits text in lines of at most `max` characters, at spaces when possible. */
export function wrapText(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= max) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
    }
    while (line.length > max + 4) {
      lines.push(line.slice(0, max));
      line = line.slice(max);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export type BubbleStyle = 'say' | 'error' | 'label' | 'badge';

/** A canvas texture with a speech bubble, a label chip or a number badge. Returns the texture and its aspect. */
export function textTexture(text: string, style: BubbleStyle): { texture: THREE.Texture; aspect: number; lines: number } {
  if (!hasDom()) return { texture: new THREE.Texture(), aspect: 1, lines: 1 };
  const c = document.createElement('canvas');
  const x = c.getContext('2d')!;
  const px = style === 'badge' ? 44 : style === 'label' ? 30 : 34;
  const lines = style === 'say' || style === 'error' ? wrapText(text, 18) : [text];
  x.font = `800 ${px}px ${FONT}`;
  const textW = Math.max(...lines.map((l) => x.measureText(l).width));
  const padX = style === 'badge' ? 14 : 22;
  const padY = style === 'badge' ? 6 : 14;
  const lineH = px * 1.18;
  const tail = style === 'say' || style === 'error' ? 18 : 0;
  const w = Math.ceil(style === 'badge' ? Math.max(lineH + padY * 2, textW + padX * 2) : textW + padX * 2) + 8;
  const h = Math.ceil(lineH * lines.length + padY * 2 + tail) + 8;
  c.width = w;
  c.height = h;
  x.font = `800 ${px}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const bw = w - 8;
  const bh = h - 8 - tail;
  const fill = style === 'error' ? '#fff1ec' : style === 'badge' ? '#ffffff' : style === 'label' ? 'rgba(255,250,240,0.94)' : '#ffffff';
  const stroke = style === 'error' ? '#e0503a' : style === 'badge' ? '#2b4a6b' : style === 'label' ? '#7a5a3a' : '#2b4a6b';
  x.lineWidth = 5;
  x.strokeStyle = stroke;
  x.fillStyle = fill;
  roundRect(x, 4, 4, bw, bh, style === 'badge' ? bh / 2 : 18);
  if (tail) {
    // The tail points down to the speaker.
    x.moveTo(w / 2 - 14, 4 + bh - 1);
    x.lineTo(w / 2, h - 5);
    x.lineTo(w / 2 + 14, 4 + bh - 1);
  }
  x.fill();
  x.stroke();
  if (tail) {
    x.fillStyle = fill;
    x.fillRect(w / 2 - 12, bh - 2, 24, 6);
  }
  x.fillStyle = style === 'error' ? '#a8281a' : style === 'label' ? '#4a3522' : '#1f3550';
  lines.forEach((l, i) => x.fillText(l, w / 2, 4 + padY + lineH * (i + 0.5) + 1));
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return { texture, aspect: w / h, lines: lines.length };
}

const badgeCache = new Map<string, { texture: THREE.Texture; aspect: number }>();

/** A shared texture for a short badge text ("3", "×12"). */
export function badgeTexture(text: string): { texture: THREE.Texture; aspect: number } {
  let b = badgeCache.get(text);
  if (!b) {
    const t = textTexture(text, 'badge');
    b = { texture: t.texture, aspect: t.aspect };
    SHARED_TEXTURES.add(t.texture);
    badgeCache.set(text, b);
  }
  return b;
}

/**
 * A sprite whose on-screen size stays readable: `worldHeight` meters, clamped between `minPx` and
 * `maxPx` pixels tall. The view calls `fit(pxPerMeter)` on resize.
 */
export class ScreenSprite extends THREE.Sprite {
  constructor(
    texture: THREE.Texture,
    public aspect: number,
    public worldHeight: number,
    public minPx: number,
    public maxPx: number,
    options: { onTop?: boolean } = {},
  ) {
    super(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: !options.onTop }));
    this.center.set(0.5, 0);
    if (options.onTop) this.renderOrder = 10;
  }

  fit(pxPerMeter: number): void {
    const px = Math.min(this.maxPx, Math.max(this.minPx, this.worldHeight * pxPerMeter));
    const h = px / Math.max(1e-6, pxPerMeter);
    this.scale.set(h * this.aspect, h, 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------------

/** Clips to try, in order, when a figure lacks the one asked for. */
const CLIP_FALLBACKS: Record<string, string[]> = {
  pick: ['pick', 'inspect', 'action', 'idle'],
  drop: ['drop', 'pick', 'inspect', 'idle'],
  light: ['light', 'action', 'inspect', 'idle'],
  paint: ['paint', 'action', 'inspect', 'idle'],
  action: ['action', 'inspect', 'talk', 'idle'],
  talk: ['talk', 'idle'],
  cheer: ['cheer', 'talk', 'idle'],
  sad: ['sad', 'idle'],
  bump: ['bump', 'sad', 'idle'],
  jump: ['jump', 'walk', 'idle'],
  walk: ['walk', 'idle'],
};

/**
 * A rigged figure as a character. `scale` sizes the whole figure; `height` is its standing height
 * in meters after scaling. For level actions (`pose('action', t, { action: 'eatApple' })`) it plays
 * `actions[name]`, else a clip named like the action, else the `action` clip and its fallbacks.
 */
export function figureCharacter(
  project: Project,
  figure: Figure,
  options: {
    scale?: number;
    height: number;
    actions?: Record<string, string>;
    /**
     * Lasting poses: while the robot holds one of these items, `idle` plays its clip (`{ lying:
     * 'lieDown' }`), and `cheer` too (lying in the hammock, it stays lying when the level passes).
     * When it holds several, the last one listed wins.
     */
    rest?: Record<string, string>;
    extra?: (clip: string, t: number, f: Figure3D, info?: PoseInfo) => void;
  },
): CharacterVisual & { figure: Figure3D } {
  const f = new Figure3D(project, figure, { light: false });
  f.scale.setScalar(options.scale ?? 1);
  // Movers set the holder's scale (pop-ins, vanishing); the figure keeps its own.
  const holder = new THREE.Group();
  holder.add(f);
  f.traverse((o) => {
    o.castShadow = true;
    // Eyes and screens look lit but do not bloom: the glow is for lamps.
    if (o instanceof THREE.Mesh && o.material === emissiveMaterial) o.material = softGlowMaterial;
  });
  const names = new Set(figure.clips.map((c) => c.name));
  const pick = (clip: string, info?: PoseInfo): string => {
    if ((clip === 'idle' || clip === 'cheer') && options.rest && info?.inventory) {
      let rest: string | undefined;
      for (const [item, c] of Object.entries(options.rest)) if ((info.inventory[item] ?? 0) > 0 && names.has(c)) rest = c;
      if (rest) return rest;
    }
    const action = clip === 'action' && info?.action ? [options.actions?.[info.action], info.action] : [];
    return [...action, ...(CLIP_FALLBACKS[clip] ?? [clip, 'idle'])].find((c): c is string => !!c && names.has(c)) ?? 'idle';
  };
  return {
    figure: f,
    object: holder,
    height: options.height,
    pose(clip, t, info) {
      f.applyPose(poseOf(figure, pick(clip, info), t));
      options.extra?.(clip, t, f, info);
    },
    dispose: () => disposeObject(holder),
  };
}

/** A static object as a character: it bobs when idle and squashes when it walks. */
export function propCharacter(object: THREE.Object3D, height: number): CharacterVisual {
  const holder = new THREE.Group();
  holder.add(object);
  return {
    object: holder,
    height,
    pose(clip, t) {
      const walking = clip === 'walk' || clip === 'jump';
      const k = walking ? Math.abs(Math.sin(t * 9)) : 0.5 + 0.5 * Math.sin(t * 2.2);
      object.position.y = walking ? k * 0.08 : k * 0.025;
      object.scale.set(1 + (walking ? (1 - k) * 0.06 : 0), 1 - (walking ? (1 - k) * 0.06 : 0) + (clip === 'cheer' ? Math.abs(Math.sin(t * 7)) * 0.12 : 0), 1);
      object.rotation.z = clip === 'sad' || clip === 'bump' ? Math.sin(t * 14) * 0.12 : 0;
    },
    dispose: () => disposeObject(holder),
  };
}

/** Whether a value is a `CharacterVisual` (and not a bare object). */
export function isCharacter(v: unknown): v is CharacterVisual {
  return !!v && typeof v === 'object' && 'object' in v && 'pose' in v;
}

/** Heading in radians (0 looks toward +z) of a grid direction: screen up (N) is −z. */
export function headingOf(dir: string): number {
  switch (dir) {
    case 'E':
      return Math.PI / 2;
    case 'W':
      return -Math.PI / 2;
    case 'N':
      return Math.PI;
    default:
      return 0;
  }
}

/** A little burst of cubes ("poof") for changes, reusing one instanced mesh. */
export class Poof {
  readonly mesh: THREE.InstancedMesh;
  private bursts: Array<{ x: number; y: number; z: number; t: number; color: THREE.Color }> = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private static readonly PER = 10;

  constructor(max = 8) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), mat, max * Poof.PER);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  burst(x: number, y: number, z: number, color = 0xffffff): void {
    this.bursts.push({ x, y, z, t: 0, color: new THREE.Color(color) });
    if (this.bursts.length * Poof.PER > this.mesh.instanceMatrix.count) this.bursts.shift();
  }

  update(dt: number): void {
    this.bursts = this.bursts.filter((b) => (b.t += dt) < 0.6);
    let i = 0;
    for (const b of this.bursts) {
      const k = b.t / 0.6;
      for (let j = 0; j < Poof.PER; j++) {
        const a = (j / Poof.PER) * Math.PI * 2 + j * 0.7;
        const r = 0.12 + easeOut(k) * 0.42;
        const s = (1 - k) * (0.7 + (j % 3) * 0.25);
        this.q.setFromEuler(this.e.set(k * 4 + j, k * 3, 0));
        this.m.compose(new THREE.Vector3(b.x + Math.cos(a) * r, b.y + 0.15 + Math.sin(k * Math.PI) * 0.35 + (j % 2) * 0.1, b.z + Math.sin(a) * r), this.q, new THREE.Vector3(s, s, s));
        this.mesh.setMatrixAt(i, this.m);
        this.mesh.setColorAt(i, b.color);
        i++;
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    disposeObject(this.mesh);
  }
}

/** A speech bubble that follows an anchor and fades out after its life (seconds; Infinity stays). */
export class Bubble {
  sprite: ScreenSprite | null = null;
  private life = 0;
  private age = 0;

  constructor(private readonly parent: THREE.Object3D, private readonly fit: (o: THREE.Object3D) => void) {}

  show(text: string, style: 'say' | 'error', life: number): void {
    this.clear();
    const t = textTexture(text, style);
    const s = new ScreenSprite(t.texture, t.aspect, 0.42 * t.lines + 0.16, 34 * t.lines + 14, 46 * t.lines + 18, { onTop: true });
    this.sprite = s;
    this.parent.add(s);
    this.fit(s);
    this.life = life;
    this.age = 0;
  }

  update(dt: number, anchor: THREE.Vector3): void {
    const s = this.sprite;
    if (!s) return;
    this.age += dt;
    s.position.copy(anchor);
    const pop = easeOutBack(clamp01(this.age / 0.25));
    const fade = this.life === Infinity ? 1 : clamp01((this.life - this.age) / 0.3);
    s.material.opacity = fade;
    s.scale.multiplyScalar(1);
    s.position.y += (1 - pop) * -0.1;
    if (this.age >= this.life) this.clear();
  }

  clear(): void {
    if (!this.sprite) return;
    this.sprite.removeFromParent();
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
    this.sprite = null;
  }
}
