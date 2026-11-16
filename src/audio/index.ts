/**
 * Synthesized game audio on Web Audio: an engine with music, sfx and ambience buses, instruments, a
 * text-pattern step sequencer, ambience beds and sound effects. No sound files.
 *
 * Use `GameAudio` for the usual game wiring, or the pieces directly (they also run on an
 * `OfflineAudioContext`, to render to WAV).
 *
 * Former Spanish names (from Nullgard's `src/sonido`):
 * - theory (`teoria`): `nota` → `note`, `frecuencia` → `frequency`, `acorde`/`Acorde { raiz, intervalos }`
 *   → `chord`/`Chord { root, intervals }`, `tono` → `chordTone`, `pasos` → `steps`,
 *   `golpes`/`Golpe { paso, largo, valor }` → `hits`/`Hit { step, length, value }`, `acordes` → `chords`.
 * - engine (`motor`): `Motor` → `AudioEngine` (`salida` → `output`, `musica`/`efectos`/`ambiente` →
 *   `music`/`sfx`/`ambience`, `ruido` → `noise`, `ahora` → `now`, `ritmoEco` → `setEchoTime`,
 *   `nivel` → `setLevel`), `Bus { seco, rev, eco }` → `Bus { dry, reverb, echo }`.
 * - instruments (`instrumentos`): `Instrumento` → `Instrument`, `INSTRUMENTOS` → `INSTRUMENTS`,
 *   `NombreInstrumento` → `InstrumentName`; colchon → pad, piano, campana → bell, pulso → pulse,
 *   bajo → bass, canto → voice, flauta → flute, acordeon → accordion, bombo → kick, caja → snare,
 *   platillo → cymbal, aro → rim, tic → tick.
 * - sequencer (`secuenciador`): `Voz { inst, tipo, patron, octava, vel, desde }` →
 *   `Voice { inst, kind, pattern, octave, vel, startBar }` (kinds melodia/acorde/bajo/arpegio/golpe →
 *   melody/chord/bass/arpeggio/drum), `Pista { bpm, pasosPorCompas, acordes, voces, swing }` →
 *   `Track { bpm, stepsPerBar, chords, voices, swing }`, `Reproduccion` → `Playback`
 *   (`duracionPaso` → `stepDuration`, `ppc` → `stepsPerBar`, `vuelta` → `loopDuration`,
 *   `programarHasta` → `scheduleUntil`, `apagar` → `stop`).
 * - ambience (`ambiente`): `Ambiente` → `Ambience` (`poner` → `set`), `DefAmbiente { viento, zumbido: { f, vol },
 *   sucesos }` → `AmbienceDef { wind, hum: { freq, vol }, events }`, `Suceso` pajaro/paloma/gota/chispa →
 *   `AmbienceEvent` bird/coo/drip/spark.
 * - sfx (`efectos`): `Efectos` → `Sfx`; `tono` → `tone` (options `tipo, hasta, ataque, rev, eco, pan, corte`
 *   → `type, to, attack, reverb, echo, pan, cutoff`), `soplo` → `noise`, `paso` → `step`
 *   (`Superficie` baldosa/calle/tierra/piedra → `Surface` tile/pavement/dirt/stone), `letra` → `letter`,
 *   `linea` → `line`, `clic` → `click`, `aviso` → `notice`, `transicion` → `transition`, `impacto` →
 *   `impact`, `puerta` → `door`, `boom` → `explosion`, `golpe` → `glitch`, `ejecutar` → `confirm`,
 *   `incompleto` → `error`, `apagada` → `denied`, `tic` → `progress`, `conectar` → `powerUp`,
 *   `desconectar` → `powerDown`, `sanar` → `success`, `senal` → `ping`.
 * - facade (`sonido`): `Sonido` → `GameAudio` (`iniciar` → `start`, `musica` → `playTrack`,
 *   `efecto` → `play`, `ciclarNivel` → `cycleLevel`), `Nivel` todo/efectos/nada → `MuteLevel` all/sfx/none.
 */
import { Ambience, type AmbienceDef } from './ambience.js';
import { AudioEngine } from './engine.js';
import { Playback, type Track } from './sequencer.js';
import { Sfx } from './sfx.js';

export { note, frequency, chord, chordTone, steps, hits, chords, type Chord, type Hit } from './theory.js';
export { AudioEngine, type Bus } from './engine.js';
export { INSTRUMENTS, pad, piano, bell, pulse, bass, voice, flute, accordion, kick, snare, cymbal, rim, tick, type Instrument, type InstrumentName } from './instruments.js';
export { Playback, type Track, type Voice, type VoiceKind } from './sequencer.js';
export { Ambience, type AmbienceDef, type AmbienceEvent } from './ambience.js';
export { Sfx, type DialogueVoice, type NoiseOptions, type Surface, type ToneOptions } from './sfx.js';
export { DEMO_TRACK } from './demo-track.js';

/** `all` plays everything, `sfx` mutes the music, `none` mutes everything. */
export type MuteLevel = 'all' | 'sfx' | 'none';

