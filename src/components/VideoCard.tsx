import type { ReactNode } from 'react';
import { engagementRate, type Video } from '../../shared/video';
import { PLATFORM_LABEL } from '../config';
import { cleanHandle, formatCompact, formatDate, formatDuration, formatFull, formatPercent, formatRelative } from '../lib/format';
import { CommentIcon, EyeIcon, ExternalIcon, HeartIcon } from './icons';
import { PlatformBadge } from './PlatformBadge';
import { Thumbnail } from './Thumbnail';
import { focusRing } from './ui';

type Props = {
  video: Video;
  /** FR-6: what the platform applied when it can't honour the time filter. */
  windowNote?: string;
  now: number;
};

function Stat({ icon, value, label }: { icon: ReactNode; value: number | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${formatFull(value)} ${label}`}>
      {icon}
      <span>{formatCompact(value)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The title link is stretched over the whole card (after:absolute inset-0), so the card
 * is one click target and one tab stop. The creator link sits above it (z-10).
 */
export function VideoCard({ video, windowNote, now }: Props) {
  const handle = cleanHandle(video.author.handle);
  const creator = handle ? `@${handle}` : video.author.name?.trim() || 'Unknown creator';
  const title = video.title.trim();
  const linkText = title || `${PLATFORM_LABEL[video.platform]} video by ${creator}`;
  const alt = title ? `Thumbnail: ${title.slice(0, 120)}` : `Thumbnail of ${PLATFORM_LABEL[video.platform]} video by ${creator}`;
  const duration = formatDuration(video.durationSec);
  const relative = formatRelative(video.postedAt, now);
  const rate = engagementRate(video.stats);

  return (
    <article
      className={`relative flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm motion-safe:transition hover:shadow-md has-[.card-link:focus-visible]:outline-2 has-[.card-link:focus-visible]:outline-offset-2 has-[.card-link:focus-visible]:outline-focus`}
    >
      <div className="relative">
        <Thumbnail src={video.thumbnail} alt={alt} platform={video.platform} />
        <PlatformBadge platform={video.platform} className="absolute top-2 left-2" />
        {duration && (
          <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white tabular-nums">
            <span className="sr-only">Duration </span>
            {duration}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium break-words" title={title || undefined}>
          <a
            href={video.url}
            target="_blank"
            rel="noopener noreferrer"
            className="card-link outline-none after:absolute after:inset-0 after:content-['']"
          >
            {linkText}
            <span className="sr-only"> (opens {PLATFORM_LABEL[video.platform]} in a new tab)</span>
          </a>
        </h3>

        {video.author.url ? (
          <a
            href={video.author.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`relative z-10 -mb-1 w-fit max-w-full truncate rounded py-1 text-xs text-muted hover:text-ink hover:underline ${focusRing}`}
          >
            {creator}
          </a>
        ) : (
          <span className="truncate text-xs text-muted">{creator}</span>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted tabular-nums">
          <Stat icon={<EyeIcon className="size-3.5" />} value={video.stats.views} label="views" />
          <Stat icon={<HeartIcon className="size-3.5" />} value={video.stats.likes} label="likes" />
          <Stat icon={<CommentIcon className="size-3.5" />} value={video.stats.comments} label="comments" />
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {relative && (
            <time dateTime={video.postedAt} title={formatDate(video.postedAt)}>
              {relative}
            </time>
          )}
          {rate !== undefined && (
            <span title="Engagement rate: (likes + comments) / views">
              {relative && <span aria-hidden="true">· </span>}
              {formatPercent(rate)} eng.
            </span>
          )}
          {windowNote && (
            <span
              className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn-ink"
              title={`${PLATFORM_LABEL[video.platform]} can't apply this time filter; results are from: ${windowNote}`}
            >
              {windowNote}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-brand-ink" aria-hidden="true">
            Open <ExternalIcon className="size-3" />
          </span>
        </div>
      </div>
    </article>
  );
}
