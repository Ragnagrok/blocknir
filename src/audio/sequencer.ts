/**
 * Plays tracks written as text patterns. Notes are scheduled a little before they sound
 * (`scheduleUntil`), so the game loop doesn't need to be punctual.
 */
import type { AudioEngine, Bus } from './engine.js';
import { INSTRUMENTS, type Instrument, type InstrumentName } from './instruments.js';
import { chords, chordTone, hits, note, type Chord, type Hit } from './theory.js';

/**
 * How a voice reads its pattern.
 * - `melody`: written notes ("D5").
 * - `chord`: "x" plays the bar's chord.
 * - `bass`: 1, 3, 5, 7 are chord tones and 8 is the root an octave up.
 * - `arpeggio`: the number is the chord tone, counting upwards (see `chordTone`).
 * - `drum`: x normal, X accented, o soft, O soft and long (an open cymbal).
 */
export type VoiceKind = 'melody' | 'chord' | 'bass' | 'arpeggio' | 'drum';

export interface Voice {
  /** A built-in instrument name, or your own `Instrument` function. */
  inst: InstrumentName | Instrument;
  kind: VoiceKind;
  pattern: string;
  octave?: number;
  /** Velocity, 0 to 1. */
  vel?: number;
  /** Bar from which it first plays: voices can come in one at a time. */
  startBar?: number;
}

export interface Track {
  bpm: number;
  /** Steps (sixteenths) per bar: 16 is 4/4 and 12 is 3/4. */
  stepsPerBar?: number;
  /** One chord per bar. */
  chords: string;
  voices: Voice[];
  /** How late the odd steps play, as a fraction of a step. */
  swing?: number;
}

interface ReadyVoice {
  voice: Voice;
  inst: Instrument;
  total: number;
  byStep: Map<number, Hit>;
}

const BASS: Record<string, number> = { '1': 0, '3': 1, '5': 2, '7': 3 };
const ACCENT: Record<string, number> = { x: 0.75, X: 1, o: 0.4, O: 0.75 };

/** One playing instance of a track, starting at context time `start`. */
export class Playback {
  private voices: ReadyVoice[];
  private chords: Chord[];
  private step = 0;
  readonly stepDuration: number;
  readonly stepsPerBar: number;
  /** All of this track's voices go through here, so a whole track can be faded. */
  readonly bus: Bus;

  constructor(
    private e: AudioEngine,
    destination: Bus,
    readonly track: Track,
    private start: number,
    volume: number,
  ) {
    this.stepsPerBar = track.stepsPerBar ?? 16;
    // A step is always a sixteenth; a 12-step bar is a 3/4.
    this.stepDuration = 60 / track.bpm / 4;
    this.chords = chords(track.chords);
    this.voices = track.voices.map((voice) => {
      const { hits: list, total } = hits(voice.pattern);
      const inst = typeof voice.inst === 'function' ? voice.inst : INSTRUMENTS[voice.inst];
      return { voice, inst, total, byStep: new Map(list.map((h) => [h.step, h])) };
    });
    const gain = (d: GainNode): GainNode => {
      const n = e.ctx.createGain();
      n.gain.setValueAtTime(0, e.now);
      n.gain.linearRampToValueAtTime(volume, Math.max(e.now + 0.01, start));
      n.connect(d);
      return n;
    };
    this.bus = { dry: gain(destination.dry), reverb: gain(destination.reverb), echo: gain(destination.echo) };
  }

  /** How long one full pass through the chords lasts, in seconds. */
  get loopDuration(): number {
    return this.chords.length * this.stepsPerBar * this.stepDuration;
  }

  /** Schedules every step that starts before context time `until`. Call it often, ahead of time. */
  scheduleUntil(until: number): void {
    // If the game stalled (building a map, say), steps already in the past are skipped instead of
    // all sounding at once.
    const late = this.e.now - 0.05;
    while (this.start + this.step * this.stepDuration < until) {
      if (this.start + this.step * this.stepDuration >= late) this.playStep(this.step);
      this.step++;
    }
  }

  private playStep(n: number): void {
    const p = this.track;
    const bar = Math.floor(n / this.stepsPerBar);
    const c = this.chords[bar % this.chords.length]!;
    const swing = n % 2 === 1 ? (p.swing ?? 0) * this.stepDuration : 0;
    const t = this.start + n * this.stepDuration + swing;
    for (const { voice, inst, total, byStep } of this.voices) {
      if (total === 0 || bar < (voice.startBar ?? 0)) continue;
      const h = byStep.get(n % total);
      if (!h) continue;
      const dur = h.length * this.stepDuration;
      const vel = voice.vel ?? 1;
      const sound = (midi: number, v = vel): void => inst(this.e, this.bus, t, midi, dur, v);
      switch (voice.kind) {
        case 'melody':
          sound(note(h.value));
          break;
        case 'chord':
          c.intervals.forEach((_, i) => sound(chordTone(c, i, voice.octave ?? 3), vel * 0.8));
          break;
        case 'bass':
          sound(h.value === '8' ? chordTone(c, 0, (voice.octave ?? 2) + 1) : chordTone(c, BASS[h.value] ?? 0, voice.octave ?? 2));
          break;
        case 'arpeggio':
          sound(chordTone(c, Number(h.value), voice.octave ?? 4));
          break;
        case 'drum':
          inst(this.e, this.bus, t, 0, h.value === 'O' ? 1 : dur, vel * (ACCENT[h.value] ?? 0.75));
          break;
      }
    }
  }

  /** Fades to silence over `seconds` and then releases the nodes. */
  stop(seconds: number): void {
    const now = this.e.now;
    for (const g of [this.bus.dry, this.bus.reverb, this.bus.echo]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + seconds);
    }
    setTimeout(() => {
      for (const g of [this.bus.dry, this.bus.reverb, this.bus.echo]) g.disconnect();
    }, (seconds + 3) * 1000);
  }
}
