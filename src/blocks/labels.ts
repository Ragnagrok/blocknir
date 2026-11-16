/**
 * Text shown to children, as data. Nothing in the logic hardcodes a message: worlds and the
 * interpreter produce codes and parameters, and these tables turn them into words. The defaults are
 * in Spanish (Río de la Plata voseo); a level overrides any entry with `labels`.
 */
import type { BlockError, ErrorCode, RunError } from './errors.js';
import type { NodeId } from './ast.js';
import type { Direction, Value, ValueType } from './values.js';

/** All the tables of words a UI and the error messages need. */
export interface Labels {
  /**
   * Block texts by block key (see `blockKey`): commands and sensors by name, control blocks
   * (`repeat`, `if`…), operators (`+`, `and`…), events (`event.key`…). `{0}`, `{1}` mark the
   * slots in order; `{var}` and `{name}` the variable or procedure name.
   */
  blocks: Record<string, string>;
  /** Direction names. */
  directions: Record<Direction, string>;
  /** Names of items, colors, keys, sounds, looks and actor kinds, and `true` / `false`. */
  names: Record<string, string>;
  /** Value type names, for type errors. */
  types: Record<ValueType, string>;
  /**
   * Error messages by code, with `{param}` placeholders. An entry `code:key` (for example
   * `actionFailed:openChest`) overrides the message when the error carries `params.key`.
   */
  errors: Record<ErrorCode, string> & Record<string, string>;
  /** Reasons why a goal was not reached, by key (see the goal evaluators). */
  goals: Record<string, string>;
  /** Messages of `check()`. */
  check: Record<string, string>;
  /** Decimal separator for numbers in messages. */
  decimalSeparator: string;
}

/** A partial label table, merged over the defaults (per entry, not per table). */
export interface LabelOverrides {
  blocks?: Record<string, string>;
  directions?: Partial<Record<Direction, string>>;
  names?: Record<string, string>;
  types?: Partial<Record<ValueType, string>>;
  errors?: Record<string, string>;
  goals?: Record<string, string>;
  check?: Record<string, string>;
  decimalSeparator?: string;
}

/** The default Spanish labels shared by every world. Each world adds its own block texts. */
export const DEFAULT_LABELS: Labels = {
  blocks: {
    main: 'Al tocar Ejecutar',
    procedure: 'Enseñar: {name}',
    call: '{name}',
    repeat: 'Repetir {0} veces',
    repeatUntil: 'Repetir hasta que {0}',
    if: 'Si {0}',
    ifElse: 'Si {0}',
    else: 'Si no',
    set: 'Fijar {var} en {0}',
    change: 'Sumar {0} a {var}',
    subtract: 'Restar {0} a {var}',
    wait: 'Esperar {0}',
    var: '{name}',
    param: '{name}',
    '+': '{0} + {1}',
    '-': '{0} − {1}',
    '*': '{0} × {1}',
    '/': '{0} ÷ {1}',
    '%': 'resto de {0} ÷ {1}',
    '=': '{0} = {1}',
    '!=': '{0} ≠ {1}',
    '<': '{0} < {1}',
    '<=': '{0} ≤ {1}',
    '>': '{0} > {1}',
    '>=': '{0} ≥ {1}',
    and: '{0} y {1}',
    or: '{0} o {1}',
    not: 'no {0}',
    opposite: 'opuesto de {0}',
    left: 'a la izquierda de {0}',
    right: 'a la derecha de {0}',
    'event.start': 'Al tocar Ejecutar',
    'event.key': 'Al apretar {0}',
    'event.tick': 'En cada tic',
    'event.touch': 'Al tocar {0}',
  },
  directions: { N: '↑', E: '→', S: '↓', W: '←' },
  names: {
    true: 'sí',
    false: 'no',
    // items
    lamp: 'farol',
    lampOn: 'farol encendido',
    apple: 'manzana',
    banana: 'banana',
    orange: 'naranja',
    watermelon: 'sandía',
    star: 'estrella',
    fishFood: 'comida para peces',
    fish: 'pez',
    cheese: 'queso',
    wood: 'madera',
    rope: 'soga',
    key: 'llave',
    chest: 'cofre',
    ball: 'pelota',
    balloon: 'globo',
    gift: 'regalo',
    flag: 'banderín',
    start: 'inicio',
    // colors
    red: 'rojo',
    blue: 'azul',
    green: 'verde',
    yellow: 'amarillo',
    black: 'negro',
    white: 'blanco',
    purple: 'violeta',
    brown: 'marrón',
    pink: 'rosa',
    gray: 'gris',
    none: 'sin pintar',
    // terrain
    water: 'agua',
    rock: 'roca',
    // keys and buttons
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    action: 'acción',
    space: 'espacio',
    // actors
    player: 'jugador',
    enemy: 'enemigo',
  },
  types: { number: 'un número', boolean: 'verdadero o falso', direction: 'una dirección', name: 'un nombre', any: 'un valor' },
  errors: {
    wall: '¡Hay una pared! No puedo moverme {dir}.',
    'wall:water': '¡Hay agua! No puedo moverme {dir}.',
    'wall:rock': '¡Hay una roca! No puedo moverme {dir}.',
    outOfBoard: '¡Me caigo del tablero! No puedo moverme {dir}.',
    outOfArea: '¡Me salgo del patio! Me quedo acá.',
    noItem: 'Acá no hay {item}.',
    notCarrying: 'No llevo {item} para dejar.',
    inventoryFull: 'Ya llevo {capacity}, no puedo cargar más.',
    noLamp: 'Acá no hay ningún farol para encender.',
    noArrow: 'Acá no hay ninguna flecha.',
    actionFailed: 'No puedo {action} acá: falta {item}.',
    stepLimit: 'El programa hizo más de {limit} pasos sin terminar. ¿Habrá una repetición que no termina nunca?',
    recursionDepth: 'Hay procedimientos que se llaman entre sí demasiadas veces (más de {limit}).',
    paramCount: '"{name}" necesita {expected} datos y recibió {got}.',
    argType: '"{name}" esperaba {expected} en el hueco {position}.',
    notBoolean: 'Acá va una pregunta que se conteste con sí o no.',
    notNumber: 'Acá va un número.',
    badCount: 'No se puede repetir {count} veces: tiene que ser un número entero, 0 o más.',
    divisionByZero: 'No se puede dividir por cero.',
    unknownProcedure: 'No existe un bloque enseñado que se llame "{name}".',
    unknownCommand: 'No conozco el bloque "{name}".',
    unknownSensor: 'No conozco la pregunta "{name}".',
    unknownParam: '"{name}" no es un hueco de este bloque enseñado.',
    unknownVariable: '"{name}" todavía no tiene ningún valor.',
    unknownBlock: 'Hay un bloque que no sé usar.',
    notAllowed: 'En este desafío no se puede usar el bloque "{block}".',
    duplicateProcedure: 'Hay dos bloques enseñados que se llaman "{name}".',
    duplicateId: 'Hay dos bloques con el mismo número ({id}).',
  },
  goals: {},
  check: {
    pass: '¡Funciona en todos los casos!',
    passOverPar: '¡Funciona! Usaste {blocks} bloques. ¿Te animás a hacerlo con {par} o menos?',
    fail: 'Todavía no funciona en todos los casos.',
    overPar: 'Usaste {blocks} bloques y el máximo es {par}.',
    invalid: 'Hay bloques que no se pueden usar acá.',
    requirement: 'Funciona, pero falta algo: {reason}',
    caseFailed: 'Prueba {n}: {reason}',
    error: 'Hubo un error: {message}',
  },
  decimalSeparator: ',',
};

