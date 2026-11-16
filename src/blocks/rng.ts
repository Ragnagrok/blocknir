/**
 * A small seeded random generator (mulberry32). Its whole state is one 32-bit number, so a world
 * that uses it stays serializable and replays exactly from the same seed.
 */
export class Rng {
  /** The current state. Save it and pass it to the constructor to resume the same sequence. */
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max], both included. */
  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]!;
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}
