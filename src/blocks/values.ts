/** Runtime values of the block language and the four grid directions. */

/**
 * A compass direction on a grid, in screen terms: `N` is up (y - 1), `S` down (y + 1), `E` right
 * (x + 1), `W` left (x - 1). Labels usually show them as arrows.
 */
export type Direction = 'N' | 'E' | 'S' | 'W';

/** All directions, clockwise from north. */
export const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

/**
 * A value a block produces or receives. Directions are the strings `'N' | 'E' | 'S' | 'W'`; names
 * (items, colors, keys, sounds, looks) are any other string.
 */
export type Value = number | boolean | string;

/** The type of a block slot or of what a sensor returns. `name` is any string; `any` accepts all. */
export type ValueType = 'number' | 'boolean' | 'direction' | 'name' | 'any';

/** True for `'N' | 'E' | 'S' | 'W'`. */
export function isDirection(v: unknown): v is Direction {
  return v === 'N' || v === 'E' || v === 'S' || v === 'W';
}

/** The cell offset of one step toward `d`. */
export function delta(d: Direction): [dx: number, dy: number] {
  switch (d) {
    case 'N':
      return [0, -1];
    case 'S':
      return [0, 1];
    case 'E':
      return [1, 0];
    case 'W':
      return [-1, 0];
  }
}

/** The direction 90 degrees clockwise. */
export function rightOf(d: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + 1) % 4]!;
}

/** The direction 90 degrees counterclockwise. */
export function leftOf(d: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + 3) % 4]!;
}

/** The opposite direction. */
export function opposite(d: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + 2) % 4]!;
}

/** Whether `v` fits a slot of type `t`. */
export function fitsType(v: Value, t: ValueType): boolean {
  switch (t) {
    case 'any':
      return true;
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'direction':
      return isDirection(v);
    case 'name':
      return typeof v === 'string';
  }
}

/** The most specific type of a value (a direction string reports `direction`). */
export function typeOfValue(v: Value): Exclude<ValueType, 'any'> {
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return isDirection(v) ? 'direction' : 'name';
}
