import { useId, useState, type FormEvent } from 'react';
import { MAX_QUERY_LENGTH } from '../config';
import { isHashtagQuery, isSearchable, normalizeQuery } from '../lib/viewState';
import { CloseIcon, SearchIcon } from './icons';
import { buttonPrimary, focusRing } from './ui';

type Props = {
  /** The query currently in the URL. Remount (key={query}) to reset the draft. */
  query: string;
  onSearch: (q: string) => void;
};

export function SearchForm({ query, onSearch }: Props) {
  const [draft, setDraft] = useState(query);
  const [invalid, setInvalid] = useState(false);
  const hintId = useId();
  const hashtag = isHashtagQuery(draft);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = normalizeQuery(draft);
    if (q === '') {
      onSearch('');
      return;
    }
    if (!isSearchable(q)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSearch(q);
  }

  function clear() {
    setDraft('');
    setInvalid(false);
    if (query) onSearch('');
  }

  const hint = invalid
    ? 'Type a word after # to search a hashtag.'
    : hashtag
      ? 'Hashtag search on TikTok and YouTube; Instagram searches the text.'
      : 'Search a keyword, or start with # for a hashtag.';

  return (
    <form role="search" onSubmit={submit} className="flex w-full flex-col gap-1">
      <div className="flex w-full gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${hintId}-q`} className="sr-only">
            Search videos
          </label>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            id={`${hintId}-q`}
            type="search"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            maxLength={MAX_QUERY_LENGTH * 2}
            placeholder="Search videos or #hashtag"
            autoComplete="off"
            enterKeyHint="search"
            aria-describedby={hintId}
            aria-invalid={invalid || undefined}
            className={`w-full rounded-lg border border-line bg-surface py-2 pr-9 pl-9 text-sm text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
          />
          {draft && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className={`absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted hover:text-ink ${focusRing}`}
            >
              <CloseIcon className="size-4" />
            </button>
          )}
        </div>
        <button type="submit" className={buttonPrimary}>
          Search
        </button>
      </div>
      <p id={hintId} className={`text-xs ${invalid ? 'text-danger-ink' : 'text-muted'}`}>
        {hashtag && !invalid && (
          <span className="mr-1 rounded bg-brand-soft px-1 font-medium text-brand-ink">#</span>
        )}
        {hint}
      </p>
    </form>
  );
}
