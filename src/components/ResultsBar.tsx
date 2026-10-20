import { PLATFORM_LABEL, TIME_WINDOW_LABEL } from '../config';
import type { ViewState } from '../lib/viewState';
import { DownloadIcon, RefreshIcon } from './icons';
import { buttonSecondary } from './ui';

type Props = {
  view: ViewState;
  loading: boolean;
  count: number;
  onRefresh: () => void;
  onExport: () => void;
};

function describe(view: ViewState, loading: boolean, count: number): string {
  const what = view.q ? `for “${view.q}”` : 'trending now';
  if (loading) return view.q ? `Searching ${what}…` : 'Loading trending videos…';
  const n = `${count} ${count === 1 ? 'video' : 'videos'}`;
  return view.q ? `${n} ${what}` : `${n} trending now`;
}

/** Heading row above the grid: what is shown (announced politely), refresh and export. */
export function ResultsBar({ view, loading, count, onRefresh, onExport }: Props) {
  const scope = view.platforms.map((p) => PLATFORM_LABEL[p]).join(', ');
  const windowLabel = view.q && view.window !== 'all' ? ` · ${TIME_WINDOW_LABEL[view.window]}` : '';
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold break-words" aria-live="polite" aria-atomic="true">
          {describe(view, loading, count)}
        </h2>
        <p className="text-xs text-muted">
          {scope} · {view.region}
          {windowLabel}
        </p>
      </div>
      <div className="flex gap-2">
        {!view.q && (
          <button type="button" onClick={onRefresh} disabled={loading} className={buttonSecondary}>
            <RefreshIcon className="size-4" /> Refresh
          </button>
        )}
        <button type="button" onClick={onExport} disabled={loading || count === 0} className={buttonSecondary}>
          <DownloadIcon className="size-4" /> Export CSV
        </button>
      </div>
    </div>
  );
}
