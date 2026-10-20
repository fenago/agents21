import { describe, expect, it, vi } from 'vitest';
import { createCreditsHandler, parseCreditBalance } from '../../netlify/functions/credits';
import { ScrapeCreatorsError } from '../../netlify/functions/lib/scrapecreators';
import { body, brokenStore, get, memoryStore } from './helpers';

const quiet = () => {};
// Response example from the Scrape Creators docs page for /v1/account/credit-balance.
const DOCS_EXAMPLE = { success: true, credits_remaining: 1000000, credits_charged: 1, creditCount: 333 };

describe('parseCreditBalance', () => {
  it.each([
    [DOCS_EXAMPLE, 333],
    [{ credits_remaining: 42 }, 42],
    [{ creditCount: '17' }, 17],
    [{ creditCount: 0 }, 0],
    [{ creditCount: null, credits_remaining: 5 }, 5],
    [{}, null],
    [{ creditCount: 'lots' }, null],
    [{ creditCount: -1 }, null],
    [null, null],
    ['333', null],
  ])('%j → %j', (raw, expected) => {
    expect(parseCreditBalance(raw)).toBe(expected);
  });
});

describe('GET /api/credits', () => {
  it('returns { credits } and caches it for 10 minutes', async () => {
    let t = 0;
    const fetchBalance = vi.fn(async () => DOCS_EXAMPLE);
    const handler = createCreditsHandler({ fetchBalance, store: memoryStore(), now: () => t, log: quiet });

    const res = await handler(get('/api/credits'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
    expect(await body(res)).toEqual({ credits: 333 });

    t = 10 * 60_000 - 1;
    expect(await body(await handler(get('/api/credits')))).toEqual({ credits: 333 });
    expect(fetchBalance).toHaveBeenCalledTimes(1);

    t = 10 * 60_000;
    await handler(get('/api/credits'));
    expect(fetchBalance).toHaveBeenCalledTimes(2);
  });

  it('returns credits: null for an unrecognized shape and does not cache it', async () => {
    const fetchBalance = vi.fn(async () => ({ success: true }));
    const handler = createCreditsHandler({ fetchBalance, store: memoryStore(), log: quiet });
    expect(await body(await handler(get('/api/credits')))).toEqual({ credits: null });
    await handler(get('/api/credits'));
    expect(fetchBalance).toHaveBeenCalledTimes(2);
  });

  it('maps errors safely', async () => {
    const make = (err: Error) =>
      createCreditsHandler({ fetchBalance: () => Promise.reject(err), store: memoryStore(), log: quiet });

    const missing = await make(new ScrapeCreatorsError('missing_key', 0, 'x'))(get('/api/credits'));
    expect(missing.status).toBe(500);
    expect(await body(missing)).toEqual({ error: 'server_not_configured' });

    const broke = await make(new ScrapeCreatorsError('out_of_credits', 402, 'x'))(get('/api/credits'));
    expect(broke.status).toBe(200);
    expect(await body(broke)).toEqual({ credits: 0 });

    const down = await make(new ScrapeCreatorsError('upstream', 500, 'Scrape Creators /v1/account/credit-balance failed'))(
      get('/api/credits'),
    );
    expect(down.status).toBe(502);
    expect(down.headers.get('cache-control')).toBe('no-store');
    expect(await down.text()).not.toContain('/v1/');
  });

  it('calls the credit-balance endpoint through scGet by default (key from env)', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', '');
    const res = await createCreditsHandler({ store: memoryStore(), log: quiet })(get('/api/credits'));
    expect(res.status).toBe(500);
    vi.unstubAllEnvs();
  });

  it('works with a broken blob store', async () => {
    const handler = createCreditsHandler({ fetchBalance: async () => ({ creditCount: 9 }), store: brokenStore(), log: quiet });
    expect(await body(await handler(get('/api/credits')))).toEqual({ credits: 9 });
  });

  it('answers 405 to POST', async () => {
    const handler = createCreditsHandler({ fetchBalance: async () => DOCS_EXAMPLE, store: memoryStore() });
    expect((await handler(new Request('https://t.test/api/credits', { method: 'POST' }))).status).toBe(405);
  });
});
