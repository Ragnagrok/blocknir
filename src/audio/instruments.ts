/**
 * Synthesized instruments. Each one schedules a note at context time `t` and forgets about it: the
 * nodes stop by themselves when the note ends.
 */
import type { AudioEngine, Bus } from './engine.js';
import { frequency } from './theory.js';

/** Plays `midi` at time `t` for `dur` seconds with velocity `vel` (0 to 1) into `bus`. */
export type Instrument = (e: AudioEngine, bus: Bus, t: number, midi: number, dur: number, vel: number) => void;

/** Envelope: rises in `attack`, falls to `sustain` over `decay`, holds until `dur` and dies over `release`. */
function envelope(g: AudioParam, t: number, peak: number, attack: number, decay: number, sustain: number, dur: number, release: number): number {
  const end = t + Math.max(dur, attack + decay * 0.3);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.setTargetAtTime(peak * sustain, t + attack, decay / 3);
  g.setTargetAtTime(0, end, release / 4);
  return end + release;
}

/** A gain connected to the bus, with its own reverb and echo sends. */
function output(e: AudioEngine, bus: Bus, reverb: number, echo: number): GainNode {
  const g = e.ctx.createGain();
  g.connect(bus.dry);
  if (reverb > 0) {
    const r = e.ctx.createGain();
    r.gain.value = reverb;
    g.connect(r).connect(bus.reverb);
  }
  if (echo > 0) {
    const d = e.ctx.createGain();
    d.gain.value = echo;
    g.connect(d).connect(bus.echo);
  }
  return g;
}

function oscillator(e: AudioEngine, type: OscillatorType, f: number, detune = 0): OscillatorNode {
  const o = e.ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  return o;
}

function filter(e: AudioEngine, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = e.ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function noise(e: AudioEngine, t: number, until: number): AudioBufferSourceNode {
  const r = e.ctx.createBufferSource();
  r.buffer = e.noise;
  r.loop = true;
  // Each hit starts somewhere else in the noise, so they don't all sound the same.
  r.start(t, Math.random() * 1.5);
  r.stop(until);
  return r;
}

const run = (nodes: AudioScheduledSourceNode[], t: number, until: number): void => {
  for (const n of nodes) {
    n.start(t);
    n.stop(until);
  }
};

/** Pad of detuned saws, with a filter that breathes open. */
export const pad: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0.55, 0.1);
  const lp = filter(e, 'lowpass', 700 + vel * 600, 0.9);
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(900 + vel * 700, t + Math.min(dur, 2));
  lp.connect(g);
  const end = envelope(g.gain, t, 0.05 * vel, 0.6, 1, 0.85, dur, 1.6);
  const osc = [oscillator(e, 'sawtooth', f, -8), oscillator(e, 'sawtooth', f, 8), oscillator(e, 'triangle', f / 2)];
  osc.forEach((o) => o.connect(lp));
  run(osc, t, end);
};

/** FM electric piano: a bright attack that fades, a round tail. */
export const piano: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0.3, 0.12);
  const end = envelope(g.gain, t, 0.11 * vel, 0.004, 1.8, 0.0, dur, 0.5);
  const carrier = oscillator(e, 'sine', f);
  const modulator = oscillator(e, 'sine', f);
  const index = e.ctx.createGain();
  index.gain.setValueAtTime(f * 2.2 * vel, t);
  index.gain.setTargetAtTime(f * 0.25, t, 0.12);
  modulator.connect(index).connect(carrier.frequency);
  // The "tine" ping of the attack.
  const tine = oscillator(e, 'sine', f * 14);
  const strike = e.ctx.createGain();
  strike.gain.setValueAtTime(f * 0.6, t);
  strike.gain.setTargetAtTime(0, t, 0.02);
  tine.connect(strike).connect(carrier.frequency);
  carrier.connect(g);
  run([carrier, modulator, tine], t, end);
};

/** Inharmonic FM bell with a long tail. */
export const bell: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0.5, 0.25);
  const end = envelope(g.gain, t, 0.07 * vel, 0.002, 2.6, 0, Math.max(dur, 2.2), 0.4);
  const carrier = oscillator(e, 'sine', f);
  const modulator = oscillator(e, 'sine', f * 3.5);
  const index = e.ctx.createGain();
  index.gain.setValueAtTime(f * 1.6, t);
  index.gain.setTargetAtTime(f * 0.1, t, 0.5);
  modulator.connect(index).connect(carrier.frequency);
  carrier.connect(g);
  run([carrier, modulator], t, end);
};

/** Short digital pulse whose filter snaps shut: a computer-terminal colour. */
export const pulse: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0.2, 0.35);
  const lp = filter(e, 'lowpass', 3200, 4);
  lp.frequency.setValueAtTime(800 + 3200 * vel, t);
  lp.frequency.setTargetAtTime(350, t, 0.07);
  lp.connect(g);
  const end = envelope(g.gain, t, 0.07 * vel, 0.003, 0.3, 0, Math.min(dur, 0.2), 0.12);
  const o = oscillator(e, 'square', f);
  o.connect(lp);
  run([o], t, end);
};

