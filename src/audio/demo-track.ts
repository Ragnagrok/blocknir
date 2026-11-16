/**
 * A short original loop to hear the sequencer: four bars in E, pad and arpeggio first, then bass,
 * drums and a bell melody on the second pass. Each step is a sixteenth; `-` holds the previous note
 * and `.` is a rest.
 */
import type { Track } from './sequencer.js';

export const DEMO_TRACK: Track = {
  bpm: 100,
  swing: 0.12,
  chords: 'Esus2 C#m7 Aadd9 Bsus4',
  voices: [
    { inst: 'pad', kind: 'chord', pattern: 'x - - - - - - - - - - - - - - -', octave: 3, vel: 0.7 },
    { inst: 'pulse', kind: 'arpeggio', pattern: '0 . 2 . 4 . 3 . 1 . 3 . 5 . 4 .', octave: 4, vel: 0.45 },
    { inst: 'bass', kind: 'bass', pattern: '1 - - . 1 . 5 - 8 - - . 5 . 3 .', vel: 0.75, startBar: 2 },
    { inst: 'kick', kind: 'drum', pattern: 'x.....x.x.......', startBar: 4 },
    { inst: 'snare', kind: 'drum', pattern: '....x.......x..o', startBar: 4 },
    { inst: 'cymbal', kind: 'drum', pattern: 'x.o.x.o.x.o.x.oO', vel: 0.8, startBar: 4 },
    {
      inst: 'bell',
      kind: 'melody',
      vel: 0.6,
      startBar: 4,
      pattern: [
        'B4 - - . F#5 - E5 - . . B4 - F#4 - - .',
        'G#4 - - . B4 - C#5 - . . E5 - - - . .',
        'C#5 - B4 - A4 - - . E5 - - . C#5 - B4 -',
        'F#4 - - - - - - . E4 . F#4 . B4 - - -',
      ].join(' | '),
    },
  ],
};
