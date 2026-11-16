/**
 * Touch controls: a floating joystick that appears where the finger lands. It only listens to
 * fingers and pens; the mouse keeps working as usual.
 */

export interface JoystickOptions {
  /** How far the knob travels from the center, in CSS pixels. */
  radius?: number;
  /** Fraction of the radius (0 to 1) that reads as no input. */
  deadZone?: number;
  /** A touch shorter than this (ms) and stiller than `tapPx` counts as a tap, not a drag. */
  tapMs?: number;
  tapPx?: number;
  /** Class added to the base while a finger is down. */
  activeClass?: string;
}

/**
 * Maps a finger offset from where it landed to the stick's output and the knob's offset. The output
 * has magnitude 0 to 1, rescaled so it starts at 0 at the edge of the dead zone.
 */
export function stickVector(dx: number, dy: number, radius: number, deadZone: number): { x: number; y: number; knobX: number; knobY: number } {
  const length = Math.hypot(dx, dy);
  if (length > radius) {
    dx *= radius / length;
    dy *= radius / length;
  }
  const m = Math.min(1, length / radius);
  const useful = m < deadZone ? 0 : (m - deadZone) / (1 - deadZone);
  return {
    x: length > 0 ? (dx / Math.min(length, radius)) * useful : 0,
    y: length > 0 ? (dy / Math.min(length, radius)) * useful : 0,
    knobX: dx,
    knobY: dy,
  };
}

export class Joystick {
  /** Direction on screen, with magnitude 0 to 1: x to the right, y down. */
  x = 0;
  y = 0;
  /** Called on a quick, still touch (when the finger lifts). */
  onTap: () => void = () => {};
  private id: number | null = null;
  private ox = 0;
  private oy = 0;
  private travel = 0;
  private start = 0;
  private readonly radius: number;
  private readonly deadZone: number;
  private readonly activeClass: string;

  /**
   * @param zone element that receives the touches (usually the whole game area)
   * @param base the joystick's ring, positioned (`left`/`top`) where the finger lands
   * @param knob the inner circle, moved with a CSS transform
   */
  constructor(
    zone: HTMLElement,
    private base: HTMLElement,
    private knob: HTMLElement,
    options: JoystickOptions = {},
  ) {
    this.radius = options.radius ?? 52;
    this.deadZone = options.deadZone ?? 0.15;
    this.activeClass = options.activeClass ?? 'active';
    const tapMs = options.tapMs ?? 260;
    const tapPx = options.tapPx ?? 10;

    zone.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' || this.id !== null) return;
      ev.preventDefault();
      this.id = ev.pointerId;
      zone.setPointerCapture(ev.pointerId);
      this.ox = ev.clientX;
      this.oy = ev.clientY;
      this.travel = 0;
      this.start = performance.now();
      this.base.style.left = `${this.ox}px`;
      this.base.style.top = `${this.oy}px`;
      this.base.classList.add(this.activeClass);
      this.move(ev.clientX, ev.clientY);
    });
    zone.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === this.id) this.move(ev.clientX, ev.clientY);
    });
    const end = (ev: PointerEvent): void => {
      if (ev.pointerId !== this.id) return;
      const tap = this.travel < tapPx && performance.now() - this.start < tapMs;
      this.release();
      if (tap && ev.type === 'pointerup') this.onTap();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /** Whether a finger is on the joystick. */
  get active(): boolean {
    return this.id !== null;
  }

  /** Lets go of the stick (for example when a cutscene starts or the scene changes). */
  release(): void {
    this.id = null;
    this.x = this.y = 0;
    this.base.classList.remove(this.activeClass);
    this.knob.style.transform = '';
  }

  private move(cx: number, cy: number): void {
    const dx = cx - this.ox;
    const dy = cy - this.oy;
    this.travel = Math.max(this.travel, Math.hypot(dx, dy));
    const v = stickVector(dx, dy, this.radius, this.deadZone);
    this.knob.style.transform = `translate(${v.knobX}px, ${v.knobY}px)`;
    this.x = v.x;
    this.y = v.y;
  }
}

/**
 * Toggles `className` on the body while the last pointer used is a finger or a pen, so CSS can show
 * touch controls only then. Starts from the `(pointer: coarse)` media query.
 */
export function detectTouch(className = 'touch'): void {
  const set = (on: boolean): void => {
    document.body.classList.toggle(className, on);
  };
  set(matchMedia('(pointer: coarse)').matches);
  window.addEventListener('pointerdown', (ev) => set(ev.pointerType !== 'mouse'), { capture: true });
}
