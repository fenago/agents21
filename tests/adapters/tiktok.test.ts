import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTikTokAdapter,
  extractTikTokCursor,
  normalizeTikTokItem,
  normalizeTikTokList,
  normalizeTikTokResponse,
} from '../../netlify/functions/lib/adapters/tiktok';
import { jsonResponse, loadFixture, mockFetch, paramsOf } from '../helpers';

beforeEach(() => vi.stubEnv('SCRAPECREATORS_API_KEY', 'test-key'));
afterEach(() => vi.unstubAllEnvs());

describe('normalizeTikTokList', () => {
  it('maps the trending feed and skips photo posts', () => {
    const videos = normalizeTikTokList(loadFixture('tiktok', 'trending'));
    expect(videos.map((v) => v.id)).toEqual(['7540968798585670968', '7541111111111111111']);
    expect(videos[0]).toEqual({
      platform: 'tiktok',
      id: '7540968798585670968',
      url: 'https://www.tiktok.com/@moto.games.demo/video/7540968798585670968',
      thumbnail: '',
      title: 'Thrilling 3D motorcycle chases in the city. Evade cops at top speed!',
      author: {
        handle: 'moto.games.demo',
        name: 'Moto Games',
        avatar: 'https://p16-sign.tiktokcdn-us.com/example-avatar.jpeg',
        url: 'https://www.tiktok.com/@moto.games.demo',
      },
      stats: { views: 589406, likes: 6035, comments: 27, shares: 192 },
      postedAt: '2025-08-21T09:31:54.000Z',
      durationSec: 15,
    });
  });

  it('falls back to share_url without its query string, and to avatar_medium', () => {
    const [, second] = normalizeTikTokList(loadFixture('tiktok', 'trending'));
    expect(second?.url).toBe('https://www.tiktok.com/@routinelab/video/7541111111111111111');
    expect(second?.thumbnail).toBe('https://p16-sign.tiktokcdn-us.com/example-cover-3.jpeg');
    expect(second?.author.avatar).toBe('https://p16-sign.tiktokcdn-us.com/example-avatar-3.jpeg');
    expect(second?.durationSec).toBe(31);
  });

  it('unwraps keyword results from search_item_list[].aweme_info and de-dupes by id', () => {
    const videos = normalizeTikTokList(loadFixture('tiktok', 'keyword'));
    expect(videos.map((v) => v.id)).toEqual(['7545933721589910798', '7546000000000000001']);
    // The first occurrence wins.
    expect(videos[0]?.stats).toEqual({ views: 402311, likes: 15800, comments: 431, shares: 512 });
    expect(videos[0]?.durationSec).toBe(84);
  });

  it('builds a canonical URL from the handle and uses origin_cover when cover is missing', () => {
    const [, second] = normalizeTikTokList(loadFixture('tiktok', 'keyword'));
    expect(second?.url).toBe('https://www.tiktok.com/@tailgate.tours/video/7546000000000000001');
    expect(second?.thumbnail).toBe('https://p16-sign-va.tiktokcdn.com/example-origin-2.jpeg');
    expect(second?.postedAt).toBe(new Date(1757000000 * 1000).toISOString());
  });

  it('survives missing and renamed fields', () => {
    const videos = normalizeTikTokList(loadFixture('tiktok', 'keyword-missing-fields'));
    expect(videos.map((v) => v.id)).toEqual(['7547000000000000001', '754700003']);
    expect(videos[0]).toEqual({
      platform: 'tiktok',
      id: '7547000000000000001',
      url: 'https://www.tiktok.com/@bare.minimum/video/7547000000000000001',
      thumbnail: '',
      title: '',
      author: { handle: 'bare.minimum', url: 'https://www.tiktok.com/@bare.minimum' },
      stats: {},
    });
    expect(videos[1]?.author.handle).toBe('camel.case');
    expect(videos[1]?.author.name).toBeUndefined();
    expect(videos[1]?.stats).toEqual({ views: 12345, likes: 678 });
    expect(videos[1]?.postedAt).toBe(new Date(1757100000 * 1000).toISOString());
  });

  it('dedupes hashtag results', () => {
    const videos = normalizeTikTokList(loadFixture('tiktok', 'hashtag'));
    expect(videos.map((v) => v.id)).toEqual(['6862153058223197445', '7012345678901234567']);
    expect(videos[1]?.thumbnail).toBe('https://p16-sign-va.tiktokcdn.com/example-dynamic.webp');
  });

  it.each([{}, { aweme_list: [] }, { search_item_list: null }, null, 'garbage', 42])(
    'returns [] for empty or malformed input %#',
    (input) => {
      expect(normalizeTikTokList(input)).toEqual([]);
    },
  );

  it('never throws on junk items', () => {
    expect(normalizeTikTokItem(null)).toBeUndefined();
    expect(normalizeTikTokItem({ aweme_id: {} })).toBeUndefined();
    expect(normalizeTikTokList({ aweme_list: [null, 1, 'x', [], { aweme_id: '1', author: 5 }] })).toEqual([]);
  });
});

