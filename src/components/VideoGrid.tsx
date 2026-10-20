import type { Video } from '../../shared/video';
import { videoKey, windowCaveat } from '../lib/videos';
import type { ViewState } from '../lib/viewState';
import { VideoCard } from './VideoCard';

/** 1 → 5 columns. Two columns from 360px: 9:16 thumbnails are too tall at full phone width. */
export const GRID_CLASS =
  'grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5';

type Props = { videos: Video[]; view: Pick<ViewState, 'q' | 'window'>; now: number };

export function VideoGrid({ videos, view, now }: Props) {
  return (
    <ul className={GRID_CLASS} aria-label="Videos">
      {videos.map((v) => (
        <li key={videoKey(v)} className="flex min-w-0">
          <VideoCard video={v} windowNote={windowCaveat(v.platform, view)} now={now} />
        </li>
      ))}
    </ul>
  );
}
