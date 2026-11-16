import type { Clip, Figure, V3 } from './types.js';

/** Rotation of each part, in radians, by part id. */
export type Pose = Record<string, V3>;

/** Linear interpolation between keyframes at time `t`; looping clips also blend the last key into the first. */
export function poseFromClip(clip: Clip, t: number): Pose {
  const keys = [...clip.keys].sort((a, b) => a.t - b.t);
  if (keys.length === 0) return {};
  const time = clip.loop && clip.duration > 0 ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(t, clip.duration);

  let a = keys[keys.length - 1]!;
  let b = keys[0]!;
  let u = 0;
  if (time < keys[0]!.t) {
    if (clip.loop) {
      const gap = keys[0]!.t + clip.duration - a.t;
      u = gap > 0 ? (time + clip.duration - a.t) / gap : 0;
    } else {
      a = b;
    }
  } else if (time >= a.t) {
    if (clip.loop) {
      const gap = keys[0]!.t + clip.duration - a.t;
      u = gap > 0 ? (time - a.t) / gap : 0;
    } else {
      b = a;
    }
  } else {
    for (let i = 0; i + 1 < keys.length; i++) {
      if (time >= keys[i]!.t && time < keys[i + 1]!.t) {
        a = keys[i]!;
        b = keys[i + 1]!;
        u = (time - a.t) / (b.t - a.t);
        break;
      }
    }
  }

  const pose: Pose = {};
  for (const id of new Set([...Object.keys(a.rot), ...Object.keys(b.rot)])) {
    const ra = a.rot[id] ?? [0, 0, 0];
    const rb = b.rot[id] ?? [0, 0, 0];
    pose[id] = [ra[0] + (rb[0] - ra[0]) * u, ra[1] + (rb[1] - ra[1]) * u, ra[2] + (rb[2] - ra[2]) * u];
  }
  return pose;
}

/** Pose of the named clip, falling back to the figure's first clip. */
export function poseOf(f: Figure, clipName: string, t: number): Pose {
  const clip = f.clips.find((c) => c.name === clipName) ?? f.clips[0];
  return clip ? poseFromClip(clip, t) : {};
}
