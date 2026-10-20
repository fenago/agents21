// Input validation for the functions (PRD §7.4). Nothing reaches an adapter unvalidated.
//
// Pagination ("load more") contract for /api/search:
//   Cursors are passed as one query param per platform: `cursor_tiktok`, `cursor_instagram`,
//   `cursor_youtube`, each set to the value from the previous response's `cursors[platform]`.
//   - No cursor params: a first-page search on every platform in `platforms`.
//   - One or more cursor params: a load-more. ONLY the platforms that have a cursor are
//     queried (a platform with no cursor has no further pages). Every cursor must belong to
//     a platform in `platforms` (or to the default set when `platforms` is omitted).
//   - Empty cursor values (`cursor_tiktok=`) are treated as absent.
//   The response `cursors` then holds the next cursor for each queried platform that has more.
// Flat per-platform params were chosen over a JSON blob: they are cache/URL friendly,
// need no JSON parsing, and each one is validated on its own.
import { PLATFORMS, isPlatform, type Platform } from '../../../shared/video';
import { TIME_WINDOWS, type TimeWindow } from './adapters';
import { INSTAGRAM_MAX_PAGE } from './adapters/instagram';
import { errorResponse } from './http';

export const MAX_QUERY_LENGTH = 100;
export const MAX_CURSOR_LENGTH = 2000;
export const DEFAULT_REGION = 'US';
export const DEFAULT_WINDOW: TimeWindow = 'all';
export const CURSOR_PARAM_PREFIX = 'cursor_';

export type ValidationError = { error: 'invalid_parameter'; field: string; message: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

export type TrendingParams = { platforms: Platform[]; region: string };

export type SearchParams = {
  q: string;
  platforms: Platform[];
  window: TimeWindow;
  region: string;
  cursors: Partial<Record<Platform, string>>;
};

function fail<T>(field: string, message: string): Validated<T> {
  return { ok: false, error: { error: 'invalid_parameter', field, message } };
}

export function validationErrorResponse(error: ValidationError): Response {
  return errorResponse(400, error);
}

/** Comma-separated whitelist, deduped, returned in canonical PLATFORMS order. Default: all. */
export function parsePlatforms(raw: string | null): Validated<Platform[]> {
  if (raw === null) return { ok: true, value: [...PLATFORMS] };
  const items = raw.split(',').map((s) => s.trim().toLowerCase());
  if (items.length === 0 || items.every((s) => s === '')) return fail('platforms', 'platforms must not be empty');
  const chosen = new Set<Platform>();
  for (const item of items) {
    if (item === '') continue;
    if (!isPlatform(item)) return fail('platforms', `platforms must be a comma-separated subset of ${PLATFORMS.join(', ')}`);
    chosen.add(item);
  }
  return { ok: true, value: PLATFORMS.filter((p) => chosen.has(p)) };
}

export function parseRegion(raw: string | null): Validated<string> {
  if (raw === null) return { ok: true, value: DEFAULT_REGION };
  const region = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) return fail('region', 'region must be a two-letter country code');
  return { ok: true, value: region };
}

export function parseWindow(raw: string | null): Validated<TimeWindow> {
  if (raw === null) return { ok: true, value: DEFAULT_WINDOW };
  const w = raw.trim().toLowerCase();
  if (!(TIME_WINDOWS as readonly string[]).includes(w)) {
    return fail('window', `window must be one of ${TIME_WINDOWS.join(', ')}`);
  }
  return { ok: true, value: w as TimeWindow };
}

// Control characters never appear in real queries or cursors; rejecting them keeps logs,
// cache keys and upstream URLs clean.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function parseQuery(raw: string | null): Validated<string> {
  const q = (raw ?? '').trim();
  // Count code points, not UTF-16 units, so an emoji counts as one character.
  const length = Array.from(q).length;
  if (length < 1 || length > MAX_QUERY_LENGTH) return fail('q', `q must be 1–${MAX_QUERY_LENGTH} characters`);
  if (CONTROL_CHARS.test(q)) return fail('q', 'q contains invalid characters');
  return { ok: true, value: q };
}

export function parseCursor(platform: Platform, raw: string): Validated<string> {
  const field = `${CURSOR_PARAM_PREFIX}${platform}`;
  if (raw.length > MAX_CURSOR_LENGTH) return fail(field, `${field} must be at most ${MAX_CURSOR_LENGTH} characters`);
  if (CONTROL_CHARS.test(raw)) return fail(field, `${field} contains invalid characters`);
  if (platform === 'instagram') {
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 2 || n > INSTAGRAM_MAX_PAGE) {
      return fail(field, `${field} must be an integer from 2 to ${INSTAGRAM_MAX_PAGE}`);
    }
    // Canonical form, so `02` and `2` are the same page (and the same cache entry).
    return { ok: true, value: String(n) };
  }
  return { ok: true, value: raw };
}

export function validateTrending(url: URL): Validated<TrendingParams> {
  const platforms = parsePlatforms(url.searchParams.get('platforms'));
  if (!platforms.ok) return platforms;
  const region = parseRegion(url.searchParams.get('region'));
  if (!region.ok) return region;
  return { ok: true, value: { platforms: platforms.value, region: region.value } };
}

export function validateSearch(url: URL): Validated<SearchParams> {
  const sp = url.searchParams;
  const q = parseQuery(sp.get('q'));
  if (!q.ok) return q;
  const platforms = parsePlatforms(sp.get('platforms'));
  if (!platforms.ok) return platforms;
  const window = parseWindow(sp.get('window'));
  if (!window.ok) return window;
  const region = parseRegion(sp.get('region'));
  if (!region.ok) return region;

  const cursors: Partial<Record<Platform, string>> = {};
  for (const [name, value] of sp) {
    if (!name.startsWith(CURSOR_PARAM_PREFIX)) continue;
    const platform = name.slice(CURSOR_PARAM_PREFIX.length);
    if (!isPlatform(platform)) return fail(name, `unknown cursor parameter ${name}`);
    if (value === '') continue;
    if (!platforms.value.includes(platform)) return fail(name, `${name} given but ${platform} is not in platforms`);
    if (cursors[platform] !== undefined) return fail(name, `${name} given more than once`);
    const cursor = parseCursor(platform, value);
    if (!cursor.ok) return cursor;
    cursors[platform] = cursor.value;
  }

  return {
    ok: true,
    value: { q: q.value, platforms: platforms.value, window: window.value, region: region.value, cursors },
  };
}

/** Platforms a search actually queries: all selected ones, or only those with a cursor on load-more. */
export function platformsToQuery(params: SearchParams): Platform[] {
  const withCursor = params.platforms.filter((p) => params.cursors[p] !== undefined);
  return withCursor.length > 0 ? withCursor : params.platforms;
}
