// Instagram adapter (PRD §6.2). Endpoints:
//   trending  GET /v1/instagram/reels/trending  (no params; popular reels from the last 7 days)
//   search    GET /v2/instagram/reels/search    query, date_posted, page (1–11)
// There is no hashtag-reels endpoint in v1 scope: `#tag` queries search the text `tag`.
import type { Video } from '../../../../shared/video';
import { scGet } from '../scrapecreators';
import { asArray, at, compact, dedupeById, firstIso, firstNum, firstStr, hashtagOf } from './normalize-utils';
import type { AdapterDeps, AdapterResult, PlatformAdapter, SearchOptions, TimeWindow } from './types';

export const INSTAGRAM_MAX_PAGE = 11;

/** `today` has no Instagram equivalent (Google does not index reels that fast), so it widens to a week. */
export const INSTAGRAM_DATE_POSTED: Record<TimeWindow, string | undefined> = {
  today: 'last-week',
  week: 'last-week',
  month: 'last-month',
  all: undefined,
};

function captionOf(raw: unknown): string | undefined {
  return firstStr(
    at(raw, 'caption'),
    at(raw, 'caption', 'text'),
    at(raw, 'edge_media_to_caption', 'edges', 0, 'node', 'text'),
    at(raw, 'title'),
  );
}

export function normalizeInstagramItem(raw: unknown): Video | undefined {
  const shortcode = firstStr(at(raw, 'shortcode'), at(raw, 'code'));
  const id = firstStr(at(raw, 'id'), at(raw, 'pk'), shortcode);
  if (!id) return undefined;
  const url = firstStr(at(raw, 'url')) ?? (shortcode ? `https://www.instagram.com/reel/${shortcode}/` : undefined);
  if (!url) return undefined;

  const owner = at(raw, 'owner') ?? at(raw, 'user');
  const handle = firstStr(at(owner, 'username'));

  return compact({
    platform: 'instagram' as const,
    id,
    url,
    thumbnail:
      firstStr(
        at(raw, 'thumbnail_src'),
        at(raw, 'image_url'),
        at(raw, 'display_url'),
        at(raw, 'thumbnail_url'),
        at(raw, 'image_versions2', 'candidates', 0, 'url'),
      ) ?? '',
    title: captionOf(raw) ?? '',
    author: compact({
      handle: handle ?? '',
      name: firstStr(at(owner, 'full_name')),
      avatar: firstStr(at(owner, 'profile_pic_url')),
      url: handle ? `https://www.instagram.com/${handle}/` : undefined,
    }),
    stats: compact({
      // play_count is null for some reels while ig_play_count is set (and vice versa).
      views: firstNum(
        at(raw, 'play_count'),
        at(raw, 'ig_play_count'),
        at(raw, 'video_play_count'),
        at(raw, 'video_view_count'),
        at(raw, 'view_count'),
      ),
      likes: firstNum(at(raw, 'like_count'), at(raw, 'edge_liked_by', 'count'), at(raw, 'edge_media_preview_like', 'count')),
      comments: firstNum(at(raw, 'comment_count'), at(raw, 'edge_media_to_comment', 'count')),
      shares: firstNum(at(raw, 'share_count'), at(raw, 'reshare_count')),
    }),
    postedAt: firstIso(at(raw, 'taken_at'), at(raw, 'taken_at_timestamp')),
    durationSec: firstNum(at(raw, 'video_duration'), at(raw, 'duration')),
  });
}

export function normalizeInstagramList(response: unknown): Video[] {
  const items = [...asArray(at(response, 'reels')), ...asArray(at(response, 'items'))];
  const videos: Video[] = [];
  for (const item of items) {
    // Some payloads wrap each reel as `{ media: {...} }`.
    const v = normalizeInstagramItem(at(item, 'media') ?? item);
    if (v) videos.push(v);
  }
  return dedupeById(videos);
}

/** Parse an incoming cursor to a page number in 1..11 (anything else means page 1). */
export function instagramPage(cursor: string | number | undefined): number {
  const n = typeof cursor === 'number' ? cursor : Number(cursor);
  return Number.isInteger(n) && n >= 1 && n <= INSTAGRAM_MAX_PAGE ? n : 1;
}

/** Next page number, or undefined after the last allowed page or an empty page. */
export function nextInstagramPage(page: number, videosOnPage: number): number | undefined {
  if (videosOnPage === 0 || page >= INSTAGRAM_MAX_PAGE) return undefined;
  return page + 1;
}

export function createInstagramAdapter(deps: AdapterDeps = {}): PlatformAdapter {
  return {
    platform: 'instagram',

    async trending() {
      const res = await scGet<unknown>('/v1/instagram/reels/trending', {}, deps);
      return { videos: normalizeInstagramList(res) };
    },

    async search(o: SearchOptions): Promise<AdapterResult> {
      const query = hashtagOf(o.query) ?? o.query.trim();
      if (!query) return { videos: [] };
      const page = instagramPage(o.cursor);
      const res = await scGet<unknown>(
        '/v2/instagram/reels/search',
        {
          query,
          date_posted: o.window ? INSTAGRAM_DATE_POSTED[o.window] : undefined,
          // Page 1 is the API default; only send `page` when paginating.
          page: page > 1 ? page : undefined,
        },
        deps,
      );
      const videos = normalizeInstagramList(res);
      return compact({ videos, cursor: nextInstagramPage(page, videos.length) });
    },
  };
}

export const instagramAdapter = createInstagramAdapter();
