// Adapter registry keyed by platform.
import type { Platform } from '../../../../shared/video';
import { instagramAdapter } from './instagram';
import { tiktokAdapter } from './tiktok';
import type { PlatformAdapter } from './types';
import { youtubeAdapter } from './youtube';

export const adapters: Record<Platform, PlatformAdapter> = {
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
  youtube: youtubeAdapter,
};

export type {
  AdapterDeps,
  AdapterResult,
  CacheKeyParams,
  CallKind,
  PlatformAdapter,
  SearchOptions,
  TimeWindow,
  TrendingOptions,
  UpstreamParams,
  UpstreamRequest,
} from './types';
export { TIME_WINDOWS, cacheParamsFrom } from './types';
