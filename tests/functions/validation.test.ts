import { describe, expect, it } from 'vitest';
import {
  parseCursor,
  parsePlatforms,
  parseQuery,
  parseRegion,
  parseWindow,
  platformsToQuery,
  validateSearch,
  validateTrending,
} from '../../netlify/functions/lib/validation';

const url = (qs: string) => new URL(`https://t.test/api/x?${qs}`);

describe('parseQuery', () => {
  it.each([
    ['cats', 'cats'],
    ['  cats  ', 'cats'],
    ['#fyp', '#fyp'],
    ['a'.repeat(100), 'a'.repeat(100)],
    ['😀'.repeat(100), '😀'.repeat(100)],
  ])('accepts %j', (raw, expected) => {
    expect(parseQuery(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([[null], [''], ['   '], ['a'.repeat(101)], ['😀'.repeat(101)]])('rejects %j', (raw) => {
    const r = parseQuery(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('q');
  });
});

describe('parsePlatforms', () => {
  it('defaults to all platforms', () => {
    expect(parsePlatforms(null)).toEqual({ ok: true, value: ['tiktok', 'instagram', 'youtube'] });
  });

  it('dedupes, trims, lowercases and returns canonical order', () => {
    expect(parsePlatforms(' YouTube,tiktok,youtube ,')).toEqual({ ok: true, value: ['tiktok', 'youtube'] });
  });

  it.each([[''], [','], ['facebook'], ['tiktok,reddit'], ['__proto__']])('rejects %j', (raw) => {
    const r = parsePlatforms(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('platforms');
  });
});

describe('parseRegion', () => {
  it('defaults to US and uppercases', () => {
    expect(parseRegion(null)).toEqual({ ok: true, value: 'US' });
    expect(parseRegion('gb')).toEqual({ ok: true, value: 'GB' });
  });

  it.each([[''], ['USA'], ['U'], ['1A'], ['U$'], ['u s']])('rejects %j', (raw) => {
    const r = parseRegion(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('region');
  });
});

describe('parseWindow', () => {
  it.each(['today', 'week', 'month', 'all', 'WEEK'])('accepts %j', (raw) => {
    expect(parseWindow(raw)).toEqual({ ok: true, value: raw.toLowerCase() });
  });

  it('defaults to all', () => {
    expect(parseWindow(null)).toEqual({ ok: true, value: 'all' });
  });

  it.each([[''], ['year'], ['this-week']])('rejects %j', (raw) => {
    const r = parseWindow(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe('window');
  });
});

describe('parseCursor', () => {
  it('accepts opaque cursors up to 2000 chars', () => {
    expect(parseCursor('youtube', 'x'.repeat(2000)).ok).toBe(true);
    expect(parseCursor('tiktok', '20').ok).toBe(true);
  });

  it('rejects cursors over 2000 chars or with control characters', () => {
    expect(parseCursor('youtube', 'x'.repeat(2001))).toMatchObject({ ok: false, error: { field: 'cursor_youtube' } });
    expect(parseCursor('tiktok', 'ab\ncd')).toMatchObject({ ok: false, error: { field: 'cursor_tiktok' } });
  });

  it.each(['2', '7', '11'])('accepts Instagram page %s', (raw) => {
    expect(parseCursor('instagram', raw).ok).toBe(true);
  });

  it.each(['0', '1', '12', '2.5', '-3', 'abc', '1e1', ' 3'])('rejects Instagram page %j', (raw) => {
    expect(parseCursor('instagram', raw)).toMatchObject({ ok: false, error: { field: 'cursor_instagram' } });
  });
});

describe('validateTrending', () => {
  it('applies defaults', () => {
    expect(validateTrending(url(''))).toEqual({
      ok: true,
      value: { platforms: ['tiktok', 'instagram', 'youtube'], region: 'US' },
    });
  });

  it('reports the failing field', () => {
    expect(validateTrending(url('region=xyz'))).toMatchObject({ ok: false, error: { field: 'region' } });
    expect(validateTrending(url('platforms=myspace'))).toMatchObject({ ok: false, error: { field: 'platforms' } });
  });
});

describe('validateSearch', () => {
  it('parses a full first-page search', () => {
    expect(validateSearch(url('q=%20cats%20&platforms=youtube,tiktok&window=week&region=de'))).toEqual({
      ok: true,
      value: { q: 'cats', platforms: ['tiktok', 'youtube'], window: 'week', region: 'DE', cursors: {} },
    });
  });

  it('requires q', () => {
    expect(validateSearch(url('platforms=tiktok'))).toMatchObject({ ok: false, error: { field: 'q' } });
  });

  it('collects per-platform cursors and ignores empty ones', () => {
    const r = validateSearch(url('q=cats&cursor_tiktok=30&cursor_instagram=3&cursor_youtube='));
    expect(r).toMatchObject({ ok: true, value: { cursors: { tiktok: '30', instagram: '3' } } });
  });

  it('rejects unknown cursor params, duplicates and cursors for unselected platforms', () => {
    expect(validateSearch(url('q=cats&cursor_facebook=1'))).toMatchObject({ ok: false, error: { field: 'cursor_facebook' } });
    expect(validateSearch(url('q=cats&cursor_tiktok=1&cursor_tiktok=2'))).toMatchObject({
      ok: false,
      error: { field: 'cursor_tiktok' },
    });
    expect(validateSearch(url('q=cats&platforms=youtube&cursor_tiktok=1'))).toMatchObject({
      ok: false,
      error: { field: 'cursor_tiktok' },
    });
    expect(validateSearch(url('q=cats&cursor_instagram=1'))).toMatchObject({ ok: false, error: { field: 'cursor_instagram' } });
  });
});

describe('platformsToQuery', () => {
  const base = { q: 'x', window: 'all' as const, region: 'US', platforms: ['tiktok', 'instagram', 'youtube'] as const };

  it('queries every selected platform on a first page', () => {
    expect(platformsToQuery({ ...base, platforms: [...base.platforms], cursors: {} })).toEqual([
      'tiktok',
      'instagram',
      'youtube',
    ]);
  });

  it('queries only platforms with a cursor on load-more', () => {
    expect(platformsToQuery({ ...base, platforms: [...base.platforms], cursors: { youtube: 'tok' } })).toEqual(['youtube']);
  });
});
