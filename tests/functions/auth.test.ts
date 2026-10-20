import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreditsHandler } from '../../netlify/functions/credits';
import health from '../../netlify/functions/health';
import { FAILED_PASSWORD_DELAY_MS, checkPassword, passwordMatches } from '../../netlify/functions/lib/auth';
import { createSearchHandler } from '../../netlify/functions/search';
import { createTrendingHandler } from '../../netlify/functions/trending';
import { body, fakeAdapters, get, memoryStore } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const quiet = () => {};
const noSleep = async () => {};

/** Records requested delays and resolves at once. */
function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => void delays.push(ms);
  return { delays, sleep };
}

function handlers(sleep = recordingSleep().sleep) {
  const { adapters } = fakeAdapters();
  return {
    trending: [createTrendingHandler({ adapters, store: memoryStore(), log: quiet, sleep }), '/api/trending'],
    search: [createSearchHandler({ adapters, store: memoryStore(), log: quiet, sleep }), '/api/search?q=cats'],
    credits: [
      createCreditsHandler({ fetchBalance: async () => ({ creditCount: 1 }), store: memoryStore(), log: quiet, sleep }),
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

  it('checkPassword uses the given expected value', async () => {
    const { sleep } = recordingSleep();
    expect(await checkPassword(get('/'), { expected: undefined, sleep })).toBeUndefined();
    expect(await checkPassword(get('/'), { expected: '', sleep })).toBeUndefined();
    expect(await checkPassword(get('/', { 'x-app-password': 'a' }), { expected: 'a', sleep })).toBeUndefined();
    expect((await checkPassword(get('/'), { expected: 'a', sleep }))?.status).toBe(401);
  });

  it('checkPassword reads APP_PASSWORD per call by default', async () => {
    const { sleep } = recordingSleep();
    vi.stubEnv('APP_PASSWORD', '');
    expect(await checkPassword(get('/'), { sleep })).toBeUndefined();
    vi.stubEnv('APP_PASSWORD', 'b');
    expect((await checkPassword(get('/'), { sleep }))?.status).toBe(401);
    expect(await checkPassword(get('/', { 'x-app-password': 'b' }), { sleep })).toBeUndefined();
  });

  it('trims APP_PASSWORD, since browsers trim header values', async () => {
    const { sleep } = recordingSleep();
    vi.stubEnv('APP_PASSWORD', '  secret ');
    expect(await checkPassword(get('/', { 'x-app-password': 'secret' }), { sleep })).toBeUndefined();
    vi.stubEnv('APP_PASSWORD', '   ');
    expect(await checkPassword(get('/'), { sleep })).toBeUndefined();
  });
});

describe('failed-password delay', () => {
  it('delays a wrong password by FAILED_PASSWORD_DELAY_MS, but not a missing or correct one', async () => {
    const { delays, sleep } = recordingSleep();
    await checkPassword(get('/', { 'x-app-password': 'wrong' }), { expected: 'right', sleep });
    expect(delays).toEqual([FAILED_PASSWORD_DELAY_MS]);
    await checkPassword(get('/', { 'x-app-password': '' }), { expected: 'right', sleep });
    expect(delays).toHaveLength(2);
    await checkPassword(get('/'), { expected: 'right', sleep });
    await checkPassword(get('/', { 'x-app-password': 'right' }), { expected: 'right', sleep });
    await checkPassword(get('/', { 'x-app-password': 'x' }), { expected: undefined, sleep });
    expect(delays).toHaveLength(2);
    expect(FAILED_PASSWORD_DELAY_MS).toBeGreaterThanOrEqual(250);
    expect(FAILED_PASSWORD_DELAY_MS).toBeLessThanOrEqual(1000);
  });

  it('the default sleep holds the 401 for the full delay (fake timers)', async () => {
    vi.useFakeTimers();
    let res: Response | undefined;
    const pending = checkPassword(get('/', { 'x-app-password': 'wrong' }), { expected: 'right' }).then((r) => (res = r));
    await vi.advanceTimersByTimeAsync(FAILED_PASSWORD_DELAY_MS - 1);
    expect(res).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(res?.status).toBe(401);
  });

  it.each(['trending', 'search', 'credits'] as const)('%s passes its sleep to the gate', async (name) => {
    vi.stubEnv('APP_PASSWORD', 's3cret');
    const { delays, sleep } = recordingSleep();
    const [handler, path] = handlers(sleep)[name];
    expect((await handler(get(path, { 'x-app-password': 'nope' }))).status).toBe(401);
    expect(delays).toEqual([FAILED_PASSWORD_DELAY_MS]);
    expect((await handler(get(path, { 'x-app-password': 's3cret' }))).status).toBe(200);
    expect(delays).toHaveLength(1);
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
      trending: createTrendingHandler({ adapters, store, log: quiet, sleep: noSleep }),
      search: createSearchHandler({ adapters, store, log: quiet, sleep: noSleep }),
      credits: createCreditsHandler({ fetchBalance, store, log: quiet, sleep: noSleep }),
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
