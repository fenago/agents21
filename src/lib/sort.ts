// Client-side sorting (PRD FR-10). Stable; videos missing the sort value go last.
import { engagementRate, type Video } from '../../shared/video';
import type { SortKey } from '../config';
import { parseDate } from './format';

function sortValue(video: Video, key: Exclude<SortKey, 'relevance'>): number | undefined {
  switch (key) {
    case 'views':
      return video.stats.views;
    case 'likes':
      return video.stats.likes;
    case 'comments':
      return video.stats.comments;
    case 'newest':
      return parseDate(video.postedAt);
    case 'engagement':
      return engagementRate(video.stats);
  }
}

function usable(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Returns a new array. `relevance` keeps the API order (round-robin across platforms). */
export function sortVideos(videos: readonly Video[], key: SortKey): Video[] {
  if (key === 'relevance') return [...videos];
  return videos
    .map((video, index) => ({ video, index, value: sortValue(video, key) }))
    .sort((a, b) => {
      const av = usable(a.value);
      const bv = usable(b.value);
      if (av && bv && a.value !== b.value) return (b.value as number) - (a.value as number);
      if (av !== bv) return av ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.video);
}
