import { describe, expect, it, vi } from 'vitest';
import type { Platform, VideoListResponse } from '../../shared/video';
import { ApiError, type Cursors } from '../api';
import { makeVideo } from './testVideos';
import {
  INITIAL_STATE,
  RequestScope,
  loadFirstPage,
  loadFollowUp,
  planLoadMore,
  planRetry,
  selectSnapshot,
  toFailure,
  videosReducer,
  type Query,
  type VideosAction,
  type VideosDeps,
  type VideosMachineState,
} from './videosState';

const all: Platform[] = ['tiktok', 'instagram', 'youtube'];
const KEY = 'search|cats|tiktok,instagram,youtube|all|US#0';
const query: Query = { q: 'cats', platforms: all, window: 'all', region: 'US' };

function list(partial: Partial<VideoListResponse> = {}): VideoListResponse {
  return { videos: [], cursors: {}, errors: [], ...partial };
}

function run(actions: VideosAction[], from: VideosMachineState = INITIAL_STATE): VideosMachineState {
  return actions.reduce(videosReducer, from);
}

const firstPage = list({
  videos: [makeVideo({ id: '1' }), makeVideo({ id: '2', platform: 'youtube' })],
  cursors: { tiktok: 20, youtube: 'yt-2' },
  errors: [{ platform: 'instagram', message: 'Instagram unavailable' }],
});
const loaded = run([{ type: 'loaded', requestKey: KEY, data: firstPage, receivedAt: 1000 }]);

