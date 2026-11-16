/**
 * Pure engine core: the project format, voxel grids, animation, collision and pathfinding.
 * No DOM and no three.js, so it runs the same in the browser, in workers and in Node.
 */
export type {
  Camera,
  Clip,
  Entity,
  EntityKind,
  Figure,
  Instance,
  Keyframe,
  Lantern,
  Light,
  Model,
  Part,
  Project,
  Scene,
  V2,
  V3,
} from './types.js';
export {
  cellIndex,
  createGrid,
  decodeGrid,
  encodeGrid,
  getCell,
  inBounds,
  lostCells,
  raycast,
  resizeGrid,
  setCell,
  type Grid,
  type Hit,
  type RaycastOptions,
} from './voxel.js';
export {
  figureOf,
  flushGrids,
  gridOf,
  MAX_CELLS,
  MAX_SIDE,
  modelOf,
  newId,
  newModel,
  offsetFor,
  resizeModel,
  sceneOf,
  setGrid,
  validate,
  type Anchor,
} from './project.js';
export { poseFromClip, poseOf, type Pose } from './anim.js';
export {
  buildHeightmap,
  buildNavGrid,
  distanceField,
  headingToward,
  heightAt,
  MAX_STEP,
  moveBody,
  type Heightmap,
  type NavGrid,
} from './collision.js';
export { migrateLegacyProject } from './migrate.js';
