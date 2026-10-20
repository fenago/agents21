import { describe, expect, it } from 'vitest';
import type { VideoListResponse } from '../../shared/video';
import { ScrapeCreatorsError } from '../../netlify/functions/lib/scrapecreators';
import { createTrendingHandler } from '../../netlify/functions/trending';
import { body, brokenStore, settled, fakeAdapters, get, memoryStore, video } from './helpers';

const quiet = () => {};
const MIN = 60_000;

describe('GET /api/trending', () => {
  it('fans out to all platforms with the region and merges round-robin', async () => {
    const { adapters, calls } = fakeAdapters({
      tiktok: { trending: { videos: [video('tiktok', 't1'), video('tiktok', 't2')] } },
      instagram: { trending: { videos: [video('instagram', 'i1')] } },
      youtube: { trending: { videos: [video('youtube', 'y1'), video('youtube', 'y2')] } },
    });
    const handler = settled(createTrendingHandler({ adapters, store: memoryStore(), log: quiet }));
    const res = await handler(get('/api/trending?region=gb'));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    const json = await body<VideoListResponse>(res);
    expect(json.videos.map((v) => v.id)).toEqual(['t1', 'i1', 'y1', 't2', 'y2']);
    expect(json.cursors).toEqual({});
    expect(json.errors).toEqual([]);
    expect(calls.tiktok.trending).toEqual([{ region: 'GB' }]);
  });

  it('only calls the selected platforms', async () => {
    const { adapters, calls } = fakeAdapters();
    const handler = settled(createTrendingHandler({ adapters, store: memoryStore(), log: quiet }));
    const json = await body<VideoListResponse>(await handler(get('/api/trending?platforms=youtube')));
    expect(json.videos.every((v) => v.platform === 'youtube')).toBe(true);
    expect(calls.tiktok.trending).toHaveLength(0);
    expect(calls.instagram.trending).toHaveLength(0);
    expect(calls.youtube.trending).toHaveLength(1);
  });

  it('returns the other platforms when one fails (partial failure), with no-store', async () => {
    const { adapters } = fakeAdapters({
      instagram: { trending: new ScrapeCreatorsError('out_of_credits', 402, 'Scrape Creators /v1/instagram/reels/trending failed') },
      youtube: { trending: new TypeError('adapter bug: cannot read x of undefined') },
    });
    const handler = settled(createTrendingHandler({ adapters, store: memoryStore(), log: quiet }));
    const res = await handler(get('/api/trending'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    const json = JSON.parse(text) as VideoListResponse;
    expect(json.videos.map((v) => v.platform)).toEqual(['tiktok']);
    expect(json.errors).toEqual([
      { platform: 'instagram', code: 'out_of_credits', message: 'Out of Scrape Creators credits' },
      { platform: 'youtube', code: 'internal', message: 'YouTube failed unexpectedly' },
    ]);
    expect(text).not.toContain('/v1/');
    expect(text).not.toContain('adapter bug');
  });

  it('returns 500 server_not_configured when every platform fails with missing_key', async () => {
    const missing = new ScrapeCreatorsError('missing_key', 0, 'SCRAPECREATORS_API_KEY is not configured');
    const { adapters } = fakeAdapters({
      tiktok: { trending: missing },
      instagram: { trending: missing },
      youtube: { trending: missing },
    });
    const handler = settled(createTrendingHandler({ adapters, store: memoryStore(), log: quiet }));
    const res = await handler(get('/api/trending'));
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await body(res)).toEqual({ error: 'server_not_configured' });
  });

  it('serves from cache within 15 minutes and refetches after expiry', async () => {
    let t = 0;
    const store = memoryStore();
    const { adapters, calls } = fakeAdapters();
    const handler = settled(createTrendingHandler({ adapters, store, now: () => t, log: quiet }));

    await handler(get('/api/trending'));
    t = 15 * MIN - 1;
    const cached = await body<VideoListResponse>(await handler(get('/api/trending')));
    expect(cached.videos).toHaveLength(3);
    expect(calls.tiktok.trending).toHaveLength(1);

    t = 15 * MIN;
    await handler(get('/api/trending'));
    expect(calls.tiktok.trending).toHaveLength(2);
  });

  it('keys the cache by region', async () => {
    const { adapters, calls } = fakeAdapters();
    const handler = settled(createTrendingHandler({ adapters, store: memoryStore(), log: quiet }));
    await handler(get('/api/trending?platforms=tiktok&region=US'));
    await handler(get('/api/trending?platforms=tiktok&region=GB'));
    await handler(get('/api/trending?platforms=tiktok&region=us'));
    expect(calls.tiktok.trending).toEqual([{ region: 'US' }, { region: 'GB' }]);
  });

  it('does not cache a failed platform', async () => {
    let fail = true;
    const store = memoryStore();
    const { adapters, calls } = fakeAdapters({
      youtube: {
        trending: async () => {
          if (fail) throw new ScrapeCreatorsError('upstream', 503, 'x');
          return { videos: [video('youtube', 'y1')] };
        },
      },
    });
    const handler = settled(createTrendingHandler({ adapters, store, log: quiet }));
    await handler(get('/api/trending'));
    expect(store.data.size).toBe(2);

    fail = false;
    const json = await body<VideoListResponse>(await handler(get('/api/trending')));
    expect(json.errors).toEqual([]);
    expect(calls.youtube.trending).toHaveLength(2);
    expect(calls.tiktok.trending).toHaveLength(1); // still cached
  });

  it('falls through to live calls when the blob store errors', async () => {
    const { adapters, calls } = fakeAdapters();
    const handler = settled(createTrendingHandler({ adapters, store: brokenStore(), log: quiet }));
    const res = await handler(get('/api/trending'));
    expect(res.status).toBe(200);
    expect((await body<VideoListResponse>(res)).videos).toHaveLength(3);
    expect(calls.tiktok.trending).toHaveLength(1);
  });

  it('rejects invalid input with 400 { error, field } and calls nothing', async () => {
    const { adapters, calls } = fakeAdapters();
    const handler = settled(createTrendingHandler({ adapters, store: memoryStore(), log: quiet }));
    const res = await handler(get('/api/trending?platforms=tiktok,myspace'));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await body(res)).toMatchObject({ error: 'invalid_parameter', field: 'platforms' });
    expect(calls.tiktok.trending).toHaveLength(0);
  });

  it('answers 405 to POST', async () => {
    const handler = settled(createTrendingHandler({ ...fakeAdapters(), store: memoryStore() }));
    const res = await handler(new Request('https://t.test/api/trending', { method: 'POST' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });
});
