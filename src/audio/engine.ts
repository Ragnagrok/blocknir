/**
 * The audio wiring: three buses (music, sfx and ambience) feeding a shared output with a
 * compressor, plus a shared reverb and echo. Everything is synthesized: there are no sound files.
 *
 * Works the same with an AudioContext (the game) and an OfflineAudioContext (tests that render to
 * WAV).
 */

export interface Bus {
  /** Where the dry sound connects. */
  dry: GainNode;
  /** Sends to the reverb and the echo: each voice feeds them with its own gain. */
  reverb: GainNode;
  echo: GainNode;
}

export class AudioEngine {
  readonly output: GainNode;
  readonly music: Bus;
  readonly sfx: Bus;
  readonly ambience: Bus;
  /** Two seconds of white noise, for everything that sounds like a breath, a hit or a spark. */
  readonly noise: AudioBuffer;
  private delay: DelayNode;

  constructor(readonly ctx: BaseAudioContext) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.25;
    compressor.connect(ctx.destination);
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
    this.output.connect(compressor);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(2.6);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    reverb.connect(reverbReturn).connect(this.output);

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.delay.connect(tone).connect(feedback).connect(this.delay);
    tone.connect(this.output);
    // A little of the echo also gets lost in the reverb.
    const echoToReverb = ctx.createGain();
    echoToReverb.gain.value = 0.3;
    tone.connect(echoToReverb).connect(reverb);

    const bus = (): Bus => {
      const dry = ctx.createGain();
      const rev = ctx.createGain();
      const echo = ctx.createGain();
      dry.connect(this.output);
      rev.connect(reverb);
      echo.connect(this.delay);
      return { dry, reverb: rev, echo };
    };
    this.music = bus();
    this.sfx = bus();
    this.ambience = bus();
    this.music.dry.gain.value = this.music.reverb.gain.value = this.music.echo.gain.value = 0.62;

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Sets the echo time, so it can follow the music's tempo. */
  setEchoTime(seconds: number): void {
    this.delay.delayTime.setTargetAtTime(Math.min(1.9, seconds), this.now, 0.05);
  }

  /** Fades a whole bus, sends included, to `value`. */
  setLevel(bus: Bus, value: number, seconds = 0.4): void {
    for (const g of [bus.dry, bus.reverb, bus.echo]) {
      g.gain.cancelScheduledValues(this.now);
      g.gain.setTargetAtTime(value, this.now, seconds / 3);
    }
  }

  /** A room: stereo noise that decays exponentially. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // Early reflections a bit quieter, then the tail.
        d[i] = (Math.random() * 2 - 1) * (1 - t) ** 2.4 * (i < ctx.sampleRate * 0.012 ? 0.3 : 1);
      }
    }
    return b;
  }
}
