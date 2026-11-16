import { describe, expect, it } from 'vitest';
import { DEMO_TRACK } from './demo-track.js';
import { GameAudio, INSTRUMENTS, type Track } from './index.js';
import { chord, chords, chordTone, frequency, hits, note, steps } from './theory.js';

describe('theory', () => {
  it('reads notes with accidentals', () => {
    expect(note('A4')).toBe(69);
    expect(note('C4')).toBe(60);
    expect(note('C#5')).toBe(73);
    expect(note('Bb3')).toBe(58);
    expect(() => note('H2')).toThrow(/Invalid note/);
  });

  it('converts MIDI to Hz', () => {
    expect(frequency(69)).toBe(440);
    expect(frequency(81)).toBeCloseTo(880);
  });

  it('builds chords and walks them upwards', () => {
    const dm = chord('Dm');
    expect(dm.root).toBe(note('D2'));
    expect([0, 1, 2, 3].map((i) => chordTone(dm, i, 4))).toEqual([note('D4'), note('F4'), note('A4'), note('D5')]);
    expect(chordTone(dm, -1, 4)).toBe(note('A3'));
    expect(chords('Fmaj7 | Am7').map((c) => c.intervals.length)).toEqual([4, 4]);
    expect(() => chord('Cxyz')).toThrow(/Invalid chord/);
  });

  it('splits patterns by letters or by words and joins held notes', () => {
    expect(steps('x..x|.x..')).toHaveLength(8);
    expect(steps('D5 - . F5')).toEqual(['D5', '-', '.', 'F5']);
    expect(hits('D5 - - . F5 -').hits).toEqual([
      { step: 0, length: 3, value: 'D5' },
      { step: 4, length: 2, value: 'F5' },
    ]);
    expect(hits('x.-x').hits).toEqual([
      { step: 0, length: 1, value: 'x' },
      { step: 3, length: 1, value: 'x' },
    ]);
  });
});

/** The checks a hand-written track should pass; reuse them for your own tracks. */
function checkTrack(name: string, p: Track): void {
  const perBar = p.stepsPerBar ?? 16;
  const list = chords(p.chords);
  expect(list.length).toBeGreaterThan(0);
  for (const v of p.voices) {
    const label = `${name}/${typeof v.inst === 'string' ? v.inst : 'custom'}`;
    if (typeof v.inst === 'string') expect(INSTRUMENTS[v.inst], label).toBeTypeOf('function');
    const { total, hits: hs } = hits(v.pattern);
    expect(total % perBar, `${label}: ${total} steps`).toBe(0);
    if (v.kind === 'melody') {
      for (const h of hs) expect(() => note(h.value)).not.toThrow();
      // A melody spans whole passes of the chords, so every note lands on its chord.
      expect((total / perBar) % list.length, `${label} and the chords`).toBe(0);
    }
  }
}

describe('tracks', () => {
  it('the demo track fills whole bars and its notes exist', () => checkTrack('demo', DEMO_TRACK));
});

describe('GameAudio', () => {
  it('is silent and harmless without Web Audio', () => {
    const audio = new GameAudio({ storageKey: 'test.audio' });
    audio.start();
    expect(audio.running).toBe(false);
    expect(audio.engine).toBeNull();
    audio.playTrack(DEMO_TRACK);
    audio.setAmbience({ wind: 0.5, events: ['bird'] });
    let played = false;
    audio.play(() => (played = true));
    expect(played).toBe(false);
  });

  it('cycles the mute level', () => {
    const audio = new GameAudio();
    expect(audio.level).toBe('all');
    expect([audio.cycleLevel(), audio.cycleLevel(), audio.cycleLevel()]).toEqual(['sfx', 'none', 'all']);
  });
});
