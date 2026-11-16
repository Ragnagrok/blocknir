/**
 * A saved game (or any JSON value) kept in `localStorage`. Every method is safe when storage is
 * missing or blocked (private mode, sandboxed iframes): the game just runs without saving.
 */
export class SaveSlot<T> {
  /**
   * @param key storage key; include a version (for example `my-game.save.v1`) so old saves can be told apart
   * @param storage where to keep it; defaults to `localStorage`, looked up on each call
   */
  constructor(
    readonly key: string,
    private storage: () => Storage | undefined = () => globalThis.localStorage,
  ) {}

  /** The saved value, or null when there is none, it can't be parsed, or storage is unavailable. */
  read(): T | null {
    try {
      const s = this.storage()?.getItem(this.key);
      return s ? (JSON.parse(s) as T) : null;
    } catch {
      return null;
    }
  }

  /** Saves the value; returns false if it could not be stored. */
  write(value: T): boolean {
    try {
      const st = this.storage();
      if (!st) return false;
      st.setItem(this.key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  /** Deletes the saved value, if any. */
  clear(): void {
    try {
      this.storage()?.removeItem(this.key);
    } catch {
      // Nothing to delete.
    }
  }
}
