import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInstagramAdapter,
  instagramPage,
  nextInstagramPage,
  normalizeInstagramItem,
  normalizeInstagramList,
} from '../../netlify/functions/lib/adapters/instagram';
import { jsonResponse, loadFixture, mockFetch, paramsOf } from '../helpers';

beforeEach(() => vi.stubEnv('SCRAPECREATORS_API_KEY', 'test-key'));
afterEach(() => vi.unstubAllEnvs());

describe('normalizeInstagramList', () => {
  it('maps trending reels', () => {
    const videos = normalizeInstagramList(loadFixture('instagram', 'trending'));
    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      platform: 'instagram',
      id: '4000819054877393649',
      url: 'https://www.instagram.com/reel/DeFw7uwlMLx/',
      thumbnail: 'https://scontent.cdninstagram.com/example.jpg',
      title: 'Impatiently waiting for #UFC335...\n\nThe countdown is on',
      author: {
        handle: 'ufc',
        name: 'UFC',
        avatar: 'https://scontent.cdninstagram.com/example-avatar.jpg',
        url: 'https://www.instagram.com/ufc/',
      },
      stats: { views: 5112349, likes: 423127, comments: 1623 },
      postedAt: '2026-10-04T23:00:03.000Z',
    });
  });

  it('falls back to ig_play_count when play_count is null, and to image_versions2 for the thumbnail', () => {
    const [, second] = normalizeInstagramList(loadFixture('instagram', 'trending'));
    expect(second?.stats.views).toBe(2100000);
    expect(second?.thumbnail).toBe('https://scontent.cdninstagram.com/example-pasta.jpg');
  });

  it('maps search reels (owner, thumbnail_src, video_duration) and de-dupes by id', () => {
    const videos = normalizeInstagramList(loadFixture('instagram', 'search'));
    expect(videos.map((v) => v.id)).toEqual(['3723045213787686915', '3799150343414200124']);
    expect(videos[0]).toMatchObject({
      thumbnail: 'https://scontent-sjc3-1.cdninstagram.com/example-thumb-1.jpg',
      title: 'Dogs are family',
      author: { handle: 'dog.photo.demo', name: 'Dog Photographer' },
      stats: { likes: 3487, comments: 90 },
      durationSec: 75.7,
    });
    // The search endpoint does not document a view count; it stays undefined rather than 0.
    expect(videos[0]?.stats.views).toBeUndefined();
    expect(videos[1]?.stats.views).toBe(15300);
  });

  it('survives missing and renamed fields', () => {
    const videos = normalizeInstagramList(loadFixture('instagram', 'search-missing-fields'));
    expect(videos.map((v) => v.id)).toEqual(['DAbCdEfGhIj', '3800000000000000001']);
    expect(videos[0]).toEqual({
      platform: 'instagram',
      id: 'DAbCdEfGhIj',
      url: 'https://www.instagram.com/reel/DAbCdEfGhIj/',
      thumbnail: 'https://scontent.cdninstagram.com/example-candidate.jpg',
      title: 'caption as object, url built from code',
      author: { handle: '' },
      stats: { views: 45000, likes: 1024 },
      postedAt: new Date(1757100000 * 1000).toISOString(),
    });
    expect(videos[1]).toEqual({
      platform: 'instagram',
      id: '3800000000000000001',
      url: 'https://www.instagram.com/reel/DXyZ0000001/',
      thumbnail: '',
      title: '',
      author: { handle: '' },
      stats: {},
    });
  });

  it.each([{}, { reels: [] }, { reels: 'nope' }, null, undefined, []])('returns [] for empty input %#', (input) => {
    expect(normalizeInstagramList(input)).toEqual([]);
  });

  it('unwraps { media } items and never throws on junk', () => {
    expect(normalizeInstagramItem(7)).toBeUndefined();
    const videos = normalizeInstagramList({ items: [{ media: { pk: 99, code: 'ABC' } }, null] });
    expect(videos.map((v) => [v.id, v.url])).toEqual([['99', 'https://www.instagram.com/reel/ABC/']]);
  });
});

describe('instagram pagination', () => {
  it('parses the cursor as a page number in 1..11', () => {
    expect(instagramPage(undefined)).toBe(1);
    expect(instagramPage(3)).toBe(3);
    expect(instagramPage('4')).toBe(4);
    expect(instagramPage(12)).toBe(1);
    expect(instagramPage('abc')).toBe(1);
  });

  it('stops after page 11 or on an empty page', () => {
    expect(nextInstagramPage(1, 10)).toBe(2);
    expect(nextInstagramPage(10, 10)).toBe(11);
    expect(nextInstagramPage(11, 10)).toBeUndefined();
    expect(nextInstagramPage(2, 0)).toBeUndefined();
  });
});

describe('instagram adapter requests', () => {
  it('trending calls reels/trending with no params', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('instagram', 'trending')));
    const res = await createInstagramAdapter({ fetchImpl }).trending();
    expect(calls[0]?.url.pathname).toBe('/v1/instagram/reels/trending');
    expect(paramsOf(calls[0])).toEqual({});
    expect(res.videos).toHaveLength(2);
    expect(res.cursor).toBeUndefined();
  });

  it.each([
    ['today', 'last-week'],
    ['week', 'last-week'],
    ['month', 'last-month'],
  ] as const)('search maps window %s -> date_posted=%s', async (window, datePosted) => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('instagram', 'search')));
    await createInstagramAdapter({ fetchImpl }).search({ query: 'dogs', window });
    expect(calls[0]?.url.pathname).toBe('/v2/instagram/reels/search');
    expect(paramsOf(calls[0])).toEqual({ query: 'dogs', date_posted: datePosted });
  });

  it('omits date_posted for "all" and returns page 2 as the next cursor', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('instagram', 'search')));
    const res = await createInstagramAdapter({ fetchImpl }).search({ query: 'dogs', window: 'all', region: 'US' });
    expect(paramsOf(calls[0])).toEqual({ query: 'dogs' });
    expect(res.cursor).toBe(2);
  });

  it('sends page from the cursor and stops at 11', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('instagram', 'search')));
    const adapter = createInstagramAdapter({ fetchImpl });
    expect((await adapter.search({ query: 'dogs', cursor: 3 })).cursor).toBe(4);
    expect(paramsOf(calls[0])).toEqual({ query: 'dogs', page: '3' });
    expect((await adapter.search({ query: 'dogs', cursor: 11 })).cursor).toBeUndefined();
    expect(paramsOf(calls[1])).toEqual({ query: 'dogs', page: '11' });
  });

  it('returns no cursor for an empty page', async () => {
    const { fetchImpl } = mockFetch(jsonResponse({ success: true, reels: [] }));
    expect(await createInstagramAdapter({ fetchImpl }).search({ query: 'dogs' })).toEqual({ videos: [] });
  });

  it('searches #tag as plain text (no hashtag endpoint in v1)', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('instagram', 'search')));
    await createInstagramAdapter({ fetchImpl }).search({ query: '#dogs' });
    expect(calls[0]?.url.pathname).toBe('/v2/instagram/reels/search');
    expect(paramsOf(calls[0])).toEqual({ query: 'dogs' });
  });

  it('does not call the API for an empty query', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({}));
    expect(await createInstagramAdapter({ fetchImpl }).search({ query: '#' })).toEqual({ videos: [] });
    expect(calls).toHaveLength(0);
  });
});
