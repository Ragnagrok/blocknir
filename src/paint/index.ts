/**
 * Procedural voxel painting: a canvas with shapes (boxes, stacked sections, ellipsoids, front faces
 * and reliefs) and deterministic noise that exports `Model`s, plus a parametric humanoid built with it.
 *
 * Former Spanish names (from Nullgard's `src/arte`):
 * - canvas (`lienzo`): `Lienzo` → `VoxelCanvas` (`g` → `grid`, `paleta` → `palette`, `emite` → `emit`,
 *   `caja` → `box`, `perfil` → `profile`, `elipsoide` → `ellipsoid`, `repintar` → `repaint`,
 *   `cara` → `face`, `relieve` → `relief`, `fin` → `toModel`), `Pintura` → `Paint`, `Seccion` → `Section`,
 *   `azar` → `hash3`, `ruido` → `noise3`.
 * - humanoid (`heroe`): `crearPersona` → `createHumanoid`, `Estilo` → `HumanoidStyle` (`ropa`/`ropaClara`/
 *   `ropaOscura` → `clothes`/`clothesLight`/`clothesDark`, `piel`/`pielOscura` → `skin`/`skinDark`,
 *   `pelo`/`peloClaro` → `hair`/`hairLight`, `pantalon` → `pants`, `calzado` → `shoes`, `peinado` →
 *   `hairStyle` (corto/largo/atado/pelado → short/long/bun/shaved), `capucha` → `hood`, `bandolera` →
 *   `strap`, `delantal` → `apron`, `gorra` → `cap`, `barba` → `beard`, `anteojos` → `glasses`,
 *   `altura` → `height`, `ancho` → `width`, `silueta` recta/curva → `silhouette` straight/curvy).
 *   Parts pelvis/torso/cabeza/brazo_i/ante_i/pierna_i/tibia_i (and `_d`) → pelvis/torso/head/arm_l/
 *   forearm_l/thigh_l/shin_l (and `_r`); clips reposo/andar/consultar/hablar → idle/walk/inspect/talk.
 *   `tono` (from `apariencia`) → `shade`.
 */
export { hash3, noise3, VoxelCanvas, type Color, type Paint, type Section } from './canvas.js';
export {
  createHumanoid,
  DEFAULT_HUMANOID,
  HUMANOID_CLIPS,
  HUMANOID_PARTS,
  HUMANOID_SCALE,
  shade,
  type HairStyle,
  type HumanoidStyle,
} from './humanoid.js';
