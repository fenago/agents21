import { describe, expect, it } from 'vitest';
import { cleanHandle, formatCompact, formatDuration, formatFull, formatPercent, formatRelative } from './format';

describe('formatCompact', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [1234, '1.2K'],
    [12_345, '12.3K'],
    [1_250_000, '1.3M'],
    [1_000_000, '1M'],
    [2_500_000_000, '2.5B'],
  ])('%d → %s', (n, out) => expect(formatCompact(n)).toBe(out));

  it('shows a dash for missing or invalid values', () => {
    expect(formatCompact(undefined)).toBe('–');
    expect(formatCompact(NaN)).toBe('–');
    expect(formatCompact(-5)).toBe('–');
  });
});

describe('formatFull / formatPercent', () => {
  it('groups thousands', () => expect(formatFull(1234567)).toBe('1,234,567'));
  it('formats ratios', () => {
    expect(formatPercent(0.0523)).toBe('5.2%');
    expect(formatPercent(0.25)).toBe('25%');
    expect(formatPercent(undefined)).toBe('–');
  });
});

describe('formatRelative', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it.each([
    ['2026-10-20T11:59:30Z', 'just now'],
    ['2026-10-20T11:55:00Z', '5m ago'],
    ['2026-10-20T09:00:00Z', '3h ago'],
    ['2026-10-18T12:00:00Z', '2d ago'],
    ['2026-09-29T12:00:00Z', '3w ago'],
    ['2026-06-20T12:00:00Z', '4mo ago'],
    ['2024-10-01T12:00:00Z', '2y ago'],
    ['2026-10-21T12:00:00Z', 'just now'],
  ])('%s → %s', (iso, out) => expect(formatRelative(iso, now)).toBe(out));

  it('returns empty for missing or invalid dates', () => {
    expect(formatRelative(undefined, now)).toBe('');
    expect(formatRelative('not a date', now)).toBe('');
  });
});

describe('formatDuration / cleanHandle', () => {
  it('formats durations', () => {
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });
  it('strips leading @', () => {
    expect(cleanHandle('@@cats')).toBe('cats');
    expect(cleanHandle(' cats ')).toBe('cats');
    expect(cleanHandle(undefined)).toBe('');
  });
});
