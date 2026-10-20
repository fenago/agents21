import { afterEach, describe, expect, it, vi } from 'vitest';
import health from '../netlify/functions/health';

afterEach(() => vi.unstubAllEnvs());

describe('health function', () => {
  it('reports configuration without leaking the key', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', 'secret-test-key');
    vi.stubEnv('APP_PASSWORD', '');
    const res = await health();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, apiKeyConfigured: true, passwordGate: false });
    expect(text).not.toContain('secret-test-key');
  });

  it('flags a missing key', async () => {
    vi.stubEnv('SCRAPECREATORS_API_KEY', '');
    const body = (await (await health()).json()) as { apiKeyConfigured: boolean };
    expect(body.apiKeyConfigured).toBe(false);
  });
});
