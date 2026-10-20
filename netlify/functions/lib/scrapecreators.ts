// Minimal HTTP client for the Scrape Creators API (PRD §6.1).
//
// NOTE: netlify/functions/lib/ is shared code, not a function. Netlify only treats a
// subdirectory of netlify/functions as a function when it contains `index.*` or a file
// named after the directory (`lib/lib.*`). Never add either file here.
//
// - The API key is read from process.env at call time and is never logged or put into
//   an error message.
// - The timeout is an overall deadline for the call, including the one retry, so a
//   request can never run past `timeoutMs` (default 8s, to fit Netlify's 10s sync limit).
// - One retry on 5xx or network error, only if time is left. 4xx and timeouts are never retried.

export const SCRAPECREATORS_BASE_URL = 'https://api.scrapecreators.com';
export const DEFAULT_TIMEOUT_MS = 8000;

export type ScrapeCreatorsErrorCode =
  | 'missing_key'
  | 'bad_request'
  | 'unauthorized'
  | 'out_of_credits'
  | 'forbidden'
  | 'not_found'
  | 'upstream'
  | 'timeout';

export class ScrapeCreatorsError extends Error {
  /** Upstream HTTP status, or 0 when no response was received (missing key, network, timeout). */
  readonly status: number;
  readonly code: ScrapeCreatorsErrorCode;

  constructor(code: ScrapeCreatorsErrorCode, status: number, message: string) {
    super(message);
    this.name = 'ScrapeCreatorsError';
    this.code = code;
    this.status = status;
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type ScGetOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function codeForStatus(status: number): ScrapeCreatorsErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 402:
      return 'out_of_credits';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    default:
      return status >= 400 && status < 500 ? 'bad_request' : 'upstream';
  }
}

export function buildUrl(path: string, params: QueryParams): URL {
  const url = new URL(path, SCRAPECREATORS_BASE_URL);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(name, String(value));
  }
  return url;
}

// Only the path goes into messages: the query can hold user input and is not useful in logs.
function fail(code: ScrapeCreatorsErrorCode, status: number, path: string): ScrapeCreatorsError {
  const suffix = status ? ` ${status}` : '';
  return new ScrapeCreatorsError(code, status, `Scrape Creators ${path} failed (${code}${suffix})`);
}

export async function scGet<T>(path: string, params: QueryParams, opts: ScGetOptions = {}): Promise<T> {
  const apiKey = process.env.SCRAPECREATORS_API_KEY;
  if (!apiKey) {
    throw new ScrapeCreatorsError('missing_key', 0, 'SCRAPECREATORS_API_KEY is not configured');
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildUrl(path, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let attempt = 1; ; attempt++) {
      const canRetry = attempt === 1;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'GET',
          headers: { 'x-api-key': apiKey, accept: 'application/json' },
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw fail('timeout', 0, path);
        if (canRetry) continue;
        throw fail('upstream', 0, path);
      }

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          if (controller.signal.aborted) throw fail('timeout', 0, path);
          throw fail('upstream', res.status, path);
        }
      }

      // Discard the body: it is never surfaced, and leaving it unread can hold the socket.
      // Not awaited: cancel() on a tee'd/cloned body only settles once every branch is cancelled.
      void res.body?.cancel().catch(() => undefined);
      if (res.status >= 500 && canRetry && !controller.signal.aborted) continue;
      throw fail(codeForStatus(res.status), res.status, path);
    }
  } finally {
    clearTimeout(timer);
  }
}
