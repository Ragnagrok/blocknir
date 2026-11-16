/**
 * Camera framing for boards: a fixed three-quarter view that looks north (screen up is the board's
 * `y = 0` row) from above and from the south, at a distance that fits the whole content in the
 * viewport. Pure math, no three.js: positions are plain `[x, y, z]` triples.
 */

export type Vec3 = [x: number, y: number, z: number];

/** An axis-aligned box. */
export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface FramingOptions {
  /** Vertical field of view, in degrees. */
  fov: number;
  /** Viewport width / height. */
  aspect: number;
  /** Degrees below the horizon the camera looks. Default: `pitchFor(aspect)`. */
  pitch?: number;
  /** Fraction of the viewport left free on each side. Default 0.06. */
  margin?: number;
  /** The box is widened to at least this many meters in x and z, so tiny boards are not huge. Default 3. */
  minExtent?: number;
}

export interface Framing {
  position: Vec3;
  target: Vec3;
  /** Degrees below the horizon. */
  pitch: number;
  /** From the camera to the target, in meters. */
  distance: number;
}

const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/**
 * The pitch that suits an aspect ratio: wide viewports look lower (more three-quarter), tall phone
 * screens look more from above, so deep boards use the extra height.
 */
export function pitchFor(aspect: number): number {
  const t = clamp((1.35 - aspect) / 0.8, 0, 1);
  return 50 + t * 16;
}

