import { describe, expect, it } from 'vitest';
import type { VideoListResponse } from '../../shared/video';
import { ScrapeCreatorsError } from '../../netlify/functions/lib/scrapecreators';
import { createSearchHandler } from '../../netlify/functions/search';
import { body, brokenStore, settled, fakeAdapters, get, memoryStore, video } from './helpers';

const quiet = () => {};
const MIN = 60_000;

function setup(replies: Parameters<typeof fakeAdapters>[0] = {}, now?: () => number) {
  const fakes = fakeAdapters(replies);
  const store = memoryStore();
  const handler = settled(createSearchHandler({ adapters: fakes.adapters, store, now, log: quiet }));
  return { ...fakes, store, handler };
}

describe('GET /api/search', () => {
  it('searches every platform with validated params and returns per-platform cursors', async () => {
    const { handler, calls } = setup({
      tiktok: { search: { videos: [video('tiktok', 't1'), video('tiktok', 't2')], cursor: 20 } },
      instagram: { search: { videos: [video('instagram', 'i1')], cursor: 2 } },
      youtube: { search: { videos: [video('youtube', 'y1')] } },
    });
    const res = await handler(get('/api/search?q=%20cats%20&window=week&region=de'));
    expect(res.status).toBe(200);
    const json = await body<VideoListResponse>(res);
    expect(json.videos.map((v) => v.id)).toEqual(['t1', 'i1', 'y1', 't2']);
    expect(json.cursors).toEqual({ tiktok: 20, instagram: 2 });
    expect(json.errors).toEqual([]);
    expect(calls.tiktok.search).toEqual([{ query: 'cats', window: 'week', region: 'DE', cursor: undefined }]);
  });

  it('load-more queries only the platforms that have a cursor', async () => {
    const { handler, calls } = setup({
      youtube: { search: { videos: [video('youtube', 'y9')], cursor: 'tok-2' } },
      instagram: { search: { videos: [video('instagram', 'i9')], cursor: 4 } },
    });
    const res = await handler(get('/api/search?q=cats&cursor_youtube=tok-1&cursor_instagram=3'));
    const json = await body<VideoListResponse>(res);
    expect(calls.tiktok.search).toHaveLength(0);
    expect(calls.youtube.search).toEqual([{ query: 'cats', window: 'all', region: 'US', cursor: 'tok-1' }]);
    expect(calls.instagram.search).toEqual([{ query: 'cats', window: 'all', region: 'US', cursor: '3' }]);
    expect(json.cursors).toEqual({ instagram: 4, youtube: 'tok-2' });
  });

  it('caches each page separately (cursor is part of the key) for 30 minutes', async () => {
    let t = 0;
    const { handler, calls } = setup({}, () => t);
    await handler(get('/api/search?q=cats&platforms=youtube'));
    await handler(get('/api/search?q=cats&platforms=youtube&cursor_youtube=abc'));
    t = 30 * MIN - 1;
    await handler(get('/api/search?platforms=youtube&q=cats'));
    await handler(get('/api/search?q=cats&platforms=youtube&cursor_youtube=abc'));
    expect(calls.youtube.search.map((c) => c.cursor)).toEqual([undefined, 'abc']);

    t = 30 * MIN;
    await handler(get('/api/search?q=cats&platforms=youtube'));
    expect(calls.youtube.search).toHaveLength(3);
  });

  it('different window/region/query are different cache entries', async () => {
    const { handler, calls } = setup();
    await handler(get('/api/search?q=cats&platforms=tiktok'));
    await handler(get('/api/search?q=cats&platforms=tiktok&window=week'));
    await handler(get('/api/search?q=cats&platforms=tiktok&region=GB'));
    await handler(get('/api/search?q=dogs&platforms=tiktok'));
    expect(calls.tiktok.search).toHaveLength(4);
  });

  it('partial failure: one platform timing out does not fail the request', async () => {
    const { handler, store } = setup({
      tiktok: { search: new ScrapeCreatorsError('timeout', 0, 'Scrape Creators /v1/tiktok/search/keyword failed (timeout)') },
    });
    const res = await handler(get('/api/search?q=cats'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await body<VideoListResponse>(res);
    expect(json.videos.map((v) => v.platform)).toEqual(['instagram', 'youtube']);
    expect(json.errors).toEqual([{ platform: 'tiktok', code: 'timeout', message: 'TikTok took too long to respond' }]);
    expect(store.data.size).toBe(2);
  });

  it('returns 500 server_not_configured when all queried platforms lack the key', async () => {
    const missing = new ScrapeCreatorsError('missing_key', 0, 'SCRAPECREATORS_API_KEY is not configured');
    const { handler } = setup({ tiktok: { search: missing }, youtube: { search: missing } });
    const res = await handler(get('/api/search?q=cats&platforms=tiktok,youtube'));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'server_not_configured' });
  });

  it('sanitizes videos before returning them', async () => {
    const { handler } = setup({
      youtube: {
        search: {
          videos: [
            video('youtube', 'safe', { thumbnail: 'http://insecure.jpg' }),
            video('youtube', 'evil', { url: 'javascript:alert(1)' }),
          ],
        },
      },
    });
    const json = await body<VideoListResponse>(await handler(get('/api/search?q=cats&platforms=youtube')));
    expect(json.videos).toHaveLength(1);
    expect(json.videos[0]).toMatchObject({ id: 'safe', thumbnail: '' });
  });

  it('works with a broken blob store', async () => {
    const fakes = fakeAdapters();
    const handler = settled(createSearchHandler({ adapters: fakes.adapters, store: brokenStore(), log: quiet }));
    const res = await handler(get('/api/search?q=cats'));
    expect(res.status).toBe(200);
    expect((await body<VideoListResponse>(res)).videos).toHaveLength(3);
  });

  it.each([
    ['', 'q'],
    ['?q=', 'q'],
    [`?q=${'a'.repeat(101)}`, 'q'],
    ['?q=cats&platforms=vine', 'platforms'],
    ['?q=cats&window=decade', 'window'],
    ['?q=cats&region=usa', 'region'],
    ['?q=cats&cursor_instagram=12', 'cursor_instagram'],
    [`?q=cats&cursor_youtube=${'x'.repeat(2001)}`, 'cursor_youtube'],
    ['?q=cats&platforms=youtube&cursor_tiktok=5', 'cursor_tiktok'],
    ['?q=ca%00ts', 'q'],
    ['?q=cats%0Adogs', 'q'],
    ['?q=cats%09dogs', 'q'],
    ['?q=cats%7F', 'q'],
  ])('400 for %s (field %s) without calling adapters', async (qs, field) => {
    const { handler, calls } = setup();
    const res = await handler(get(`/api/search${qs}`));
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ error: 'invalid_parameter', field });
    expect(calls.tiktok.search.length + calls.instagram.search.length + calls.youtube.search.length).toBe(0);
  });

  it('answers 405 to POST', async () => {
    const { handler } = setup();
    const res = await handler(new Request('https://t.test/api/search?q=cats', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(405);
  });
});
