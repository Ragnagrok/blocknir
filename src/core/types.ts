export type V3 = [number, number, number];
export type V2 = [number, number];

/** A volume of voxels: a room, a piece of furniture or a part of a character. */
export interface Model {
  id: string;
  name: string;
  /** Size in voxels: width (x), height (y), depth (z). */
  size: V3;
  /** Meters per voxel. */
  scale: number;
  /** RGB colors. Index 0 means "empty" and is never drawn. */
  palette: number[];
  /** Palette indices that emit their own light. */
  emissive: number[];
  /** Rooms produce no outward faces, so the inside can be seen from any side. */
  closed: boolean;
  /** Compressed cells (see voxel.ts). */
  data: string;
}

export interface Instance {
  id: string;
  model: string;
  /** Center of the base, in meters. */
  pos: V3;
  /** Quarter turns (0 to 3). */
  rot: number;
  solid: boolean;
}

export interface Camera {
  id: string;
  name: string;
  pos: V3;
  target: V3;
  fov: number;
  /** While the player stands inside this (x, z) rectangle, this camera is used. */
  zone: { min: V2; max: V2 };
}

export interface Light {
  id: string;
  name: string;
  kind: 'point' | 'spot';
  pos: V3;
  target: V3;
  color: number;
  intensity: number;
  range: number;
  /** Spotlight cone angle, in radians. */
  angle: number;
  shadow: boolean;
  /** From 0 (steady) to 1 (flickers a lot). */
  flicker: number;
}

export type EntityKind = 'player' | 'creature' | 'item' | 'note' | 'door';

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  pos: V3;
  /** Radians; 0 looks toward +z. */
  heading: number;
  figure?: string;
  model?: string;
  /** Note: what is read. Door: what is shown when it opens. */
  text?: string;
  /** Door: name of the item it needs. */
  requires?: string;
  /** Door: what is shown when the item is missing. */
  lockedText?: string;
  /** Door: scene it leads to. */
  destination?: string;
  /** Door: id of the entity where the player appears in the destination. */
  entry?: string;
}

export interface Scene {
  id: string;
  name: string;
  /** Model that acts as the room. */
  room: string;
  instances: Instance[];
  cameras: Camera[];
  lights: Light[];
  entities: Entity[];
  ambient: { color: number; intensity: number };
  fog: { color: number; density: number };
}

export interface Part {
  id: string;
  model: string;
  parent: string | null;
  /** Joint position, in meters, relative to the parent's joint. */
  pivot: V3;
  /** Point of the model that sits on the joint, in voxels. */
  origin: V3;
}

export interface Keyframe {
  t: number;
  /** Rotation of each part, in radians. */
  rot: Record<string, V3>;
}

export interface Clip {
  name: string;
  duration: number;
  loop: boolean;
  keys: Keyframe[];
}

export interface Lantern {
  part: string;
  pos: V3;
  color: number;
  intensity: number;
  range: number;
}

export interface Figure {
  id: string;
  name: string;
  parts: Part[];
  clips: Clip[];
  /** Light the character carries. */
  lantern?: Lantern;
}

export interface Project {
  version: 1;
  name: string;
  startScene: string;
  models: Model[];
  figures: Figure[];
  scenes: Scene[];
}
