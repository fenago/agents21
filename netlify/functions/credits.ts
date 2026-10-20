// GET /api/credits → { credits: number | null }
// (routed by the /api/* redirect in netlify.toml; no config.path by convention).
//
// Calls GET /v1/account/credit-balance. Per the Scrape Creators docs (checked 2026-10-20)
// the response looks like:
//   { "success": true, "credits_remaining": 1000000, "credits_charged": 1, "creditCount": 333 }
// `creditCount` is the endpoint's own field; `credits_remaining` is the generic field the
// API adds to every response. We read creditCount first and fall back to credits_remaining.
// `credits` is null when neither is a number. The docs list this call at 1 credit, so the
// balance is cached for 10 minutes.
//
// Errors: missing key → 500 server_not_configured; out of credits (402) → { credits: 0 };
// any other upstream failure → 502 { error: 'credits_unavailable' } (not cached).
import { checkPassword, type Sleep } from './lib/auth';
import { TTL_MS, cacheKey, createCache, netlifyBlobStore, type CacheStore } from './lib/cache';
import { errorCodeOf, runInBackground, type FunctionContext } from './lib/fanout';
import { errorResponse, jsonResponse, requireGet } from './lib/http';
import { scGet } from './lib/scrapecreators';

export const CREDITS_PATH = '/v1/account/credit-balance';
export const CREDITS_CACHE_KEY = cacheKey('credits', {});

export type CreditsResponse = { credits: number | null };

function asCount(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function parseCreditBalance(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return asCount(r.creditCount) ?? asCount(r.credits_remaining) ?? null;
}

export type CreditsDeps = {
  fetchBalance?: () => Promise<unknown>;
  store?: CacheStore;
  now?: () => number;
  log?: (message: string) => void;
  /** Delay before a wrong-password 401 (see lib/auth.ts); injectable for tests. */
  sleep?: Sleep;
};

export function createCreditsHandler(deps: CreditsDeps = {}) {
  const fetchBalance = deps.fetchBalance ?? (() => scGet<unknown>(CREDITS_PATH, {}));
  const cache = createCache(deps.store ?? netlifyBlobStore(), deps.now);
  const log = deps.log ?? ((m: string) => console.warn(m));

  return async (req: Request, context?: FunctionContext): Promise<Response> => {
    const denied = requireGet(req) ?? (await checkPassword(req, { sleep: deps.sleep }));
    if (denied) return denied;

    const cached = await cache.read<CreditsResponse>(CREDITS_CACHE_KEY);
    if (cached && (typeof cached.credits === 'number' || cached.credits === null)) {
      return jsonResponse({ credits: cached.credits });
    }

    try {
      const body: CreditsResponse = { credits: parseCreditBalance(await fetchBalance()) };
      if (body.credits !== null) runInBackground(cache.write(CREDITS_CACHE_KEY, body, TTL_MS.credits), context);
      return jsonResponse(body);
    } catch (err) {
      const code = errorCodeOf(err);
      log(`[trendscout] credits failed: ${code}`);
      if (code === 'missing_key') return errorResponse(500, { error: 'server_not_configured' });
      if (code === 'out_of_credits') return jsonResponse({ credits: 0 });
      return errorResponse(502, { error: 'credits_unavailable' });
    }
  };
}

export default createCreditsHandler();
