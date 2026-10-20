// Keeps the ViewState in the URL query string (PRD FR-8). The URL is the single source
// of truth: components read it through this hook and change it through `update`.
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { parseViewState, serializeViewState, type ViewState } from '../lib/viewState';

const URL_CHANGE = 'trendscout:urlchange';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(URL_CHANGE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(URL_CHANGE, onChange);
  };
}

const getSearch = () => window.location.search;

export type UpdateOptions = {
  /** Replace the current history entry instead of adding one (used for sort changes). */
  replace?: boolean;
};

export function useUrlState(): [ViewState, (patch: Partial<ViewState>, opts?: UpdateOptions) => void] {
  const search = useSyncExternalStore(subscribe, getSearch, getSearch);
  const state = useMemo(() => parseViewState(search), [search]);

  const update = useCallback((patch: Partial<ViewState>, opts: UpdateOptions = {}) => {
    const current = parseViewState(window.location.search);
    const next = serializeViewState({ ...current, ...patch });
    if (next === serializeViewState(current) && next === window.location.search) return;
    const url = `${window.location.pathname}${next}${window.location.hash}`;
    if (opts.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    window.dispatchEvent(new Event(URL_CHANGE));
  }, []);

  return [state, update];
}
