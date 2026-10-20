// Browser client for the TrendScout functions. Only ever calls same-origin /api/*;
// the Scrape Creators key lives on the server (PRD §7.4).
import { PLATFORMS, isPlatform, type Platform, type PlatformError, type Video, type VideoListResponse } from '../shared/video';
import type { TimeWindow } from './config';

export const PASSWORD_HEADER = 'x-app-password';
const PASSWORD_STORAGE_KEY = 'trendscout:password';

export type Cursors = VideoListResponse['cursors'];

export type TrendingRequest = { platforms: readonly Platform[]; region: string };
export type SearchRequest = TrendingRequest & { q: string; window: TimeWindow };

// ---------------------------------------------------------------------------
// Errors

export type ApiErrorKind =
  | 'unauthorized' // 401: password gate
  | 'server_not_configured' // 500: missing SCRAPECREATORS_API_KEY
  | 'invalid_parameter' // 400
  | 'http' // any other non-2xx
  | 'network' // fetch failed or the body was not the expected JSON
  | 'aborted';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly field?: string;

  constructor(kind: ApiErrorKind, status: number, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.field = field;
  }
}

export function isAbort(err: unknown): boolean {
  return (
    (err instanceof ApiError && err.kind === 'aborted') ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
  );
}

// ---------------------------------------------------------------------------
// Password (sessionStorage, with an in-memory fallback when storage is blocked)

let memoryPassword: string | null = null;

export function getPassword(): string | null {
  try {
    return sessionStorage.getItem(PASSWORD_STORAGE_KEY) ?? memoryPassword;
  } catch {
    return memoryPassword;
  }
}

export function setPassword(password: string): void {
  memoryPassword = password;
  try {
    sessionStorage.setItem(PASSWORD_STORAGE_KEY, password);
  } catch {
    // Private mode or storage disabled: the in-memory copy lasts until reload.
  }
}

export function clearPassword(): void {
  memoryPassword = null;
  try {
    sessionStorage.removeItem(PASSWORD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// URL building (param names match netlify/functions/lib/validation.ts)

function platformsParam(platforms: readonly Platform[]): string {
  return PLATFORMS.filter((p) => platforms.includes(p)).join(',');
}

export function buildTrendingUrl(req: TrendingRequest): string {
  const sp = new URLSearchParams({ platforms: platformsParam(req.platforms), region: req.region });
  return `/api/trending?${sp}`;
}

/**
 * First page: no cursors. Load more: pass the previous response's `cursors`; one
 * `cursor_<platform>` is added per non-empty cursor, and the server then queries only
 * those platforms. Cursors for platforms outside `platforms` are dropped (the server
 * would reject them).
 */
export function buildSearchUrl(req: SearchRequest, cursors: Cursors = {}): string {
  const sp = new URLSearchParams({
    q: req.q,
    platforms: platformsParam(req.platforms),
    window: req.window,
    region: req.region,
  });
  for (const p of PLATFORMS) {
    const c = cursors[p];
    if (c === undefined || c === '' || !req.platforms.includes(p)) continue;
    sp.set(`cursor_${p}`, String(c));
  }
  return `/api/search?${sp}`;
}

// ---------------------------------------------------------------------------
// Fetching

export type RequestOptions = { signal?: AbortSignal; fetchImpl?: typeof fetch };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

export async function apiGet(url: string, opts: RequestOptions = {}): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const password = getPassword();
  if (password !== null) headers[PASSWORD_HEADER] = password;

  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: opts.signal });
  } catch (err) {
    if (isAbort(err) || opts.signal?.aborted) throw new ApiError('aborted', 0, 'Request cancelled');
    throw new ApiError('network', 0, 'Could not reach the server. Check your connection and try again.');
  }

  const body = await readJson(res);
  if (opts.signal?.aborted) throw new ApiError('aborted', 0, 'Request cancelled');
  if (res.ok) {
    if (body === undefined) throw new ApiError('network', res.status, 'The server sent an unexpected response.');
    return body;
  }

  const code = field(body, 'error');
  if (res.status === 401) throw new ApiError('unauthorized', 401, 'Password required');
  if (code === 'server_not_configured') {
    throw new ApiError('server_not_configured', res.status, 'The server is missing its Scrape Creators API key.');
  }
  if (res.status === 400 && code === 'invalid_parameter') {
    const message = field(body, 'message');
    const f = field(body, 'field');
    throw new ApiError(
      'invalid_parameter',
      400,
      typeof message === 'string' ? message : 'Invalid request',
      typeof f === 'string' ? f : undefined,
    );
  }
  throw new ApiError('http', res.status, `The server returned an error (${res.status}). Please try again.`);
}

// ---------------------------------------------------------------------------
// Response parsing (defensive: never trust the shape blindly)

function isVideo(v: unknown): v is Video {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isPlatform(r.platform) &&
    typeof r.id === 'string' &&
    typeof r.url === 'string' &&
    r.url.startsWith('https://') &&
    typeof r.author === 'object' &&
    r.author !== null &&
    typeof r.stats === 'object' &&
    r.stats !== null
  );
}

function isPlatformError(e: unknown): e is PlatformError {
  return isPlatform(field(e, 'platform')) && typeof field(e, 'message') === 'string';
}

export function parseVideoList(body: unknown): VideoListResponse {
  const rawVideos = field(body, 'videos');
  const rawCursors = field(body, 'cursors');
  const rawErrors = field(body, 'errors');
  if (!Array.isArray(rawVideos)) throw new ApiError('network', 200, 'The server sent an unexpected response.');

  const videos = rawVideos.filter(isVideo).map((v) => ({
    ...v,
    title: typeof v.title === 'string' ? v.title : '',
    thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : '',
    author: { ...v.author, handle: typeof v.author.handle === 'string' ? v.author.handle : '' },
  }));
  const cursors: Cursors = {};
  if (typeof rawCursors === 'object' && rawCursors !== null) {
    for (const [p, c] of Object.entries(rawCursors)) {
      if (isPlatform(p) && (typeof c === 'string' || typeof c === 'number') && c !== '') cursors[p] = c;
    }
  }
  const errors = Array.isArray(rawErrors) ? rawErrors.filter(isPlatformError) : [];
  return { videos, cursors, errors };
}

export async function fetchTrending(req: TrendingRequest, opts?: RequestOptions): Promise<VideoListResponse> {
  return parseVideoList(await apiGet(buildTrendingUrl(req), opts));
}

export async function fetchSearch(req: SearchRequest, cursors?: Cursors, opts?: RequestOptions): Promise<VideoListResponse> {
  return parseVideoList(await apiGet(buildSearchUrl(req, cursors), opts));
}

/** Credit balance, or null when unknown. Throws ApiError on failure (the footer ignores it). */
export async function fetchCredits(opts?: RequestOptions): Promise<number | null> {
  const credits = field(await apiGet('/api/credits', opts), 'credits');
  return typeof credits === 'number' && Number.isFinite(credits) ? credits : null;
}
