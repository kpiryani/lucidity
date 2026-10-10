// Groups bursts of texts ("dad was up" / "again" / "pacing") into one turn.
// Each new item for a key resets that key's timer; when it goes quiet for
// `delayMs`, all collected items are flushed together.

export class Debouncer<T> {
  private pending = new Map<string, { items: T[]; timer: NodeJS.Timeout }>();

  constructor(
    private readonly delayMs: number,
    private readonly onFlush: (key: string, items: T[]) => Promise<void>,
  ) {}

  push(key: string, item: T): void {
    const entry = this.pending.get(key);
    if (entry) clearTimeout(entry.timer);
    const items = entry ? [...entry.items, item] : [item];
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.onFlush(key, items).catch((err) => console.error("[lucidity.debounce] flush failed", { key, err }));
    }, this.delayMs);
    this.pending.set(key, { items, timer });
  }
}
