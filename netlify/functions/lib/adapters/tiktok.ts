// TikTok adapter (PRD §6.2). Endpoints:
//   trending  GET /v1/tiktok/get-trending-feed  region (required)
//   keyword   GET /v1/tiktok/search/keyword     query, date_posted, region, cursor
//   hashtag   GET /v1/tiktok/search/hashtag     hashtag (no #), region, cursor
// `trim` is not sent: the trimmed shape is undocumented and the docs example of it drops
// `video.cover` on some items, which would cost us thumbnails.
import type { Video } from '../../../../shared/video';
import { scGet } from '../scrapecreators';
import {
  asArray,
  at,
  compact,
  dedupeById,
  firstIso,
  firstNum,
  firstStr,
  hashtagOf,
} from './normalize-utils';
import type { AdapterDeps, AdapterResult, PlatformAdapter, SearchOptions, TimeWindow, TrendingOptions } from './types';

export const DEFAULT_REGION = 'US';

export const TIKTOK_DATE_POSTED: Record<TimeWindow, string> = {
  today: 'yesterday',
  week: 'this-week',
  month: 'this-month',
  all: 'all-time',
};

function handleFromUrl(url: string | undefined): string | undefined {
  const m = url ? /tiktok\.com\/@([^/?#]+)/.exec(url) : null;
  return m?.[1];
}

function stripQuery(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}

/** Normalize one aweme (the object with `aweme_id`). Returns undefined for unusable items. */
export function normalizeTikTokItem(raw: unknown): Video | undefined {
  const id = firstStr(at(raw, 'aweme_id'), at(raw, 'id'), at(raw, 'statistics', 'aweme_id'));
  if (!id) return undefined;

  // Photo carousels show up in feeds; TrendScout is video-only.
  if (at(raw, 'image_post_info') != null || /\/photo\//.test(String(at(raw, 'url') ?? ''))) return undefined;

  const author = at(raw, 'author');
  const apiUrl = firstStr(at(raw, 'url'), stripQuery(firstStr(at(raw, 'share_url'), at(raw, 'share_info', 'share_url'))));
  const handle = firstStr(at(author, 'unique_id'), at(author, 'uniqueId'), handleFromUrl(apiUrl));
  const url = apiUrl ?? (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : undefined);
  if (!url) return undefined;

  const stats = at(raw, 'statistics') ?? at(raw, 'stats');
  const durationMs = firstNum(at(raw, 'video', 'duration'));

  return compact({
    platform: 'tiktok' as const,
    id,
    url,
    thumbnail:
      firstStr(
        at(raw, 'video', 'cover', 'url_list', 0),
        at(raw, 'video', 'origin_cover', 'url_list', 0),
        at(raw, 'video', 'dynamic_cover', 'url_list', 0),
        at(raw, 'video', 'cover'),
      ) ?? '',
    title: firstStr(at(raw, 'desc'), at(raw, 'content_desc')) ?? '',
    author: compact({
      handle: handle ?? '',
      name: firstStr(at(author, 'nickname')),
      avatar: firstStr(
        at(author, 'avatar_thumb', 'url_list', 0),
        at(author, 'avatar_medium', 'url_list', 0),
        at(author, 'avatarThumb'),
      ),
      url: handle ? `https://www.tiktok.com/@${handle}` : undefined,
    }),
    stats: compact({
      views: firstNum(at(stats, 'play_count'), at(stats, 'playCount')),
      likes: firstNum(at(stats, 'digg_count'), at(stats, 'diggCount')),
      comments: firstNum(at(stats, 'comment_count'), at(stats, 'commentCount')),
      shares: firstNum(at(stats, 'share_count'), at(stats, 'shareCount')),
    }),
    postedAt: firstIso(at(raw, 'create_time'), at(raw, 'createTime'), at(raw, 'create_time_utc')),
    // video.duration is milliseconds in the aweme payload.
    durationSec: durationMs !== undefined ? Math.round(durationMs / 1000) : undefined,
  });
}

/** Items from any TikTok list response: keyword search wraps them in `search_item_list[].aweme_info`. */
function rawItems(response: unknown): unknown[] {
  const searchItems = asArray(at(response, 'search_item_list')).map((it) => at(it, 'aweme_info') ?? it);
  return [...searchItems, ...asArray(at(response, 'aweme_list'))];
}

export function normalizeTikTokList(response: unknown): Video[] {
  const videos: Video[] = [];
  for (const item of rawItems(response)) {
    const v = normalizeTikTokItem(item);
    if (v) videos.push(v);
  }
  return dedupeById(videos);
}

/** Next numeric cursor, or undefined when TikTok says there is nothing more (or the page was empty). */
export function extractTikTokCursor(response: unknown): number | undefined {
  const hasMore = at(response, 'has_more');
  if (hasMore === 0 || hasMore === false) return undefined;
  if (rawItems(response).length === 0) return undefined;
  return firstNum(at(response, 'cursor'));
}

export function normalizeTikTokResponse(response: unknown): AdapterResult {
  return compact({ videos: normalizeTikTokList(response), cursor: extractTikTokCursor(response) });
}

export function createTikTokAdapter(deps: AdapterDeps = {}): PlatformAdapter {
  const get = (path: string, params: Record<string, string | number | undefined>) =>
    scGet<unknown>(path, params, deps);

  return {
    platform: 'tiktok',

    async trending(o: TrendingOptions = {}) {
      const res = await get('/v1/tiktok/get-trending-feed', { region: o.region || DEFAULT_REGION });
      // The trending feed returns a fresh batch per call; there is no cursor.
      return { videos: normalizeTikTokList(res) };
    },

    async search(o: SearchOptions) {
      const tag = hashtagOf(o.query);
      if (tag !== undefined) {
        if (!tag) return { videos: [] };
        const res = await get('/v1/tiktok/search/hashtag', { hashtag: tag, region: o.region, cursor: o.cursor });
        return normalizeTikTokResponse(res);
      }
      const res = await get('/v1/tiktok/search/keyword', {
        query: o.query.trim(),
        date_posted: o.window ? TIKTOK_DATE_POSTED[o.window] : undefined,
        region: o.region,
        cursor: o.cursor,
      });
      return normalizeTikTokResponse(res);
    },
  };
}

export const tiktokAdapter = createTikTokAdapter();
