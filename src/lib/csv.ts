// CSV export of the visible results (PRD FR-12).
import { engagementRate, type Video } from '../../shared/video';
import { cleanHandle } from './format';

export const CSV_COLUMNS = ['platform', 'title', 'author', 'views', 'likes', 'comments', 'engagement', 'postedAt', 'url'] as const;

// Cells starting with these can be run as formulas by spreadsheet apps (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/** Quote a cell when needed and neutralise formula-like text by prefixing `'`. */
export function escapeCsvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = value;
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function videoToRow(v: Video): (string | number | undefined)[] {
  const rate = engagementRate(v.stats);
  return [
    v.platform,
    v.title,
    cleanHandle(v.author.handle),
    v.stats.views,
    v.stats.likes,
    v.stats.comments,
    rate === undefined ? undefined : Number(rate.toFixed(6)),
    v.postedAt,
    v.url,
  ];
}

/** RFC 4180 style: CRLF line endings, header row first. */
export function toCsv(videos: readonly Video[]): string {
  const lines = [CSV_COLUMNS.join(','), ...videos.map((v) => videoToRow(v).map(escapeCsvCell).join(','))];
  return lines.join('\r\n') + '\r\n';
}

/** e.g. "trendscout-search-booktok-2026-10-20.csv" or "trendscout-trending-2026-10-20.csv". */
export function csvFilename(q: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const slug = q
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!q.trim()) return `trendscout-trending-${date}.csv`;
  return `trendscout-search-${slug || 'results'}-${date}.csv`;
}
