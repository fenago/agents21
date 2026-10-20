import { describe, expect, it } from 'vitest';
import { PLATFORM_LABEL, buildListResponse, platformErrorMessage, roundRobinMerge } from '../../netlify/functions/lib/fanout';
import { ScrapeCreatorsError, type ScrapeCreatorsErrorCode } from '../../netlify/functions/lib/scrapecreators';
import { video } from './helpers';

describe('roundRobinMerge', () => {
  it('interleaves platforms one item at a time, continuing with the longer lists', () => {
    const merged = roundRobinMerge([
      [video('tiktok', 't1'), video('tiktok', 't2'), video('tiktok', 't3')],
      [video('instagram', 'i1')],
      [video('youtube', 'y1'), video('youtube', 'y2')],
    ]);
    expect(merged.map((v) => v.id)).toEqual(['t1', 'i1', 'y1', 't2', 'y2', 't3']);
  });

  it('handles empty input and drops repeated platform+id pairs only', () => {
    expect(roundRobinMerge([])).toEqual([]);
    const merged = roundRobinMerge([
      [video('tiktok', '1'), video('tiktok', '1')],
      [video('youtube', '1')],
    ]);
    expect(merged.map((v) => `${v.platform}:${v.id}`)).toEqual(['tiktok:1', 'youtube:1']);
  });
});

describe('platform error messages', () => {
  const codes: ScrapeCreatorsErrorCode[] = [
    'missing_key',
    'bad_request',
    'unauthorized',
    'out_of_credits',
    'forbidden',
    'not_found',
    'upstream',
    'timeout',
  ];

  it('maps out_of_credits to a clear message', () => {
    expect(platformErrorMessage('tiktok', 'out_of_credits')).toBe('Out of Scrape Creators credits');
  });

  it.each(codes)('%s has a fixed message with no internals', (code) => {
    const msg = platformErrorMessage('youtube', code);
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/\/v\d\/|api\.scrapecreators|x-api-key/i);
  });

  it('buildListResponse never forwards raw error text and drops unsafe videos', () => {
    const res = buildListResponse([
      { platform: 'tiktok', ok: false, code: 'upstream' },
      {
        platform: 'youtube',
        ok: true,
        cached: false,
        result: { videos: [video('youtube', 'ok'), video('youtube', 'bad', { url: 'javascript:x' })], cursor: 'next' },
      },
    ]);
    expect(res).toEqual({
      videos: [video('youtube', 'ok')],
      cursors: { youtube: 'next' },
      errors: [{ platform: 'tiktok', code: 'upstream', message: `${PLATFORM_LABEL.tiktok} is temporarily unavailable` }],
    });
    // Sanity: a real ScrapeCreatorsError's message holds the upstream path, which must not leak.
    expect(new ScrapeCreatorsError('upstream', 500, 'Scrape Creators /v1/x failed').message).toContain('/v1/');
  });
});
