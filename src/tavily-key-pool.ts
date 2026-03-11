/**
 * Tavily API Key pool — stick with current key until exhausted, then failover.
 */
export class TavilyKeyPool {
  private keys: string[];
  private index = 0;

  constructor(keys: string[]) {
    this.keys = keys.filter((k) => k.length > 0);
  }

  get available(): boolean {
    return this.keys.length > 0;
  }

  /** Get the current active key (stays on same key until rotated). */
  current(): string {
    if (this.keys.length === 0) throw new Error("No Tavily API keys configured");
    return this.keys[this.index % this.keys.length];
  }

  /** Advance to the next key. Returns false if all keys have been tried. */
  private rotate(): boolean {
    if (this.index + 1 >= this.keys.length) return false;
    this.index++;
    return true;
  }

  /**
   * Try a request with automatic key failover on 401/429 errors.
   * Uses the current key first; only switches to the next when quota is exhausted.
   */
  async tryWithRotation<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
    if (this.keys.length === 0) throw new Error("No Tavily API keys configured");

    let lastError: unknown;
    const startIndex = this.index;
    for (let attempt = 0; attempt < this.keys.length; attempt++) {
      const key = this.keys[(startIndex + attempt) % this.keys.length];
      try {
        return await fn(key);
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("401") || msg.includes("429")) {
          // Current key exhausted, permanently move to next
          this.index = (startIndex + attempt + 1) % this.keys.length;
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }
}
