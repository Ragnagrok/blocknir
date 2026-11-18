/**
 * The editor's own words (buttons, menus, hints), in Spanish (Río de la Plata) by default. Block
 * texts come from the level's label table instead; override any of these with `options.text`.
 */
import type { Group } from './schema.js';

export interface UiText {
  groups: Record<Group, string>;
  palette: string;
  workspace: string;
  blocks: string;
  /** `{count}` and `{par}`. */
  count: string;
  countNoPar: string;
  undo: string;
  redo: string;
  delete: string;
  duplicate: string;
  moveUp: string;
  moveDown: string;
  insertBelow: string;
  close: string;
  rename: string;
  addParam: string;
  removeParam: string;
  /** Menu entry of a parameter: change what it takes. */
  paramTypeMenu: string;
  /** Title of the type picker. `{name}`. */
  paramTypeTitle: string;
  /**
   * What a parameter takes, by type, or `name:<hint>` for names (`name:item`, `name:color`). The
   * picker shows these; the chip shows them without the article (`número`).
   */
  paramTypes: Record<string, string>;
  /** Asks what a new variable holds (`{name}`). */
  variableTypeTitle: string;
  /** The variable picker's entry that changes what a variable holds (`{name}`). */
  variableTypeMenu: string;
  /** What a variable holds, by type: `number`, `name` (a word), `boolean`. */
  variableTypes: Record<string, string>;
  deleteProcedure: string;
  deleteHandler: string;
  newVariable: string;
  createVariable: string;
  trash: string;
  emptyList: string;
  cursorHere: string;
  gap: string;
  /** Aria label of a gap: `{where}`. */
  gapAfter: string;
  gapStart: string;
  ok: string;
  cancel: string;
  confirmDelete: string;
  /** `{name}`, `{count}`. */
  confirmDeleteProcedure: string;
  nameProcedure: string;
  nameParam: string;
  nameVariable: string;
  defaultProcedure: string;
  defaultParam: string;
  chooseValue: string;
  chooseVariable: string;
  chooseEvent: string;
  typeNumber: string;
  typeText: string;
  putBlock: string;
  emptySlot: string;
  slotOf: string;
  paramChip: string;
  /** Refusals, by `Refusal` code. `{par}`. */
  refused: Record<string, string>;
  added: string;
  removed: string;
  moved: string;
  tapSlotFirst: string;
  hintDrag: string;
  readOnly: string;
}

