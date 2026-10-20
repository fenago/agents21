// Cache behaviour of the list functions: keys hold only params the upstream uses, soft
// failures are not cached, and cache writes stay off the request path.
import { describe, expect, it } from 'vitest';
import type { VideoListResponse } from '../../shared/video';
import { createCreditsHandler } from '../../netlify/functions/credits';
import { fanOut } from '../../netlify/functions/lib/fanout';
import { createCache, type CacheStore } from '../../netlify/functions/lib/cache';
import { createSearchHandler } from '../../netlify/functions/search';
import { createTrendingHandler } from '../../netlify/functions/trending';
import { body, brokenStore, fakeAdapters, fakeContext, get, memoryStore, settled, video } from './helpers';

const quiet = () => {};

function search(replies: Parameters<typeof fakeAdapters>[0] = {}) {
  const fakes = fakeAdapters(replies);
  const store = memoryStore();
  return { ...fakes, store, handler: settled(createSearchHandler({ adapters: fakes.adapters, store, log: quiet })) };
}

describe('trending cache keys', () => {
  it('only TikTok is keyed by region; Instagram and YouTube share one entry', async () => {
    const { adapters, calls } = fakeAdapters();
    const handler = settled(createTrendingHandler({ adapters, store: memoryStore(), log: quiet }));
    await handler(get('/api/trending?region=US'));
    await handler(get('/api/trending?region=GB'));
    expect(calls.tiktok.trending).toHaveLength(2);
    expect(calls.instagram.trending).toHaveLength(1);
    expect(calls.youtube.trending).toHaveLength(1);
  });

  it('does not cache an empty feed (soft failure)', async () => {
    const { adapters, calls } = fakeAdapters({ youtube: { trending: { videos: [] } } });
    const store = memoryStore();
    const handler = settled(createTrendingHandler({ adapters, store, log: quiet }));
    await handler(get('/api/trending'));
    await handler(get('/api/trending'));
    expect(calls.youtube.trending).toHaveLength(2);
    expect(calls.tiktok.trending).toHaveLength(1);
    expect(store.data.size).toBe(2);
  });
});

describe('search cache keys', () => {
  it('Instagram ignores region', async () => {
    const { handler, calls } = search();
    await handler(get('/api/search?q=cats&platforms=instagram&region=US'));
    await handler(get('/api/search?q=cats&platforms=instagram&region=DE'));
    expect(calls.instagram.search).toHaveLength(1);
  });

  it('hashtag queries ignore window on TikTok and YouTube (TikTok still keys by region)', async () => {
    const { handler, calls } = search();
    await handler(get('/api/search?q=%23cats&platforms=tiktok,youtube&window=week'));
    await handler(get('/api/search?q=%23cats&platforms=tiktok,youtube&window=today'));
    expect(calls.tiktok.search).toHaveLength(1);
    expect(calls.youtube.search).toHaveLength(1);

    await handler(get('/api/search?q=%23cats&platforms=tiktok,youtube&region=GB'));
    expect(calls.tiktok.search).toHaveLength(2);
    expect(calls.youtube.search).toHaveLength(1);
  });

  it('keyword queries still key by window', async () => {
    const { handler, calls } = search();
    await handler(get('/api/search?q=cats&platforms=youtube&window=week'));
    await handler(get('/api/search?q=cats&platforms=youtube&window=today'));
    expect(calls.youtube.search).toHaveLength(2);
  });

  it('Instagram cursors 02 and 2 share an entry (and reach the adapter as "2")', async () => {
    const { handler, calls } = search({ instagram: { search: { videos: [video('instagram', 'i2')], cursor: 3 } } });
    await handler(get('/api/search?q=cats&cursor_instagram=02'));
    await handler(get('/api/search?q=cats&cursor_instagram=2'));
    expect(calls.instagram.search.map((c) => c.cursor)).toEqual(['2']);
  });

  it('does not cache an empty first page, but does cache an empty later page', async () => {
    const { handler, calls, store } = search({ youtube: { search: { videos: [] } } });
    await handler(get('/api/search?q=cats&platforms=youtube'));
    await handler(get('/api/search?q=cats&platforms=youtube'));
    expect(calls.youtube.search).toHaveLength(2);
    expect(store.data.size).toBe(0);

    await handler(get('/api/search?q=cats&platforms=youtube&cursor_youtube=end'));
    await handler(get('/api/search?q=cats&platforms=youtube&cursor_youtube=end'));
    expect(calls.youtube.search).toHaveLength(3);
    expect(store.data.size).toBe(1);
  });
});

/** A store whose `set` stays pending until `release()` is called. */
function slowStore() {
  const mem = memoryStore();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const store: CacheStore = { get: mem.get, set: async (k, v) => (await gate, mem.set(k, v)) };
  return { store, mem, release };
}

describe('cache writes are off the request path', () => {
  it('trending responds before the write finishes and hands it to context.waitUntil', async () => {
    const { store, mem, release } = slowStore();
    const { adapters } = fakeAdapters();
    const handler = createTrendingHandler({ adapters, store, log: quiet });
    const ctx = fakeContext();

    const res = await handler(get('/api/trending'), ctx.context);
    expect(res.status).toBe(200);
    expect(ctx.pending).toHaveLength(3);
    expect(mem.data.size).toBe(0);

    release();
    await ctx.settle();
    expect(mem.data.size).toBe(3);
  });

  it('search and credits also use waitUntil', async () => {
    const { adapters } = fakeAdapters();
    const ctx = fakeContext();
    await createSearchHandler({ adapters, store: memoryStore(), log: quiet })(get('/api/search?q=cats'), ctx.context);
    expect(ctx.pending).toHaveLength(3);

    const credits = createCreditsHandler({ fetchBalance: async () => ({ creditCount: 5 }), store: memoryStore(), log: quiet });
    const cctx = fakeContext();
    expect(await body(await credits(get('/api/credits'), cctx.context))).toEqual({ credits: 5 });
    expect(cctx.pending).toHaveLength(1);
    await Promise.all([ctx.settle(), cctx.settle()]);
  });

  it('without a context the write is fire-and-forget and never rejects', async () => {
    const { adapters } = fakeAdapters();
    const handler = createTrendingHandler({ adapters, store: brokenStore(), log: quiet });
    const res = await handler(get('/api/trending'));
    expect((await body<VideoListResponse>(res)).videos).toHaveLength(3);
  });

  it('fanOut passes the write to waitUntil even when the store rejects', async () => {
    const ctx = fakeContext();
    const cache = createCache(brokenStore());
    const [outcome] = await fanOut(
      [{ platform: 'tiktok', key: 'k', firstPage: true, run: async () => ({ videos: [video('tiktok', '1')] }) }],
      { cache, ttlMs: 1000, context: ctx.context, log: quiet },
    );
    expect(outcome).toMatchObject({ ok: true, cached: false });
    expect(ctx.pending).toHaveLength(1);
    await expect(ctx.settle()).resolves.toBeUndefined();
  });
});
