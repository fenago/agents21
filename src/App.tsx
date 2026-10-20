import { useEffect, useMemo, useState } from 'react';
import { setPassword } from './api';
import { EmptyState } from './components/EmptyState';
import { ErrorChips } from './components/ErrorChips';
import { FatalError } from './components/FatalError';
import { FilterBar } from './components/FilterBar';
import { Footer } from './components/Footer';
import { Logo } from './components/Logo';
import { PasswordScreen } from './components/PasswordScreen';
import { ResultsBar } from './components/ResultsBar';
import { SearchForm } from './components/SearchForm';
import { SkeletonGrid } from './components/SkeletonGrid';
import { VideoGrid } from './components/VideoGrid';
import { buttonPrimary } from './components/ui';
import { useUrlState } from './hooks/useUrlState';
import { useVideos } from './hooks/useVideos';
import { csvFilename, toCsv } from './lib/csv';
import { downloadText } from './lib/download';
import { sortVideos } from './lib/sort';

export default function App() {
  const [view, update] = useUrlState();
  const videos = useVideos(view);
  const [authVersion, setAuthVersion] = useState(0);
  const sorted = useMemo(() => sortVideos(videos.videos, view.sort), [videos.videos, view.sort]);

  useEffect(() => {
    document.title = view.q ? `${view.q} · TrendScout` : 'TrendScout: trending videos';
  }, [view.q]);

  if (videos.error?.kind === 'unauthorized') {
    return (
      <PasswordScreen
        rejected={videos.passwordRejected}
        checking={videos.loading}
        onSubmit={(password) => {
          setPassword(password);
          setAuthVersion((v) => v + 1);
          videos.reload();
        }}
      />
    );
  }

  const fatal = videos.error;
  const allFailed = !videos.loading && videos.errors.length > 0 && videos.errors.length >= view.platforms.length;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#results"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to results
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-6">
            <div className="md:pt-1">
              <Logo onHome={() => update({ q: '' })} />
            </div>
            <div className="w-full md:max-w-2xl">
              <SearchForm key={view.q} query={view.q} onSearch={(q) => update({ q })} />
            </div>
          </div>
          <FilterBar view={view} onChange={update} />
        </div>
      </header>

      <main id="results" tabIndex={-1} className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-6 outline-none sm:px-6">
        <ResultsBar
          view={view}
          loading={videos.loading}
          count={fatal ? 0 : sorted.length}
          onRefresh={videos.reload}
          onExport={() => downloadText(csvFilename(view.q), toCsv(sorted))}
        />

        {fatal ? (
          <FatalError error={fatal} onRetry={videos.reload} />
        ) : videos.loading ? (
          <SkeletonGrid />
        ) : (
          <>
            <div aria-live="polite">
              <ErrorChips errors={videos.errors} busy={videos.busy} onRetry={videos.retry} />
            </div>
            {sorted.length === 0 ? (
              <EmptyState view={view} allFailed={allFailed} onChange={update} />
            ) : (
              <VideoGrid videos={sorted} view={view} now={videos.receivedAt} />
            )}
            {(videos.hasMore || videos.moreError) && sorted.length > 0 && (
              <div className="flex flex-col items-center gap-2 py-4">
                {videos.moreError && (
                  <p role="alert" className="text-sm text-danger-ink">
                    Couldn’t load more: {videos.moreError}
                  </p>
                )}
                {videos.hasMore && (
                  <button
                    type="button"
                    onClick={videos.loadMore}
                    disabled={videos.busy !== null}
                    aria-busy={videos.busy === 'more'}
                    className={`${buttonPrimary} px-6`}
                  >
                    {videos.busy === 'more' ? 'Loading more…' : 'Load more'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <Footer authVersion={authVersion} />
    </div>
  );
}
