// GET /api/search?q=...&platforms=tiktok,youtube&window=today|week|month|all&region=US
//                 [&cursor_tiktok=...&cursor_instagram=...&cursor_youtube=...]
// (routed by the /api/* redirect in netlify.toml; no config.path by convention).
//
// Params (validated in lib/validation.ts; invalid input → 400 { error, field, message }):
//   q          required, trimmed, 1–100 chars, no control characters. A leading `#` means
//              hashtag search where supported.
//   platforms  optional, comma-separated subset of tiktok,instagram,youtube (default: all).
//   window     optional, today|week|month|all (default: all). Ignored by hashtag endpoints.
//   region     optional, two-letter country code (default: US).
//   cursor_<platform>  optional, per-platform pagination cursor (≤ 2000 chars;
//              Instagram: integer 2–11).
//
// Load more: copy each `cursors[platform]` from the previous response into
// `cursor_<platform>` and repeat the same q/platforms/window/region. When ANY cursor is
// present, only the platforms that have one are queried; the others are finished.
// The response `cursors` holds the next cursor for each platform that has more pages.
//
// Each platform's page is cached for 30 minutes under
// `search/{platform, ...adapter.cacheParams('search')}`, i.e. the upstream path and the
// params actually sent: Instagram ignores region, hashtag endpoints ignore window (and
// YouTube hashtag ignores region), Instagram cursors are normalized to page numbers.
// An empty first page is cached for only 2 minutes (likely a soft failure, but caching it
// stops a persistently empty platform from costing a credit per request); cache writes are
// not awaited.
import type { Platform } from '../../shared/video';
import { adapters as defaultAdapters, type PlatformAdapter } from './lib/adapters';
import { checkPassword, type Sleep } from './lib/auth';
import { TTL_MS, cacheKey, createCache, netlifyBlobStore, type CacheStore } from './lib/cache';
import { fanOut, listResponse, type FunctionContext } from './lib/fanout';
import { requireGet } from './lib/http';
import { platformsToQuery, validateSearch, validationErrorResponse } from './lib/validation';

export type SearchDeps = {
  adapters?: Record<Platform, PlatformAdapter>;
  store?: CacheStore;
  now?: () => number;
  log?: (message: string) => void;
  /** Delay before a wrong-password 401 (see lib/auth.ts); injectable for tests. */
  sleep?: Sleep;
};

export function createSearchHandler(deps: SearchDeps = {}) {
  const adapters = deps.adapters ?? defaultAdapters;
  const cache = createCache(deps.store ?? netlifyBlobStore(), deps.now);

  return async (req: Request, context?: FunctionContext): Promise<Response> => {
    const denied = requireGet(req) ?? (await checkPassword(req, { sleep: deps.sleep }));
    if (denied) return denied;

    const parsed = validateSearch(new URL(req.url));
    if (!parsed.ok) return validationErrorResponse(parsed.error);
    const params = parsed.value;
    const { q, window, region } = params;

    const outcomes = await fanOut(
      platformsToQuery(params).map((platform) => {
        const adapter = adapters[platform];
        const cursor = params.cursors[platform];
        const options = { query: q, window, region, cursor };
        return {
          platform,
          key: cacheKey('search', { ...adapter.cacheParams('search', options), platform }),
          firstPage: cursor === undefined,
          run: () => adapter.search(options),
        };
      }),
      { cache, ttlMs: TTL_MS.search, log: deps.log, context },
    );
    return listResponse(outcomes);
  };
}

export default createSearchHandler();
