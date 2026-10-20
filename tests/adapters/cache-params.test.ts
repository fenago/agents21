// cacheParams(): the cache-key params each adapter derives from the request it would send.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapters, type SearchOptions } from '../../netlify/functions/lib/adapters';
import { createInstagramAdapter } from '../../netlify/functions/lib/adapters/instagram';
import { createTikTokAdapter } from '../../netlify/functions/lib/adapters/tiktok';
import { createYouTubeAdapter } from '../../netlify/functions/lib/adapters/youtube';
import { jsonResponse, mockFetch, paramsOf } from '../helpers';

const { tiktok, instagram, youtube } = adapters;
const base: SearchOptions = { query: 'cats', window: 'week', region: 'US' };

describe('adapter cacheParams', () => {
  it('trending: only TikTok depends on region', () => {
    expect(tiktok.cacheParams('trending', { region: 'US' })).not.toEqual(tiktok.cacheParams('trending', { region: 'GB' }));
    expect(tiktok.cacheParams('trending', {})).toEqual(tiktok.cacheParams('trending', { region: 'US' }));
    expect(instagram.cacheParams('trending', { region: 'US' })).toEqual(instagram.cacheParams('trending', { region: 'GB' }));
    expect(youtube.cacheParams('trending', { region: 'US' })).toEqual(youtube.cacheParams('trending', { region: 'GB' }));
  });

  it('search: Instagram ignores region and normalizes the cursor to a page number', () => {
    expect(instagram.cacheParams('search', base)).toEqual(instagram.cacheParams('search', { ...base, region: 'DE' }));
    expect(instagram.cacheParams('search', { ...base, cursor: '02' })).toEqual(
      instagram.cacheParams('search', { ...base, cursor: 2 }),
    );
    expect(instagram.cacheParams('search', { ...base, cursor: '2' })).not.toEqual(
      instagram.cacheParams('search', { ...base, cursor: '3' }),
    );
    expect(instagram.cacheParams('search', base)).not.toEqual(instagram.cacheParams('search', { ...base, window: 'month' }));
  });

  it('search: keyword mode depends on window and region on TikTok and YouTube', () => {
    for (const a of [tiktok, youtube]) {
      expect(a.cacheParams('search', base)).not.toEqual(a.cacheParams('search', { ...base, window: 'month' }));
      expect(a.cacheParams('search', base)).not.toEqual(a.cacheParams('search', { ...base, region: 'GB' }));
    }
  });

  it('search: hashtag mode ignores window (TikTok keeps region, YouTube hashtag sends none)', () => {
    const tag: SearchOptions = { ...base, query: '#cats' };
    expect(tiktok.cacheParams('search', tag)).toEqual(tiktok.cacheParams('search', { ...tag, window: 'today' }));
    expect(tiktok.cacheParams('search', tag)).not.toEqual(tiktok.cacheParams('search', { ...tag, region: 'GB' }));
    expect(youtube.cacheParams('search', tag)).toEqual(youtube.cacheParams('search', { ...tag, window: 'today', region: 'GB' }));
    // Hashtag and keyword searches for the same text never share an entry.
    expect(tiktok.cacheParams('search', tag)).not.toEqual(tiktok.cacheParams('search', { ...base, query: 'cats' }));
  });

  it('search: the cursor is part of the key on every platform', () => {
    expect(tiktok.cacheParams('search', base)).not.toEqual(tiktok.cacheParams('search', { ...base, cursor: 10 }));
    expect(youtube.cacheParams('search', base)).not.toEqual(youtube.cacheParams('search', { ...base, cursor: 'tok' }));
    expect(instagram.cacheParams('search', base)).not.toEqual(instagram.cacheParams('search', { ...base, cursor: 2 }));
  });

  describe('matches the path and params actually sent upstream', () => {
    beforeEach(() => vi.stubEnv('SCRAPECREATORS_API_KEY', 'test-key'));
    afterEach(() => vi.unstubAllEnvs());

    const factories = {
      tiktok: createTikTokAdapter,
      instagram: createInstagramAdapter,
      youtube: createYouTubeAdapter,
    } as const;
    const searches: SearchOptions[] = [
      base,
      { ...base, window: 'all', cursor: '3' },
      { query: '#Cat Videos', window: 'month', region: 'GB', cursor: 'next' },
    ];

    it.each(Object.keys(factories) as (keyof typeof factories)[])('%s', async (platform) => {
      const { fetchImpl, calls } = mockFetch(jsonResponse({}));
      const adapter = factories[platform]({ fetchImpl });

      await adapter.trending({ region: 'GB' });
      for (const o of searches) await adapter.search(o);

      const expected = [adapter.cacheParams('trending', { region: 'GB' }), ...searches.map((o) => adapter.cacheParams('search', o))];
      expect(calls.map((c) => ({ ...paramsOf(c), path: c.url.pathname }))).toEqual(
        expected.map((p) =>
          Object.fromEntries(
            Object.entries(p)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, String(v)]),
          ),
        ),
      );
    });
  });

  it('an empty hashtag makes no call and has an empty path', () => {
    expect(tiktok.cacheParams('search', { query: '#' })).toEqual({ path: '' });
    expect(youtube.cacheParams('search', { query: '#' })).toEqual({ path: '' });
  });
});
