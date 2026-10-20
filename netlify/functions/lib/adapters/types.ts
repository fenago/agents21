// Shared adapter contract (PRD §6.2 / §7.2).
import type { Platform, Video } from '../../../../shared/video';

export type TimeWindow = 'today' | 'week' | 'month' | 'all';

export const TIME_WINDOWS: readonly TimeWindow[] = ['today', 'week', 'month', 'all'];

export type TrendingOptions = { region?: string };

/**
 * `query` starting with `#` switches to the platform's hashtag endpoint (with the `#`
 * stripped) where one exists. Hashtag endpoints do not support a time window, so
 * `window` is ignored in hashtag mode.
 */
export type SearchOptions = {
  query: string;
  window?: TimeWindow;
  region?: string;
  cursor?: string | number;
};

/** `cursor` is exactly what the next `search()` call needs; undefined when there are no more pages. */
export type AdapterResult = { videos: Video[]; cursor?: string | number };

export interface PlatformAdapter {
  platform: Platform;
  trending(o?: TrendingOptions): Promise<AdapterResult>;
  search(o: SearchOptions): Promise<AdapterResult>;
}

/** Injection point for tests (mock fetch) and for per-call timeouts set by the functions layer. */
export type AdapterDeps = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};