/** Merges label overrides over a base table, entry by entry. Later overrides win. */
export function mergeLabels(base: Labels, ...overrides: Array<LabelOverrides | undefined>): Labels {
  const out: Labels = {
    blocks: { ...base.blocks },
    directions: { ...base.directions },
    names: { ...base.names },
    types: { ...base.types },
    errors: { ...base.errors },
    goals: { ...base.goals },
    check: { ...base.check },
    decimalSeparator: base.decimalSeparator,
  };
  for (const o of overrides) {
    if (!o) continue;
    Object.assign(out.blocks, o.blocks);
    Object.assign(out.directions, o.directions);
    Object.assign(out.names, o.names);
    Object.assign(out.types, o.types);
    Object.assign(out.errors, o.errors);
    Object.assign(out.goals, o.goals);
    Object.assign(out.check, o.check);
    if (o.decimalSeparator !== undefined) out.decimalSeparator = o.decimalSeparator;
  }
  return out;
}

/** A number as children read it: integers as is, others with up to two decimals. */
export function formatNumber(n: number, labels: Labels): string {
  if (Number.isInteger(n)) return String(n);
  const s = String(Math.round(n * 100) / 100);
  return s.replace('.', labels.decimalSeparator);
}

/** A value in words: directions and known names are translated; numbers formatted. */
export function describeValue(v: Value, labels: Labels): string {
  if (typeof v === 'number') return formatNumber(v, labels);
  if (typeof v === 'boolean') return labels.names[String(v)] ?? String(v);
  return (labels.directions as Record<string, string>)[v] ?? labels.names[v] ?? v;
}

/** Fills `{key}` placeholders with described parameter values. Unknown keys stay as they are. */
export function formatMessage(template: string, params: Record<string, Value>, labels: Labels): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (all, key: string) => {
    const v = params[key];
    return v === undefined ? all : describeValue(v, labels);
  });
}

/** The message of an error code with its parameters. */
export function errorMessage(code: ErrorCode, params: Record<string, Value>, labels: Labels): string {
  const specific = typeof params.key === 'string' ? labels.errors[`${code}:${params.key}`] : undefined;
  return formatMessage(specific ?? labels.errors[code] ?? code, params, labels);
}

/** Turns a thrown `BlockError` into a `RunError` with its message. */
export function toRunError(e: BlockError, labels: Labels, fallbackNode: NodeId | null = null): RunError {
  return {
    code: e.code,
    nodeId: e.nodeId ?? fallbackNode,
    params: e.params,
    message: errorMessage(e.code, e.params, labels),
  };
}

/** The text of a goal reason by key, filled with parameters. */
export function goalMessage(key: string, params: Record<string, Value>, labels: Labels): string {
  return formatMessage(labels.goals[key] ?? key, params, labels);
}

/** The text of a block key, or the key itself. */
export function blockLabel(key: string, labels: Labels): string {
  return labels.blocks[key] ?? key;
}

