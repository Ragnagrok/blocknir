/** A dialogue box whose text types itself out, a few letters per frame. */

export interface Line {
  text: string;
  /** Label shown in the speaker element; empty when missing. */
  speaker?: string;
  /** CSS class added to the box while this line shows (for example a narrator or system style). */
  style?: string;
}

export interface DialogueElements {
  /** The box; gets `openClass` while lines show and `completeClass` once a line is fully typed. */
  box: HTMLElement;
  /** Where the speaker's label goes. */
  speaker: HTMLElement;
  /** Where the line's text goes. */
  text: HTMLElement;
}

export interface DialogueOptions {
  charsPerSecond?: number;
  openClass?: string;
  completeClass?: string;
}

export class Dialogue {
  private queue: Line[] = [];
  private current: Line | null = null;
  private typed = 0;
  private done: (() => void) | null = null;
  private style = '';
  private readonly openClass: string;
  private readonly completeClass: string;
  charsPerSecond: number;
  /** For sound: when a line starts. */
  onLine: (line: Line) => void = () => {};
  /** For sound: every other letter that appears, at most once per frame. */
  onChar: (line: Line, char: string) => void = () => {};

  constructor(
    private elements: DialogueElements,
    options: DialogueOptions = {},
  ) {
    this.charsPerSecond = options.charsPerSecond ?? 55;
    this.openClass = options.openClass ?? 'open';
    this.completeClass = options.completeClass ?? 'complete';
  }

  /** Whether a line is showing. */
  get active(): boolean {
    return this.current !== null;
  }

  /** The line showing now, if any. */
  get line(): Line | null {
    return this.current;
  }

  /** Queues lines; `onDone` runs once the queue empties (it replaces an earlier pending one). */
  say(lines: Line[], onDone?: () => void): void {
    this.queue.push(...lines);
    if (onDone) this.done = onDone;
    if (!this.current) this.next();
  }

  /** Completes the line being typed, or moves on to the next one. */
  advance(): void {
    if (!this.current) return;
    if (this.typed < this.current.text.length) this.typed = this.current.text.length;
    else this.next();
    this.paint();
  }

  update(dt: number): void {
    if (!this.current) return;
    const before = Math.floor(this.typed);
    this.typed = Math.min(this.current.text.length, this.typed + dt * this.charsPerSecond);
    const now = Math.floor(this.typed);
    // A blip every other letter, and never more than one per frame.
    for (let i = now - 1; i >= before; i--) {
      const c = this.current.text[i]!;
      if (i % 2 === 0 && /[\p{L}\d]/u.test(c)) {
        this.onChar(this.current, c);
        break;
      }
    }
    this.paint();
  }

  private next(): void {
    this.current = this.queue.shift() ?? null;
    this.typed = 0;
    const box = this.elements.box;
    if (this.style) box.classList.remove(this.style);
    this.style = '';
    if (!this.current) {
      box.classList.remove(this.openClass, this.completeClass);
      const f = this.done;
      this.done = null;
      f?.();
      return;
    }
    box.classList.add(this.openClass);
    if (this.current.style) {
      this.style = this.current.style;
      box.classList.add(this.style);
    }
    this.onLine(this.current);
    this.elements.speaker.textContent = this.current.speaker ?? '';
    this.paint();
  }

  private paint(): void {
    if (!this.current) return;
    this.elements.text.textContent = this.current.text.slice(0, Math.floor(this.typed));
    this.elements.box.classList.toggle(this.completeClass, this.typed >= this.current.text.length);
  }
}
