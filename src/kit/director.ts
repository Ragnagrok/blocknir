/**
 * Cutscenes as async functions: every step returns a promise that resolves inside the game loop
 * (`update(dt)`), so a scene reads in order, like a script.
 */
import type { Dialogue, Line } from './dialogue.js';

interface Wait {
  left: number;
  resolve: () => void;
}

export interface DirectorOptions {
  /** Dialogue box used by `say`. */
  dialogue?: Dialogue;
  /** Gets `cutsceneClass` while a cutscene runs. Defaults to `document.body` when there is a document. */
  root?: HTMLElement | null;
  cutsceneClass?: string;
  /**
   * Full-screen overlay for `fade`: it gets `fadeClass` when faded to black, and its CSS
   * `transition-duration` is set to the fade's length. Without it, `fade` only waits.
   */
  fade?: HTMLElement;
  fadeClass?: string;
  /** Full-screen caption for `caption`: gets the text and `captionClass` while it shows. Without it, `caption` only waits. */
  caption?: HTMLElement;
  captionClass?: string;
}

export class Director {
  /** How many cutscenes are running. While any is, the player should not control their character. */
  private running = 0;
  private waits: Wait[] = [];
  private readonly options: DirectorOptions;
  private readonly root: HTMLElement | null;
  /** For tests: waits and fades finish at once. */
  hurry = false;
  /** For sound: when a caption appears. */
  onCaption: (text: string) => void = () => {};

  constructor(options: DirectorOptions = {}) {
    this.options = options;
    this.root = options.root !== undefined ? options.root : (globalThis.document?.body ?? null);
  }

  /** Whether a cutscene is running. */
  get active(): boolean {
    return this.running > 0;
  }

  /** Runs a script; nested and overlapping scripts are counted, so `active` stays on until the last ends. */
  async run(script: () => Promise<void>): Promise<void> {
    const cls = this.options.cutsceneClass ?? 'cutscene';
    this.running++;
    this.root?.classList.add(cls);
    try {
      await script();
    } finally {
      this.running--;
      if (!this.running) this.root?.classList.remove(cls);
    }
  }

  /** Resolves after `seconds` of game time (immediately when hurrying). */
  wait(seconds: number): Promise<void> {
    if (this.hurry) return Promise.resolve();
    return new Promise((resolve) => this.waits.push({ left: seconds, resolve }));
  }

  /** Shows lines in the dialogue box and resolves when the player has gone through all of them. */
  say(lines: Line[]): Promise<void> {
    const d = this.options.dialogue;
    if (!d) return Promise.reject(new Error('Director.say needs a dialogue (pass it in the options)'));
    return new Promise((resolve) => d.say(lines, resolve));
  }

  /** Fades to black (true) or back from black (false). */
  async fade(toBlack: boolean, seconds = 0.6): Promise<void> {
    const f = this.options.fade;
    if (f) {
      f.style.transitionDuration = `${this.hurry ? 0 : seconds}s`;
      f.classList.toggle(this.options.fadeClass ?? 'black', toBlack);
    }
    await this.wait(seconds);
  }

  /** A full-screen caption, for example for a change of place or time. */
  async caption(text: string, seconds = 2.6): Promise<void> {
    const c = this.options.caption;
    const cls = this.options.captionClass ?? 'visible';
    if (c) {
      c.textContent = text;
      c.classList.add(cls);
    }
    this.onCaption(text);
    await this.wait(seconds);
    c?.classList.remove(cls);
    await this.wait(0.6);
  }

  update(dt: number): void {
    for (const w of [...this.waits]) {
      w.left -= dt;
      if (w.left <= 0) {
        this.waits.splice(this.waits.indexOf(w), 1);
        w.resolve();
      }
    }
  }
}
