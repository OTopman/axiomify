export declare class LruTtlCache<T = any> {
  private cache;
  private maxKeys;
  private defaultTtlMs;
  constructor(maxKeys?: number, defaultTtlMs?: number);
  get(key: string): T | null;
  set(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
}
//# sourceMappingURL=cache.d.ts.map
