/**
 * Synthesized sound effects: footsteps, dialogue blips, UI sounds, impacts and doors. They all go to
 * the sfx bus and are scheduled in audio-context time (`t` defaults to now).
 */
import type { AudioEngine } from './engine.js';
import { frequency } from './theory.js';

export interface ToneOptions {
  type?: OscillatorType;
  /** Final frequency: the note glides there. */
  to?: number;
  attack?: number;
  reverb?: number;
  echo?: number;
  /** Stereo position, -1 (left) to 1 (right). */
  pan?: number;
  /** Fixed lowpass cutoff in Hz. */
  cutoff?: number;
}

export interface NoiseOptions {
  /** Final filter frequency: it glides there. */
  to?: number;
  attack?: number;
  reverb?: number;
  pan?: number;
}

/** What the footsteps walk on. */
export type Surface = 'tile' | 'pavement' | 'dirt' | 'stone';

/**
 * Dialogue voices with their own sound. Any other string is a character name, hashed to a pitch so
 * each character always sounds the same.
 */
export type DialogueVoice = 'system' | 'narrator' | 'player' | (string & {});

export class Sfx {
  constructor(protected readonly engine: AudioEngine) {}

  /** The audio context, for effects that build their own node graphs. */
  protected get ctx(): BaseAudioContext {
    return this.engine.ctx;
  }

