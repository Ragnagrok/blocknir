# Ragnagrok Engine

*[Leer en español](README.es.md)*

A small voxel engine for the web, written in TypeScript on top of [three.js](https://threejs.org).
It comes with a browser editor and a synthesized audio engine, so a game can be made of models,
scenes and sound without image or audio files.

It was extracted from two games by [Ragnagrok](https://github.com/Ragnagrok): **Nullgard**, a
top-down adventure about learning to program, and a fixed-camera voxel survival-horror prototype.

- **Voxel models** with a compact run-length format, chunked meshing with per-vertex ambient
  occlusion, emissive colors that glow, and cheap instancing of repeated props.
- **Rigged figures**: characters made of articulated voxel parts, animated with keyframe clips.
- **Scenes** with fixed cameras and trigger zones, point and spot lights with flicker, fog,
  entities (player, creatures, items, notes, doors) and a heightmap for walking and pathfinding.
- **A browser editor** to paint models, rig and animate figures and lay out scenes. It saves to the
  browser, to `.json` files, or straight to disk while developing.
- **Synthesized audio**: an engine with music, effects and ambience buses, thirteen instruments, a
  step sequencer with a compact pattern notation, footsteps, UI blips and ambience beds.
- **Game kit**: a floating touch joystick, a typewriter dialogue box, async cutscenes, walking
  actors and save slots.
- **Procedural painting**: shapes and deterministic noise to build models in code, and a
  parametric voxel humanoid generator that comes rigged and animated.

## Try it

Online, without installing anything: **<https://engine.ragnagrok.com>** (the editor and the examples).

Or locally:

```sh
git clone https://github.com/Ragnagrok/ragnagrok-engine.git
cd ragnagrok-engine
npm install
npm run dev
```

Then open the address Vite prints:

- `/editor/`: the editor, with a starter project. **Play** opens it in the adventure example.
- `/examples/adventure/`: a minimal fixed-camera adventure that plays any project from the editor.
- `/examples/room/`: the smallest example, a diorama built in code.

To point **Play** at your own game instead of the adventure example, open the editor with
`/editor/?play=<url>`.

To save the editor's project to a file on disk while developing:

```sh
PROJECT=path/to/project.json npm run dev
```

## Use it in a game

The engine is not on npm yet. Install it from GitHub; `three` is a peer dependency:

```sh
npm install three github:Ragnagrok/ragnagrok-engine
```

```ts
import { createGrid, newModel, setCell, setGrid } from 'ragnagrok-engine/core';
import { placeModel, View } from 'ragnagrok-engine/render';

const crate = newModel('crate', 'Crate', [8, 8, 8], 0.125, false, [0x8a5a34, 0x5a3a20]);
const grid = createGrid(8, 8, 8);
for (let y = 0; y < 8; y++)
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 8; x++) setCell(grid, x, y, z, (x + y + z) % 2 ? 1 : 2);
setGrid(crate, grid);

const view = new View(document.querySelector('canvas')!);
view.scene.add(placeModel(crate, [0, 0, 0], 0));
view.resize(innerWidth, innerHeight);
view.camera.position.set(2, 2, 2);
view.camera.lookAt(0, 0.5, 0);
view.renderer.setAnimationLoop((ms) => view.render(ms / 1000));
```

Sound needs no files either:

```ts
import { DEMO_TRACK, GameAudio } from 'ragnagrok-engine/audio';

const audio = new GameAudio({ storageKey: 'my-game.audio' });
audio.start(); // it begins sounding after the first tap or key press
audio.playTrack(DEMO_TRACK);
audio.play((sfx) => sfx.step('stone'));
```

## Modules

| Import | What's in it |
|---|---|
| `ragnagrok-engine/core` | The project format (`Project`, `Model`, `Scene`, `Figure`…), voxel grids and raycasting, keyframe poses, the walkable heightmap and pathfinding, validation, and `migrateLegacyProject` for projects saved by the original Spanish-language editor. No DOM, no three.js. |
| `ragnagrok-engine/render` | Meshing (`meshVoxels`, `VoxelMesh`), `buildScene`, `Figure3D`, and `View`: renderer, shadows, bloom and a light film finish. |
| `ragnagrok-engine/audio` | `AudioEngine`, `INSTRUMENTS`, the `Playback` sequencer and music theory helpers, `Sfx`, `Ambience`, and the `GameAudio` facade. |
| `ragnagrok-engine/kit` | `Joystick`, `Dialogue`, `Director`, `Actor`, `SaveSlot`. |
| `ragnagrok-engine/paint` | `VoxelCanvas` and noise helpers for procedural models, and `createHumanoid`, a parametric voxel character (skin, hair, clothes, glasses, beard, silhouette) rigged with idle, walk, inspect and talk clips. |
| `ragnagrok-engine/blocks` | A block-based programming language for kids and its interpreter, with the worlds programs run in: a grid with a robot (items, lamps, arrows, walls, level-defined actions), a drawing turtle, and a tick-based realtime arena with scripted actors. Levels, goals and execution traces are plain JSON; `check(level, program)` tests a program on every board and says why it fails, in Spanish by default. No DOM, no three.js. See [`src/blocks/README.md`](src/blocks/README.md). |

Positions are in meters, model sizes in voxels, angles in radians. A heading of 0 faces +z.
[`GLOSSARY.md`](GLOSSARY.md) maps the engine's names to the Spanish ones it had inside the games.

## Develop

```sh
npm test            # unit tests
npm run typecheck
npm run build       # dist/ for consumers
npm run build:site  # site/: the editor and examples as a static site
npx tsx tools/test-editor.ts             # drives the editor with a real mouse and keyboard
npx tsx tools/render-audio.ts <folder>   # renders music and sounds to WAV and checks levels
```

## License

[MIT](LICENSE) © 2026 Ragnagrok
