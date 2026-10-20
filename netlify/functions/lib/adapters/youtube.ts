// YouTube adapter (PRD §6.2). Endpoints:
//   trending  GET /v1/youtube/shorts/trending   (no params; ~48 different shorts per call, no cursor)
//   search    GET /v1/youtube/search            query, uploadDate, type=shorts, region, continuationToken, includeExtras
//   hashtag   GET /v1/youtube/search/hashtag    hashtag, type=shorts, continuationToken
//
// type=shorts: TrendScout is a short-form product, and with type=videos YouTube mixes in
// long-form uploads (the docs example returns 4–50 minute videos for a plain query).
//
// includeExtras=true on keyword search: without it the search payload has views only, so
// likes/comments (sort by likes/comments, engagement rate) would be blank for YouTube.
// It still costs 1 credit per request; the docs warn it "slows down the response slightly".
// The hashtag endpoint has no includeExtras option, so hashtag results have views only.
import type { Video } from '../../../../shared/video';
import { scGet } from '../scrapecreators';
import { asArray, at, compact, dedupeById, firstIso, firstNum, firstStr, hashtagOf } from './normalize-utils';
import type { AdapterDeps, AdapterResult, PlatformAdapter, SearchOptions, TimeWindow } from './types';

export const YOUTUBE_UPLOAD_DATE: Record<TimeWindow, string | undefined> = {
  today: 'today',
  week: 'this_week',
  month: 'this_month',
  all: undefined,
};

export type YouTubeAdapterDeps = AdapterDeps & {
  /** Request likes/comments on keyword search (default true). */
  includeExtras?: boolean;
};

const NON_VIDEO_TYPES = new Set(['channel', 'playlist', 'shelf', 'live', 'lockup']);

function isShortItem(raw: unknown): boolean {
  return firstStr(at(raw, 'type')) === 'short';
}

export function normalizeYouTubeItem(raw: unknown, opts: { short?: boolean } = {}): Video | undefined {
  const type = firstStr(at(raw, 'type'));
  if (type && NON_VIDEO_TYPES.has(type)) return undefined;
  const id = firstStr(at(raw, 'id'), at(raw, 'videoId'));
  if (!id) return undefined;
  const short = opts.short ?? isShortItem(raw);
  const url =
    firstStr(at(raw, 'url')) ??
    (short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`);

  const channel = at(raw, 'channel');
  const channelId = firstStr(at(channel, 'id'));
  // Some channels have no @handle and the API returns "channel/UC…" in its place.
  const rawHandle = firstStr(at(channel, 'handle'))?.replace(/^@/, '');
  const handle = rawHandle && !rawHandle.startsWith('channel/') ? rawHandle : undefined;
  const durationMs = firstNum(at(raw, 'durationMs'));

  return compact({
    platform: 'youtube' as const,
    id,
    url,
    thumbnail: firstStr(at(raw, 'thumbnail'), at(raw, 'thumbnails', 0, 'url')) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    title: firstStr(at(raw, 'title')) ?? '',
    author: compact({
      handle: handle ?? channelId ?? '',
      name: firstStr(at(channel, 'title'), at(channel, 'name')),
      avatar: firstStr(at(channel, 'thumbnail')),
      url:
        firstStr(at(channel, 'url')) ??
        (handle
          ? `https://www.youtube.com/@${handle}`
          : channelId
            ? `https://www.youtube.com/channel/${channelId}`
            : undefined),
    }),
    stats: compact({
      views: firstNum(at(raw, 'viewCountInt'), at(raw, 'viewCount'), at(raw, 'viewCountText')),
      likes: firstNum(at(raw, 'likeCountInt'), at(raw, 'likeCount'), at(raw, 'likeCountText')),
      comments: firstNum(at(raw, 'commentCountInt'), at(raw, 'commentCount'), at(raw, 'commentCountText')),
    }),
    postedAt: firstIso(at(raw, 'publishDate'), at(raw, 'publishedTime'), at(raw, 'uploadDate')),
    durationSec: firstNum(at(raw, 'lengthSeconds'), durationMs !== undefined ? Math.round(durationMs / 1000) : undefined),
  });
}

/**
 * Collect videos from any YouTube list response: `shorts[]` (trending + search),
 * `videos[]` (search + hashtag) and the "Shorts" shelves inside search results.
 * Items from the trending endpoint are shorts, so `allShorts` builds /shorts/ URLs as fallback.
 */
export function normalizeYouTubeList(response: unknown, opts: { allShorts?: boolean } = {}): Video[] {
  const videos: Video[] = [];
  const push = (raw: unknown, short?: boolean) => {
    const v = normalizeYouTubeItem(raw, { short: opts.allShorts || short || isShortItem(raw) });
    if (v) videos.push(v);
  };
  for (const raw of asArray(at(response, 'shorts'))) push(raw, true);
  for (const raw of asArray(at(response, 'videos'))) push(raw);
  for (const shelf of asArray(at(response, 'shelves'))) {
    for (const raw of asArray(at(shelf, 'items'))) push(raw);
  }
  return dedupeById(videos);
}

export function extractYouTubeCursor(response: unknown): string | undefined {
  return firstStr(at(response, 'continuationToken'));
}

export function normalizeYouTubeResponse(response: unknown): AdapterResult {
  return compact({ videos: normalizeYouTubeList(response), cursor: extractYouTubeCursor(response) });
}

export function createYouTubeAdapter(deps: YouTubeAdapterDeps = {}): PlatformAdapter {
  const { includeExtras = true, ...http } = deps;
  const continuationToken = (cursor: string | number | undefined) =>
    cursor === undefined || cursor === '' ? undefined : String(cursor);

  return {
    platform: 'youtube',

    async trending() {
      const res = await scGet<unknown>('/v1/youtube/shorts/trending', {}, http);
      return { videos: normalizeYouTubeList(res, { allShorts: true }) };
    },

    async search(o: SearchOptions) {
      const tag = hashtagOf(o.query);
      if (tag !== undefined) {
        if (!tag) return { videos: [] };
        const res = await scGet<unknown>(
          '/v1/youtube/search/hashtag',
          { hashtag: tag, type: 'shorts', continuationToken: continuationToken(o.cursor) },
          http,
        );
        return normalizeYouTubeResponse(res);
      }
      const res = await scGet<unknown>(
        '/v1/youtube/search',
        {
          query: o.query.trim(),
          uploadDate: o.window ? YOUTUBE_UPLOAD_DATE[o.window] : undefined,
          type: 'shorts',
          region: o.region,
          continuationToken: continuationToken(o.cursor),
          includeExtras: includeExtras ? true : undefined,
        },
        http,
      );
      return normalizeYouTubeResponse(res);
    },
  };
}

export const youtubeAdapter = createYouTubeAdapter();
