# Glossary · Glosario

The engine was born in Spanish, inside two games (casa-voxel and Nullgard). This table maps the old
names to the new ones, so those games (and anyone reading their code) can migrate.

El engine nació en español, adentro de dos juegos (casa-voxel y Nullgard). Esta tabla traduce los
nombres viejos a los nuevos, para migrar esos juegos y para quien lea su código.

## core

| Antes | Now |
|---|---|
| `Modelo { id, nombre, tam, escala, paleta, emisivos, cerrado, datos }` | `Model { id, name, size, scale, palette, emissive, closed, data }` |
| `Instancia { id, modelo, pos, rot, solido }` | `Instance { id, model, pos, rot, solid }` |
| `Camara { id, nombre, pos, mira, fov, zona: { min, max } }` | `Camera { id, name, pos, target, fov, zone: { min, max } }` |
| `Luz { id, nombre, tipo: 'punto' \| 'foco', pos, mira, color, intensidad, alcance, angulo, sombra, parpadeo }` | `Light { id, name, kind: 'point' \| 'spot', pos, target, color, intensity, range, angle, shadow, flicker }` |
| `TipoEntidad = 'jugador' \| 'criatura' \| 'item' \| 'nota' \| 'puerta'` | `EntityKind = 'player' \| 'creature' \| 'item' \| 'note' \| 'door'` |
| `Entidad { id, tipo, nombre, pos, rumbo, figura?, modelo?, texto?, requiere?, textoCerrado?, destino?, entrada? }` | `Entity { id, kind, name, pos, heading, figure?, model?, text?, requires?, lockedText?, destination?, entry? }` |
| `Escena { id, nombre, sala, instancias, camaras, luces, entidades, ambiente: { color, intensidad }, niebla: { color, densidad } }` | `Scene { id, name, room, instances, cameras, lights, entities, ambient: { color, intensity }, fog: { color, density } }` |
| `Parte { id, modelo, padre, pivote, origen }` | `Part { id, model, parent, pivot, origin }` |
| `Clave { t, rot }` | `Keyframe { t, rot }` |
| `Clip { nombre, duracion, bucle, claves }` | `Clip { name, duration, loop, keys }` |
| `Faro { parte, pos, color, intensidad, alcance }` | `Lantern { part, pos, color, intensity, range }` |
| `Figura { id, nombre, partes, clips, faro? }` | `Figure { id, name, parts, clips, lantern? }` |
| `Proyecto { version, nombre, escenaInicial, modelos, figuras, escenas }` | `Project { version, name, startScene, models, figures, scenes }` |
| `Grilla { x, y, z, celdas }` | `Grid { x, y, z, cells }` |
| `crearGrilla`, `indice`, `dentro`, `leer`, `escribir` | `createGrid`, `cellIndex`, `inBounds`, `getCell`, `setCell` |
| `codificar`, `decodificar`, `redimensionar`, `celdasPerdidas` | `encodeGrid`, `decodeGrid`, `resizeGrid`, `lostCells` |
| `rayo(g, o, d, { saltarExterior, ignorar })` → `Impacto { celda, previa, normal }` | `raycast(g, o, d, { skipExterior, ignore })` → `Hit { cell, previous, normal }` |
| `grillaDe`, `volcarGrillas`, `fijarGrilla`, `nuevoModelo` | `gridOf`, `flushGrids`, `setGrid`, `newModel` |
| `Ancla = 'inicio' \| 'centro' \| 'fin'`, `desplazamientoPara`, `redimensionarModelo` | `Anchor = 'start' \| 'center' \| 'end'`, `offsetFor`, `resizeModel` |
| `MAX_LADO`, `MAX_CELDAS` | `MAX_SIDE`, `MAX_CELLS` |
| `modeloDe`, `figuraDe`, `escenaDe`, `idNuevo`, `validar` | `modelOf`, `figureOf`, `sceneOf`, `newId`, `validate` |
| `Pose`, `poseDeClip`, `poseDe` | `Pose`, `poseFromClip`, `poseOf` |
| `Mapa { x, z, escala, suelo, techo }`, `crearMapa`, `PASO_MAX` | `Heightmap { x, z, scale, floor, ceiling }`, `buildHeightmap`, `MAX_STEP` |
| `alturaEn`, `mover` | `heightAt`, `moveBody` |
| `Rastreo { mapa, libre, radio }`, `crearRastreo`, `campoHacia`, `rumboHacia` | `NavGrid { map, free, radius }`, `buildNavGrid`, `distanceField`, `headingToward` |
| (nuevo) | `migrateLegacyProject(json)`: reads a Spanish-format project and returns a `Project` |

Units: meters for positions, voxels for model sizes, radians for angles. `heading` 0 looks toward
+z; rotations of instances are quarter turns (0 to 3).

## render

| Antes | Now |
|---|---|
| `Datos { posiciones, normales, colores, indices }`, `Malla { solida, emisiva }` | `MeshData { positions, normals, colors, indices }`, `VoxelMeshData { solid, emissive }` |
| `OpcionesMallado { paleta, emisivos, cerrado, desde, hasta, corteY }`, `mallar` | `MeshOptions { palette, emissive, closed, from, to, cutY }`, `meshVoxels` |
| `MallaVoxel` (`tocar`, `aplicar`, `reconstruir`, `corteY`, `grilla`, `modelo`) | `VoxelMesh` (`touch`, `apply`, `rebuild`, `cutY`, `grid`, `model`) |
| `matSolido`, `matEmisivo`, `instanciar`, `olvidarMalla` | `solidMaterial`, `emissiveMaterial`, `instantiate`, `forgetMesh` |
| `Escena3D { grupo, luces }`, `LuzViva { datos, objeto }` | `BuiltScene { group, lights }`, `LiveLight { data, object }` |
| `crearLuz`, `colocarModelo`, `colocarInstancia`, `construirEscena`, `titilar` | `createLight`, `placeModel`, `placeInstance`, `buildScene`, `flickerAt` |
| `Figura3D` (`articulaciones`, `luz`, `halo`, `aplicar`) | `Figure3D` (`joints`, `light`, `glow`, `applyPose`) |
| `resplandor`, `Vista` (`renderer`, `escena`, `camara`, `ajustar`, `dibujar`) | `glowSprite`, `View` (`renderer`, `scene`, `camera`, `resize`, `render`) |

## kit, paint, audio

See each module's `index.ts`: every export has a doc comment, and the Spanish name it replaces when
there was one.
