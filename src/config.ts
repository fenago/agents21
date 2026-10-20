// UI configuration: labels and option lists for the filters (PRD §5, §8).
import type { Platform } from '../shared/video';

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

/** Mirrors the `window` values accepted by /api/search (netlify/functions/lib/validation.ts). */
export const TIME_WINDOWS = ['all', 'today', 'week', 'month'] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

export const TIME_WINDOW_LABEL: Record<TimeWindow, string> = {
  all: 'Any time',
  today: 'Today',
  week: 'This week',
  month: 'This month',
};

export const SORT_KEYS = ['relevance', 'views', 'likes', 'comments', 'newest', 'engagement'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABEL: Record<SortKey, string> = {
  relevance: 'Relevance',
  views: 'Most views',
  likes: 'Most likes',
  comments: 'Most comments',
  newest: 'Newest',
  engagement: 'Engagement rate',
};

export const DEFAULT_REGION = 'US';

/** Common markets for the region dropdown. The API accepts any two-letter code. */
export const REGIONS: readonly { code: string; label: string }[] = [
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'IN', label: 'India' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
  { code: 'JP', label: 'Japan' },
  { code: 'KR', label: 'South Korea' },
];

/** Matches MAX_QUERY_LENGTH on the server (counted in code points). */
export const MAX_QUERY_LENGTH = 100;

export const SUGGESTED_QUERIES: readonly string[] = ['cooking hacks', '#booktok', 'travel vlog', 'home workout', '#asmr'];
