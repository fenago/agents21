import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adapters } from '../../netlify/functions/lib/adapters';
import { compact, dedupeById, hashtagOf, toIso, toNum } from '../../netlify/functions/lib/adapters/normalize-utils';
import { PLATFORMS } from '../../shared/video';

describe('adapter registry', () => {
  it('has one adapter per platform, keyed correctly', () => {
    expect(Object.keys(adapters).sort()).toEqual([...PLATFORMS].sort());
    for (const platform of PLATFORMS) {
      expect(adapters[platform].platform).toBe(platform);
      expect(typeof adapters[platform].trending).toBe('function');
      expect(typeof adapters[platform].search).toBe('function');
    }
  });

  it('netlify/functions/lib is never deployed as a function (no index.* or lib.* inside it)', () => {
    const dir = fileURLToPath(new URL('../../netlify/functions/lib', import.meta.url));
    expect(existsSync(dir)).toBe(true);
    const offenders = readdirSync(dir).filter((f) => /^(index|lib)\.[cm]?[jt]sx?$/.test(f));
    expect(offenders).toEqual([]);
  });
});

describe('normalize utils', () => {
  it.each([
    [123, 123],
    ['1,234', 1234],
    ['14,860,541 views', 14860541],
    ['750K', 750000],
    ['1.2M views', 1200000],
    ['2B', 2000000000],
    ['12 billion', 12],
    [null, undefined],
    [undefined, undefined],
    ['', undefined],
    ['n/a', undefined],
    [-5, undefined],
    [Number.NaN, undefined],
    [{}, undefined],
  ] as const)('toNum(%j) -> %j', (input, expected) => {
    expect(toNum(input)).toBe(expected);
  });

  it.each([
    [1597719521, '2020-08-18T02:58:41.000Z'],
    ['1597719521', '2020-08-18T02:58:41.000Z'],
    [1597719521000, '2020-08-18T02:58:41.000Z'],
    ['2025-08-07T13:00:22-07:00', '2025-08-07T20:00:22.000Z'],
    ['4 weeks ago', undefined],
    [0, undefined],
    [null, undefined],
  ] as const)('toIso(%j) -> %j', (input, expected) => {
    expect(toIso(input)).toBe(expected);
  });

  it('hashtagOf strips # and inner whitespace, and ignores plain queries', () => {
    expect(hashtagOf('#fyp')).toBe('fyp');
    expect(hashtagOf('  ##cat videos ')).toBe('catvideos');
    expect(hashtagOf('#')).toBe('');
    expect(hashtagOf('cats #fyp')).toBeUndefined();
  });

  it('dedupeById keeps the first occurrence; compact drops undefined keys', () => {
    const base = { platform: 'tiktok' as const, url: 'u', thumbnail: '', title: '', author: { handle: 'h' }, stats: {} };
    const out = dedupeById([
      { ...base, id: '1', title: 'first' },
      { ...base, id: '2' },
      { ...base, id: '1', title: 'second' },
    ]);
    expect(out.map((v) => [v.id, v.title])).toEqual([
      ['1', 'first'],
      ['2', ''],
    ]);
    expect(compact({ a: 1, b: undefined })).toEqual({ a: 1 });
    expect('b' in compact({ a: 1, b: undefined })).toBe(false);
  });
});
