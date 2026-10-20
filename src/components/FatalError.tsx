import type { ApiError } from '../api';
import { AlertIcon, RefreshIcon } from './icons';
import { buttonSecondary } from './ui';

type Props = { error: ApiError; onRetry: () => void };

/** Whole-request failures. `server_not_configured` gets setup instructions. */
export function FatalError({ error, onRetry }: Props) {
  const setup = error.kind === 'server_not_configured';
  return (
    <div role="alert" className="flex flex-col items-center gap-4 rounded-xl border border-danger-line bg-danger-soft px-4 py-10 text-center text-danger-ink">
      <AlertIcon className="size-8" />
      <div className="flex max-w-prose flex-col gap-2">
        <h2 className="text-lg font-semibold">{setup ? 'TrendScout isn’t set up yet' : 'Couldn’t load videos'}</h2>
        {setup ? (
          <p className="text-sm">
            The server has no Scrape Creators API key. In Netlify, open <strong>Project configuration → Environment
            variables</strong>, add <code className="rounded bg-surface px-1 text-ink">SCRAPECREATORS_API_KEY</code>, then
            redeploy. Locally, put it in <code className="rounded bg-surface px-1 text-ink">.env</code> and run{' '}
            <code className="rounded bg-surface px-1 text-ink">npx netlify dev</code>.
          </p>
        ) : (
          <p className="text-sm">{error.message}</p>
        )}
      </div>
      <button type="button" onClick={onRetry} className={buttonSecondary}>
        <RefreshIcon className="size-4" /> Try again
      </button>
    </div>
  );
}
