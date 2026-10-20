// URL safety for videos leaving the API (M2 QA hand-off).
// The SPA renders `url`/`author.url` as links and `thumbnail`/`author.avatar` as <img src>,
// so anything that is not an absolute https: URL (javascript:, data:, http:, relative…) is removed.
import type { Video } from '../../../shared/video';

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Returns a sanitized copy, or undefined when the video's own `url` is not https
 * (a card without a safe link is useless). Non-https thumbnails become '' and
 * non-https author avatar/url are dropped. The input is never mutated (it may be cached).
 */
export function sanitizeVideo(video: Video): Video | undefined {
  if (!isHttpsUrl(video.url)) return undefined;
  const author = { ...video.author };
  if (author.avatar !== undefined && !isHttpsUrl(author.avatar)) delete author.avatar;
  if (author.url !== undefined && !isHttpsUrl(author.url)) delete author.url;
  return {
    ...video,
    thumbnail: isHttpsUrl(video.thumbnail) ? video.thumbnail : '',
    author,
    stats: { ...video.stats },
  };
}

export function sanitizeVideos(videos: readonly Video[]): Video[] {
  const out: Video[] = [];
  for (const v of videos) {
    const s = sanitizeVideo(v);
    if (s) out.push(s);
  }
  return out;
}
