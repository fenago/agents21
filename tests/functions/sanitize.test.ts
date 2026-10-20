import { describe, expect, it } from 'vitest';
import { isHttpsUrl, sanitizeVideo, sanitizeVideos } from '../../netlify/functions/lib/sanitize';
import { video } from './helpers';

describe('isHttpsUrl', () => {
  it.each([
    ['https://www.tiktok.com/@a/video/1', true],
    ['HTTPS://EXAMPLE.COM/x', true],
    ['http://example.com', false],
    ['javascript:alert(1)', false],
    ['JaVaScRiPt:alert(1)', false],
    ['data:image/png;base64,AAAA', false],
    ['//example.com/x', false],
    ['/relative', false],
    ['', false],
    [undefined, false],
    [42, false],
  ])('%j → %s', (value, expected) => {
    expect(isHttpsUrl(value)).toBe(expected);
  });
});

describe('sanitizeVideo', () => {
  it('passes a fully https video through unchanged (as a copy)', () => {
    const v = video('tiktok', '1');
    const out = sanitizeVideo(v);
    expect(out).toEqual(v);
    expect(out).not.toBe(v);
  });

  it('drops a video whose url is not https', () => {
    expect(sanitizeVideo(video('tiktok', '1', { url: 'javascript:alert(1)' }))).toBeUndefined();
    expect(sanitizeVideo(video('tiktok', '1', { url: 'http://www.tiktok.com/x' }))).toBeUndefined();
  });

  it('blanks a non-https thumbnail and removes non-https author avatar/url without mutating the input', () => {
    const v = video('youtube', '1', {
      thumbnail: 'data:image/svg+xml,<svg onload=alert(1)>',
      author: { handle: 'h', name: 'N', avatar: 'http://insecure/a.jpg', url: 'javascript:void(0)' },
    });
    const snapshot = structuredClone(v);
    expect(sanitizeVideo(v)).toEqual({ ...v, thumbnail: '', author: { handle: 'h', name: 'N' } });
    expect(v).toEqual(snapshot);
  });

  it('sanitizeVideos filters the list', () => {
    const list = [video('tiktok', '1'), video('tiktok', '2', { url: 'ftp://x' }), video('tiktok', '3')];
    expect(sanitizeVideos(list).map((v) => v.id)).toEqual(['1', '3']);
  });
});