export const DEFAULT_TEXT: UiText = {
  groups: {
    actions: 'Acciones',
    control: 'Control',
    sensors: 'Sensores',
    values: 'Valores',
    variables: 'Variables',
    procedures: 'Enseñar…',
    events: 'Eventos',
  },
  palette: 'Bloques para usar',
  workspace: 'Programa',
  blocks: 'Bloques',
  count: '{count} de {par}',
  countNoPar: '{count}',
  undo: 'Deshacer',
  redo: 'Rehacer',
  delete: 'Borrar',
  duplicate: 'Duplicar',
  moveUp: 'Subir',
  moveDown: 'Bajar',
  insertBelow: 'Poner abajo',
  close: 'Cerrar',
  rename: 'Cambiar nombre',
  addParam: 'Agregar hueco',
  removeParam: 'Quitar hueco',
  paramTypeMenu: 'Qué va en el hueco',
  paramTypeTitle: '¿Qué va en el hueco “{name}”?',
  paramTypes: {
    number: 'Un número',
    direction: 'Una dirección',
    boolean: 'Verdadero o falso',
    name: 'Un nombre',
    any: 'Cualquier cosa',
    'name:item': 'Un objeto',
    'name:color': 'Un color',
    'name:terrain': 'Un piso',
    'name:key': 'Una tecla',
    'name:kind': 'Una cosa del juego',
    'name:tile': 'Una baldosa',
    'name:signal': 'Una señal',
    'name:sound': 'Un sonido',
    'name:look': 'Un aspecto',
  },
  variableTypeTitle: '¿Qué guarda “{name}”?',
  variableTypeMenu: 'Qué guarda “{name}”',
  variableTypes: {
    number: 'Un número',
    name: 'Una palabra',
    boolean: 'Verdadero o falso',
    any: 'Cualquier cosa',
  },
  deleteProcedure: 'Borrar enseñanza',
  deleteHandler: 'Borrar evento',
  newVariable: 'Nueva variable…',
  createVariable: 'Crear una variable',
  trash: 'Soltá acá para borrar',
  emptyList: 'Vacío',
  cursorHere: 'Acá va el próximo bloque',
  gap: 'Lugar para un bloque',
  gapAfter: 'Lugar después de {where}',
  gapStart: 'Lugar al principio de {where}',
  ok: 'Listo',
  cancel: 'Cancelar',
  confirmDelete: 'Borrar',
  confirmDeleteProcedure: 'Hay {count} bloques que usan “{name}”. Si borrás la enseñanza, se borran también. ¿Borrar igual?',
  nameProcedure: '¿Cómo se llama lo que le enseñás?',
  nameParam: '¿Cómo se llama el hueco?',
  nameVariable: '¿Cómo se llama la variable?',
  defaultProcedure: 'mi bloque',
  defaultParam: 'cantidad',
  chooseValue: 'Elegí un valor',
  chooseVariable: 'Elegí una variable',
  chooseEvent: 'Elegí cuándo',
  typeNumber: 'Escribí un número',
  typeText: 'Escribir…',
  putBlock: 'Poner un bloque',
  emptySlot: 'hueco vacío',
  slotOf: 'hueco {n}',
  paramChip: 'hueco “{name}”',
  refused: {
    par: 'Ya usaste los {par} bloques de este desafío.',
    type: 'Ese bloque no entra en este hueco.',
    scope: 'Ese hueco sólo se puede usar adentro de su enseñanza.',
    cycle: 'Un bloque no puede ir adentro de sí mismo.',
    duplicateName: 'Ya hay uno con ese nombre.',
    name: 'Falta el nombre.',
    edge: 'No se puede mover más.',
    fixed: 'Esa parte del bloque viene fija.',
    counted: 'Hay bloques que le suman a esa variable: tiene que guardar un número.',
    readOnly: 'Esperá a que termine.',
    notFound: 'No se pudo.',
    invalid: 'No se pudo.',
  },
  added: 'Agregado: {block}',
  removed: 'Borrado: {block}',
  moved: 'Movido: {block}',
  tapSlotFirst: 'Tocá primero el hueco donde va.',
  hintDrag: 'Arrastrá o tocá un bloque para agregarlo.',
  readOnly: 'Ejecutando…',
};

/** Merges partial text over the defaults. */
export function mergeText(over: DeepPartial<UiText> | undefined): UiText {
  if (!over) return DEFAULT_TEXT;
  return {
    ...DEFAULT_TEXT,
    ...over,
    groups: { ...DEFAULT_TEXT.groups, ...over.groups },
    refused: { ...DEFAULT_TEXT.refused, ...over.refused },
    paramTypes: { ...DEFAULT_TEXT.paramTypes, ...over.paramTypes },
    variableTypes: { ...DEFAULT_TEXT.variableTypes, ...over.variableTypes },
  } as UiText;
}

/** What a parameter takes, in words (`Un objeto`); `short` drops the article (`objeto`). */
export function paramTypeName(text: UiText, spec: { type: string; name?: string }, short = false): string {
  const t = text.paramTypes;
  const s = (spec.type === 'name' && spec.name ? t[`name:${spec.name}`] : undefined) ?? t[spec.type] ?? spec.type;
  return short ? s.replace(/^(un|una|unos|unas)\s+/i, '') : s;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends Record<string, string> ? Partial<T[K]> : T[K] };

/** Fills `{key}` in a UI string. */
export function fmt(s: string, params: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (all, k: string) => (params[k] === undefined ? all : String(params[k])));
}
