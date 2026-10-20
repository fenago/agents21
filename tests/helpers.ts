// Test helpers: fixture loading and a recording fetch mock. No real network is ever used.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadFixture(platform: 'tiktok' | 'instagram' | 'youtube', name: string): unknown {
  const file = fileURLToPath(new URL(`./fixtures/${platform}/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}

export type RecordedCall = { url: URL; headers: Headers; signal?: AbortSignal | null };

type Reply = Response | Error | ((call: RecordedCall) => Response | Promise<Response>);

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fetch mock that answers with `replies` in order (the last one repeats) and records every call. */
export function mockFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: RecordedCall = {
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers: new Headers(init?.headers),
      signal: init?.signal,
    };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply === undefined) throw new Error('mockFetch: no reply configured');
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(call);
    return reply.clone();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** A fetch that never answers until its signal aborts (for timeout tests). */
export function hangingFetch() {
  const calls: RecordedCall[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers), signal: init?.signal });
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Query params of a recorded call as a plain object. */
export function paramsOf(call: RecordedCall | undefined): Record<string, string> {
  return call ? Object.fromEntries(call.url.searchParams) : {};
}
