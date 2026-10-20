// Normalized video model shared by the frontend and Netlify Functions (PRD §6.3).

export const PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type VideoAuthor = {
  handle: string;
  name?: string;
  avatar?: string;
  url?: string;
};

export type VideoStats = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
};

export type Video = {
  platform: Platform;
  id: string;
  url: string;
  thumbnail: string;
  title: string;
  author: VideoAuthor;
  stats: VideoStats;
  postedAt?: string; // ISO 8601
  durationSec?: number;
};

/**
 * `message` is safe to show to users. `code` is a stable machine-readable reason
 * (e.g. `out_of_credits`, `timeout`) so the UI can decide whether to offer a retry.
 */
export type PlatformError = { platform: Platform; message: string; code?: string };

export type VideoListResponse = {
  videos: Video[];
  cursors: Partial<Record<Platform, string | number>>;
  errors: PlatformError[];
};

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

// (likes + comments) / views — undefined when views are unknown or zero (PRD FR-10).
export function engagementRate(stats: VideoStats): number | undefined {
  if (!stats.views) return undefined;
  return ((stats.likes ?? 0) + (stats.comments ?? 0)) / stats.views;
}
