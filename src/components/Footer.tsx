import { useEffect, useState } from 'react';
import { fetchCredits } from '../api';
import { formatFull } from '../lib/format';

const LOW_CREDITS = 100;

/** Credit balance (PRD FR-13). Fails silently: nothing is shown if it can't be read. */
export function Footer({ authVersion }: { authVersion: number }) {
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchCredits({ signal: ctrl.signal })
      .then(setCredits)
      .catch(() => setCredits(null));
    return () => ctrl.abort();
  }, [authVersion]);

  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted sm:px-6">
        <p>
          Data from{' '}
          <a href="https://scrapecreators.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-ink">
            Scrape Creators
          </a>
          . Videos open on the original platform.
        </p>
        {credits !== null && (
          <p className={credits < LOW_CREDITS ? 'font-semibold text-warn-ink' : undefined}>
            <span className="tabular-nums">{formatFull(credits)}</span> credits left
            {credits < LOW_CREDITS && ' (running low)'}
          </p>
        )}
      </div>
    </footer>
  );
}
