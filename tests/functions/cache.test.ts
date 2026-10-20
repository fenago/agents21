import { describe, expect, it } from 'vitest';
import { cacheKey, canonicalParams, createCache, netlifyBlobStore, type CacheStore } from '../../netlify/functions/lib/cache';
import { brokenStore, memoryStore } from './helpers';

describe('cache keys', () => {
  it('are independent of param order and skip undefined values', () => {
    expect(canonicalParams({ b: '2', a: 1, c: undefined })).toBe('a=1&b=2');
    expect(cacheKey('search', { q: 'cats', platform: 'tiktok' })).toBe(cacheKey('search', { platform: 'tiktok', q: 'cats' }));
    expect(cacheKey('search', { q: 'cats', cursor: undefined })).toBe(cacheKey('search', { q: 'cats' }));
  });

  it('differ by endpoint and by any param value', () => {
    const a = cacheKey('search', { platform: 'tiktok', q: 'cats' });
    expect(cacheKey('trending', { platform: 'tiktok', q: 'cats' })).not.toBe(a);
    expect(cacheKey('search', { platform: 'tiktok', q: 'dogs' })).not.toBe(a);
    expect(cacheKey('search', { platform: 'youtube', q: 'cats' })).not.toBe(a);
  });

  it('cannot be confused by delimiter characters in values', () => {
    expect(cacheKey('search', { q: 'a&b=c' })).not.toBe(cacheKey('search', { q: 'a', b: 'c' }));
  });

  it('are short, versioned and path-safe even for 2000-char cursors', () => {
    const key = cacheKey('search', { q: 'x', cursor: 'y'.repeat(2000) });
    expect(key).toMatch(/^v2\/search\/[0-9a-f]{64}$/);
  });
});

describe('createCache', () => {
  it('misses, then hits after a write, then expires at the TTL', async () => {
    let t = 1_000;
    const store = memoryStore();
    const cache = createCache(store, () => t);

    expect(await cache.read('k')).toBeUndefined();
    await cache.write('k', { hello: 'world' }, 60_000);
    expect(JSON.parse(store.data.get('k')!)).toEqual({ expires: 61_000, data: { hello: 'world' } });

    t = 60_999;
    expect(await cache.read('k')).toEqual({ hello: 'world' });
    t = 61_000;
    expect(await cache.read('k')).toBeUndefined();
  });

  it('treats corrupt or foreign entries as misses', async () => {
    const store = memoryStore();
    const cache = createCache(store, () => 0);
    store.data.set('bad-json', '{not json');
    store.data.set('no-expiry', JSON.stringify({ data: 1 }));
    expect(await cache.read('bad-json')).toBeUndefined();
    expect(await cache.read('no-expiry')).toBeUndefined();
  });

  it('swallows store errors on read and write (sync throws and rejections)', async () => {
    const cache = createCache(brokenStore());
    await expect(cache.read('k')).resolves.toBeUndefined();
    await expect(cache.write('k', 1, 1000)).resolves.toBeUndefined();
  });

  it('gives up on a hanging store after the op timeout', async () => {
    const hanging: CacheStore = { get: () => new Promise(() => {}), set: () => new Promise(() => {}) };
    const cache = createCache(hanging, Date.now, 20);
    await expect(cache.read('k')).resolves.toBeUndefined();
    await expect(cache.write('k', 1, 1000)).resolves.toBeUndefined();
  });

  it('the real Netlify Blobs store falls through outside a Netlify context', async () => {
    const cache = createCache(netlifyBlobStore());
    await expect(cache.read('k')).resolves.toBeUndefined();
    await expect(cache.write('k', 1, 1000)).resolves.toBeUndefined();
  });
});
