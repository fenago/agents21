// Helpers for result lists: de-dupe on append (PRD FR-11) and time-window caveats (FR-6).
import type { Platform, Video } from '../../shared/video';
import { TIME_WINDOW_LABEL } from '../config';
import { isHashtagQuery, type ViewState } from './viewState';

export function videoKey(v: Pick<Video, 'platform' | 'id'>): string {
  return `${v.platform}:${v.id}`;
}

/** Append `incoming` to `existing`, skipping platform+id pairs already present. */
export function mergeVideos(existing: readonly Video[], incoming: readonly Video[]): Video[] {
  const seen = new Set(existing.map(videoKey));
  const out = [...existing];
  for (const v of incoming) {
    const k = videoKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * What a platform actually applied when it can't honour the chosen time window (FR-6),
 * as a short label for a card badge, or undefined when the filter applies as chosen.
 *   - Hashtag endpoints (TikTok, YouTube) have no date filter → "Any time".
 *   - Instagram has no "today" → "This week".
 */
export function windowCaveat(platform: Platform, view: Pick<ViewState, 'q' | 'window'>): string | undefined {
  if (!view.q || view.window === 'all') return undefined;
  if (isHashtagQuery(view.q) && platform !== 'instagram') return TIME_WINDOW_LABEL.all;
  if (platform === 'instagram' && view.window === 'today') return TIME_WINDOW_LABEL.week;
  return undefined;
}

type CursorMap = Partial<Record<Platform, string | number>>;

/**
 * Cursors after a follow-up request (load more or a single-platform retry) that queried
 * `queried`. Each queried platform takes the new cursor; one that failed keeps its old
 * cursor so the next "Load more" retries the same page; one that finished is dropped.
 * Platforms that were not queried keep whatever they had.
 */
export function nextCursors(
  prev: CursorMap,
  response: { cursors: CursorMap; errors: readonly { platform: Platform }[] },
  queried: readonly Platform[],
): CursorMap {
  const out: CursorMap = { ...prev };
  for (const p of queried) {
    const c = response.cursors[p];
    if (c !== undefined && c !== '') out[p] = c;
    else if (!response.errors.some((e) => e.platform === p)) delete out[p];
  }
  return out;
}
