import { describe, expect, it } from 'vitest';
import { csvFilename, escapeCsvCell, toCsv } from './csv';
import { makeVideo } from './testVideos';

describe('escapeCsvCell', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(NaN)).toBe('');
  });

  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('cr\r')).toBe('"cr\r"');
  });

  it.each(['=SUM(A1)', '+1', '-1+2', '@cmd', '\tx', '\rx'])('neutralises formula-like text %j', (s) => {
    const out = escapeCsvCell(s);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('combines the formula guard with quoting', () => {
    expect(escapeCsvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });
});

describe('toCsv', () => {
  it('writes a header and one row per video with engagement', () => {
    const csv = toCsv([
      makeVideo({
        id: '1',
        platform: 'youtube',
        title: 'Cats, "best" of',
        author: { handle: '@cat' },
        stats: { views: 200, likes: 20, comments: 5 },
        postedAt: '2026-10-20T12:00:00.000Z',
        url: 'https://youtube.com/shorts/1',
      }),
      makeVideo({ id: '2', title: '=cmd()', author: { handle: 'x' }, stats: {} }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('platform,title,author,views,likes,comments,engagement,postedAt,url');
    expect(lines[1]).toBe('youtube,"Cats, ""best"" of",cat,200,20,5,0.125,2026-10-20T12:00:00.000Z,https://youtube.com/shorts/1');
    expect(lines[2]).toBe("tiktok,'=cmd(),x,,,,,,https://example.com/2");
    expect(lines[3]).toBe('');
  });
});

describe('csvFilename', () => {
  const now = new Date('2026-10-20T08:00:00Z');
  it('names trending and search exports', () => {
    expect(csvFilename('', now)).toBe('trendscout-trending-2026-10-20.csv');
    expect(csvFilename('#BookTok', now)).toBe('trendscout-search-booktok-2026-10-20.csv');
    expect(csvFilename('Café / ../etc', now)).toBe('trendscout-search-cafe-etc-2026-10-20.csv');
    expect(csvFilename('🔥', now)).toBe('trendscout-search-results-2026-10-20.csv');
  });
});