  /**
   * A gain node routed to the effects bus, with optional reverb and echo sends and stereo pan.
   * Connect a custom sound to it to get the same placement as the built-in effects.
   */
  protected output(vol: number, reverb = 0, echo = 0, pan = 0): GainNode {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    let destination: AudioNode = this.engine.sfx.dry;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(destination);
      destination = p;
    }
    g.connect(destination);
    if (reverb) g.connect(this.send(reverb, this.engine.sfx.reverb));
    if (echo) g.connect(this.send(echo, this.engine.sfx.echo));
    return g;
  }

  /** A gain node that feeds `to` (a reverb or echo input) at `value`. */
  protected send(value: number, to: AudioNode): GainNode {
    const s = this.ctx.createGain();
    s.gain.value = value;
    s.connect(to);
    return s;
  }

  /** One note with a percussive envelope. The building block of most effects. */
  tone(f: number, t: number, dur: number, vol: number, o: ToneOptions = {}): void {
    const ctx = this.ctx;
    const g = this.output(1, o.reverb, o.echo, o.pan);
    const amp = ctx.createGain();
    const attack = o.attack ?? 0.004;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vol, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    let chain: AudioNode = osc;
    if (o.cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.cutoff;
      osc.connect(lp);
      chain = lp;
    }
    chain.connect(amp).connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise with an envelope: hits, whooshes, sparks. */
  noise(t: number, dur: number, vol: number, filter: BiquadFilterType, f: number, q = 1, o: NoiseOptions = {}): void {
    const ctx = this.ctx;
    const g = this.output(1, o.reverb, 0, o.pan);
    const amp = ctx.createGain();
    const attack = o.attack ?? 0.003;
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vol, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
    const b = ctx.createBiquadFilter();
    b.type = filter;
    b.frequency.setValueAtTime(f, t);
    if (o.to) b.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    b.Q.value = q;
    const r = ctx.createBufferSource();
    r.buffer = this.engine.noise;
    r.loop = true;
    r.connect(b).connect(amp).connect(g);
    r.start(t, Math.random() * 1.5);
    r.stop(t + dur + 0.05);
  }

  // ── World ───────────────────────────────────────────────────────────────────────────────────

  /** One footstep, slightly varied each time. */
  step(s: Surface, t = this.engine.now): void {
    const v = 0.85 + Math.random() * 0.3;
    switch (s) {
      case 'tile':
        this.noise(t, 0.035, 0.128 * v, 'bandpass', 2800 * v, 2.5);
        this.tone(130 * v, t, 0.05, 0.096, { to: 70 });
        break;
      case 'pavement':
        this.noise(t, 0.06, 0.112 * v, 'bandpass', 1300 * v, 1.2);
        this.tone(95 * v, t, 0.06, 0.096, { to: 55 });
        break;
      case 'dirt':
        this.noise(t, 0.09, 0.128 * v, 'lowpass', 1000 * v, 0.8);
        this.noise(t + 0.025, 0.05, 0.056 * v, 'bandpass', 2600, 2);
        break;
      case 'stone':
        this.noise(t, 0.05, 0.112 * v, 'bandpass', 2000 * v, 1.6, { reverb: 0.25 });
        if (Math.random() < 0.4) this.noise(t + 0.04, 0.03, 0.048, 'highpass', 4000, 1, { reverb: 0.3 });
        this.tone(110 * v, t, 0.05, 0.08, { to: 60 });
        break;
    }
  }

  /** A door: a creaking hinge and the thud of it closing. */
  door(t = this.engine.now): void {
    const ctx = this.ctx;
    // The creak: a saw that rises and falls through a narrow filter.
    const g = this.output(1, 0.4);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.06, t + 0.1);
    amp.gain.setValueAtTime(0.06, t + 1.0);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(190, t + 0.5);
    o.frequency.linearRampToValueAtTime(120, t + 1.3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 6;
    o.connect(bp).connect(amp).connect(g);
    o.start(t);
    o.stop(t + 1.4);
    this.noise(t + 1.3, 0.5, 0.22, 'bandpass', 700, 2, { reverb: 0.5 });
    this.tone(180, t + 1.3, 0.6, 0.12, { type: 'triangle', to: 150, reverb: 0.4 });
  }

  /** A low boom that keeps ringing, for title cards and big reveals. */
  impact(): void {
    const t = this.engine.now;
    this.tone(70, t, 2.6, 0.5, { to: 32, reverb: 0.7 });
    this.noise(t, 1.6, 0.18, 'lowpass', 900, 0.7, { to: 120, reverb: 0.8 });
    for (const [i, n] of [74, 81, 86].entries()) this.tone(frequency(n), t + 0.15 + i * 0.12, 2.4, 0.025, { reverb: 0.9, echo: 0.4, attack: 0.3 });
  }

  /** An explosion: a falling thump, a rumble and a crack. */
  explosion(): void {
    const t = this.engine.now;
    this.tone(120, t, 0.9, 0.5, { to: 28 });
    this.noise(t, 0.8, 0.35, 'lowpass', 2400, 0.8, { to: 150, reverb: 0.4 });
    this.noise(t, 0.15, 0.2, 'highpass', 3000, 1);
  }

  /** Taking damage: a buzz that breaks up. */
  glitch(): void {
    const t = this.engine.now;
    for (let i = 0; i < 6; i++) this.noise(t + i * 0.045, 0.04, 0.16, 'bandpass', 600 + Math.random() * 3000, 3);
    this.tone(80, t, 0.6, 0.3, { type: 'sawtooth', to: 40, cutoff: 600 });
    this.tone(frequency(61), t + 0.05, 0.5, 0.05, { type: 'square', to: frequency(49), cutoff: 1800 });
  }

  // ── Dialogue ────────────────────────────────────────────────────────────────────────────────

  /** A typewriter blip for one letter of dialogue. Call it every other character or so. */
  letter(voice: DialogueVoice, char: string): void {
    const t = this.engine.now;
    // The same letter always sounds the same: that gives each voice an "intonation".
    const shift = 2 ** ((((char.toLowerCase().charCodeAt(0) * 7) % 5) - 2) / 12);
    switch (voice) {
      case 'system':
        this.tone(1180 * shift, t, 0.035, 0.0875, { type: 'square', cutoff: 3500 });
        break;
      case 'narrator':
        this.tone(240 * shift, t, 0.05, 0.0875, { type: 'triangle' });
        break;
      case 'player':
        this.tone(420 * shift, t, 0.045, 0.125, { type: 'triangle', cutoff: 2400 });
        break;
      default: {
        let h = 0;
        for (const c of voice) h = (h * 31 + c.charCodeAt(0)) % 997;
        const base = 230 + (h % 9) * 45;
        this.tone(base * shift, t, 0.045, 0.125, { type: 'triangle', cutoff: 2000 });
      }
    }
  }

  /** Opens a new line of dialogue: two beeps for the system, a soft whoosh for anyone else. */
  line(voice: DialogueVoice): void {
    const t = this.engine.now;
    if (voice === 'system') {
      this.tone(1600, t, 0.04, 0.1, { type: 'square', cutoff: 4000 });
      this.tone(2400, t + 0.05, 0.05, 0.0875, { type: 'square', cutoff: 4000 });
    } else this.noise(t, 0.12, 0.075, 'bandpass', 900, 0.8, { to: 1600 });
  }

  // ── Interface ───────────────────────────────────────────────────────────────────────────────

  click(): void {
    this.tone(1900, this.engine.now, 0.025, 0.175, { type: 'square', cutoff: 5000 });
  }

  /** A soft two-note chime: something new to look at. */
  notice(): void {
    const t = this.engine.now;
    this.tone(frequency(81), t, 0.5, 0.08, { reverb: 0.4 });
    this.tone(frequency(76), t + 0.12, 0.7, 0.08, { reverb: 0.4 });
  }

  /** Changing places: a passing whoosh. */
  transition(): void {
    this.noise(this.engine.now, 0.9, 0.14, 'bandpass', 300, 1.5, { to: 2400, attack: 0.4, reverb: 0.3 });
  }

  /** Quick rising arpeggio: an action went through. */
  confirm(): void {
    const t = this.engine.now;
    [69, 72, 76, 81].forEach((n, i) => this.tone(frequency(n), t + i * 0.05, 0.1, 0.0765, { type: 'square', cutoff: 3500 }));
  }

  /** Two falling notes: not yet, or not like that. */
  error(): void {
    const t = this.engine.now;
    this.tone(frequency(64), t, 0.18, 0.06, { type: 'square', cutoff: 2000 });
    this.tone(frequency(60), t + 0.2, 0.3, 0.06, { type: 'square', cutoff: 2000 });
  }

  /** A dull thud: the thing is off, locked or out of reach. */
  denied(): void {
    const t = this.engine.now;
    this.tone(90, t, 0.3, 0.28, { to: 60 });
    this.tone(55, t, 0.6, 0.07, { type: 'sawtooth', cutoff: 300 });
  }

  /** Step `i` of a process: climbs a minor pentatonic scale over two octaves, then starts again. */
  progress(i: number, t = this.engine.now): void {
    const scale = [0, 3, 5, 7, 10];
    const n = 69 + scale[i % 5]! + 12 * (Math.floor(i / 5) % 2);
    this.tone(frequency(n), t, 0.12, 0.063, { type: 'square', cutoff: 2600, echo: 0.15 });
  }

  /** A rising sweep and three beeps: a device turns on or connects. */
  powerUp(): void {
    const t = this.engine.now;
    this.tone(220, t, 0.3, 0.102, { type: 'sawtooth', to: 1400, cutoff: 3000 });
    [76, 83, 88].forEach((n, i) => this.tone(frequency(n), t + 0.28 + i * 0.07, 0.12, 0.085, { type: 'square', cutoff: 4000, echo: 0.2 }));
  }

  /** A falling sweep and a low beep: a device turns off or disconnects. */
  powerDown(): void {
    const t = this.engine.now;
    this.tone(1200, t, 0.3, 0.09, { type: 'sawtooth', to: 160, cutoff: 2500 });
    this.tone(frequency(64), t + 0.25, 0.15, 0.072, { type: 'square', cutoff: 2000 });
  }

  /** A rising arpeggio with a shimmer that lingers: something was solved or restored. */
  success(): void {
    const t = this.engine.now;
    [72, 76, 79, 83, 86, 91].forEach((n, i) => this.tone(frequency(n), t + i * 0.07, 1.2, 0.06, { reverb: 0.5, echo: 0.3 }));
    this.noise(t + 0.3, 1.8, 0.04, 'highpass', 6000, 0.7, { attack: 0.5, reverb: 0.8 });
    this.tone(frequency(48), t, 1.6, 0.12, { type: 'triangle', attack: 0.05 });
  }

  /** Three radar pings that come closer: something was found nearby. */
  ping(): void {
    const t = this.engine.now;
    for (let i = 0; i < 3; i++) this.tone(1250 + i * 180, t + i * (0.55 - i * 0.12), 0.35, 0.084, { reverb: 0.4, echo: 0.3 });
  }
}
