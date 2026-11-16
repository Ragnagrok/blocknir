# Ragnagrok Engine

*[Read in English](README.md)*

Un engine de voxels chico para la web, escrito en TypeScript sobre [three.js](https://threejs.org).
Trae un editor en el navegador y un motor de sonido sintetizado: un juego se puede hacer con
modelos, escenas y sonido, sin archivos de imagen ni de audio.

Salió de dos juegos de [Ragnagrok](https://github.com/Ragnagrok): **Nullgard**, una aventura vista
desde arriba sobre aprender a programar, y un prototipo de survival horror en voxels con cámaras
fijas.

- **Modelos de voxels** con un formato comprimido, mallado por trozos con oclusión ambiental por
  vértice, colores que emiten luz y copias baratas de los objetos que se repiten.
- **Figuras articuladas**: personajes hechos de partes de voxels con articulaciones, animados con
  clips por claves.
- **Escenas** con cámaras fijas y zonas que las activan, luces de punto y foco que pueden titilar,
  niebla, entidades (jugador, criaturas, items, notas, puertas) y un mapa de alturas para caminar y
  buscar caminos.
- **Un editor en el navegador** para pintar modelos, articular y animar figuras y armar escenas.
  Guarda en el navegador, en archivos `.json` o, mientras desarrollás, directo en disco.
- **Sonido sintetizado**: un motor con canales de música, efectos y ambiente, trece instrumentos,
  un secuenciador por pasos con una notación compacta, pasos, sonidos de interfaz y fondos de
  ambiente.
- **Kit de juego**: joystick táctil que aparece donde apoyás el dedo, caja de diálogo que escribe
  sola, cinemáticas con async, actores que caminan y ranuras de guardado.
- **Pintura procedural**: formas y ruido determinista para armar modelos por código, y un
  generador de personajes de voxels paramétrico que ya viene articulado y animado.

## Probarlo

Online, sin instalar nada: **<https://engine.ragnagrok.com>** (el editor y los ejemplos).

O en tu máquina:

```sh
git clone https://github.com/Ragnagrok/ragnagrok-engine.git
cd ragnagrok-engine
npm install
npm run dev
```

Abrí la dirección que muestra Vite:

- `/editor/`: el editor, con un proyecto de arranque. **Play** lo abre en el ejemplo de aventura.
- `/examples/adventure/`: una aventura mínima de cámaras fijas que juega cualquier proyecto del
  editor.
- `/examples/room/`: el ejemplo más chico, un diorama armado por código.

Para que **Play** abra tu propio juego en vez del ejemplo de aventura, abrí el editor con
`/editor/?play=<url>`.

Para que el editor guarde el proyecto en un archivo del disco mientras desarrollás:

```sh
PROJECT=ruta/al/proyecto.json npm run dev
```

## Usarlo en un juego

Todavía no está en npm. Se instala desde GitHub; `three` es una dependencia par:

```sh
npm install three github:Ragnagrok/ragnagrok-engine
```

```ts
import { createGrid, newModel, setCell, setGrid } from 'ragnagrok-engine/core';
import { placeModel, View } from 'ragnagrok-engine/render';

const caja = newModel('caja', 'Caja', [8, 8, 8], 0.125, false, [0x8a5a34, 0x5a3a20]);
const grilla = createGrid(8, 8, 8);
for (let y = 0; y < 8; y++)
  for (let z = 0; z < 8; z++)
    for (let x = 0; x < 8; x++) setCell(grilla, x, y, z, (x + y + z) % 2 ? 1 : 2);
setGrid(caja, grilla);

const vista = new View(document.querySelector('canvas')!);
vista.scene.add(placeModel(caja, [0, 0, 0], 0));
vista.resize(innerWidth, innerHeight);
vista.camera.position.set(2, 2, 2);
vista.camera.lookAt(0, 0.5, 0);
vista.renderer.setAnimationLoop((ms) => vista.render(ms / 1000));
```

El sonido tampoco necesita archivos:

```ts
import { DEMO_TRACK, GameAudio } from 'ragnagrok-engine/audio';

const audio = new GameAudio({ storageKey: 'mi-juego.audio' });
audio.start(); // empieza a sonar después del primer toque o tecla
audio.playTrack(DEMO_TRACK);
audio.play((sfx) => sfx.step('stone'));
```

## Módulos

| Import | Qué tiene |
|---|---|
| `ragnagrok-engine/core` | El formato del proyecto (`Project`, `Model`, `Scene`, `Figure`…), grillas de voxels y rayos, poses por claves, el mapa de alturas y la búsqueda de caminos, la validación, y `migrateLegacyProject` para proyectos guardados por el editor original en español. Sin DOM ni three.js. |
| `ragnagrok-engine/render` | El mallado (`meshVoxels`, `VoxelMesh`), `buildScene`, `Figure3D` y `View`: renderer, sombras, bloom y un acabado de película suave. |
| `ragnagrok-engine/audio` | `AudioEngine`, `INSTRUMENTS`, el secuenciador `Playback` y la teoría musical, `Sfx`, `Ambience` y la fachada `GameAudio`. |
| `ragnagrok-engine/kit` | `Joystick`, `Dialogue`, `Director`, `Actor`, `SaveSlot`. |
| `ragnagrok-engine/paint` | `VoxelCanvas` y funciones de ruido para modelos procedurales, y `createHumanoid`, un personaje de voxels paramétrico (piel, pelo, ropa, anteojos, barba, silueta) ya articulado con clips de reposo, caminar, consultar y hablar. |

Las posiciones van en metros, el tamaño de los modelos en voxels y los ángulos en radianes. Un rumbo
0 mira hacia +z. El código está en inglés; [`GLOSSARY.md`](GLOSSARY.md) traduce cada nombre al que
tenía en español adentro de los juegos.

## Desarrollar

```sh
npm test            # pruebas unitarias
npm run typecheck
npm run build       # dist/, lo que usan los juegos
npm run build:site  # site/: el editor y los ejemplos como sitio estático
npx tsx tools/test-editor.ts             # maneja el editor con mouse y teclado reales
npx tsx tools/render-audio.ts <carpeta>  # pasa música y sonidos a WAV y revisa los niveles
```

## Licencia

[MIT](LICENSE) © 2026 Ragnagrok