describe('extractTikTokCursor', () => {
  it('returns the numeric cursor when more pages exist', () => {
    expect(extractTikTokCursor(loadFixture('tiktok', 'keyword'))).toBe(12);
    expect(extractTikTokCursor(loadFixture('tiktok', 'hashtag'))).toBe(12);
  });

  it('returns undefined when has_more is 0/false or the page is empty', () => {
    expect(extractTikTokCursor(loadFixture('tiktok', 'keyword-missing-fields'))).toBeUndefined();
    expect(extractTikTokCursor({ cursor: 10, has_more: false, aweme_list: [{}] })).toBeUndefined();
    expect(extractTikTokCursor({ cursor: 10, aweme_list: [] })).toBeUndefined();
    expect(extractTikTokCursor({ aweme_list: [{}] })).toBeUndefined();
  });

  it('coerces a string cursor', () => {
    expect(extractTikTokCursor({ cursor: '20', has_more: 1, aweme_list: [{}] })).toBe(20);
  });

  it('normalizeTikTokResponse omits cursor on the last page', () => {
    expect(normalizeTikTokResponse(loadFixture('tiktok', 'keyword-missing-fields'))).not.toHaveProperty('cursor');
  });
});

describe('tiktok adapter requests', () => {
  it('trending calls get-trending-feed with region (default US) and no cursor', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('tiktok', 'trending')));
    const adapter = createTikTokAdapter({ fetchImpl });
    const res = await adapter.trending();
    expect(calls[0]?.url.pathname).toBe('/v1/tiktok/get-trending-feed');
    expect(paramsOf(calls[0])).toEqual({ region: 'US' });
    expect(res.videos).toHaveLength(2);
    expect(res.cursor).toBeUndefined();

    await adapter.trending({ region: 'GB' });
    expect(paramsOf(calls[1])).toEqual({ region: 'GB' });
  });

  it.each([
    ['today', 'yesterday'],
    ['week', 'this-week'],
    ['month', 'this-month'],
    ['all', 'all-time'],
  ] as const)('keyword search maps window %s -> date_posted=%s', async (window, datePosted) => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('tiktok', 'keyword')));
    await createTikTokAdapter({ fetchImpl }).search({ query: ' chiefs ', window });
    expect(calls[0]?.url.pathname).toBe('/v1/tiktok/search/keyword');
    expect(paramsOf(calls[0])).toEqual({ query: 'chiefs', date_posted: datePosted });
  });

  it('keyword search passes region and cursor, omits date_posted without a window, returns the next cursor', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('tiktok', 'keyword')));
    const res = await createTikTokAdapter({ fetchImpl }).search({ query: 'chiefs', region: 'US', cursor: 12 });
    expect(paramsOf(calls[0])).toEqual({ query: 'chiefs', region: 'US', cursor: '12' });
    expect(res.cursor).toBe(12);
    expect(res.videos).toHaveLength(2);
  });

  it('routes #queries to the hashtag endpoint without the # and ignores the window', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('tiktok', 'hashtag')));
    const res = await createTikTokAdapter({ fetchImpl }).search({ query: '#fyp', window: 'week', cursor: 12 });
    expect(calls[0]?.url.pathname).toBe('/v1/tiktok/search/hashtag');
    expect(paramsOf(calls[0])).toEqual({ hashtag: 'fyp', cursor: '12' });
    expect(res.videos.map((v) => v.id)).toEqual(['6862153058223197445', '7012345678901234567']);
    expect(res.cursor).toBe(12);
  });

  it('does not spend a credit on a bare "#"', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({}));
    await expect(createTikTokAdapter({ fetchImpl }).search({ query: ' # ' })).resolves.toEqual({ videos: [] });
    expect(calls).toHaveLength(0);
  });

  it('propagates client errors (e.g. out of credits)', async () => {
    const { fetchImpl } = mockFetch(jsonResponse({}, 402));
    await expect(createTikTokAdapter({ fetchImpl }).search({ query: 'x' })).rejects.toMatchObject({
      code: 'out_of_credits',
    });
  });
});
