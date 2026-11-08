interface Entry<V> { value: V; expires: number; weight: number }

/**
 * Small TTL + LRU cache with "single flight": if 2,000 requests ask for the same missing key at the same
 * moment, `load` runs ONCE and everyone shares the result.
 */
export class TtlCache<V> {
  private entries = new Map<string, Entry<V>>();
  private inflight = new Map<string, Promise<V>>();
  private total = 0;

  constructor(
    private readonly ttlMs: number,
    private readonly maxWeight: number,
    private readonly weigh: (value: V) => number = () => 1,
  ) {}

  async get(key: string, load: () => Promise<V>, cacheIf: (value: V) => boolean = () => true): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, hit); // most recently used goes last
      return hit.value;
    }
    if (hit) this.drop(key);

    const running = this.inflight.get(key);
    if (running) return running;

    const p = load()
      .then((value) => {
        if (cacheIf(value)) this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  /** fresh value or undefined; never loads */
  peek(key: string): V | undefined {
    const e = this.entries.get(key);
    return e && e.expires > Date.now() ? e.value : undefined;
  }

  set(key: string, value: V): void {
    const weight = this.weigh(value);
    if (weight > this.maxWeight) return;
    this.drop(key);
    this.entries.set(key, { value, expires: Date.now() + this.ttlMs, weight });
    this.total += weight;
    for (const k of this.entries.keys()) {
      if (this.total <= this.maxWeight) break;
      this.drop(k); // oldest first
    }
  }

  private drop(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    this.total -= e.weight;
    this.entries.delete(key);
  }
}