/** Deps with a controllable request: resolve/reject each call by hand. */
function fakeDeps(password: string | null = null) {
  let stored = password;
  const pending: {
    query: Query;
    cursors: Cursors;
    signal: AbortSignal;
    resolve: (d: VideoListResponse) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const deps: VideosDeps = {
    request: (q, cursors, signal) =>
      new Promise((resolve, reject) => {
        pending.push({ query: q, cursors, signal, resolve, reject });
        signal.addEventListener('abort', () => reject(new ApiError('aborted', 0, 'Request cancelled')));
      }),
    getPassword: () => stored,
    clearPassword: vi.fn(() => {
      stored = null;
    }),
    now: () => 5000,
  };
  return { deps, pending, stored: () => stored };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('videosReducer: first page and stale responses', () => {
  it('is loading until a result for the current request arrives', () => {
    expect(selectSnapshot(INITIAL_STATE, KEY, 'cats', all).loading).toBe(true);
    const snap = selectSnapshot(loaded, KEY, 'cats', all);
    expect(snap.loading).toBe(false);
    expect(snap.videos.map((v) => v.id)).toEqual(['1', '2']);
    expect(snap.errors).toHaveLength(1);
    expect(snap.receivedAt).toBe(1000);
    expect(snap.hasMore).toBe(true);
  });

  it('ignores a result tagged with an older request key', () => {
    const snap = selectSnapshot(loaded, 'search|dogs|tiktok,instagram,youtube|all|US#0', 'dogs', all);
    expect(snap.loading).toBe(true);
    expect(snap.videos).toEqual([]);
  });

  it('ignores follow-up results and failures for another request', () => {
    const other = 'trending|tiktok|US#0';
    const after = run(
      [
        { type: 'followUpLoaded', requestKey: other, queried: ['tiktok'], data: list({ videos: [makeVideo({ id: 'x' })] }) },
        {
          type: 'followUpFailed',
          requestKey: other,
          failure: toFailure(new ApiError('unauthorized', 401, 'Password required'), true),
          receivedAt: 1,
        },
      ],
      loaded,
    );
    expect(after).toBe(loaded);
  });

  it('has no "more" for trending, even with cursors', () => {
    expect(selectSnapshot(loaded, KEY, '', all).hasMore).toBe(false);
  });
});

describe('videosReducer: load more', () => {
  it('merges (de-duped) and advances, keeps or drops cursors per platform', () => {
    const plan = planLoadMore(selectSnapshot(loaded, KEY, 'cats', all), 'cats', all)!;
    expect(plan).toEqual({ what: 'more', queried: ['tiktok', 'youtube'], cursors: { tiktok: 20, youtube: 'yt-2' }, platforms: all });

    const page2 = list({
      videos: [makeVideo({ id: '1' }), makeVideo({ id: '3' })], // '1' is a TikTok duplicate
      cursors: { tiktok: 40 }, // YouTube finished (no cursor, no error)
    });
    const after = run(
      [
        { type: 'followUpStarted', requestKey: KEY, what: 'more' },
        { type: 'followUpLoaded', requestKey: KEY, queried: plan.queried, data: page2 },
      ],
      loaded,
    );
    const snap = selectSnapshot(after, KEY, 'cats', all);
    expect(snap.busy).toBe('more');
    expect(snap.videos.map((v) => v.id)).toEqual(['1', '2', '3']);
    expect(snap.cursors).toEqual({ tiktok: 40 });
    // Instagram was not queried, so its first-page error stays.
    expect(snap.errors.map((e) => e.platform)).toEqual(['instagram']);

    const settled = videosReducer(after, { type: 'followUpSettled', requestKey: KEY, what: 'more' });
    expect(selectSnapshot(settled, KEY, 'cats', all).busy).toBeNull();
  });

  it('keeps the cursor of a platform whose page failed, so Load more retries it', () => {
    const after = videosReducer(loaded, {
      type: 'followUpLoaded',
      requestKey: KEY,
      queried: ['tiktok', 'youtube'],
      data: list({ cursors: { youtube: 'yt-3' }, errors: [{ platform: 'tiktok', message: 'TikTok timed out' }] }),
    });
    const snap = selectSnapshot(after, KEY, 'cats', all);
    expect(snap.cursors).toEqual({ tiktok: 20, youtube: 'yt-3' });
    expect(snap.errors.map((e) => e.platform).sort()).toEqual(['instagram', 'tiktok']);
  });

  it('records a whole-request failure as moreError without losing results', () => {
    const after = videosReducer(loaded, {
      type: 'followUpFailed',
      requestKey: KEY,
      failure: toFailure(new ApiError('network', 0, 'Could not reach the server.'), false),
      receivedAt: 2,
    });
    const snap = selectSnapshot(after, KEY, 'cats', all);
    expect(snap.moreError).toBe('Could not reach the server.');
    expect(snap.videos).toHaveLength(2);
    expect(snap.error).toBeNull();
    // A later success clears it.
    const ok = videosReducer(after, { type: 'followUpLoaded', requestKey: KEY, queried: ['tiktok'], data: list() });
    expect(selectSnapshot(ok, KEY, 'cats', all).moreError).toBeNull();
  });

  it('is not planned while busy, loading, failed, for trending, or without cursors', () => {
    const snap = selectSnapshot(loaded, KEY, 'cats', all);
    expect(planLoadMore({ ...snap, busy: 'tiktok' }, 'cats', all)).toBeNull();
    expect(planLoadMore(selectSnapshot(INITIAL_STATE, KEY, 'cats', all), 'cats', all)).toBeNull();
    expect(planLoadMore(snap, '', all)).toBeNull();
    expect(planLoadMore({ ...snap, cursors: {} }, 'cats', all)).toBeNull();
    expect(planLoadMore(snap, 'cats', ['instagram'])).toBeNull();
  });

  it('only clears busy for the matching request and action', () => {
    const busy = videosReducer(loaded, { type: 'followUpStarted', requestKey: KEY, what: 'tiktok' });
    expect(videosReducer(busy, { type: 'followUpSettled', requestKey: KEY, what: 'more' })).toBe(busy);
    expect(videosReducer(busy, { type: 'followUpSettled', requestKey: 'other', what: 'tiktok' })).toBe(busy);
    expect(selectSnapshot(busy, 'other', 'cats', all).busy).toBeNull();
  });
});

describe('retry', () => {
  it('re-requests the first page of a platform that failed on the first page', () => {
    const plan = planRetry(selectSnapshot(loaded, KEY, 'cats', all), 'cats', 'instagram');
    expect(plan).toEqual({ what: 'instagram', queried: ['instagram'], cursors: {}, platforms: ['instagram'] });
  });

  it('retries the same page when the platform still has a cursor (load-more failure)', () => {
    const plan = planRetry(selectSnapshot(loaded, KEY, 'cats', all), 'cats', 'tiktok');
    expect(plan?.cursors).toEqual({ tiktok: 20 });
  });

  it('never sends cursors for trending', () => {
    expect(planRetry(selectSnapshot(loaded, KEY, '', all), '', 'tiktok')?.cursors).toEqual({});
  });

  it('replaces the platform error with the retry outcome', () => {
    const ok = videosReducer(loaded, {
      type: 'followUpLoaded',
      requestKey: KEY,
      queried: ['instagram'],
      data: list({ videos: [makeVideo({ id: 'ig', platform: 'instagram' })], cursors: { instagram: 'ig-2' } }),
    });
    const snap = selectSnapshot(ok, KEY, 'cats', all);
    expect(snap.errors).toEqual([]);
    expect(snap.cursors).toEqual({ tiktok: 20, youtube: 'yt-2', instagram: 'ig-2' });

    const again = videosReducer(loaded, {
      type: 'followUpLoaded',
      requestKey: KEY,
      queried: ['instagram'],
      data: list({ errors: [{ platform: 'instagram', message: 'still down' }] }),
    });
    expect(selectSnapshot(again, KEY, 'cats', all).errors).toEqual([{ platform: 'instagram', message: 'still down' }]);
  });

  it('is not planned while another follow-up is running', () => {
    expect(planRetry({ ...selectSnapshot(loaded, KEY, 'cats', all), busy: 'more' }, 'cats', 'instagram')).toBeNull();
  });
});

describe('401 and the password flow', () => {
  it('marks the password rejected only when one was sent', () => {
    const err = new ApiError('unauthorized', 401, 'Password required');
    expect(toFailure(err, true).passwordRejected).toBe(true);
    expect(toFailure(err, false).passwordRejected).toBe(false);
    expect(toFailure(new ApiError('http', 502, 'x'), true).passwordRejected).toBe(false);
    expect(toFailure(new Error('boom'), true).error.kind).toBe('network');
  });

  it('is pure: reducing the same failure twice gives the same result (StrictMode)', () => {
    const action: VideosAction = {
      type: 'failed',
      requestKey: KEY,
      failure: toFailure(new ApiError('unauthorized', 401, 'Password required'), true),
      receivedAt: 1,
    };
    const a = videosReducer(INITIAL_STATE, action);
    const b = videosReducer(INITIAL_STATE, action);
    expect(a).toEqual(b);
    expect(selectSnapshot(a, KEY, 'cats', all).passwordRejected).toBe(true);
  });

  it('keeps reporting the 401 while the next request (new password) loads', () => {
    const failed = videosReducer(INITIAL_STATE, {
      type: 'failed',
      requestKey: KEY,
      failure: toFailure(new ApiError('unauthorized', 401, 'Password required'), true),
      receivedAt: 1,
    });
    const next = selectSnapshot(failed, `${KEY.slice(0, -1)}1`, 'cats', all);
    expect(next.loading).toBe(true);
    expect(next.error?.kind).toBe('unauthorized');
    expect(next.passwordRejected).toBe(false);
  });

  it('does not keep other errors across a view change', () => {
    const failed = videosReducer(INITIAL_STATE, {
      type: 'failed',
      requestKey: KEY,
      failure: toFailure(new ApiError('http', 502, 'x'), false),
      receivedAt: 1,
    });
    expect(selectSnapshot(failed, 'other', 'cats', all).error).toBeNull();
  });

  it('a 401 during load more replaces the result so the password screen shows', () => {
    const after = videosReducer(loaded, {
      type: 'followUpFailed',
      requestKey: KEY,
      failure: toFailure(new ApiError('unauthorized', 401, 'Password required'), true),
      receivedAt: 2,
    });
    const snap = selectSnapshot(after, KEY, 'cats', all);
    expect(snap.error?.kind).toBe('unauthorized');
    expect(snap.passwordRejected).toBe(true);
    expect(snap.videos).toEqual([]);
  });

  it('loadFirstPage clears a rejected password once and reports it as rejected', async () => {
    const { deps, pending, stored } = fakeDeps('wrong');
    const dispatch = vi.fn<(a: VideosAction) => void>();
    const done = loadFirstPage(deps, KEY, query, new AbortController().signal, dispatch);
    pending[0]!.reject(new ApiError('unauthorized', 401, 'Password required'));
    await done;
    expect(deps.clearPassword).toHaveBeenCalledTimes(1);
    expect(stored()).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0]![0];
    expect(action).toMatchObject({ type: 'failed', requestKey: KEY, failure: { passwordRejected: true } });
    // Dispatching the very same action twice (StrictMode) cannot lose the flag.
    const s1 = videosReducer(INITIAL_STATE, action);
    expect(selectSnapshot(videosReducer(s1, action), KEY, 'cats', all).passwordRejected).toBe(true);
  });

  it('loadFirstPage without a stored password shows the screen without the error message', async () => {
    const { deps, pending } = fakeDeps(null);
    const dispatch = vi.fn<(a: VideosAction) => void>();
    const done = loadFirstPage(deps, KEY, query, new AbortController().signal, dispatch);
    pending[0]!.reject(new ApiError('unauthorized', 401, 'Password required'));
    await done;
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ type: 'failed', failure: { passwordRejected: false } });
  });

  it('loadFollowUp clears the password on 401 and always settles busy', async () => {
    const { deps, pending } = fakeDeps('pw');
    const actions: VideosAction[] = [];
    const plan = planLoadMore(selectSnapshot(loaded, KEY, 'cats', all), 'cats', all)!;
    const done = loadFollowUp(deps, KEY, query, plan, new AbortController().signal, (a) => actions.push(a));
    expect(pending[0]!.cursors).toEqual({ tiktok: 20, youtube: 'yt-2' });
    pending[0]!.reject(new ApiError('unauthorized', 401, 'Password required'));
    await done;
    expect(deps.clearPassword).toHaveBeenCalledTimes(1);
    expect(actions.map((a) => a.type)).toEqual(['followUpStarted', 'followUpFailed', 'followUpSettled']);
    const state = run(actions, loaded);
    const snap = selectSnapshot(state, KEY, 'cats', all);
    expect(snap.error?.kind).toBe('unauthorized');
    expect(snap.passwordRejected).toBe(true);
    expect(snap.busy).toBeNull();
  });
});

