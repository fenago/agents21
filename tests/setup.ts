import { vi } from 'vitest';

// Tests must never reach the network (and spend Scrape Creators credits). Inject fetchImpl instead.
vi.stubGlobal('fetch', () => {
  throw new Error('network disabled in tests — inject fetchImpl');
});