/** Round bass: triangle, a sub sine an octave down and a touch of square, through a lowpass. */
export const bass: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0, 0);
  const lp = filter(e, 'lowpass', 420, 1.2);
  lp.connect(g);
  const end = envelope(g.gain, t, 0.24 * vel, 0.01, 0.4, 0.7, dur * 0.92, 0.09);
  const osc = [oscillator(e, 'triangle', f), oscillator(e, 'sine', f / 2), oscillator(e, 'square', f, 4)];
  const mix = [1, 0.55, 0.18];
  osc.forEach((o, i) => {
    const k = e.ctx.createGain();
    k.gain.value = mix[i]!;
    o.connect(k).connect(lp);
  });
  run(osc, t, end);
};

/** Singing voice: a soft saw with vibrato that arrives late. */
export const voice: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0.35, 0.3);
  const lp = filter(e, 'lowpass', 1500, 1);
  lp.connect(g);
  const end = envelope(g.gain, t, 0.065 * vel, 0.05, 0.4, 0.8, dur, 0.3);
  const osc = [oscillator(e, 'sawtooth', f, -5), oscillator(e, 'triangle', f, 5)];
  const vib = oscillator(e, 'sine', 5.2);
  const depth = e.ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.5, dur));
  vib.connect(depth);
  osc.forEach((o) => {
    depth.connect(o.frequency);
    o.connect(lp);
  });
  run([...osc, vib], t, end);
};

/** Flute: a triangle with breath noise. */
export const flute: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0.35, 0.2);
  const end = envelope(g.gain, t, 0.09 * vel, 0.06, 0.3, 0.8, dur, 0.2);
  const o = oscillator(e, 'triangle', f);
  const vib = oscillator(e, 'sine', 4.6);
  const depth = e.ctx.createGain();
  depth.gain.value = f * 0.008;
  vib.connect(depth).connect(o.frequency);
  o.connect(g);
  const breath = noise(e, t, end);
  const bp = filter(e, 'bandpass', f * 2, 6);
  const k = e.ctx.createGain();
  k.gain.value = 0.25;
  breath.connect(bp).connect(k).connect(g);
  run([o, vib], t, end);
};

/** Old-radio accordion: two detuned reeds with tremolo. */
export const accordion: Instrument = (e, bus, t, midi, dur, vel) => {
  const f = frequency(midi);
  const g = output(e, bus, 0, 0);
  const end = envelope(g.gain, t, 0.07 * vel, 0.03, 0.2, 0.85, dur, 0.08);
  const osc = [oscillator(e, 'sawtooth', f, -12), oscillator(e, 'sawtooth', f, 12), oscillator(e, 'square', f / 2)];
  const trem = oscillator(e, 'sine', 6);
  const depth = e.ctx.createGain();
  depth.gain.value = 0.25;
  const amp = e.ctx.createGain();
  amp.gain.value = 0.75;
  trem.connect(depth).connect(amp.gain);
  osc.forEach((o) => o.connect(amp));
  amp.connect(g);
  run([...osc, trem], t, end);
};

// ── Percussion ──────────────────────────────────────────────────────────────────────────────────

/** Kick: a sine that drops from 150 to 42 Hz. */
export const kick: Instrument = (e, bus, t, _midi, _dur, vel) => {
  const g = output(e, bus, 0.05, 0);
  g.gain.setValueAtTime(0.55 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
  const o = oscillator(e, 'sine', 150);
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  o.connect(g);
  run([o], t, t + 0.4);
};

/** Snare: highpassed noise over a short triangle body. */
export const snare: Instrument = (e, bus, t, _midi, _dur, vel) => {
  const g = output(e, bus, 0.25, 0);
  g.gain.setValueAtTime(0.2 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  const hp = filter(e, 'highpass', 1300);
  noise(e, t, t + 0.22).connect(hp).connect(g);
  const body = e.ctx.createGain();
  body.gain.setValueAtTime(0.5 * vel, t);
  body.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  const o = oscillator(e, 'triangle', 190);
  o.connect(body).connect(g);
  run([o], t, t + 0.1);
};

/** Hi-hat style cymbal: closed for short notes, open when the note is longer than 0.2 s. */
export const cymbal: Instrument = (e, bus, t, _midi, dur, vel) => {
  const g = output(e, bus, 0.1, 0);
  const length = dur > 0.2 ? 0.25 : 0.045;
  g.gain.setValueAtTime(0.09 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + length);
  const hp = filter(e, 'highpass', 7200);
  noise(e, t, t + length + 0.02).connect(hp).connect(g);
};

/** Rim shot: a dry, high click. */
export const rim: Instrument = (e, bus, t, _midi, _dur, vel) => {
  const g = output(e, bus, 0.3, 0.1);
  g.gain.setValueAtTime(0.12 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  const bp = filter(e, 'bandpass', 1900, 3);
  noise(e, t, t + 0.06).connect(bp).connect(g);
  const o = oscillator(e, 'square', 820);
  const k = e.ctx.createGain();
  k.gain.value = 0.3;
  o.connect(k).connect(g);
  run([o], t, t + 0.03);
};

/** Clock tick. Pitched by `midi` (C7 when 0, as drum voices pass). */
export const tick: Instrument = (e, bus, t, midi, _dur, vel) => {
  const g = output(e, bus, 0.4, 0);
  g.gain.setValueAtTime(0.08 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  const o = oscillator(e, 'sine', frequency(midi || 96));
  o.connect(g);
  run([o], t, t + 0.04);
};

/** Every built-in instrument by name, as used by sequencer voices. */
export const INSTRUMENTS = { pad, piano, bell, pulse, bass, voice, flute, accordion, kick, snare, cymbal, rim, tick } satisfies Record<string, Instrument>;
export type InstrumentName = keyof typeof INSTRUMENTS;
