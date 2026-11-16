/**
 * Background beds for a place: wind, an electric hum, and things that happen now and then (birds,
 * doves, drips, sparks). Setting a new ambience crossfades from the old one.
 */
import type { AudioEngine } from './engine.js';
import type { Sfx } from './sfx.js';

/** Random event presets: chirping bird, cooing dove, water drip, electric spark. */
export type AmbienceEvent = 'bird' | 'coo' | 'drip' | 'spark';

export interface AmbienceDef {
  /** Wind strength, 0 to 1. */
  wind?: number;
  /** Electric hum (a fridge, a server room): base frequency in Hz and volume 0 to 1. */
  hum?: { freq: number; vol: number };
  /** Events to sprinkle in. Listing one twice doesn't make it more frequent; each has its own pace. */
  events?: AmbienceEvent[];
}

/** Seconds between two events of a kind: a minimum and a maximum. */
const INTERVAL: Record<AmbienceEvent, [number, number]> = {
  bird: [3, 9],
  coo: [5, 13],
  drip: [1.5, 5],
  spark: [6, 16],
};

export class Ambience {
  private layer: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private events: AmbienceEvent[] = [];
  private next = new Map<AmbienceEvent, number>();

  constructor(
    private e: AudioEngine,
    private sfx: Sfx,
  ) {}

  /** Crossfades to `def`, or to silence with `undefined`. */
  set(def: AmbienceDef | undefined, fade = 1.2): void {
    const ctx = this.e.ctx;
    const now = this.e.now;
    if (this.layer) {
      const old = this.layer;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + fade);
      for (const s of this.sources) s.stop(now + fade + 0.1);
    }
    this.layer = null;
    this.sources = [];
    this.events = def?.events ?? [];
    this.next.clear();
    for (const s of this.events) this.next.set(s, now + INTERVAL[s][0] * Math.random());
    if (!def) return;

    const layer = ctx.createGain();
    layer.gain.setValueAtTime(0, now);
    layer.gain.linearRampToValueAtTime(1, now + fade);
    layer.connect(this.e.ambience.dry);
    this.layer = layer;

    if (def.wind) {
      // Noise through a slowly moving filter, panned back and forth.
      const r = ctx.createBufferSource();
      r.buffer = this.e.noise;
      r.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500;
      bp.Q.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const depth = ctx.createGain();
      depth.gain.value = 260;
      lfo.connect(depth).connect(bp.frequency);
      const pan = ctx.createStereoPanner();
      const panLfo = ctx.createOscillator();
      panLfo.frequency.value = 0.043;
      const panDepth = ctx.createGain();
      panDepth.gain.value = 0.5;
      panLfo.connect(panDepth).connect(pan.pan);
      const g = ctx.createGain();
      g.gain.value = def.wind * 0.32;
      r.connect(bp).connect(g).connect(pan).connect(layer);
      this.startSources(r, lfo, panLfo);
    }
    if (def.hum) {
      const { freq, vol } = def.hum;
      const g = ctx.createGain();
      g.gain.value = vol * 0.085;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.31;
      const depth = ctx.createGain();
      depth.gain.value = vol * 0.028;
      lfo.connect(depth).connect(g.gain);
      g.connect(layer);
      [1, 2, 3].forEach((k, i) => {
        const o = ctx.createOscillator();
        o.frequency.value = freq * k;
        const a = ctx.createGain();
        a.gain.value = [0.6, 0.3, 0.15][i]!;
        o.connect(a).connect(g);
        this.startSources(o);
      });
      this.startSources(lfo);
    }
  }

  private startSources(...nodes: AudioScheduledSourceNode[]): void {
    for (const n of nodes) {
      n.start();
      this.sources.push(n);
    }
  }

  /** Schedules the events due before context time `until`. */
  scheduleUntil(until: number): void {
    for (const s of this.events) {
      const t = this.next.get(s)!;
      if (t > until) continue;
      if (t > this.e.now - 0.1) this.event(s, t);
      const [a, b] = INTERVAL[s];
      this.next.set(s, Math.max(t, this.e.now) + a + Math.random() * (b - a));
    }
  }

  private event(s: AmbienceEvent, t: number): void {
    const fx = this.sfx;
    const pan = Math.random() * 1.6 - 0.8;
    switch (s) {
      case 'bird': {
        // An odd bird: two to four rising chirps.
        const n = 2 + Math.floor(Math.random() * 3);
        const base = 2300 + Math.random() * 1200;
        for (let i = 0; i < n; i++) fx.tone(base, t + i * 0.11, 0.07, 0.02, { to: base * 1.4, reverb: 0.4, pan });
        break;
      }
      case 'coo':
        for (const [i, f] of [390, 340].entries()) fx.tone(f, t + i * 0.32, 0.3, 0.035, { type: 'triangle', to: f * 0.92, attack: 0.08, cutoff: 900, pan });
        break;
      case 'drip': {
        const f = 1300 + Math.random() * 1100;
        fx.tone(f, t, 0.09, 0.03, { to: f * 0.6, reverb: 0.8, pan });
        break;
      }
      case 'spark':
        for (let i = 0; i < 5; i++) fx.noise(t + i * 0.025 + Math.random() * 0.02, 0.015, 0.06, 'highpass', 3500, 1, { pan });
        break;
    }
  }
}
