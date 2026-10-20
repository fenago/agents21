// Parallel per-platform fan-out with per-platform caching, safe error mapping and
// round-robin merge (PRD §7.2, §7.3). Shared by trending and search.
import type { Platform, PlatformError, Video, VideoListResponse } from '../../../shared/video';
import type { AdapterResult } from './adapters';
import type { Cache } from './cache';
import { CACHE_NONE, CACHE_OK, errorResponse, jsonResponse } from './http';
import { sanitizeVideos } from './sanitize';
import { ScrapeCreatorsError, type ScrapeCreatorsErrorCode } from './scrapecreators';

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

export type PlatformErrorCode = ScrapeCreatorsErrorCode | 'internal';

/**
 * Fixed, user-safe messages. Raw error messages are never forwarded: they can contain
 * upstream paths or other internals.
 */
export function platformErrorMessage(platform: Platform, code: PlatformErrorCode): string {
  const name = PLATFORM_LABEL[platform];
  switch (code) {
    case 'out_of_credits':
      return 'Out of Scrape Creators credits';
    case 'missing_key':
      return 'Server is not configured (missing API key)';
    case 'unauthorized':
      return 'Scrape Creators rejected the API key';
    case 'bad_request':
      return `${name} rejected the request`;
    case 'forbidden':
      return `${name} blocked the request, try again later`;
    case 'not_found':
      return `${name} returned no results`;
    case 'timeout':
      return `${name} took too long to respond`;
    case 'upstream':
      return `${name} is temporarily unavailable`;
    case 'internal':
      return `${name} failed unexpectedly`;
  }
}

export function errorCodeOf(err: unknown): PlatformErrorCode {
  return err instanceof ScrapeCreatorsError ? err.code : 'internal';
}

export type PlatformTask = {
  platform: Platform;
  /** Cache key for this platform's result (see cache.ts). */
  key: string;
  run: () => Promise<AdapterResult>;
};

export type Outcome =
  | { platform: Platform; ok: true; result: AdapterResult; cached: boolean }
  | { platform: Platform; ok: false; code: PlatformErrorCode };

export type FanOutOptions = {
  cache: Cache;
  ttlMs: number;
  /** Safe diagnostics only (platform, code, status). Defaults to console.warn. */
  log?: (message: string) => void;
};

function isAdapterResult(value: unknown): value is AdapterResult {
  return typeof value === 'object' && value !== null && Array.isArray((value as AdapterResult).videos);
}

/**
 * Runs every task in parallel. Each task reads its own cache entry first; on a miss it
 * calls the adapter and caches only a successful result. Failures become Outcomes,
 * never rejections (Promise.allSettled), so one platform cannot fail the request.
 */
export async function fanOut(tasks: PlatformTask[], opts: FanOutOptions): Promise<Outcome[]> {
  const log = opts.log ?? ((m: string) => console.warn(m));

  const settled = await Promise.allSettled(
    tasks.map(async (task) => {
      const hit = await opts.cache.read<AdapterResult>(task.key);
      if (isAdapterResult(hit)) return { result: hit, cached: true };
      const result = await task.run();
      await opts.cache.write(task.key, result, opts.ttlMs);
      return { result, cached: false };
    }),
  );

  return settled.map((s, i): Outcome => {
    const platform = tasks[i]!.platform;
    if (s.status === 'fulfilled') return { platform, ok: true, ...s.value };
    const code = errorCodeOf(s.reason);
    const status = s.reason instanceof ScrapeCreatorsError ? s.reason.status : 0;
    log(`[trendscout] ${platform} failed: ${code}${status ? ` (${status})` : ''}`);
    return { platform, ok: false, code };
  });
}

/** Interleave lists one item at a time (a1, b1, c1, a2, b2, …), dropping repeat platform+id pairs. */
export function roundRobinMerge(lists: readonly (readonly Video[])[]): Video[] {
  const out: Video[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const v = list[i];
      if (!v) continue;
      const id = `${v.platform}:${v.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(v);
    }
  }
  return out;
}

export function buildListResponse(outcomes: Outcome[]): VideoListResponse {
  const lists: Video[][] = [];
  const cursors: VideoListResponse['cursors'] = {};
  const errors: PlatformError[] = [];
  for (const o of outcomes) {
    if (o.ok) {
      lists.push(sanitizeVideos(o.result.videos));
      if (o.result.cursor !== undefined && o.result.cursor !== '') cursors[o.platform] = o.result.cursor;
    } else {
      errors.push({ platform: o.platform, code: o.code, message: platformErrorMessage(o.platform, o.code) });
    }
  }
  return { videos: roundRobinMerge(lists), cursors, errors };
}

/**
 * Final HTTP response for a fan-out. 500 `server_not_configured` when every platform
 * failed for lack of an API key; otherwise 200 with per-platform errors in `errors`.
 */
export function listResponse(outcomes: Outcome[]): Response {
  if (outcomes.length > 0 && outcomes.every((o) => !o.ok && o.code === 'missing_key')) {
    return errorResponse(500, { error: 'server_not_configured' });
  }
  const body = buildListResponse(outcomes);
  return jsonResponse(body, 200, body.errors.length > 0 ? CACHE_NONE : CACHE_OK);
}
