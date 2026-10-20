// Test helper: build a Video with sensible defaults.
import type { Video } from '../../shared/video';

export function makeVideo(partial: Partial<Video> & Pick<Video, 'id'>): Video {
  return {
    platform: 'tiktok',
    url: `https://example.com/${partial.id}`,
    thumbnail: '',
    title: `Video ${partial.id}`,
    author: { handle: 'someone' },
    stats: {},
    ...partial,
  };
}
