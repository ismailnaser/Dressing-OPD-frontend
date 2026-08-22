type CacheEntry = { at: number; data: unknown };

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export function getCached<T>(key: string, ttlMs: number): T | undefined {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= ttlMs) {
    memory.delete(key);
    return undefined;
  }
  return hit.data as T;
}

export function setCached<T>(key: string, data: T): void {
  memory.set(key, { at: Date.now(), data });
}

export function invalidateCache(prefix: string): void {
  for (const key of [...memory.keys()]) {
    if (key === prefix || key.startsWith(prefix)) memory.delete(key);
  }
}

export function clearQueryCache(): void {
  memory.clear();
  inflight.clear();
}

export function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  options?: { fresh?: boolean }
): Promise<T> {
  if (!options?.fresh) {
    const hit = getCached<T>(key, ttlMs);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const pending = fn()
    .then((data) => {
      setCached(key, data);
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, pending);
  return pending;
}
