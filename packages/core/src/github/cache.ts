export interface EtagCache {
  get(key: string): { etag: string; body: unknown } | undefined;
  set(key: string, etag: string, body: unknown): void;
}

export function createMemoryEtagCache(): EtagCache {
  const m = new Map<string, { etag: string; body: unknown }>();
  return {
    get: (k) => m.get(k),
    set: (k, etag, body) => {
      m.set(k, { etag, body });
    },
  };
}
