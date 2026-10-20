import { describe, expect, it } from 'vitest';
import { engagementRate, isPlatform } from '../shared/video';

describe('isPlatform', () => {
  it('accepts supported platforms', () => {
    expect(isPlatform('tiktok')).toBe(true);
    expect(isPlatform('instagram')).toBe(true);
    expect(isPlatform('youtube')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPlatform('facebook')).toBe(false);
    expect(isPlatform('')).toBe(false);
    expect(isPlatform(undefined)).toBe(false);
  });
});

describe('engagementRate', () => {
  it('is (likes + comments) / views', () => {
    expect(engagementRate({ views: 1000, likes: 80, comments: 20 })).toBeCloseTo(0.1);
  });

  it('treats missing likes/comments as zero', () => {
    expect(engagementRate({ views: 100, likes: 5 })).toBeCloseTo(0.05);
  });

  it('is undefined without views', () => {
    expect(engagementRate({ likes: 10 })).toBeUndefined();
    expect(engagementRate({ views: 0, likes: 10 })).toBeUndefined();
  });
});