describe('aborting', () => {
  it('a new view aborts the previous view and its follow-up; nothing stale is dispatched', async () => {
    const scope = new RequestScope();
    const { deps, pending } = fakeDeps();
    const dispatch = vi.fn<(a: VideosAction) => void>();

    const oldDone = loadFirstPage(deps, 'old', query, scope.startView(), dispatch);
    const followDone = loadFollowUp(
      deps,
      'old',
      query,
      { what: 'more', queried: ['tiktok'], cursors: { tiktok: 1 }, platforms: ['tiktok'] },
      scope.startFollowUp(),
      dispatch,
    );
    const newSignal = scope.startView(); // view changed
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(pending[1]!.signal.aborted).toBe(true);
    expect(newSignal.aborted).toBe(false);
    await Promise.all([oldDone, followDone]);
    // Only the follow-up's own bookkeeping, no loaded/failed results.
    expect(dispatch.mock.calls.map(([a]) => a.type)).toEqual(['followUpStarted', 'followUpSettled']);
  });

  it('drops a response that resolves after its signal was aborted', async () => {
    const { deps } = fakeDeps();
    const ctrl = new AbortController();
    const late: VideosDeps = { ...deps, request: async () => list({ videos: [makeVideo({ id: 'late' })] }) };
    const dispatch = vi.fn();
    const done = loadFirstPage(late, KEY, query, ctrl.signal, dispatch);
    ctrl.abort();
    await done;
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a new follow-up aborts the previous one but not the view', () => {
    const scope = new RequestScope();
    const view = scope.startView();
    const first = scope.startFollowUp();
    const second = scope.startFollowUp();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(view.aborted).toBe(false);
    scope.abortAll();
    expect(view.aborted && second.aborted).toBe(true);
  });

  it('passes the signal, cursors and query to the request', async () => {
    const { deps, pending } = fakeDeps();
    const dispatch = vi.fn();
    const ctrl = new AbortController();
    const done = loadFirstPage(deps, KEY, query, ctrl.signal, dispatch);
    expect(pending[0]).toMatchObject({ query, cursors: {}, signal: ctrl.signal });
    pending[0]!.resolve(firstPage);
    await done;
    expect(dispatch).toHaveBeenCalledWith({ type: 'loaded', requestKey: KEY, data: firstPage, receivedAt: 5000 });
  });
});
