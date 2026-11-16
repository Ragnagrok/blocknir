/**
 * Notes, chords and step patterns written as text, so tracks can be composed by hand.
 *
 * A pattern is a list of steps (sixteenth notes unless the track says otherwise). Each note is one
 * step ("D5 - - . F5"), and in drum patterns each letter is one step too ("x...x..."). Bar lines
 * `|` only help reading and are ignored.
 */

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "A4" → 69 (MIDI). Accepts sharps and flats: "C#5", "Bb3". */
export function note(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Invalid note: "${name}"`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + LETTERS[m[1]!]! + accidental;
}

/** MIDI note → Hz, equal temperament with A4 = 440. */
export const frequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
};

export interface Chord {
  /** The root in octave 2 (MIDI 36 to 47): where the bass plays it. */
  root: number;
  intervals: number[];
}

/** "Dm" → D minor; also "Bbmaj7", "E7", "Asus4"... */
export function chord(name: string): Chord {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  const intervals = m ? QUALITIES[m[2]!] : undefined;
  if (!m || !intervals) throw new Error(`Invalid chord: "${name}"`);
  return { root: note(`${m[1]}2`), intervals };
}

/**
 * Tone `i` of the chord, counting upwards: in a triad, tone 3 is the root an octave higher. This
 * lets an arpeggio climb past the chord.
 */
export function chordTone(c: Chord, i: number, octave: number): number {
  const n = c.intervals.length;
  const wrap = Math.floor(i / n);
  return c.root + 12 * (octave - 2 + wrap) + c.intervals[((i % n) + n) % n]!;
}

/** Splits a pattern into steps, dropping the bar lines. */
export function steps(pattern: string): string[] {
  const words = pattern.split(/[\s|]+/).filter(Boolean);
  // A word made only of hits and rests ("x..x") is several steps; a note is one.
  return words.flatMap((w) => (/^[xXoO.-]+$/.test(w) ? [...w] : [w]));
}

export interface Hit {
  /** Step where it starts. */
  step: number;
  /** How many steps it lasts: its own plus the `-` that follow it. */
  length: number;
  value: string;
}

/** Joins each step with its `-` continuations. `.` is a rest. */
export function hits(pattern: string): { hits: Hit[]; total: number } {
  const p = steps(pattern);
  const list: Hit[] = [];
  p.forEach((v, i) => {
    if (v === '-') {
      const last = list[list.length - 1];
      if (last && last.step + last.length === i) last.length++;
      return;
    }
    if (v !== '.') list.push({ step: i, length: 1, value: v });
  });
  return { hits: list, total: p.length };
}

/** A chord list, one per bar: "Dm Bb F C". */
export const chords = (text: string): Chord[] => text.replace(/\|/g, ' ').trim().split(/\s+/).map(chord);
