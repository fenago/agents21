// Display formatting for stats and dates (PRD FR-9).

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

/** 1234 → "1.2K", 1_250_000 → "1.3M". Missing or invalid → "–". */
export function formatCompact(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return '–';
  return compact.format(n);
}

/** 1234567 → "1,234,567". */
export function formatFull(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–';
  return full.format(n);
}

/** 0.0523 → "5.2%". Values under 10% get one decimal, larger ones none. */
export function formatPercent(ratio: number | undefined): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return '–';
  const pct = ratio * 100;
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function parseDate(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/** "just now", "5m ago", "3h ago", "2d ago", "3w ago", "4mo ago", "2y ago". Invalid → ''. */
export function formatRelative(iso: string | undefined, now: number = Date.now()): string {
  const t = parseDate(iso);
  if (t === undefined) return '';
  const diff = now - t;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / (7 * DAY))}w ago`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo ago`;
  return `${Math.floor(diff / (365 * DAY))}y ago`;
}

/** Full date for tooltips and screen readers, e.g. "Oct 20, 2026". Invalid → ''. */
export function formatDate(iso: string | undefined): string {
  const t = parseDate(iso);
  if (t === undefined) return '';
  return new Date(t).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** 42 → "0:42", 3725 → "1:02:05". Missing or invalid → ''. */
export function formatDuration(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Strip any leading "@" so the UI can add exactly one. */
export function cleanHandle(handle: string | undefined): string {
  return (handle ?? '').trim().replace(/^@+/, '');
}
