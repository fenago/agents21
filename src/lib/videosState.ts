// The state machine behind useVideos, kept free of React so it can be unit tested in
// the node environment. The hook only wires these pieces to useReducer and effects.
//
//  - `videosReducer` is pure (StrictMode may run it twice). Every action carries the
//    `requestKey` of the view it belongs to; actions for any other key are ignored, so a
//    slow response from an old view can never overwrite the current one.
//  - Side effects (reading/clearing the stored password) happen in the async runners
//    (`loadFirstPage`, `loadFollowUp`), never inside the reducer.
//  - `RequestScope` owns the AbortControllers: a new view aborts everything in flight,
//    a new follow-up aborts the previous follow-up.
import type { Platform, PlatformError, Video, VideoListResponse } from '../../shared/video';
import { ApiError, isAbort, type Cursors } from '../api';
import type { TimeWindow } from '../config';
import { mergeVideos, nextCursors } from './videos';

export type Busy = 'more' | Platform;

export type Result = {
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

export type VideosMachineState = {
  result: Result | null;
  busy: { requestKey: string; what: Busy } | null;
};

export const INITIAL_STATE: VideosMachineState = { result: null, busy: null };

export type Failure = { error: ApiError; passwordRejected: boolean };

export type VideosAction =
  | { type: 'loaded'; requestKey: string; data: VideoListResponse; receivedAt: number }
  | { type: 'failed'; requestKey: string; failure: Failure; receivedAt: number }
  | { type: 'followUpStarted'; requestKey: string; what: Busy }
  | { type: 'followUpLoaded'; requestKey: string; queried: Platform[]; data: VideoListResponse }
  | { type: 'followUpFailed'; requestKey: string; failure: Failure; receivedAt: number }
  | { type: 'followUpSettled'; requestKey: string; what: Busy };

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** Pure: turn any thrown value into a Failure. `sentPassword` = a password was sent. */
export function toFailure(err: unknown, sentPassword: boolean): Failure {
  const error = err instanceof ApiError ? err : new ApiError('network', 0, GENERIC_MESSAGE);
  return { error, passwordRejected: error.kind === 'unauthorized' && sentPassword };
}

function failedResult(requestKey: string, failure: Failure, receivedAt: number): Result {
  return { requestKey, videos: [], cursors: {}, errors: [], ...failure, moreError: null, receivedAt };
}

export function videosReducer(state: VideosMachineState, action: VideosAction): VideosMachineState {
  const { result } = state;
  switch (action.type) {
    case 'loaded':
      return {
        ...state,
        result: {
          requestKey: action.requestKey,
          ...action.data,
          error: null,
          passwordRejected: false,
          moreError: null,
          receivedAt: action.receivedAt,
        },
      };
    case 'failed':
      return { ...state, result: failedResult(action.requestKey, action.failure, action.receivedAt) };
    case 'followUpStarted':
      return { ...state, busy: { requestKey: action.requestKey, what: action.what } };
    case 'followUpLoaded': {
      if (result?.requestKey !== action.requestKey) return state;
      const { data, queried } = action;
      return {
        ...state,
        result: {
          ...result,
          videos: mergeVideos(result.videos, data.videos),
          cursors: nextCursors(result.cursors, data, queried),
          errors: [...result.errors.filter((e) => !queried.includes(e.platform)), ...data.errors],
          moreError: null,
        },
      };
    }
    case 'followUpFailed': {
      if (result?.requestKey !== action.requestKey) return state;
      // A 401 mid-session replaces the whole result so the password screen shows.
      if (action.failure.error.kind === 'unauthorized') {
        return { ...state, result: failedResult(action.requestKey, action.failure, action.receivedAt) };
      }
      return { ...state, result: { ...result, moreError: action.failure.error.message } };
    }
    case 'followUpSettled': {
      const b = state.busy;
      return b?.requestKey === action.requestKey && b.what === action.what ? { ...state, busy: null } : state;
    }
  }
}

// ---------------------------------------------------------------------------
// Derived view

export type VideosSnapshot = {
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
};

/** What the UI sees for the view identified by `requestKey`. */
export function selectSnapshot(
  state: VideosMachineState,
  requestKey: string,
  q: string,
  platforms: readonly Platform[],
): VideosSnapshot {
  const { result } = state;
  const current = result?.requestKey === requestKey ? result : null;
  return {
    loading: current === null,
    videos: current?.videos ?? [],
    cursors: current?.cursors ?? {},
    errors: current?.errors ?? [],
    // While a new request loads, keep reporting a 401 so the password screen stays up.
    error: current?.error ?? (result?.error?.kind === 'unauthorized' ? result.error : null),
    // Hidden while a new password is being checked; re-announced if it fails again.
    passwordRejected: current?.passwordRejected ?? false,
    moreError: current?.moreError ?? null,
    receivedAt: current?.receivedAt ?? 0,
    hasMore: Boolean(q) && current !== null && platforms.some((p) => current.cursors[p] !== undefined),
    busy: state.busy?.requestKey === requestKey ? state.busy.what : null,
  };
}

// ---------------------------------------------------------------------------
// Follow-up planning

/**
 * A follow-up request. `queried` are the platforms the server will actually call: those
 * with a cursor in `cursors`, or all of `platforms` when there are none.
 */
export type FollowUpPlan = { what: Busy; queried: Platform[]; cursors: Cursors; platforms: Platform[] };

export function planLoadMore(snap: VideosSnapshot, q: string, platforms: readonly Platform[]): FollowUpPlan | null {
  if (snap.loading || snap.error || !q || snap.busy) return null;
  const queried = platforms.filter((p) => snap.cursors[p] !== undefined);
  if (queried.length === 0) return null;
  return { what: 'more', queried, cursors: snap.cursors, platforms: [...platforms] };
}

export function planRetry(snap: VideosSnapshot, q: string, platform: Platform): FollowUpPlan | null {
  if (snap.loading || snap.error || snap.busy) return null;
  // A cursor is only kept for a platform whose load-more failed: retry that page.
  // Otherwise (first page failed, or trending) re-request that platform's first page.
  const cursor = q ? snap.cursors[platform] : undefined;
  return { what: platform, queried: [platform], cursors: cursor === undefined ? {} : { [platform]: cursor }, platforms: [platform] };
}

// ---------------------------------------------------------------------------
// Async runners (side effects injected so tests need no network or storage)

export type Query = { q: string; platforms: Platform[]; window: TimeWindow; region: string };

export type VideosDeps = {
  request: (query: Query, cursors: Cursors, signal: AbortSignal) => Promise<VideoListResponse>;
  getPassword: () => string | null;
  clearPassword: () => void;
  now: () => number;
};

/** Run side effects for a failure: a 401 drops the stored password. Returns the Failure. */
function settleFailure(deps: VideosDeps, err: unknown, sentPassword: boolean): Failure {
  const failure = toFailure(err, sentPassword);
  if (failure.error.kind === 'unauthorized') deps.clearPassword();
  return failure;
}

export async function loadFirstPage(
  deps: VideosDeps,
  requestKey: string,
  query: Query,
  signal: AbortSignal,
  dispatch: (a: VideosAction) => void,
): Promise<void> {
  const sentPassword = deps.getPassword() !== null;
  try {
    const data = await deps.request(query, {}, signal);
    if (signal.aborted) return;
    dispatch({ type: 'loaded', requestKey, data, receivedAt: deps.now() });
  } catch (err) {
    if (isAbort(err) || signal.aborted) return;
    dispatch({ type: 'failed', requestKey, failure: settleFailure(deps, err, sentPassword), receivedAt: deps.now() });
  }
}

export async function loadFollowUp(
  deps: VideosDeps,
  requestKey: string,
  query: Omit<Query, 'platforms'>,
  plan: FollowUpPlan,
  signal: AbortSignal,
  dispatch: (a: VideosAction) => void,
): Promise<void> {
  const { what, queried } = plan;
  dispatch({ type: 'followUpStarted', requestKey, what });
  const sentPassword = deps.getPassword() !== null;
  try {
    const data = await deps.request({ ...query, platforms: plan.platforms }, plan.cursors, signal);
    if (signal.aborted) return;
    dispatch({ type: 'followUpLoaded', requestKey, queried, data });
  } catch (err) {
    if (isAbort(err) || signal.aborted) return;
    dispatch({ type: 'followUpFailed', requestKey, failure: settleFailure(deps, err, sentPassword), receivedAt: deps.now() });
  } finally {
    dispatch({ type: 'followUpSettled', requestKey, what });
  }
}

// ---------------------------------------------------------------------------
// Abort bookkeeping

export class RequestScope {
  private view: AbortController | null = null;
  private followUp: AbortController | null = null;

  /** A new view: abort everything still in flight for the old one. */
  startView(): AbortSignal {
    this.abortAll();
    this.view = new AbortController();
    return this.view.signal;
  }

  /** A new follow-up replaces (aborts) the previous follow-up of the same view. */
  startFollowUp(): AbortSignal {
    this.followUp?.abort();
    this.followUp = new AbortController();
    return this.followUp.signal;
  }

  abortAll(): void {
    this.view?.abort();
    this.followUp?.abort();
    this.view = null;
    this.followUp = null;
  }
}
