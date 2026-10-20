import { PLATFORMS } from '../../shared/video';
import { SUGGESTED_QUERIES, TIME_WINDOW_LABEL } from '../config';
import type { ViewState } from '../lib/viewState';
import { SearchIcon } from './icons';
import { buttonSecondary, focusRing } from './ui';

type Props = {
  view: ViewState;
  allFailed: boolean;
  onChange: (patch: Partial<ViewState>) => void;
};

export function EmptyState({ view, allFailed, onChange }: Props) {
  const suggestions = SUGGESTED_QUERIES.filter((s) => s.toLowerCase() !== view.q.toLowerCase());
  const title = allFailed
    ? 'No platform returned results'
    : view.q
      ? `No videos found for “${view.q}”`
      : 'Nothing is trending right now';
  const detail = allFailed
    ? 'See the notices above. You can retry, or try one of these searches.'
    : 'Try a different keyword or hashtag, or broaden the filters.';

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-line bg-surface px-4 py-12 text-center">
      <SearchIcon className="size-8 text-muted" />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">{detail}</p>
      </div>

      {view.q && (view.window !== 'all' || view.platforms.length < PLATFORMS.length) && (
        <div className="flex flex-wrap justify-center gap-2">
          {view.window !== 'all' && (
            <button type="button" className={buttonSecondary} onClick={() => onChange({ window: 'all' })}>
              Search {TIME_WINDOW_LABEL.all.toLowerCase()}
            </button>
          )}
          {view.platforms.length < PLATFORMS.length && (
            <button type="button" className={buttonSecondary} onClick={() => onChange({ platforms: [...PLATFORMS] })}>
              Search all platforms
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs font-medium text-muted">Try searching</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => onChange({ q: s })}
                className={`rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand-ink hover:underline ${focusRing}`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
