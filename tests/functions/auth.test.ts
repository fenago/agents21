import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreditsHandler } from '../../netlify/functions/credits';
import health from '../../netlify/functions/health';
import { checkPassword, passwordMatches } from '../../netlify/functions/lib/auth';
import { createSearchHandler } from '../../netlify/functions/search';
import { createTrendingHandler } from '../../netlify/functions/trending';
import { body, fakeAdapters, get, memoryStore } from './helpers';

afterEach(() => vi.unstubAllEnvs());

const quiet = () => {};

function handlers() {
  const { adapters } = fakeAdapters();
  return {
    trending: [createTrendingHandler({ adapters, store: memoryStore(), log: quiet }), '/api/trending'],
    search: [createSearchHandler({ adapters, store: memoryStore(), log: quiet }), '/api/search?q=cats'],
    credits: [
      createCreditsHandler({ fetchBalance: async () => ({ creditCount: 1 }), store: memoryStore(), log: quiet }),
      '/api/credits',
    ],
  } as const;
}

describe('passwordMatches', () => {
  it('compares exactly, including different lengths and unicode', () => {
    expect(passwordMatches('hunter2', 'hunter2')).toBe(true);
    expect(passwordMatches('hunter', 'hunter2')).toBe(false);
    expect(passwordMatches('hunter22', 'hunter2')).toBe(false);
    expect(passwordMatches('Hunter2', 'hunter2')).toBe(false);
    expect(passwordMatches('pässwörd', 'pässwörd')).toBe(true);
    expect(passwordMatches('', 'x')).toBe(false);
  });

  it('checkPassword reads the expected value per call', () => {
    expect(checkPassword(get('/'), undefined)).toBeUndefined();
    expect(checkPassword(get('/'), '')).toBeUndefined();
    expect(checkPassword(get('/', { 'x-app-password': 'a' }), 'a')).toBeUndefined();
    expect(checkPassword(get('/'), 'a')?.status).toBe(401);
  });
});

describe.each(['trending', 'search', 'credits'] as const)('password gate on %s', (name) => {
  const run = (headers: Record<string, string> = {}) => {
    const [handler, path] = handlers()[name];
    return handler(get(path, headers));
  };

  it('is off when APP_PASSWORD is unset or empty', async () => {
    vi.stubEnv('APP_PASSWORD', '');
    expect((await run()).status).toBe(200);
  });

  it('401s when the header is missing', async () => {
    vi.stubEnv('APP_PASSWORD', 's3cret');
    const res = await run();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await body(res)).toEqual({ error: 'unauthorized' });
  });

  it('401s on a wrong value', async () => {
    vi.stubEnv('APP_PASSWORD', 's3cret');
    expect((await run({ 'x-app-password': 's3cre' })).status).toBe(401);
    expect((await run({ 'x-app-password': 's3cret!' })).status).toBe(401);
  });

  it('passes with the right value', async () => {
    vi.stubEnv('APP_PASSWORD', 's3cret');
    expect((await run({ 'x-app-password': 's3cret' })).status).toBe(200);
  });
});

describe('health stays public', () => {
  it('needs no password', async () => {
    vi.stubEnv('APP_PASSWORD', 's3cret');
    expect((await health()).status).toBe(200);
  });
});

describe('rejected requests touch neither the cache nor the adapters', () => {
  function instrumented() {
    const { adapters, calls } = fakeAdapters();
    const store = memoryStore();
    let balanceCalls = 0;
    const fetchBalance = async () => {
      balanceCalls++;
      return { creditCount: 1 };
    };
    const adapterCalls = () =>
      Object.values(calls).reduce((n, c) => n + c.trending.length + c.search.length, 0) + balanceCalls;
    return {
      store,
      adapterCalls,
      trending: createTrendingHandler({ adapters, store, log: quiet }),
      search: createSearchHandler({ adapters, store, log: quiet }),
      credits: createCreditsHandler({ fetchBalance, store, log: quiet }),
    };
  }

  it.each([
    ['trending', '/api/trending'],
    ['search', '/api/search?q=cats'],
    ['credits', '/api/credits'],
  ] as const)('401 on %s: no store get, no upstream call', async (name, path) => {
    vi.stubEnv('APP_PASSWORD', 's3cret');
    const t = instrumented();
    const res = await t[name](get(path, { 'x-app-password': 'wrong' }));
    expect(res.status).toBe(401);
    expect(t.store.gets).toBe(0);
    expect(t.store.sets).toBe(0);
    expect(t.adapterCalls()).toBe(0);
  });

  it.each([
    ['trending', '/api/trending?platforms=myspace'],
    ['trending', '/api/trending?region=usa'],
    ['search', '/api/search?q=cats&window=decade'],
    ['search', '/api/search?q=ca%00ts'],
    ['search', '/api/search'],
  ] as const)('400 on %s (%s): no store get, no upstream call', async (name, path) => {
    const t = instrumented();
    const res = await t[name](get(path));
    expect(res.status).toBe(400);
    expect(t.store.gets).toBe(0);
    expect(t.store.sets).toBe(0);
    expect(t.adapterCalls()).toBe(0);
  });
});
