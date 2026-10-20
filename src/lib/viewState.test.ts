import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, fetchKey, isSearchable, parseViewState, serializeViewState } from './viewState';

describe('parseViewState', () => {
  it('defaults to the trending view', () => {
    expect(parseViewState('')).toEqual(DEFAULT_VIEW);
  });

  it('reads every field', () => {
    expect(parseViewState('?q=cats&platforms=youtube,tiktok&window=week&region=gb&sort=views')).toEqual({
      q: 'cats',
      platforms: ['tiktok', 'youtube'],
      window: 'week',
      region: 'GB',
      sort: 'views',
    });
  });

  it('falls back on invalid values', () => {
    expect(parseViewState('?platforms=myspace,&window=decade&region=USA&sort=random')).toEqual(DEFAULT_VIEW);
    expect(parseViewState('?platforms=')).toEqual(DEFAULT_VIEW);
  });

  it('ignores unknown platforms but keeps valid ones, deduped', () => {
    expect(parseViewState('?platforms=INSTAGRAM,foo,instagram').platforms).toEqual(['instagram']);
  });

  it('trims the query, drops a bare #, and caps at 100 code points', () => {
    expect(parseViewState('?q=%20%20cats%20').q).toBe('cats');
    expect(parseViewState('?q=%23').q).toBe('');
    expect(parseViewState(`?q=${'😀'.repeat(150)}`).q).toBe('😀'.repeat(100));
  });
});

describe('serializeViewState', () => {
  it('omits defaults', () => {
    expect(serializeViewState(DEFAULT_VIEW)).toBe('');
  });

  it('round-trips a full view', () => {
    const view = { q: '#booktok', platforms: ['instagram' as const], window: 'month' as const, region: 'DE', sort: 'engagement' as const };
    const s = serializeViewState(view);
    expect(s).toBe('?q=%23booktok&platforms=instagram&window=month&region=DE&sort=engagement');
    expect(parseViewState(s)).toEqual(view);
  });

  it('never writes an empty platform list', () => {
    expect(serializeViewState({ ...DEFAULT_VIEW, platforms: [] })).toBe('');
  });
});

describe('isSearchable / fetchKey', () => {
  it('rejects empty and bare-hash queries', () => {
    expect(isSearchable('')).toBe(false);
    expect(isSearchable(' # ')).toBe(false);
    expect(isSearchable('#a')).toBe(true);
  });

  it('ignores sort, and window for trending', () => {
    expect(fetchKey({ ...DEFAULT_VIEW, sort: 'views' })).toBe(fetchKey(DEFAULT_VIEW));
    expect(fetchKey({ ...DEFAULT_VIEW, window: 'week' })).toBe(fetchKey(DEFAULT_VIEW));
    expect(fetchKey({ ...DEFAULT_VIEW, q: 'a', window: 'week' })).not.toBe(fetchKey({ ...DEFAULT_VIEW, q: 'a' }));
  });
});
