// The shareable view: everything that lives in the URL query string (PRD FR-8).
// Parsing is lenient: anything unknown or invalid falls back to its default, so a
// hand-edited or stale link still opens a working view. Serializing omits defaults.
import { PLATFORMS, isPlatform, type Platform } from '../../shared/video';
import {
  DEFAULT_REGION,
  MAX_QUERY_LENGTH,
  SORT_KEYS,
  TIME_WINDOWS,
  type SortKey,
  type TimeWindow,
} from '../config';

export type ViewState = {
  /** Trimmed search text. Empty means the trending view. */
  q: string;
  /** Non-empty, in canonical PLATFORMS order. */
  platforms: Platform[];
  window: TimeWindow;
  region: string;
  sort: SortKey;
};

export const DEFAULT_VIEW: ViewState = {
  q: '',
  platforms: [...PLATFORMS],
  window: 'all',
  region: DEFAULT_REGION,
  sort: 'relevance',
};

/** Trim and cap at MAX_QUERY_LENGTH code points (the server's limit). */
export function normalizeQuery(raw: string): string {
  return Array.from(raw.trim()).slice(0, MAX_QUERY_LENGTH).join('').trim();
}

/** A query the server would accept as a search: not empty and not a bare `#`. */
export function isSearchable(q: string): boolean {
  const n = normalizeQuery(q);
  return n !== '' && n.replace(/^#+/, '').trim() !== '';
}

export function isHashtagQuery(q: string): boolean {
  return q.trim().startsWith('#');
}

export function parsePlatformList(raw: string | null): Platform[] {
  if (raw === null) return [...PLATFORMS];
  const chosen = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(isPlatform));
  const list = PLATFORMS.filter((p) => chosen.has(p));
  return list.length > 0 ? list : [...PLATFORMS];
}

function oneOf<T extends string>(values: readonly T[], raw: string | null, fallback: T): T {
  const v = raw?.trim().toLowerCase();
  return v !== undefined && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function parseRegionCode(raw: string | null): string {
  const r = (raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(r) ? r : DEFAULT_REGION;
}

export function parseViewState(search: string): ViewState {
  const sp = new URLSearchParams(search);
  const q = normalizeQuery(sp.get('q') ?? '');
  return {
    q: isSearchable(q) ? q : '',
    platforms: parsePlatformList(sp.get('platforms')),
    window: oneOf(TIME_WINDOWS, sp.get('window'), DEFAULT_VIEW.window),
    region: parseRegionCode(sp.get('region')),
    sort: oneOf(SORT_KEYS, sp.get('sort'), DEFAULT_VIEW.sort),
  };
}

/** Returns `?…` with only non-default values, or '' for the default view. */
export function serializeViewState(state: ViewState): string {
  const sp = new URLSearchParams();
  const q = normalizeQuery(state.q);
  if (isSearchable(q)) sp.set('q', q);
  const platforms = parsePlatformList(state.platforms.join(','));
  if (platforms.length !== PLATFORMS.length) sp.set('platforms', platforms.join(','));
  if (state.window !== DEFAULT_VIEW.window) sp.set('window', state.window);
  const region = parseRegionCode(state.region);
  if (region !== DEFAULT_VIEW.region) sp.set('region', region);
  if (state.sort !== DEFAULT_VIEW.sort) sp.set('sort', state.sort);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * Identifies the data a view needs. Sort is client-side, so it is not part of the key;
 * window only matters for search (trending has no window).
 */
export function fetchKey(state: ViewState): string {
  return state.q
    ? `search|${state.q}|${state.platforms.join(',')}|${state.window}|${state.region}`
    : `trending|${state.platforms.join(',')}|${state.region}`;
}
