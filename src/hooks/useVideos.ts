// Loads the videos for the current view (trending or search), with load-more,
// per-platform retry and full reload. The logic lives in lib/videosState (pure reducer,
// planners and runners); this hook wires it to React. Every request is aborted when the
// view changes, and results are tagged with the request they belong to, so a slow old
// response can never overwrite a newer one.
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { Platform } from '../../shared/video';
import { clearPassword, fetchSearch, fetchTrending, getPassword } from '../api';
import type { TimeWindow } from '../config';
import { fetchKey, type ViewState } from '../lib/viewState';
import {
  INITIAL_STATE,
  RequestScope,
  loadFirstPage,
  loadFollowUp,
  planLoadMore,
  planRetry,
  selectSnapshot,
  videosReducer,
  type Query,
  type VideosDeps,
  type VideosSnapshot,
} from '../lib/videosState';

export type { Busy } from '../lib/videosState';

export type VideosState = VideosSnapshot & {
  loadMore: () => void;
  retry: (platform: Platform) => void;
  reload: () => void;
};

const deps: VideosDeps = {
  request: (query, cursors, signal) =>
    query.q
      ? fetchSearch(query, cursors, { signal })
      : fetchTrending({ platforms: query.platforms, region: query.region }, { signal }),
  getPassword,
  clearPassword,
  now: () => Date.now(),
};

export function useVideos(view: ViewState): VideosState {
  const [nonce, setNonce] = useState(0);
  const [state, dispatch] = useReducer(videosReducer, INITIAL_STATE);
  const [scope] = useState(() => new RequestScope());

  const { q, region } = view;
  const timeWindow: TimeWindow = q ? view.window : 'all';
  const platformsKey = view.platforms.join(',');
  const requestKey = `${fetchKey({ ...view, window: timeWindow })}#${nonce}`;

  useEffect(() => {
    const query: Query = { q, platforms: platformsKey.split(',') as Platform[], window: timeWindow, region };
    void loadFirstPage(deps, requestKey, query, scope.startView(), dispatch);
    return () => scope.abortAll();
  }, [scope, requestKey, q, platformsKey, timeWindow, region]);

  const snapshot = useMemo(
    () => selectSnapshot(state, requestKey, q, view.platforms),
    [state, requestKey, q, view.platforms],
  );

  const loadMore = useCallback(() => {
    const plan = planLoadMore(snapshot, q, view.platforms);
    if (plan) void loadFollowUp(deps, requestKey, { q, window: timeWindow, region }, plan, scope.startFollowUp(), dispatch);
  }, [snapshot, q, view.platforms, requestKey, timeWindow, region, scope]);

  const retry = useCallback(
    (platform: Platform) => {
      const plan = planRetry(snapshot, q, platform);
      if (plan) void loadFollowUp(deps, requestKey, { q, window: timeWindow, region }, plan, scope.startFollowUp(), dispatch);
    },
    [snapshot, q, requestKey, timeWindow, region, scope],
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { ...snapshot, loadMore, retry, reload };
}
