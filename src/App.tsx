import { useEffect, useState } from 'react';
import { PLATFORMS } from '../shared/video';

type Health = { ok: boolean; apiKeyConfigured: boolean; passwordGate: boolean };

const PLATFORM_LABELS: Record<(typeof PLATFORMS)[number], string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setHealth)
      .catch(() => setHealthError(true));
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Trend<span className="text-brand">Scout</span>
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Trending videos across {PLATFORMS.map((p) => PLATFORM_LABELS[p]).join(', ')}.
        </p>
      </header>

      <section
        aria-label="Setup status"
        className="rounded-xl border border-zinc-200 p-6 dark:border-zinc-800"
      >
        <h2 className="mb-3 font-semibold">Setup status</h2>
        {healthError && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Backend not reachable. Run <code>netlify dev</code> locally, or check the Netlify deploy.
          </p>
        )}
        {!health && !healthError && <p className="text-sm text-zinc-500">Checking backend…</p>}
        {health && (
          <ul className="space-y-1 text-sm">
            <li>✅ Backend online</li>
            <li>
              {health.apiKeyConfigured ? '✅' : '⚠️'} Scrape Creators API key{' '}
              {health.apiKeyConfigured ? 'configured' : 'missing — set SCRAPECREATORS_API_KEY'}
            </li>
            <li>{health.passwordGate ? '🔒 Password gate on' : '🔓 Password gate off'}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
