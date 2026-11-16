/**
 * The part of tools/render-audio.ts that runs in the browser: Vite serves it like any module.
 * Renders the demo track, every sound effect and a few ambiences with an OfflineAudioContext.
 */
import { Ambience, AudioEngine, DEMO_TRACK, Playback, Sfx, chords, type AmbienceDef, type Surface } from '../src/audio/index.js';

export interface Render {
  name: string;
  seconds: number;
  peak: number;
  rms: number;
  /** 16-bit stereo WAV, base64. */
  wav: string;
}

const SR = 44100;

function wav(b: AudioBuffer): string {
  const n = b.length;
  const data = new DataView(new ArrayBuffer(44 + n * 4));
  const text = (o: number, s: string): void => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  data.setUint32(4, 36 + n * 4, true);
  text(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 2, true);
  data.setUint32(24, SR, true);
  data.setUint32(28, SR * 4, true);
  data.setUint16(32, 4, true);
  data.setUint16(34, 16, true);
  text(36, 'data');
  data.setUint32(40, n * 4, true);
  const l = b.getChannelData(0);
  const r = b.getChannelData(1);
  for (let i = 0; i < n; i++) {
    data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i]!)) * 32767, true);
    data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i]!)) * 32767, true);
  }
  let s = '';
  const bytes = new Uint8Array(data.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function render(name: string, seconds: number, build: (e: AudioEngine) => void): Promise<Render> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const e = new AudioEngine(ctx);
  // The same levels GameAudio uses when everything plays.
  e.setLevel(e.music, 0.62, 0);
  e.setLevel(e.ambience, 0.9, 0);
  build(e);
  const b = await ctx.startRendering();
  let peak = 0;
  let sum = 0;
  for (let c = 0; c < 2; c++) {
    for (const v of b.getChannelData(c)) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
  }
  return { name, seconds, peak, rms: Math.sqrt(sum / (b.length * 2)), wav: wav(b) };
}

export async function renderAll(): Promise<Render[]> {
  const list: Render[] = [];

  const track = DEMO_TRACK;
  const loop = ((track.stepsPerBar ?? 16) * chords(track.chords).length * 15) / track.bpm;
  // The drums and melody come in on the second pass: render two.
  const seconds = loop * 2 + 2;
  list.push(
    await render('music_demo', seconds, (e) => {
      e.setEchoTime((60 / track.bpm) * 0.75);
      new Playback(e, e.music, track, 0.05, 1).scheduleUntil(seconds - 2);
    }),
  );

  const surfaces: Surface[] = ['tile', 'pavement', 'dirt', 'stone'];
  const effects: [string, number, (fx: Sfx) => void][] = [
    ['steps', 3, (fx) => surfaces.forEach((s, i) => [0, 0.4].forEach((d) => fx.step(s, i * 0.75 + d)))],
    ['dialogue', 3, (fx) => [...'Hello there, how are you?'].forEach((c, i) => i % 2 === 0 && fx.letter(['player', 'Ada', 'system', 'narrator', 'Bo'][Math.floor(i / 5)]!, c))],
    ['line_system', 1, (fx) => fx.line('system')],
    ['line_person', 1, (fx) => fx.line('Ada')],
    ['click', 0.5, (fx) => fx.click()],
    ['notice', 1.5, (fx) => fx.notice()],
    ['transition', 1.5, (fx) => fx.transition()],
    ['impact', 4, (fx) => fx.impact()],
    ['door', 2.5, (fx) => fx.door()],
    ['explosion', 2, (fx) => fx.explosion()],
    ['glitch', 1.5, (fx) => fx.glitch()],
    ['confirm', 1, (fx) => fx.confirm()],
    ['error', 1, (fx) => fx.error()],
    ['denied', 1, (fx) => fx.denied()],
    ['progress', 2.4, (fx) => {
      for (let i = 0; i < 10; i++) fx.progress(i, i * 0.2);
    }],
    ['power_up', 1.2, (fx) => fx.powerUp()],
    ['power_down', 1, (fx) => fx.powerDown()],
    ['success', 3, (fx) => fx.success()],
    ['ping', 2.5, (fx) => fx.ping()],
  ];
  for (const [name, secs, f] of effects) list.push(await render(`sfx_${name}`, secs, (e) => f(new Sfx(e))));

  const ambiences: [string, AmbienceDef][] = [
    ['outdoors', { wind: 0.5, events: ['bird', 'coo'] }],
    ['machine_room', { hum: { freq: 50, vol: 0.5 }, events: ['drip', 'spark'] }],
  ];
  for (const [name, def] of ambiences) {
    list.push(
      await render(`ambience_${name}`, 12, (e) => {
        const a = new Ambience(e, new Sfx(e));
        a.set(def, 0.5);
        a.scheduleUntil(12);
      }),
    );
  }
  return list;
}
