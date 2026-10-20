import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  PASSWORD_HEADER,
  buildSearchUrl,
  buildTrendingUrl,
  clearPassword,
  fetchCredits,
  fetchSearch,
  fetchTrending,
  getPassword,
  parseVideoList,
  setPassword,
} from './api';

const all = ['tiktok', 'instagram', 'youtube'] as const;
const search = { q: '#cats & dogs', platforms: [...all], window: 'week' as const, region: 'US' };

function params(url: string) {
  expect(url.startsWith('/api/')).toBe(true);
  return Object.fromEntries(new URL(url, 'http://x').searchParams);
}

describe('URL building', () => {
  it('builds trending URLs in canonical platform order', () => {
    expect(buildTrendingUrl({ platforms: ['youtube', 'tiktok'], region: 'GB' })).toBe(
      '/api/trending?platforms=tiktok%2Cyoutube&region=GB',
    );
  });

  it('builds a first-page search URL without cursors', () => {
    const url = buildSearchUrl(search);
    expect(url.startsWith('/api/search?')).toBe(true);
    expect(params(url)).toEqual({ q: '#cats & dogs', platforms: 'tiktok,instagram,youtube', window: 'week', region: 'US' });
  });

  it('adds one cursor_<platform> per non-empty cursor', () => {
    const url = buildSearchUrl(search, { tiktok: 20, instagram: '', youtube: 'Ep+/=' });
    expect(params(url)).toMatchObject({ cursor_tiktok: '20', cursor_youtube: 'Ep+/=' });
    expect(params(url)).not.toHaveProperty('cursor_instagram');
  });

  it('drops cursors for platforms that are not selected', () => {
    const url = buildSearchUrl({ ...search, platforms: ['youtube'] }, { tiktok: 20, youtube: 'x' });
    expect(params(url)).toEqual({ q: '#cats & dogs', platforms: 'youtube', window: 'week', region: 'US', cursor_youtube: 'x' });
  });
});

function jsonFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

const okBody = {
  videos: [
    { platform: 'tiktok', id: '1', url: 'https://t/1', thumbnail: 'https://i/1', title: 'a', author: { handle: 'h' }, stats: { views: 1 } },
    { platform: 'tiktok', id: '2', url: 'javascript:alert(1)', thumbnail: '', title: 'bad', author: { handle: 'h' }, stats: {} },
    { platform: 'myspace', id: '3', url: 'https://m/3', author: { handle: 'h' }, stats: {} },
  ],
  cursors: { tiktok: 20, youtube: '', bogus: 'x' },
  errors: [{ platform: 'instagram', code: 'timeout', message: 'Instagram took too long to respond' }, { nope: true }],
};

describe('fetching', () => {
  afterEach(() => clearPassword());

  it('parses and sanitises a list response', async () => {
    const f = jsonFetch(200, okBody);
    const res = await fetchTrending({ platforms: [...all], region: 'US' }, { fetchImpl: f });
    expect(res.videos.map((v) => v.id)).toEqual(['1']);
    expect(res.cursors).toEqual({ tiktok: 20 });
    expect(res.errors).toEqual([okBody.errors[0]]);
  });

  it('sends the password header only when one is stored', async () => {
    const f = jsonFetch(200, okBody);
    await fetchSearch(search, {}, { fetchImpl: f });
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)[PASSWORD_HEADER]).toBeUndefined();

    setPassword('s3cret');
    expect(getPassword()).toBe('s3cret');
    await fetchSearch(search, { tiktok: 20 }, { fetchImpl: f });
    const [url, init] = f.mock.calls[1]!;
    expect((init!.headers as Record<string, string>)[PASSWORD_HEADER]).toBe('s3cret');
    expect(params(String(url)).cursor_tiktok).toBe('20');
  });

  it('keeps the password in memory when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    setPassword('pw');
    expect(getPassword()).toBe('pw');
    clearPassword();
    expect(getPassword()).toBeNull();
    vi.unstubAllGlobals();
  });

  it.each([
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [500, { error: 'server_not_configured' }, 'server_not_configured'],
    [400, { error: 'invalid_parameter', field: 'q', message: 'q must be 1–100 characters' }, 'invalid_parameter'],
    [502, { error: 'credits_unavailable' }, 'http'],
  ])('maps HTTP %d to %s', async (status, body, kind) => {
    const err = await fetchTrending({ platforms: [...all], region: 'US' }, { fetchImpl: jsonFetch(status, body) }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
  });

  it('maps fetch failures to network and aborts to aborted', async () => {
    const boom = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchCredits({ fetchImpl: boom })).rejects.toMatchObject({ kind: 'network' });

    const ctrl = new AbortController();
    ctrl.abort();
    const aborting = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(fetchCredits({ fetchImpl: aborting, signal: ctrl.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('reads credits, null when not a number', async () => {
    expect(await fetchCredits({ fetchImpl: jsonFetch(200, { credits: 1234 }) })).toBe(1234);
    expect(await fetchCredits({ fetchImpl: jsonFetch(200, { credits: null }) })).toBeNull();
  });

  it('rejects a body without a videos array', () => {
    expect(() => parseVideoList({})).toThrow(ApiError);
  });
});
