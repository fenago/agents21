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

/**
 * Whether `password` can be sent in the x-app-password header. Header values are
 * ByteStrings, so fetch() throws a TypeError for anything outside Latin-1 (and for
 * CR/LF/NUL). We accept printable Latin-1 only: U+0020 to U+00FF.
 */
export function isSendablePassword(password: string): boolean {
  if (!/^[\u0020-\u00ff]*$/.test(password)) return false;
  if (typeof Headers === 'undefined') return true;
  try {
    new Headers({ [PASSWORD_HEADER]: password });
    return true;
  } catch {
    return false;
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
  if (password !== null) {
    // A stored password the header can't carry would make every fetch throw a
    // TypeError and lock the tab: drop it and go back to the password screen.
    if (!isSendablePassword(password)) {
      clearPassword();
      throw new ApiError('unauthorized', 401, 'Password required');
    }
    headers[PASSWORD_HEADER] = password;
  }

  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: opts.signal });
  } catch (err) {
    if (isAbort(err) || opts.signal?.aborted) throw new ApiError('aborted', 0, 'Request cancelled');
    // Belt and braces: the browser rejected the request while building it (header
    // value it refuses). Treat it as a bad password so the password screen returns.
    if (password !== null && err instanceof TypeError && /header/i.test(err.message)) {
      clearPassword();
      throw new ApiError('unauthorized', 401, 'Password required');
    }
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

/** Only https links and images reach the DOM (the server already enforces this). */
function httpsOrUndefined(u: unknown): string | undefined {
  return typeof u === 'string' && u.startsWith('https://') ? u : undefined;
}

function isPlatformError(e: unknown): e is PlatformError {
  return isPlatform(field(e, 'platform')) && typeof field(e, 'message') === 'string';
}

export function parseVideoList(body: unknown): VideoListResponse {
  const rawVideos = field(body, 'videos');
  const rawCursors = field(body, 'cursors');
  const rawErrors = field(body, 'errors');
  if (!Array.isArray(rawVideos)) throw new ApiError('network', 200, 'The server sent an unexpected response.');

  const videos = rawVideos.filter(isVideo).map((v): Video => {
    const { url: authorUrl, avatar, ...author } = v.author;
    const safeAuthorUrl = httpsOrUndefined(authorUrl);
    const safeAvatar = httpsOrUndefined(avatar);
    return {
      ...v,
      title: typeof v.title === 'string' ? v.title : '',
      thumbnail: httpsOrUndefined(v.thumbnail) ?? '',
      author: {
        ...author,
        handle: typeof author.handle === 'string' ? author.handle : '',
        ...(safeAuthorUrl !== undefined && { url: safeAuthorUrl }),
        ...(safeAvatar !== undefined && { avatar: safeAvatar }),
      },
    };
  });
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
