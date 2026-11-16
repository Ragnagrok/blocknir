/**
 * The smallest useful example: build voxel models in code, place them, light them and render them
 * with an orbiting camera. Only `core` (data) and `render` (three.js) are used.
 */
import * as THREE from 'three';
import { createGrid, newModel, setCell, setGrid, type Grid, type Model } from '../../src/core/index.js';
import { glowSprite, placeModel, View } from '../../src/render/index.js';

/** Deterministic per-cell variation, so the same code always builds the same diorama. */
const hash = (x: number, y: number, z: number): number => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Makes a model and lets `paint` fill its grid. Palette index 0 is always empty. */
function model(id: string, size: [number, number, number], palette: number[], paint: (g: Grid) => void, emissive: number[] = []): Model {
  const m = newModel(id, id, size, 0.125, false, palette);
  const g = createGrid(...size);
  paint(g);
  setGrid(m, g);
  m.emissive = emissive;
  return m;
}

// The ground: grass with a stone path across it.
const GRASS = 1, GRASS_DARK = 2, STONE = 3, STONE_DARK = 4, DIRT = 5;
const ground = model('ground', [40, 3, 40], [0x4f7a3a, 0x3f6a30, 0x8a8a84, 0x6a6a66, 0x5a4030], (g) => {
  for (let z = 0; z < 40; z++) {
    for (let x = 0; x < 40; x++) {
      setCell(g, x, 0, z, DIRT);
      setCell(g, x, 1, z, DIRT);
      const path = Math.abs(x - 20 + Math.sin(z / 6) * 3) < 3;
      setCell(g, x, 2, z, path ? (hash(x, 0, z) < 0.5 ? STONE : STONE_DARK) : hash(x, 1, z) < 0.6 ? GRASS : GRASS_DARK);
    }
  }
});

// A lamp post whose lamp emits light (index 3 is emissive).
const lamp = model('lamp', [5, 26, 5], [0x2a2a30, 0x3a3a42, 0xffd486], (g) => {
  for (let y = 0; y < 22; y++) setCell(g, 2, y, 2, 1);
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) setCell(g, x, 0, z, 2);
  for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) for (let y = 22; y <= 24; y++) setCell(g, x, y, z, x === 2 && z === 2 ? 3 : 3);
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) setCell(g, x, 25, z, 2);
}, [3]);

// A bench: wooden seat and backrest on two iron legs.
const bench = model('bench', [14, 8, 5], [0x8a5a34, 0x6a4428, 0x2a2a30], (g) => {
  for (let x = 0; x < 14; x++) {
    for (let z = 0; z < 4; z++) setCell(g, x, 3, z, (x + z) % 3 ? 1 : 2);
    for (let y = 4; y < 8; y++) setCell(g, x, y, 4, y % 2 ? 1 : 2);
  }
  for (const x of [1, 12]) for (let y = 0; y < 3; y++) for (let z = 0; z < 5; z++) if (z === 0 || z === 4) setCell(g, x, y, z, 3);
});

// A small tree: a trunk and a lumpy crown.
const tree = model('tree', [17, 30, 17], [0x5a3a24, 0x3e6e34, 0x4f8a3e, 0x2f5a2a], (g) => {
  for (let y = 0; y < 14; y++) setCell(g, 8, y, 8, 1);
  for (let y = 10; y < 30; y++) {
    for (let z = 0; z < 17; z++) {
      for (let x = 0; x < 17; x++) {
        const d = Math.hypot(x - 8, (y - 20) * 1.15, z - 8);
        if (d < 8 - hash(x, y, z) * 1.6) setCell(g, x, y, z, 2 + Math.floor(hash(z, x, y) * 3));
      }
    }
  }
});

const view = new View(document.getElementById('view') as HTMLCanvasElement);
const scene = view.scene;
scene.background = new THREE.Color(0x07090f);
scene.fog = new THREE.FogExp2(0x07090f, 0.035);
scene.add(new THREE.HemisphereLight(0x8fa0d0, 0x2a2a20, 0.9));

// Cold moonlight from behind, so the warm lamp has something to contrast with.
const moon = new THREE.DirectionalLight(0x9fb4ff, 0.8);
moon.position.set(-4, 7, -5);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.bias = -0.0006;
moon.shadow.normalBias = 0.03;
scene.add(moon);

scene.add(placeModel(ground, [0, -0.375, 0], 0));
scene.add(placeModel(lamp, [-1.1, 0, -0.4], 0));
scene.add(placeModel(bench, [-1.1, 0, 0.5], 2));
scene.add(placeModel(tree, [1.4, 0, -1.1], 0));

const light = new THREE.PointLight(0xffc870, 6, 7, 1.7);
light.position.set(-1.1, 2.9, -0.4);
light.castShadow = true;
light.shadow.mapSize.set(1024, 1024);
light.shadow.bias = -0.002;
light.shadow.normalBias = 0.03;
scene.add(light);
const glow = glowSprite(0xffc870, 1.2);
glow.position.copy(light.position);
scene.add(glow);

const fit = (): void => view.resize(innerWidth, innerHeight);
addEventListener('resize', fit);
fit();

view.renderer.setAnimationLoop((ms) => {
  const t = ms / 1000;
  view.camera.position.set(Math.sin(t * 0.15 + 0.6) * 6.4, 3.4, Math.cos(t * 0.15 + 0.6) * 6.4);
  view.camera.lookAt(0, 1.1, 0);
  view.render(t);
});
