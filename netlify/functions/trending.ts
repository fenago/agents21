// GET /api/trending?platforms=tiktok,instagram,youtube&region=US
// (routed by the /api/* redirect in netlify.toml; no config.path by convention).
//
// Calls each selected platform's trending() in parallel and returns a VideoListResponse
// with the platforms interleaved round-robin. Each platform's result is cached for
// 15 minutes under `trending/{platform, ...adapter.cacheParams('trending')}`: only TikTok
// sends `region`, so Instagram/YouTube share one entry across regions. Empty feeds are
// cached for only 2 minutes (TTL_MS.emptyFirstPage). Trending feeds have no cursors.
import type { Platform } from '../../shared/video';
import { adapters as defaultAdapters, type PlatformAdapter } from './lib/adapters';
import { checkPassword, type Sleep } from './lib/auth';
import { TTL_MS, cacheKey, createCache, netlifyBlobStore, type CacheStore } from './lib/cache';
import { fanOut, listResponse, type FunctionContext } from './lib/fanout';
import { requireGet } from './lib/http';
import { validateTrending, validationErrorResponse } from './lib/validation';

export type TrendingDeps = {
  adapters?: Record<Platform, PlatformAdapter>;
  store?: CacheStore;
  now?: () => number;
  log?: (message: string) => void;
  /** Delay before a wrong-password 401 (see lib/auth.ts); injectable for tests. */
  sleep?: Sleep;
};

export function createTrendingHandler(deps: TrendingDeps = {}) {
  const adapters = deps.adapters ?? defaultAdapters;
  const cache = createCache(deps.store ?? netlifyBlobStore(), deps.now);

  return async (req: Request, context?: FunctionContext): Promise<Response> => {
    const denied = requireGet(req) ?? (await checkPassword(req, { sleep: deps.sleep }));
    if (denied) return denied;

    const parsed = validateTrending(new URL(req.url));
    if (!parsed.ok) return validationErrorResponse(parsed.error);
    const { platforms, region } = parsed.value;

    const outcomes = await fanOut(
      platforms.map((platform) => {
        const adapter = adapters[platform];
        return {
          platform,
          key: cacheKey('trending', { ...adapter.cacheParams('trending', { region }), platform }),
          firstPage: true,
          run: () => adapter.trending({ region }),
        };
      }),
      { cache, ttlMs: TTL_MS.trending, log: deps.log, context },
    );
    return listResponse(outcomes);
  };
}

export default createTrendingHandler();
