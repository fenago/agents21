// Loads the videos for the current view (trending or search), with load-more,
// per-platform retry and full reload. Every request is aborted when the view changes,
// and results are tagged with the request they belong to, so a slow old response can
// never overwrite a newer one.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Platform, PlatformError, Video } from '../../shared/video';
import {
  ApiError,
  clearPassword,
  fetchSearch,
  fetchTrending,
  getPassword,
  isAbort,
  type Cursors,
} from '../api';
import type { TimeWindow } from '../config';
import { mergeVideos, nextCursors } from '../lib/videos';
import { fetchKey, type ViewState } from '../lib/viewState';

type Result = {
  requestKey: string;
  videos: Video[];
  cursors: Cursors;
  errors: PlatformError[];
  /** A failure of the whole request (401, 500, network…). */
  error: ApiError | null;
  /** The 401 happened although a password was sent, i.e. it was wrong. */
  passwordRejected: boolean;
  /** Load more failed as a whole (not per platform). */
  moreError: string | null;
  /** When the first page arrived; relative dates are computed against it. */
  receivedAt: number;
};

export type Busy = 'more' | Platform;

export type VideosState = {
  loading: boolean;
  videos: Video[];
  cursors: Cursors;
  errors: PlatformError[];
  error: ApiError | null;
  passwordRejected: boolean;
  moreError: string | null;
  receivedAt: number;
  hasMore: boolean;
  busy: Busy | null;
  loadMore: () => void;
  retry: (platform: Platform) => void;
  reload: () => void;
};

type Query = { q: string; platforms: Platform[]; window: TimeWindow; region: string };

function request(query: Query, cursors: Cursors, signal: AbortSignal) {
  return query.q
    ? fetchSearch(query, cursors, { signal })
    : fetchTrending({ platforms: query.platforms, region: query.region }, { signal });
}

function failure(requestKey: string, err: unknown): Result {
  const error = err instanceof ApiError ? err : new ApiError('network', 0, 'Something went wrong. Please try again.');
  let passwordRejected = false;
  if (error.kind === 'unauthorized') {
    passwordRejected = getPassword() !== null;
    clearPassword();
  }
  return { requestKey, videos: [], cursors: {}, errors: [], error, passwordRejected, moreError: null, receivedAt: Date.now() };
}

export function useVideos(view: ViewState): VideosState {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [busyState, setBusyState] = useState<{ requestKey: string; what: Busy } | null>(null);
  const followUp = useRef<AbortController | null>(null);

  const { q, region } = view;
  const timeWindow: TimeWindow = q ? view.window : 'all';
  const platformsKey = view.platforms.join(',');
  const requestKey = `${fetchKey({ ...view, window: timeWindow })}#${nonce}`;

  useEffect(() => {
    const ctrl = new AbortController();
    const query: Query = { q, platforms: platformsKey.split(',') as Platform[], window: timeWindow, region };
    request(query, {}, ctrl.signal)
      .then((data) =>
        setResult({ requestKey, ...data, error: null, passwordRejected: false, moreError: null, receivedAt: Date.now() }),
      )
      .catch((err: unknown) => {
        if (!isAbort(err)) setResult(failure(requestKey, err));
      });
    return () => {
      ctrl.abort();
      followUp.current?.abort();
    };
  }, [requestKey, q, platformsKey, timeWindow, region]);

  const current = result?.requestKey === requestKey ? result : null;
  const loading = current === null;
  const busy = busyState?.requestKey === requestKey ? busyState.what : null;

  /**
   * Runs a follow-up request and merges it into the current result. `queried` are the
   * platforms the server will actually call: those with a cursor in `cursors`, or all of
   * `platforms` when there are none.
   */
  const runFollowUp = useCallback(
    (what: Busy, queried: Platform[], cursors: Cursors, platforms: Platform[]) => {
      followUp.current?.abort();
      const ctrl = new AbortController();
      followUp.current = ctrl;
      setBusyState({ requestKey, what });
      const query: Query = { q, platforms, window: timeWindow, region };
      request(query, cursors, ctrl.signal)
        .then((data) =>
          setResult((r) =>
            r?.requestKey !== requestKey
              ? r
              : {
                  ...r,
                  videos: mergeVideos(r.videos, data.videos),
                  cursors: nextCursors(r.cursors, data, queried),
                  errors: [...r.errors.filter((e) => !queried.includes(e.platform)), ...data.errors],
                  moreError: null,
                },
          ),
        )
        .catch((err: unknown) => {
          if (isAbort(err)) return;
          setResult((r) => {
            if (r?.requestKey !== requestKey) return r;
            if (err instanceof ApiError && err.kind === 'unauthorized') return failure(requestKey, err);
            const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
            return { ...r, moreError: message };
          });
        })
        .finally(() => setBusyState((b) => (b?.requestKey === requestKey && b.what === what ? null : b)));
    },
    [requestKey, q, timeWindow, region],
  );

  const loadMore = useCallback(() => {
    if (!current || !q || busy) return;
    const queried = view.platforms.filter((p) => current.cursors[p] !== undefined);
    if (queried.length === 0) return;
    runFollowUp('more', queried, current.cursors, view.platforms);
  }, [current, q, busy, view.platforms, runFollowUp]);

  const retry = useCallback(
    (platform: Platform) => {
      if (!current || busy) return;
      // A cursor is only kept for a platform whose load-more failed: retry that page.
      const cursor = q ? current.cursors[platform] : undefined;
      runFollowUp(platform, [platform], cursor === undefined ? {} : { [platform]: cursor }, [platform]);
    },
    [current, q, busy, runFollowUp],
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const shown = current ?? null;
  return {
    loading,
    videos: shown?.videos ?? [],
    cursors: shown?.cursors ?? {},
    errors: shown?.errors ?? [],
    // While a new request loads, keep reporting a 401 so the password screen stays up.
    error: shown?.error ?? (result?.error?.kind === 'unauthorized' ? result.error : null),
    passwordRejected: shown?.passwordRejected ?? false,
    moreError: shown?.moreError ?? null,
    receivedAt: shown?.receivedAt ?? 0,
    hasMore: Boolean(q) && !!shown && view.platforms.some((p) => shown.cursors[p] !== undefined),
    busy,
    loadMore,
    retry,
    reload,
  };
}
