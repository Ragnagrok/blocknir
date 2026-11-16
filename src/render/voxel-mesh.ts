import * as THREE from 'three';
import { gridOf } from '../core/project.js';
import type { Model, V3 } from '../core/types.js';
import type { Grid } from '../core/voxel.js';
import { meshVoxels, type MeshData } from './mesher.js';

/** Chunk side, in voxels. */
const CHUNK = 32;

/** Shared material for regular voxels. */
export const solidMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.88,
  metalness: 0,
  shadowSide: THREE.DoubleSide,
});

/** Shared unlit material for emissive voxels; the color above 1 feeds the bloom pass. */
export const emissiveMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) });

function geometry(d: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** A voxel model split into chunks, so it can be edited without rebuilding everything. */
export class VoxelMesh extends THREE.Group {
  private chunks = new Map<string, THREE.Mesh[]>();
  private dirty = new Set<string>();
  readonly grid: Grid;
  /** Cells with y at or above this are hidden; call `rebuild` after changing it. */
  cutY: number | undefined;

  constructor(readonly model: Model) {
    super();
    this.grid = gridOf(model);
    this.scale.setScalar(model.scale);
    this.rebuild();
  }

  rebuild(): void {
    for (const k of [...this.chunks.keys()]) this.discard(k);
    const g = this.grid;
    for (let y = 0; y < Math.ceil(g.y / CHUNK); y++) {
      for (let z = 0; z < Math.ceil(g.z / CHUNK); z++) {
        for (let x = 0; x < Math.ceil(g.x / CHUNK); x++) this.remesh(x, y, z);
      }
    }
    this.dirty.clear();
  }

  /** Marks a cell as modified, including the neighboring chunks it affects. Takes effect on `apply`. */
  touch(x: number, y: number, z: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = Math.floor((x + dx) / CHUNK);
          const cy = Math.floor((y + dy) / CHUNK);
          const cz = Math.floor((z + dz) / CHUNK);
          if (cx >= 0 && cy >= 0 && cz >= 0) this.dirty.add(`${cx},${cy},${cz}`);
        }
      }
    }
  }

  /** Rebuilds the chunks marked by `touch`. */
  apply(): void {
    for (const k of this.dirty) {
      const [x, y, z] = k.split(',').map(Number) as V3;
      if (x * CHUNK < this.grid.x && y * CHUNK < this.grid.y && z * CHUNK < this.grid.z) this.remesh(x, y, z);
    }
    this.dirty.clear();
  }

  private discard(key: string): void {
    for (const m of this.chunks.get(key) ?? []) {
      this.remove(m);
      m.geometry.dispose();
    }
    this.chunks.delete(key);
  }

  private remesh(cx: number, cy: number, cz: number): void {
    const key = `${cx},${cy},${cz}`;
    this.discard(key);
    const { palette, emissive, closed } = this.model;
    const g = this.grid;
    const mesh = meshVoxels(g, {
      palette,
      emissive,
      closed,
      from: [cx * CHUNK, cy * CHUNK, cz * CHUNK],
      to: [Math.min(g.x, (cx + 1) * CHUNK), Math.min(g.y, (cy + 1) * CHUNK), Math.min(g.z, (cz + 1) * CHUNK)],
      cutY: this.cutY,
    });
    const created: THREE.Mesh[] = [];
    if (mesh.solid.indices.length) {
      const m = new THREE.Mesh(geometry(mesh.solid), solidMaterial);
      m.castShadow = true;
      m.receiveShadow = true;
      created.push(m);
    }
    if (mesh.emissive.indices.length) created.push(new THREE.Mesh(geometry(mesh.emissive), emissiveMaterial));
    for (const m of created) this.add(m);
    if (created.length) this.chunks.set(key, created);
  }
}

const cache = new WeakMap<Model, VoxelMesh>();

/** A copy that shares geometry: repeated furniture does not cost extra memory. */
export function instantiate(m: Model): THREE.Object3D {
  let base = cache.get(m);
  if (!base) {
    base = new VoxelMesh(m);
    cache.set(m, base);
  }
  const copy = new THREE.Group();
  copy.scale.copy(base.scale);
  for (const child of base.children) copy.add(child.clone());
  return copy;
}

/** Drops the cached mesh of a model, so the next `instantiate` rebuilds it (after edits). */
export function forgetMesh(m: Model): void {
  cache.delete(m);
}
