import { describe, expect, it } from 'vitest';
import { sortVideos } from './sort';
import { makeVideo } from './testVideos';

const a = makeVideo({ id: 'a', stats: { views: 100, likes: 10, comments: 0 }, postedAt: '2026-10-01T00:00:00Z' });
const b = makeVideo({ id: 'b', stats: { views: 1000, likes: 50, comments: 50 }, postedAt: '2026-10-10T00:00:00Z' });
const c = makeVideo({ id: 'c', stats: { likes: 500 }, postedAt: 'garbage' });
const d = makeVideo({ id: 'd', stats: { views: 10, likes: 5, comments: 1 } });
const list = [a, b, c, d];
const ids = (vs: { id: string }[]) => vs.map((v) => v.id).join('');

describe('sortVideos', () => {
  it('keeps API order for relevance and returns a copy', () => {
    const out = sortVideos(list, 'relevance');
    expect(ids(out)).toBe('abcd');
    expect(out).not.toBe(list);
  });

  it('sorts by views descending, missing last', () => expect(ids(sortVideos(list, 'views'))).toBe('badc'));
  it('sorts by likes descending', () => expect(ids(sortVideos(list, 'likes'))).toBe('cbad'));
  it('sorts by comments, missing last, ties stable', () => expect(ids(sortVideos(list, 'comments'))).toBe('bdac'));
  it('sorts newest first; invalid or missing dates last', () => expect(ids(sortVideos(list, 'newest'))).toBe('bacd'));

  it('sorts by engagement rate; no views → last', () => {
    // d: 6/10 = 0.6, a: 10/100 = 0.1, b: 100/1000 = 0.1 (tie keeps order), c: no views
    expect(ids(sortVideos(list, 'engagement'))).toBe('dabc');
  });

  it('does not mutate the input', () => {
    sortVideos(list, 'views');
    expect(ids(list)).toBe('abcd');
  });
});
