import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createYouTubeAdapter,
  extractYouTubeCursor,
  normalizeYouTubeItem,
  normalizeYouTubeList,
} from '../../netlify/functions/lib/adapters/youtube';
import { jsonResponse, loadFixture, mockFetch, paramsOf } from '../helpers';

beforeEach(() => vi.stubEnv('SCRAPECREATORS_API_KEY', 'test-key'));
afterEach(() => vi.unstubAllEnvs());

describe('normalizeYouTubeList', () => {
  it('maps trending shorts', () => {
    const videos = normalizeYouTubeList(loadFixture('youtube', 'trending'), { allShorts: true });
    expect(videos).toHaveLength(2);
    expect(videos[0]).toEqual({
      platform: 'youtube',
      id: 'ou0nl5ET0HA',
      url: 'https://www.youtube.com/watch?v=ou0nl5ET0HA',
      thumbnail: 'https://img.youtube.com/vi/ou0nl5ET0HA/maxresdefault.jpg',
      title: 'That hooper who says their just shoes',
      author: { handle: 'dameuniverse', name: 'Dame Universe', url: 'https://www.youtube.com/@dameuniverse' },
      stats: { views: 13798774, likes: 151957, comments: 168 },
      postedAt: '2025-08-07T20:00:22.000Z',
      durationSec: 19,
    });
  });

  it('builds missing URLs/thumbnails and parses text counts', () => {
    const [, second] = normalizeYouTubeList(loadFixture('youtube', 'trending'), { allShorts: true });
    expect(second).toMatchObject({
      url: 'https://www.youtube.com/shorts/RHjn1eyPLgI',
      thumbnail: 'https://i.ytimg.com/vi/RHjn1eyPLgI/hqdefault.jpg',
      author: { handle: 'mindset.demo', url: 'https://www.youtube.com/@mindset.demo' },
      stats: { views: 4512330, likes: 98000, comments: 2100 },
      durationSec: 24,
    });
  });

  it('collects videos, shorts and shelf items from search and de-dupes by id', () => {
    const videos = normalizeYouTubeList(loadFixture('youtube', 'search'));
    expect(videos.map((v) => v.id)).toEqual(['Q1w2e3r4t5y', 'uMNvF-lSCHg', 'LLBR5nO05tE']);
    const run = videos.find((v) => v.id === 'uMNvF-lSCHg');
    expect(run).toMatchObject({
      title: 'LONG RUN ROUTINE #run #runvlog #runner #shorts #morning',
      stats: { views: 462705, likes: 21000, comments: 310 },
      postedAt: '2024-07-28T17:08:46.498Z',
      durationSec: 44,
      author: { handle: 'run.demo', avatar: 'https://yt3.ggpht.com/example-avatar-1=s68-c-k-c0x00ffffff-no-rj' },
    });
  });

  it('uses the channel id when the handle is a "channel/UC…" placeholder', () => {
    const [noHandle] = normalizeYouTubeList(loadFixture('youtube', 'search'));
    expect(noHandle?.author).toEqual({
      handle: 'UCNoHandle0000000000000',
      name: 'No Handle Channel',
      url: 'https://www.youtube.com/channel/UCNoHandle0000000000000',
    });
    expect(noHandle?.stats.views).toBe(1200000);
  });

  it('survives missing and renamed fields, and skips channels and id-less rows', () => {
    const videos = normalizeYouTubeList(loadFixture('youtube', 'search-missing-fields'));
    expect(videos.map((v) => v.id)).toEqual(['bareVideo01', 'renamed0001']);
    expect(videos[0]).toEqual({
      platform: 'youtube',
      id: 'bareVideo01',
      url: 'https://www.youtube.com/watch?v=bareVideo01',
      thumbnail: 'https://i.ytimg.com/vi/bareVideo01/hqdefault.jpg',
      title: '',
      author: { handle: '' },
      stats: {},
    });
    expect(videos[1]).toEqual({
      platform: 'youtube',
      id: 'renamed0001',
      url: 'https://www.youtube.com/shorts/renamed0001',
      thumbnail: 'https://i.ytimg.com/vi/renamed0001/default.jpg',
      title: 'renamed fields',
      author: { handle: '', name: 'Renamed Channel' },
      stats: { views: 5000 },
    });
  });

  it('maps hashtag results', () => {
    const videos = normalizeYouTubeList(loadFixture('youtube', 'hashtag'));
    expect(videos.map((v) => v.id)).toEqual(['jXMISgQq9MM', 'aBcDeFgHiJk']);
    expect(videos[0]?.author).toEqual({
      handle: 'UCvUzWu1Whyw1FWuLl9GOo_g',
      name: 'Funny Demo',
      avatar: 'https://yt3.ggpht.com/example-avatar=s68-c-k-c0x00ffffff-no-rj',
      url: 'https://www.youtube.com/channel/UCvUzWu1Whyw1FWuLl9GOo_g',
    });
    expect(videos[0]?.stats).toEqual({ views: 22668056 });
  });

  it.each([{}, { videos: [], shorts: [] }, { shelves: [{ items: null }] }, null, 'x'])(
    'returns [] for empty input %#',
    (input) => {
      expect(normalizeYouTubeList(input)).toEqual([]);
    },
  );

  it('never throws on junk items', () => {
    expect(normalizeYouTubeItem(undefined)).toBeUndefined();
    expect(normalizeYouTubeItem({ id: '' })).toBeUndefined();
  });
});

