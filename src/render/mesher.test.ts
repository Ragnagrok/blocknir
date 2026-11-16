import { describe, expect, it } from 'vitest';
import { createGrid, setCell } from '../core/voxel.js';
import { meshVoxels, type MeshData, type MeshOptions } from './mesher.js';

const options = (size: [number, number, number], closed: boolean): MeshOptions => ({
  palette: [0, 0xffffff, 0xffaa00],
  emissive: [2],
  closed,
  from: [0, 0, 0],
  to: size,
});

const faceCount = (d: MeshData): number => d.positions.length / 12;

/** A 5x5x5 box whose shell is solid and whose 3x3x3 inside is empty. */
function hollowBox(): ReturnType<typeof createGrid> {
  const g = createGrid(5, 5, 5);
  for (let y = 0; y < 5; y++) {
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        if (x === 0 || y === 0 || z === 0 || x === 4 || y === 4 || z === 4) setCell(g, x, y, z, 1);
      }
    }
  }
  return g;
}

describe('meshVoxels', () => {
  it('a single voxel yields 6 faces and 24 vertices', () => {
    const g = createGrid(1, 1, 1);
    setCell(g, 0, 0, 0, 1);
    const { solid, emissive } = meshVoxels(g, options([1, 1, 1], false));
    expect(faceCount(solid)).toBe(6);
    expect(solid.positions.length / 3).toBe(24);
    expect(solid.normals.length).toBe(solid.positions.length);
    expect(solid.colors.length).toBe(solid.positions.length);
    expect(solid.indices.length).toBe(36);
    expect(faceCount(emissive)).toBe(0);
  });

  it('a closed room yields no outward faces', () => {
    const g = hollowBox();
    const { solid } = meshVoxels(g, options([5, 5, 5], true));
    // Only the 6 inner walls of the 3x3x3 cavity.
    expect(faceCount(solid)).toBe(6 * 9);
    for (let f = 0; f < faceCount(solid); f++) {
      const c = [0, 1, 2].map((e) => {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += solid.positions[(f * 4 + k) * 3 + e]!;
        return sum / 4 + solid.normals[f * 12 + e]! * 0.5;
      });
      // Half a voxel along the normal from the face center lands inside the cavity.
      for (const v of c) expect(v > 1 && v < 4).toBe(true);
    }
    expect(faceCount(meshVoxels(g, options([5, 5, 5], false)).solid)).toBe(6 * 9 + 6 * 25);
  });

  it('emissive voxels go to their own mesh and cutY hides the top', () => {
    const g = createGrid(1, 2, 1);
    setCell(g, 0, 0, 0, 1);
    setCell(g, 0, 1, 0, 2);
    const both = meshVoxels(g, options([1, 2, 1], false));
    expect(faceCount(both.solid)).toBe(5);
    expect(faceCount(both.emissive)).toBe(5);
    const cut = meshVoxels(g, { ...options([1, 2, 1], false), cutY: 1 });
    expect(faceCount(cut.solid)).toBe(6);
    expect(faceCount(cut.emissive)).toBe(0);
  });
});
