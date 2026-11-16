import * as THREE from 'three';
import { modelOf } from '../core/project.js';
import type { Instance, Light, Model, Project, Scene } from '../core/types.js';
import { instantiate } from './voxel-mesh.js';

/** A scene light together with the three.js object built from it. */
export interface LiveLight {
  data: Light;
  object: THREE.PointLight | THREE.SpotLight;
}

export interface BuiltScene {
  group: THREE.Group;
  lights: LiveLight[];
}

/** Builds a three.js light from scene data and adds it (and a spotlight's target) to `group`. */
export function createLight(l: Light, group: THREE.Object3D): LiveLight {
  let object: THREE.PointLight | THREE.SpotLight;
  if (l.kind === 'spot') {
    const spot = new THREE.SpotLight(l.color, l.intensity, l.range, l.angle, 0.35, 1.2);
    spot.target.position.set(...l.target);
    group.add(spot.target);
    spot.shadow.camera.near = 0.2;
    spot.shadow.camera.far = l.range;
    object = spot;
  } else {
    object = new THREE.PointLight(l.color, l.intensity, l.range, 1.7);
    object.shadow.camera.near = 0.06;
    object.shadow.camera.far = l.range;
  }
  object.position.set(...l.pos);
  object.castShadow = l.shadow;
  object.shadow.mapSize.set(1024, 1024);
  object.shadow.bias = -0.002;
  object.shadow.normalBias = 0.03;
  group.add(object);
  return { data: l, object };
}

/** A model placed by the center of its base, turned `rot` quarter turns around y. */
export function placeModel(m: Model, pos: readonly [number, number, number], rot: number): THREE.Group {
  const holder = new THREE.Group();
  const mesh = instantiate(m);
  mesh.position.set((-m.size[0] * m.scale) / 2, 0, (-m.size[2] * m.scale) / 2);
  holder.add(mesh);
  holder.position.set(pos[0], pos[1], pos[2]);
  holder.rotation.y = (rot * Math.PI) / 2;
  return holder;
}

export function placeInstance(p: Project, i: Instance): THREE.Group {
  return placeModel(modelOf(p, i.model), i.pos, i.rot);
}

/** Room, objects and lights. Entities are added by whoever needs them (the game or the editor). */
export function buildScene(p: Project, s: Scene): BuiltScene {
  const group = new THREE.Group();
  group.add(instantiate(modelOf(p, s.room)));
  for (const i of s.instances) group.add(placeInstance(p, i));
  group.add(new THREE.AmbientLight(s.ambient.color, s.ambient.intensity));
  const lights = s.lights.map((l) => createLight(l, group));
  return { group, lights };
}

/**
 * Organic flame-like intensity multiplier, without real randomness: it depends only on time.
 * `amount` is the light's `flicker` (0 to 1).
 */
export function flickerAt(t: number, amount: number): number {
  const noise = Math.sin(t * 11.3) * 0.5 + Math.sin(t * 23.7 + 1.3) * 0.3 + Math.sin(t * 41.1 + 2.1) * 0.2;
  return 1 + noise * 0.16 * amount;
}
