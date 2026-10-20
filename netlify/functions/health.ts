import type { Config } from '@netlify/functions';

// Liveness check. Reports whether secrets are configured without revealing them.
export default async () =>
  Response.json(
    {
      ok: true,
      apiKeyConfigured: Boolean(process.env.SCRAPECREATORS_API_KEY),
      passwordGate: Boolean(process.env.APP_PASSWORD),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );

export const config: Config = { path: '/api/health' };
