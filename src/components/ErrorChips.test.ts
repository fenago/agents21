import { describe, expect, it } from 'vitest';
import { canRetry } from './ErrorChips';

describe('canRetry', () => {
  it('offers Retry for transient errors, including rate limits', () => {
    for (const code of ['timeout', 'upstream', 'rate_limited', undefined]) {
      expect(canRetry({ platform: 'tiktok', message: 'x', code })).toBe(true);
    }
  });

  it('hides Retry where retrying cannot help', () => {
    for (const code of ['out_of_credits', 'missing_key', 'unauthorized']) {
      expect(canRetry({ platform: 'tiktok', message: 'x', code })).toBe(false);
    }
  });
});
