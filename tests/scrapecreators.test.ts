import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrapeCreatorsError, buildUrl, codeForStatus, scGet } from '../netlify/functions/lib/scrapecreators';
import { hangingFetch, jsonResponse, mockFetch, paramsOf } from './helpers';

const KEY = 'sc-test-key-DO-NOT-LEAK-123';

beforeEach(() => vi.stubEnv('SCRAPECREATORS_API_KEY', KEY));
afterEach(() => vi.unstubAllEnvs());

async function catchError(p: Promise<unknown>): Promise<ScrapeCreatorsError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ScrapeCreatorsError);
    return err as ScrapeCreatorsError;
  }
  throw new Error('expected promise to reject');
}

function expectNoLeak(err: Error) {
  expect(err.message).not.toContain(KEY);
  expect(String(err.stack)).not.toContain(KEY);
  expect(JSON.stringify(err)).not.toContain(KEY);
}

describe('buildUrl', () => {
  it('uses the base URL and drops undefined params', () => {
    const url = buildUrl('/v1/tiktok/search/keyword', { query: 'cats & dogs', cursor: 10, trim: false, region: undefined });
    expect(url.origin + url.pathname).toBe('https://api.scrapecreators.com/v1/tiktok/search/keyword');
    expect(Object.fromEntries(url.searchParams)).toEqual({ query: 'cats & dogs', cursor: '10', trim: 'false' });
  });
});

describe('codeForStatus', () => {
  it.each([
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [402, 'out_of_credits'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'bad_request'],
    [500, 'upstream'],
    [503, 'upstream'],
  ] as const)('%i -> %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});

describe('scGet', () => {
  it('sends the x-api-key header and returns parsed JSON', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ success: true, n: 1 }));
    const body = await scGet<{ n: number }>('/v1/account/credit-balance', {}, { fetchImpl });
    expect(body.n).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('x-api-key')).toBe(KEY);
    expect(calls[0]?.url.href).toBe('https://api.scrapecreators.com/v1/account/credit-balance');
  });

  it('passes defined params in the query string', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({}));
    await scGet('/v1/youtube/search', { query: 'run', type: 'shorts', continuationToken: undefined }, { fetchImpl });
    expect(paramsOf(calls[0])).toEqual({ query: 'run', type: 'shorts' });
  });

  it('reads the key at call time', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'rotated-key');
    const { fetchImpl, calls } = mockFetch(jsonResponse({}));
    await scGet('/v1/account/credit-balance', {}, { fetchImpl });
    expect(calls[0]?.headers.get('x-api-key')).toBe('rotated-key');
  });

  it('throws missing_key without calling fetch when the key is not set', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', '');
    const { fetchImpl, calls } = mockFetch(jsonResponse({}));
    const err = await catchError(scGet('/v1/account/credit-balance', {}, { fetchImpl }));
    expect(err.code).toBe('missing_key');
    expect(err.status).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('maps 402 to out_of_credits and does not retry', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ success: false, message: `bad key ${KEY}` }, 402));
    const err = await catchError(scGet('/v1/tiktok/get-trending-feed', { region: 'US' }, { fetchImpl }));
    expect(err.code).toBe('out_of_credits');
    expect(err.status).toBe(402);
    expect(calls).toHaveLength(1);
    expectNoLeak(err);
    expect(err.message).not.toContain('bad key');
  });

  it.each([
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
  ] as const)('does not retry %i (%s)', async (status, code) => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ error: 'nope' }, status));
    const err = await catchError(scGet('/v1/x', {}, { fetchImpl }));
    expect(err.code).toBe(code);
    expect(calls).toHaveLength(1);
  });

  it('retries once on 5xx and succeeds', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ error: 'boom' }, 500), jsonResponse({ ok: 1 }));
    await expect(scGet('/v1/x', {}, { fetchImpl })).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('gives up after one retry on repeated 5xx', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({ error: 'boom' }, 502));
    const err = await catchError(scGet('/v1/x', {}, { fetchImpl }));
    expect(err.code).toBe('upstream');
    expect(err.status).toBe(502);
    expect(calls).toHaveLength(2);
  });

  it('retries once on a network error', async () => {
    const { fetchImpl, calls } = mockFetch(new TypeError(`fetch failed for key ${KEY}`), jsonResponse({ ok: 1 }));
    await expect(scGet('/v1/x', {}, { fetchImpl })).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it('reports upstream after two network errors without leaking the cause', async () => {
    const { fetchImpl, calls } = mockFetch(new TypeError(`fetch failed for key ${KEY}`));
    const err = await catchError(scGet('/v1/x', {}, { fetchImpl }));
    expect(err.code).toBe('upstream');
    expect(err.status).toBe(0);
    expect(calls).toHaveLength(2);
    expectNoLeak(err);
  });

  it('times out via AbortController and does not retry', async () => {
    const { fetchImpl, calls } = hangingFetch();
    const err = await catchError(scGet('/v1/x', {}, { fetchImpl, timeoutMs: 20 }));
    expect(err.code).toBe('timeout');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('does not retry a 5xx once the deadline has passed', async () => {
    const slow500 = () => new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse({}, 500)), 40));
    const { fetchImpl, calls } = mockFetch(slow500);
    const err = await catchError(scGet('/v1/x', {}, { fetchImpl, timeoutMs: 20 }));
    expect(['timeout', 'upstream']).toContain(err.code);
    expect(calls).toHaveLength(1);
  });

  it('treats an invalid JSON body as upstream', async () => {
    const { fetchImpl } = mockFetch(new Response('<html>oops</html>', { status: 200 }));
    const err = await catchError(scGet('/v1/x', {}, { fetchImpl }));
    expect(err.code).toBe('upstream');
    expect(err.message).not.toContain('oops');
  });

  it('keeps the query (user input) out of error messages', async () => {
    const { fetchImpl } = mockFetch(jsonResponse({}, 404));
    const err = await catchError(scGet('/v1/tiktok/search/keyword', { query: 'secret-search-term' }, { fetchImpl }));
    expect(err.message).toContain('/v1/tiktok/search/keyword');
    expect(err.message).not.toContain('secret-search-term');
  });
});