const LEVELS: MuteLevel[] = ['all', 'sfx', 'none'];

export interface GameAudioOptions {
  /** localStorage key that remembers the mute level. Without one, it isn't remembered. */
  storageKey?: string;
  /** Music bus level when everything plays. Default 0.62. */
  musicVolume?: number;
  /** Ambience bus level unless muted. Default 0.9. */
  ambienceVolume?: number;
}

/**
 * The usual game wiring in one object: call `start()` once, early; the browser lets it sound only
 * after the first tap or key press, which it listens for. Before `start()` (or where there is no
 * Web Audio, like Node tests) everything is silent, but the requested track and ambience are kept
 * and begin when it starts.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private e: AudioEngine | null = null;
  private fx: Sfx | null = null;
  private amb: Ambience | null = null;
  private track: Track | null = null;
  private playback: Playback | null = null;
  private ambienceDef: AmbienceDef | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private teardown: (() => void)[] = [];
  private current: MuteLevel = 'all';

  constructor(private options: GameAudioOptions = {}) {
    const key = options.storageKey;
    if (!key) return;
    try {
      const stored = localStorage.getItem(key) as MuteLevel | null;
      if (stored && LEVELS.includes(stored)) this.current = stored;
    } catch {
      // No storage: stays at "all".
    }
  }

  /** The engine, once started: for custom effects or instruments. */
  get engine(): AudioEngine | null {
    return this.e;
  }

  get level(): MuteLevel {
    return this.current;
  }

  /** Whether the context is actually producing sound (started and unlocked). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Creates the audio context and starts scheduling. Safe to call more than once. */
  start(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    const e = new AudioEngine(ctx);
    this.ctx = ctx;
    this.e = e;
    this.fx = new Sfx(e);
    this.amb = new Ambience(e, this.fx);
    this.applyLevel(0);

    // Browsers don't allow sound until the player interacts with the page.
    const unlock = (): void => void ctx.resume();
    const events = ['pointerdown', 'keydown', 'touchend'];
    for (const ev of events) window.addEventListener(ev, unlock, { capture: true, passive: true });
    const visibility = (): void => void (document.hidden ? ctx.suspend() : ctx.resume());
    document.addEventListener('visibilitychange', visibility);
    this.teardown.push(() => {
      for (const ev of events) window.removeEventListener(ev, unlock, { capture: true });
      document.removeEventListener('visibilitychange', visibility);
    });
    this.timer = setInterval(() => this.schedule(), 50);

    const track = this.track;
    this.track = null;
    this.playTrack(track, 0.1);
    if (this.ambienceDef) this.amb.set(this.ambienceDef);
  }

  /** Stops everything and closes the audio context. */
  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const f of this.teardown) f();
    this.teardown = [];
    void this.ctx?.close();
    this.ctx = this.e = this.fx = this.amb = this.playback = null;
  }

  private schedule(): void {
    const e = this.e;
    if (!e || !this.running) return;
    const until = e.now + 0.3;
    this.playback?.scheduleUntil(until);
    this.amb?.scheduleUntil(until);
  }

  /** Crossfades to another track, or to silence with null. Does nothing if that track is already playing. */
  playTrack(track: Track | null, fade = 1.6): void {
    if (this.track === track) return;
    this.track = track;
    const e = this.e;
    if (!e) return;
    this.playback?.stop(fade);
    this.playback = null;
    if (!track) return;
    this.playback = new Playback(e, e.music, track, e.now + 0.15, 1);
    e.setEchoTime((60 / track.bpm) * 0.75);
  }

  /** Crossfades to another ambience, or to silence with `undefined`. */
  setAmbience(def: AmbienceDef | undefined, fade = 1.2): void {
    this.ambienceDef = def;
    this.amb?.set(def, fade);
  }

  /** Runs a sound effect, if audio is running and not fully muted: `audio.play((s) => s.click())`. */
  play(f: (sfx: Sfx) => void): void {
    if (this.fx && this.running && this.current !== 'none') f(this.fx);
  }

  setLevel(level: MuteLevel): void {
    this.current = level;
    const key = this.options.storageKey;
    if (key) {
      try {
        localStorage.setItem(key, level);
      } catch {
        // Applies anyway, just without remembering it.
      }
    }
    this.applyLevel(0.3);
  }

  /** Moves to the next level: all, sfx only, none. Returns the new one. */
  cycleLevel(): MuteLevel {
    this.setLevel(LEVELS[(LEVELS.indexOf(this.current) + 1) % LEVELS.length]!);
    return this.current;
  }

  private applyLevel(seconds: number): void {
    const e = this.e;
    if (!e) return;
    e.setLevel(e.music, this.current === 'all' ? (this.options.musicVolume ?? 0.62) : 0, seconds);
    e.setLevel(e.sfx, this.current === 'none' ? 0 : 1, seconds);
    e.setLevel(e.ambience, this.current === 'none' ? 0 : (this.options.ambienceVolume ?? 0.9), seconds);
  }
}