/** The camera axes for a pitch: forward, right and up (unit vectors). */
export function cameraAxes(pitch: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const s = Math.sin(pitch * DEG);
  const c = Math.cos(pitch * DEG);
  return { forward: [0, -s, -c], right: [1, 0, 0], up: [0, c, -s] };
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The 8 corners of a box. */
export function corners(b: Bounds): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

/** Widens a box in x and z to at least `extent` meters, around its center. */
export function widen(b: Bounds, extent: number): Bounds {
  const min: Vec3 = [...b.min];
  const max: Vec3 = [...b.max];
  for (const i of [0, 2] as const) {
    const size = max[i] - min[i];
    if (size < extent) {
      const grow = (extent - size) / 2;
      min[i] -= grow;
      max[i] += grow;
    }
  }
  return { min, max };
}

/**
 * Where a point lands on screen for a camera at `position` looking along `pitch`: `x` and `y` in
 * tangent units (divide by `tan(fov / 2)` for normalized device coordinates), `depth` in meters.
 */
export function project(p: Vec3, position: Vec3, pitch: number): { x: number; y: number; depth: number } {
  const { forward, right, up } = cameraAxes(pitch);
  const rel: Vec3 = [p[0] - position[0], p[1] - position[1], p[2] - position[2]];
  const depth = dot(rel, forward);
  return { x: dot(rel, right) / depth, y: dot(rel, up) / depth, depth };
}

/**
 * Frames a box: the camera keeps its pitch and looks north; the distance is the smallest that fits
 * every corner inside the viewport (minus the margin), and the target is shifted so the projected
 * box is centered on screen.
 */
export function frameBox(box: Bounds, o: FramingOptions): Framing {
  const pitch = o.pitch ?? pitchFor(o.aspect);
  const margin = o.margin ?? 0.06;
  const b = widen(box, o.minExtent ?? 3);
  const ty = Math.tan((o.fov * DEG) / 2) * (1 - 2 * margin);
  const tx = Math.tan((o.fov * DEG) / 2) * o.aspect * (1 - 2 * margin);
  const { forward, right, up } = cameraAxes(pitch);
  const pts = corners(b);
  let target: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  let distance = 1;
  const at = (t: Vec3, d: number): Vec3 => [t[0] - forward[0] * d, t[1] - forward[1] * d, t[2] - forward[2] * d];
  for (let iteration = 0; iteration < 8; iteration++) {
    // The smallest distance that fits every corner, for this target.
    distance = 0.1;
    for (const p of pts) {
      const rel: Vec3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
      const along = dot(rel, forward);
      distance = Math.max(distance, Math.abs(dot(rel, right)) / tx - along, Math.abs(dot(rel, up)) / ty - along);
    }
    // Center the projection: move the target by the offset of the projected bounds' middle.
    const position = at(target, distance);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      const q = project(p, position, pitch);
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (Math.abs(cx) < 1e-5 && Math.abs(cy) < 1e-5) break;
    target = [target[0] + right[0] * cx * distance + up[0] * cy * distance, target[1] + right[1] * cx * distance + up[1] * cy * distance, target[2] + right[2] * cx * distance + up[2] * cy * distance];
  }
  // One last fit for the final target, so no corner pokes out after the shift.
  distance = 0.1;
  for (const p of pts) {
    const rel: Vec3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
    const along = dot(rel, forward);
    distance = Math.max(distance, Math.abs(dot(rel, right)) / tx - along, Math.abs(dot(rel, up)) / ty - along);
  }
  return { position: at(target, distance), target, pitch, distance };
}

/** The bounds a grid board needs on screen: its cells, a rim around them and room for a character. */
export function boardBounds(width: number, height: number, options: { rim?: number; top?: number } = {}): Bounds {
  const rim = options.rim ?? 0.2;
  const top = options.top ?? 1.25;
  return { min: [-width / 2 - rim, -0.4, -height / 2 - rim], max: [width / 2 + rim, top, height / 2 + rim] };
}

/** Screen pixels per meter at a camera distance, for a viewport `viewportHeight` pixels tall. */
export function pixelsPerMeter(distance: number, fov: number, viewportHeight: number): number {
  return viewportHeight / (2 * Math.tan((fov * DEG) / 2) * Math.max(1e-6, distance));
}

/**
 * The camera distance at which one meter (one cell) measures `px` pixels on screen.
 * The inverse of `pixelsPerMeter`.
 */
export function distanceForPixels(px: number, fov: number, viewportHeight: number): number {
  return viewportHeight / (2 * Math.tan((fov * DEG) / 2) * Math.max(1e-6, px));
}

export interface FollowOptions extends FramingOptions {
  /** Viewport height in pixels. */
  viewportHeight: number;
  /** How big a 1 m cell should look, in pixels. */
  cellPx: number;
  /** The framing of the whole box (computed if missing). The follow view is never farther. */
  full?: Framing;
}

/**
 * A closer view that keeps `focus` (the character) near the middle of the screen at a comfortable
 * zoom (`cellPx` pixels per meter), with the same pitch as the full framing. The target is clamped
 * so the view does not leave the box: along an axis where the box is smaller than the view, the box
 * stays centered; where it is larger, the view slides over it and stops at its edges. When the
 * whole box already fits at that zoom, this is the full framing.
 */
export function followBox(box: Bounds, focus: Vec3, o: FollowOptions): Framing {
  const full = o.full ?? frameBox(box, o);
  const d = Math.min(full.distance, distanceForPixels(o.cellPx, o.fov, o.viewportHeight));
  if (d >= full.distance * 0.999) return full;
  const pitch = full.pitch;
  const half = (o.fov * DEG) / 2;
  const p = pitch * DEG;
  // The camera looks a bit above the floor (at the character's middle); the view is measured on the floor.
  const floor = focus[1];
  const y = Math.max(box.min[1], Math.min(box.max[1], floor + 0.35));
  const lift = y - floor;
  const height = lift + d * Math.sin(p);
  const back = d * Math.cos(p);
  // How far the floor reaches toward the bottom (near) and the top (far) of the screen from the
  // point under the target.
  const near = back - height / Math.tan(p + half);
  const far = p - half > 0.01 ? height / Math.tan(p - half) - back : Infinity;
  const slide = (want: number, lo: number, hi: number): number => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, want)));
  // Screen up is −z: the far edge of the view must not pass the box's far side, nor the near edge its near side.
  // A board shallower than the view keeps its middle row in the middle of the screen.
  const zLo = box.min[2] + far;
  const zHi = box.max[2] - near;
  const z = zLo > zHi ? (box.min[2] + box.max[2]) / 2 + lift / Math.tan(p) : Math.min(zHi, Math.max(zLo, focus[2]));
  // The floor seen is a trapezoid: measure its half width across the middle of the visible board.
  const rows = (Math.max(box.min[2], z - far) + Math.min(box.max[2], z + near)) / 2;
  const depth = (z + back - rows) * Math.cos(p) + height * Math.sin(p);
  const hx = depth * Math.tan(half) * o.aspect;
  const x = slide(focus[0], box.min[0] + hx, box.max[0] - hx);
  const target: Vec3 = [x, y, z];
  const { forward } = cameraAxes(pitch);
  return { position: [x - forward[0] * d, y - forward[1] * d, z - forward[2] * d], target, pitch, distance: d };
}