describe('extractYouTubeCursor', () => {
  it('returns the continuation token or undefined', () => {
    expect(extractYouTubeCursor(loadFixture('youtube', 'search'))).toBe('EooDEg-example-token');
    expect(extractYouTubeCursor(loadFixture('youtube', 'search-missing-fields'))).toBeUndefined();
    expect(extractYouTubeCursor({})).toBeUndefined();
  });
});

describe('youtube adapter requests', () => {
  it('trending calls shorts/trending with no params and no cursor', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('youtube', 'trending')));
    const res = await createYouTubeAdapter({ fetchImpl }).trending();
    expect(calls[0]?.url.pathname).toBe('/v1/youtube/shorts/trending');
    expect(paramsOf(calls[0])).toEqual({});
    expect(res.videos).toHaveLength(2);
    expect(res.cursor).toBeUndefined();
  });

  it.each([
    ['today', 'today'],
    ['week', 'this_week'],
    ['month', 'this_month'],
  ] as const)('search maps window %s -> uploadDate=%s, type=shorts, includeExtras', async (window, uploadDate) => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('youtube', 'search')));
    await createYouTubeAdapter({ fetchImpl }).search({ query: 'running', window });
    expect(calls[0]?.url.pathname).toBe('/v1/youtube/search');
    expect(paramsOf(calls[0])).toEqual({ query: 'running', uploadDate, type: 'shorts', includeExtras: 'true' });
  });

  it('omits uploadDate for "all", passes region + continuationToken, and returns the next token', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('youtube', 'search')));
    const res = await createYouTubeAdapter({ fetchImpl }).search({
      query: 'running',
      window: 'all',
      region: 'US',
      cursor: 'prev-token',
    });
    expect(paramsOf(calls[0])).toEqual({
      query: 'running',
      type: 'shorts',
      region: 'US',
      continuationToken: 'prev-token',
      includeExtras: 'true',
    });
    expect(res.cursor).toBe('EooDEg-example-token');
  });

  it('can turn includeExtras off', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('youtube', 'search')));
    await createYouTubeAdapter({ fetchImpl, includeExtras: false }).search({ query: 'running' });
    expect(paramsOf(calls[0])).toEqual({ query: 'running', type: 'shorts' });
  });

  it('routes #queries to the hashtag endpoint (hashtag, type=shorts, continuationToken)', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse(loadFixture('youtube', 'hashtag')));
    const res = await createYouTubeAdapter({ fetchImpl }).search({ query: '#funny', window: 'week', cursor: 'tok' });
    expect(calls[0]?.url.pathname).toBe('/v1/youtube/search/hashtag');
    expect(paramsOf(calls[0])).toEqual({ hashtag: 'funny', type: 'shorts', continuationToken: 'tok' });
    expect(res.videos).toHaveLength(2);
    expect(res.cursor).toBe('4qmFsgLtBRIJRkVoYX-example');
  });

  it('does not call the API for a bare "#"', async () => {
    const { fetchImpl, calls } = mockFetch(jsonResponse({}));
    expect(await createYouTubeAdapter({ fetchImpl }).search({ query: '#' })).toEqual({ videos: [] });
    expect(calls).toHaveLength(0);
  });
});
