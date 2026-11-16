import type { Camera, Clip, Entity, EntityKind, Figure, Instance, Light, Model, Part, Project, Scene, V2, V3 } from './types.js';

// The project format as it was saved before the engine was translated (Spanish keys).

interface LegacyModel {
  id: string;
  nombre: string;
  tam: V3;
  escala: number;
  paleta: number[];
  emisivos: number[];
  cerrado: boolean;
  datos: string;
}

interface LegacyInstance {
  id: string;
  modelo: string;
  pos: V3;
  rot: number;
  solido: boolean;
}

interface LegacyCamera {
  id: string;
  nombre: string;
  pos: V3;
  mira: V3;
  fov: number;
  zona: { min: V2; max: V2 };
}

interface LegacyLight {
  id: string;
  nombre: string;
  tipo: 'punto' | 'foco';
  pos: V3;
  mira: V3;
  color: number;
  intensidad: number;
  alcance: number;
  angulo: number;
  sombra: boolean;
  parpadeo: number;
}

interface LegacyEntity {
  id: string;
  tipo: string;
  nombre: string;
  pos: V3;
  rumbo: number;
  figura?: string;
  modelo?: string;
  texto?: string;
  requiere?: string;
  textoCerrado?: string;
  destino?: string;
  entrada?: string;
}

interface LegacyScene {
  id: string;
  nombre: string;
  sala: string;
  instancias: LegacyInstance[];
  camaras: LegacyCamera[];
  luces: LegacyLight[];
  entidades: LegacyEntity[];
  ambiente: { color: number; intensidad: number };
  niebla: { color: number; densidad: number };
}

interface LegacyPart {
  id: string;
  modelo: string;
  padre: string | null;
  pivote: V3;
  origen: V3;
}

interface LegacyClip {
  nombre: string;
  duracion: number;
  bucle: boolean;
  claves: { t: number; rot: Record<string, V3> }[];
}

interface LegacyFigure {
  id: string;
  nombre: string;
  partes: LegacyPart[];
  clips: LegacyClip[];
  faro?: { parte: string; pos: V3; color: number; intensidad: number; alcance: number };
}

interface LegacyProject {
  version: number;
  nombre: string;
  escenaInicial: string;
  modelos: LegacyModel[];
  figuras: LegacyFigure[];
  escenas: LegacyScene[];
}

const ENTITY_KINDS: Record<string, EntityKind> = {
  jugador: 'player',
  criatura: 'creature',
  item: 'item',
  nota: 'note',
  puerta: 'door',
};

const LIGHT_KINDS: Record<string, Light['kind']> = { punto: 'point', foco: 'spot' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function checkShape(json: unknown): asserts json is LegacyProject {
  if (!isObject(json)) throw new Error('Legacy project: expected a JSON object');
  for (const key of ['modelos', 'figuras', 'escenas']) {
    if (!Array.isArray(json[key])) throw new Error(`Legacy project: "${key}" must be an array`);
  }
  if (typeof json.escenaInicial !== 'string') throw new Error('Legacy project: "escenaInicial" must be a string');
}

const model = (m: LegacyModel): Model => ({
  id: m.id,
  name: m.nombre,
  size: m.tam,
  scale: m.escala,
  palette: m.paleta,
  emissive: m.emisivos ?? [],
  closed: m.cerrado,
  // Same run-length + base64 encoding: the cells carry over untouched.
  data: m.datos,
});

const instance = (i: LegacyInstance): Instance => ({ id: i.id, model: i.modelo, pos: i.pos, rot: i.rot, solid: i.solido });

const camera = (c: LegacyCamera): Camera => ({ id: c.id, name: c.nombre, pos: c.pos, target: c.mira, fov: c.fov, zone: c.zona });

function light(l: LegacyLight): Light {
  const kind = LIGHT_KINDS[l.tipo];
  if (!kind) throw new Error(`Legacy project: unknown light type "${l.tipo}" in "${l.id}"`);
  return {
    id: l.id,
    name: l.nombre,
    kind,
    pos: l.pos,
    target: l.mira,
    color: l.color,
    intensity: l.intensidad,
    range: l.alcance,
    angle: l.angulo,
    shadow: l.sombra,
    flicker: l.parpadeo,
  };
}

function entity(x: LegacyEntity): Entity {
  const kind = ENTITY_KINDS[x.tipo];
  if (!kind) throw new Error(`Legacy project: unknown entity type "${x.tipo}" in "${x.id}"`);
  const e: Entity = { id: x.id, kind, name: x.nombre, pos: x.pos, heading: x.rumbo };
  // Optional fields are copied only when present, so the result has no `undefined` keys.
  if (x.figura !== undefined) e.figure = x.figura;
  if (x.modelo !== undefined) e.model = x.modelo;
  if (x.texto !== undefined) e.text = x.texto;
  if (x.requiere !== undefined) e.requires = x.requiere;
  if (x.textoCerrado !== undefined) e.lockedText = x.textoCerrado;
  if (x.destino !== undefined) e.destination = x.destino;
  if (x.entrada !== undefined) e.entry = x.entrada;
  return e;
}

const scene = (s: LegacyScene): Scene => ({
  id: s.id,
  name: s.nombre,
  room: s.sala,
  instances: s.instancias.map(instance),
  cameras: s.camaras.map(camera),
  lights: s.luces.map(light),
  entities: s.entidades.map(entity),
  ambient: { color: s.ambiente.color, intensity: s.ambiente.intensidad },
  fog: { color: s.niebla.color, density: s.niebla.densidad },
});

const part = (x: LegacyPart): Part => ({ id: x.id, model: x.modelo, parent: x.padre, pivot: x.pivote, origin: x.origen });

const clip = (c: LegacyClip): Clip => ({
  name: c.nombre,
  duration: c.duracion,
  loop: c.bucle,
  keys: c.claves.map((k) => ({ t: k.t, rot: k.rot })),
});

function figure(f: LegacyFigure): Figure {
  const out: Figure = { id: f.id, name: f.nombre, parts: f.partes.map(part), clips: f.clips.map(clip) };
  if (f.faro) {
    out.lantern = { part: f.faro.parte, pos: f.faro.pos, color: f.faro.color, intensity: f.faro.intensidad, range: f.faro.alcance };
  }
  return out;
}

/**
 * Reads a project saved in the old Spanish-keyed format (`modelos`, `escenas`, `tipo: 'jugador'`...)
 * and returns the equivalent `Project`. Voxel data strings are kept as they are. The input is not
 * modified, but arrays such as positions are shared with it.
 */
export function migrateLegacyProject(json: unknown): Project {
  checkShape(json);
  return {
    version: 1,
    name: json.nombre,
    startScene: json.escenaInicial,
    models: json.modelos.map(model),
    figures: json.figuras.map(figure),
    scenes: json.escenas.map(scene),
  };
}
