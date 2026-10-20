// Defensive readers for untyped upstream JSON. None of these throw on any input.
import type { Video } from '../../../../shared/video';

type Key = string | number;

/** Safe deep read: `at(obj, 'video', 'cover', 'url_list', 0)`. */
export function at(value: unknown, ...path: Key[]): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<Key, unknown>)[key];
  }
  return cur;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Non-empty trimmed string, or undefined. Numbers are stringified (ids can arrive as numbers). */
export function str(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const s = value.trim();
    return s ? s : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function firstStr(...values: unknown[]): string | undefined {
  for (const v of values) {
    const s = str(v);
    if (s !== undefined) return s;
  }
  return undefined;
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * Coerce a count to a non-negative finite number. Accepts numbers, numeric strings,
 * "1,234", "1,234 views", "750K", "1.2M". Anything else is undefined.
 */
export function toNum(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /^\s*([\d.,]+)\s*([kmb])?\b/i.exec(value);
  if (!m || !m[1]) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return undefined;
  const mult = m[2] ? (SUFFIX[m[2].toLowerCase()] ?? 1) : 1;
  return Math.round(n * mult);
}

export function firstNum(...values: unknown[]): number | undefined {
  for (const v of values) {
    const n = toNum(v);
    if (n !== undefined) return n;
  }
  return undefined;
}

/**
 * Convert a timestamp to ISO 8601. Numbers (or digit-only strings) are unix seconds,
 * or milliseconds when they are too large to be seconds. Other strings go through Date.
 */
export function toIso(value: unknown): string | undefined {
  let ms: number | undefined;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    ms = n < 1e12 ? n * 1000 : n;
  } else if (typeof value === 'string' && value.trim()) {
    ms = Date.parse(value);
  }
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

export function firstIso(...values: unknown[]): string | undefined {
  for (const v of values) {
    const iso = toIso(v);
    if (iso !== undefined) return iso;
  }
  return undefined;
}

/** Keep the first occurrence of each id. */
export function dedupeById(videos: Video[]): Video[] {
  const seen = new Set<string>();
  return videos.filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

/** Drop keys whose value is undefined so normalized objects stay compact and deep-equal friendly. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

/** Strip a leading `#` (and whitespace inside the tag). Returns undefined when the query is not a hashtag. */
export function hashtagOf(query: string): string | undefined {
  const q = query.trim();
  if (!q.startsWith('#')) return undefined;
  return q.replace(/^#+/, '').replace(/\s+/g, '');
}
