/**
 * A three.js renderer for the block-language worlds of `blocknir/blocks`: grid boards,
 * the drawing turtle and realtime arenas, from a fixed three-quarter camera that frames the whole
 * board (or follows the character on long boards). Runs animate from their traces; realtime games
 * from their ticks. Names (items, terrain, actors) become visuals through a `Skin`; the default
 * skin paints every model in code.
 */
export {
  BoardView,
  cameraModeOf,
  isGridState,
  isTurtleState,
  presentation,
  type BoardViewOptions,
  type CameraMode,
  type CameraShot,
  type ResetOptions,
  type Speed,
  type TraceInput,
  type WorldInput,
  type WorldKind,
} from './board-view.js';
export { defaultCatalogue, defaultSkin, labelSprite } from './default-skin.js';
export {
  actorOf,
  colorOf,
  extendSkin,
  glowOf,
  hashColor,
  itemContext,
  mergeSkin,
  resolveName,
  terrainOf,
  toActorDef,
  toCharacterFactory,
  toItemDef,
  toTerrainDef,
  type ActorContext,
  type ActorDef,
  type ActorLike,
  type BackdropContext,
  type CharacterClip,
  type CharacterFactory,
  type CharacterLike,
  type CharacterVisual,
  type Environment,
  type FigureSpec,
  type Glow,
  type ItemContext,
  type ItemDef,
  type ItemLike,
  type PoseInfo,
  type ResolvedName,
  type Skin,
  type SkinExtension,
  type SkinOverrides,
  type SkinTable,
  type TerrainDef,
  type TerrainLike,
} from './skin.js';
export { copyObject, figureCharacter, propCharacter, voxelObject } from './pieces.js';
export {
  boardBounds,
  distanceForPixels,
  followBox,
  frameBox,
  pitchFor,
  pixelsPerMeter,
  project,
  type Bounds,
  type FollowOptions,
  type Framing,
  type FramingOptions,
  type Vec3,
} from './framing.js';
export { asideSlots, layoutCell, roomFor, type CellEntry, type Placement, type Room } from './layout.js';
export { DEFAULT_TIMING, gridStepDuration, parseSpeed, Playhead, turtleStepDuration, type Timing } from './timeline.js';
export type { RealtimeHud } from './realtime-stage.js';
