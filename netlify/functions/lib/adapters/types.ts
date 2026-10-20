// Shared adapter contract (PRD §6.2 / §7.2).
import type { Platform, Video } from '../../../../shared/video';

export type TimeWindow = 'today' | 'week' | 'month' | 'all';

export const TIME_WINDOWS: readonly TimeWindow[] = ['today', 'week', 'month', 'all'];

export type TrendingOptions = { region?: string };

/**
 * `query` starting with `#` switches to the platform's hashtag endpoint (with the `#`
 * stripped) where one exists. Hashtag endpoints do not support a time window, so
 * `window` is ignored in hashtag mode.
 */
export type SearchOptions = {
  query: string;
  window?: TimeWindow;
  region?: string;
  cursor?: string | number;
};

/** `cursor` is exactly what the next `search()` call needs; undefined when there are no more pages. */
export type AdapterResult = { videos: Video[]; cursor?: string | number };

export type CallKind = 'trending' | 'search';

/** Query params exactly as sent upstream (undefined values are dropped by scGet). */
export type UpstreamParams = Record<string, string | number | boolean | undefined>;

/** One upstream request: what `trending()` / `search()` will send to Scrape Creators. */
export type UpstreamRequest = { path: string; params: UpstreamParams };

/**
 * Cache-key params for a call: the endpoint path plus the params actually sent, so two
 * calls share a cache entry exactly when they would make the same upstream request
 * (e.g. Instagram ignores `region`, hashtag endpoints ignore `window`). `{ path: '' }`
 * means no upstream call is made (e.g. an empty hashtag).
 */
export type CacheKeyParams = UpstreamParams & { path: string };

export interface PlatformAdapter {
  platform: Platform;
  trending(o?: TrendingOptions): Promise<AdapterResult>;
  search(o: SearchOptions): Promise<AdapterResult>;
  /** Pure: no network. Derived from the same request builder trending()/search() use. */
  cacheParams(kind: 'trending', o?: TrendingOptions): CacheKeyParams;
  cacheParams(kind: 'search', o: SearchOptions): CacheKeyParams;
}

/** Shared `cacheParams` implementation over an adapter's pure request builders. */
export function cacheParamsFrom(
  build: { trending: (o?: TrendingOptions) => UpstreamRequest; search: (o: SearchOptions) => UpstreamRequest | undefined },
): PlatformAdapter['cacheParams'] {
  function cacheParams(kind: 'trending', o?: TrendingOptions): CacheKeyParams;
  function cacheParams(kind: 'search', o: SearchOptions): CacheKeyParams;
  function cacheParams(kind: CallKind, o?: TrendingOptions | SearchOptions): CacheKeyParams {
    const req = kind === 'trending' ? build.trending(o as TrendingOptions | undefined) : build.search(o as SearchOptions);
    return req ? { ...req.params, path: req.path } : { path: '' };
  }
  return cacheParams;
}

/** Injection point for tests (mock fetch) and for per-call timeouts set by the functions layer. */
export type AdapterDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};
