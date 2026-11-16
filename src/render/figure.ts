import * as THREE from 'three';
import type { Pose } from '../core/anim.js';
import { modelOf } from '../core/project.js';
import type { Figure, Project } from '../core/types.js';
import { glowSprite } from './view.js';
import { instantiate } from './voxel-mesh.js';

/** A character built from rigid, jointed parts. */
export class Figure3D extends THREE.Group {
  /** One group per part, placed at its joint, by part id. */
  readonly joints = new Map<string, THREE.Group>();
  /** The lantern's light, if the figure has one and it was not disabled. */
  light: THREE.PointLight | null = null;
  glow: THREE.Sprite | null = null;

  constructor(p: Project, readonly figure: Figure, options: { light?: boolean } = {}) {
    super();
    for (const part of figure.parts) {
      const g = new THREE.Group();
      g.name = part.id;
      g.position.set(...part.pivot);
      const model = modelOf(p, part.model);
      const mesh = instantiate(model);
      mesh.position.set(-part.origin[0] * model.scale, -part.origin[1] * model.scale, -part.origin[2] * model.scale);
      g.add(mesh);
      this.joints.set(part.id, g);
    }
    for (const part of figure.parts) {
      const g = this.joints.get(part.id)!;
      const parent = part.parent ? this.joints.get(part.parent) : undefined;
      (parent ?? this).add(g);
    }

    const l = figure.lantern;
    const anchor = l && this.joints.get(l.part);
    if (l && anchor && options.light !== false) {
      // The lantern's casing surrounds the light: if it cast shadows, it would block itself.
      anchor.traverse((o) => {
        o.castShadow = false;
      });
      const light = new THREE.PointLight(l.color, l.intensity, l.range, 1.7);
      light.position.set(...l.pos);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = 0.06;
      light.shadow.camera.far = l.range;
      light.shadow.bias = -0.003;
      light.shadow.normalBias = 0.03;
      anchor.add(light);
      this.light = light;
      this.glow = glowSprite(l.color, 0.75);
      this.glow.position.set(...l.pos);
      anchor.add(this.glow);
    }
  }

  /** Sets every joint's rotation; parts missing from the pose go back to rest. */
  applyPose(pose: Pose): void {
    for (const [id, g] of this.joints) {
      const r = pose[id];
      if (r) g.rotation.set(r[0], r[1], r[2]);
      else g.rotation.set(0, 0, 0);
    }
  }
}
