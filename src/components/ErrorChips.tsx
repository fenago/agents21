import type { Platform, PlatformError } from '../../shared/video';
import { PLATFORM_LABEL } from '../config';
import type { Busy } from '../hooks/useVideos';
import { AlertIcon, RefreshIcon } from './icons';
import { focusRing } from './ui';

/** Codes where retrying cannot help, so no retry button is offered. */
const NO_RETRY = new Set(['out_of_credits', 'missing_key', 'unauthorized']);

export function canRetry(error: PlatformError): boolean {
  return !NO_RETRY.has(error.code ?? '');
}

type Props = { errors: PlatformError[]; busy: Busy | null; onRetry: (platform: Platform) => void };

/** Per-platform failure notices (PRD §8: "Instagram unavailable — retry"). */
export function ErrorChips({ errors, busy, onRetry }: Props) {
  if (errors.length === 0) return null;
  return (
    <ul aria-label="Platform errors" className="flex flex-wrap gap-2">
      {errors.map((e) => {
        const retrying = busy === e.platform;
        return (
          <li
            key={e.platform}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-danger-line bg-danger-soft py-1 pr-1 pl-3 text-sm text-danger-ink"
          >
            <AlertIcon className="size-4 shrink-0" />
            <span className="min-w-0">
              {!e.message.includes(PLATFORM_LABEL[e.platform]) && (
                <span className="font-semibold">{PLATFORM_LABEL[e.platform]}: </span>
              )}
              {e.message}
            </span>
            {canRetry(e) ? (
              <button
                type="button"
                onClick={() => onRetry(e.platform)}
                disabled={busy !== null}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink hover:bg-subtle disabled:opacity-60 ${focusRing}`}
              >
                <RefreshIcon className={`size-3 ${retrying ? 'motion-safe:animate-spin' : ''}`} />
                {retrying ? 'Retrying…' : 'Retry'}
                <span className="sr-only"> {PLATFORM_LABEL[e.platform]}</span>
              </button>
            ) : (
              <span className="pr-2" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
