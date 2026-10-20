import { describe, expect, it } from 'vitest';
import { makeVideo } from './testVideos';
import { mergeVideos, nextCursors, windowCaveat } from './videos';

describe('mergeVideos', () => {
  it('appends and drops platform+id duplicates', () => {
    const a = makeVideo({ id: '1' });
    const b = makeVideo({ id: '1', platform: 'youtube' });
    const out = mergeVideos([a], [makeVideo({ id: '1' }), b, makeVideo({ id: '2' }), makeVideo({ id: '2' })]);
    expect(out.map((v) => `${v.platform}:${v.id}`)).toEqual(['tiktok:1', 'youtube:1', 'tiktok:2']);
  });
});

describe('nextCursors', () => {
  it('advances, keeps failed platforms, drops finished ones, leaves others alone', () => {
    const prev = { tiktok: 20, instagram: '2', youtube: 'abc' };
    const out = nextCursors(
      prev,
      { cursors: { tiktok: 40 }, errors: [{ platform: 'instagram' }] },
      ['tiktok', 'instagram'],
    );
    expect(out).toEqual({ tiktok: 40, instagram: '2', youtube: 'abc' });
    expect(nextCursors(prev, { cursors: {}, errors: [] }, ['youtube'])).toEqual({ tiktok: 20, instagram: '2' });
  });
});

describe('windowCaveat', () => {
  it('is empty for trending and "any time"', () => {
    expect(windowCaveat('tiktok', { q: '', window: 'week' })).toBeUndefined();
    expect(windowCaveat('tiktok', { q: '#cats', window: 'all' })).toBeUndefined();
  });
  it('flags hashtag searches on TikTok and YouTube', () => {
    expect(windowCaveat('tiktok', { q: '#cats', window: 'week' })).toBe('Any time');
    expect(windowCaveat('youtube', { q: '#cats', window: 'today' })).toBe('Any time');
    expect(windowCaveat('instagram', { q: '#cats', window: 'week' })).toBeUndefined();
  });
  it('flags Instagram "today" as this week', () => {
    expect(windowCaveat('instagram', { q: 'cats', window: 'today' })).toBe('This week');
    expect(windowCaveat('tiktok', { q: 'cats', window: 'today' })).toBeUndefined();
  });
});
