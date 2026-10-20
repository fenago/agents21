// Response helpers shared by the functions.
//
// Caching headers:
//   - Errors (4xx/5xx), and 200s that carry per-platform errors, are `no-store` so a retry
//     goes straight back to the function instead of a browser-cached partial result.
//   - Fully successful responses are `private, max-age=60` (per-user browser cache only;
//     the shared cache lives server-side in Netlify Blobs).

export const CACHE_OK = 'private, max-age=60';
export const CACHE_NONE = 'no-store';

export function jsonResponse(body: unknown, status = 200, cacheControl = status < 400 ? CACHE_OK : CACHE_NONE): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': cacheControl } });
}

export function errorResponse(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': CACHE_NONE, ...extraHeaders } });
}

/** Only GET is served. Returns a 405 for anything else, or undefined when the method is allowed. */
export function requireGet(req: Request): Response | undefined {
  if (req.method === 'GET') return undefined;
  return errorResponse(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
}
