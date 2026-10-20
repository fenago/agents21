// Server-side response cache on Netlify Blobs (PRD §7.3).
//
// - Entries are `{ expires, data }` JSON; expiry is checked on read (Blobs has no native TTL).
// - Keys: `<version>/<endpoint>/<sha256 of the stable-sorted params>`. For trending and
//   search the params are the platform plus the adapter's `cacheParams()` (upstream path
//   and the params it actually sends), so inputs a platform ignores never split the cache. The canonical
//   string is `name=value&…` with names sorted and values URI-encoded, so param order
//   never matters. It is hashed because params hold user text and cursors up to 2000
//   chars, while blob keys must stay short and path-safe.
// - The functions cache per platform, never the merged response: one failed platform
//   is simply not written and is retried on the next request.
// - The cache is best-effort. Any store error or slow store (no Blobs context locally or
//   in tests, network blip) is treated as a miss / skipped write and never fails a request.
import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';

/** Bump to invalidate every entry when the cached data shape changes. */
export const CACHE_VERSION = 'v2';
export const STORE_NAME = 'trendscout-cache';

export const TTL_MS = {
  trending: 15 * 60_000,
  search: 30 * 60_000,
  credits: 10 * 60_000,
} as const;

/** Cap on each store operation so a slow store cannot eat the upstream call's time budget. */
export const STORE_OP_TIMEOUT_MS = 500;

/** The subset of a Blobs store the cache needs; injectable for tests. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

export type CacheParams = Record<string, string | number | boolean | undefined>;

export function canonicalParams(params: CacheParams): string {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join('&');
}

export function cacheKey(endpoint: string, params: CacheParams): string {
  const hash = createHash('sha256').update(canonicalParams(params)).digest('hex');
  return `${CACHE_VERSION}/${endpoint}/${hash}`;
}

/**
 * Lazily binds to the Netlify Blobs store. getStore() itself throws outside a Netlify
 * context, so it is called inside each operation where the cache layer can catch it.
 */
export function netlifyBlobStore(name = STORE_NAME): CacheStore {
  return {
    get: (key) => getStore(name).get(key, { type: 'text' }),
    set: (key, value) => getStore(name).set(key, value),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('cache store timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type Entry = { expires: number; data: unknown };

function isEntry(value: unknown): value is Entry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Entry).expires === 'number' &&
    'data' in value
  );
}

export type Cache = {
  /** The cached data, or undefined on miss, expiry, corrupt entry or store error. */
  read<T>(key: string): Promise<T | undefined>;
  /** Best-effort write; never throws. */
  write(key: string, data: unknown, ttlMs: number): Promise<void>;
};

export function createCache(
  store: CacheStore,
  now: () => number = Date.now,
  opTimeoutMs = STORE_OP_TIMEOUT_MS,
): Cache {
  return {
    async read<T>(key: string): Promise<T | undefined> {
      try {
        const raw = await withTimeout(Promise.resolve().then(() => store.get(key)), opTimeoutMs);
        if (raw === null || raw === undefined) return undefined;
        const entry: unknown = JSON.parse(raw);
        if (!isEntry(entry) || entry.expires <= now()) return undefined;
        return entry.data as T;
      } catch {
        return undefined;
      }
    },

    async write(key, data, ttlMs) {
      try {
        const entry: Entry = { expires: now() + ttlMs, data };
        await withTimeout(Promise.resolve().then(() => store.set(key, JSON.stringify(entry))), opTimeoutMs);
      } catch {
        // Cache writes are best-effort.
      }
    },
  };
}
