#!/usr/bin/env node
// Post-deploy smoke test for a live TrendScout site (docs/DEPLOY.md). Plain Node 22, no deps.
//
//   node scripts/smoke.mjs https://<site>.netlify.app [--password=<APP_PASSWORD>]
//   npm run smoke -- https://<site>.netlify.app --password=<APP_PASSWORD>
//
// The password can also come from the TRENDSCOUT_PASSWORD env var (keeps it out of shell
// history). It is only ever sent in the x-app-password header and is never printed.
//
// Cost: trending (3 platforms) + one search (3 platforms) + credits = up to 7 Scrape
// Creators credits, fewer when the server cache already holds those results
// (trending 15 min, search 30 min, credits 10 min). health and the 401 check are free.
//
// Exit code: 0 when every check is PASS or WARN, 1 when any check FAILs, 2 on bad usage.

const PLATFORMS = ['tiktok', 'instagram', 'youtube'];
const SEARCH_QUERY = 'cats';
const REQUEST_TIMEOUT_MS = 30_000;
const LOW_CREDITS = 100;
const SECURITY_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
];

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error('Usage: node scripts/smoke.mjs https://<site>.netlify.app [--password=<APP_PASSWORD>]');
  console.error('       (or set TRENDSCOUT_PASSWORD instead of --password)');
  process.exit(2);
}

function parseArgs(argv) {
  let base;
  let password = process.env.TRENDSCOUT_PASSWORD || undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') usage();
    else if (arg.startsWith('--password=')) password = arg.slice('--password='.length);
    else if (arg === '--password') password = argv[++i];
    else if (arg.startsWith('-')) usage(`unknown option ${arg.split('=')[0]}`);
    else if (!base) base = arg;
    else usage('only one site URL is allowed');
  }
  if (!base) usage('missing site URL');
  let url;
  try {
    url = new URL(base);
  } catch {
    usage('site URL is not a valid URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    usage('site URL must start with https:// (http:// is allowed for localhost only)');
  }
  if (password !== undefined && password.trim() === '') password = undefined;
  return { origin: url.origin, password };
}

const { origin, password } = parseArgs(process.argv.slice(2));
const results = [];
const coverage = [];

function record(check, result, detail) {
  results.push({ check, result, detail });
}

async function get(path, { withPassword = true } = {}) {
  const headers = { accept: 'application/json' };
  if (withPassword && password) headers['x-app-password'] = password;
  const started = Date.now();
  const res = await fetch(origin + path, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, json, text, ms: Date.now() - started };
}

function describeFailure(err) {
  if (err?.name === 'TimeoutError') return `no response within ${REQUEST_TIMEOUT_MS / 1000}s`;
  return `request failed: ${err?.cause?.code ?? err?.message ?? String(err)}`;
}

function bodyHint(r) {
  if (r.status === 401) return '401 unauthorized (wrong password? it must match APP_PASSWORD exactly)';
  if (r.json?.error === 'server_not_configured') return '500 server_not_configured (SCRAPECREATORS_API_KEY not set)';
  if (r.json && typeof r.json.error === 'string') return `${r.status} ${r.json.error}`;
  if (r.status === 404) return '404 (function not found: check the /api/* redirect in netlify.toml)';
  return `${r.status} ${r.text.slice(0, 80).replace(/\s+/g, ' ')}`;
}

async function checkStaticPage() {
  try {
    const r = await get('/', { withPassword: false });
    const missing = SECURITY_HEADERS.filter((h) => !r.headers.get(h));
    const isHtml = (r.headers.get('content-type') ?? '').includes('text/html') && r.text.includes('id="root"');
    if (r.status !== 200 || !isHtml) record('static page', 'FAIL', `${r.status}, expected the SPA index.html`);
    else if (missing.length) record('static page', 'FAIL', `missing headers: ${missing.join(', ')}`);
    else record('static page', 'PASS', `200 in ${r.ms} ms, CSP + ${SECURITY_HEADERS.length - 1} security headers`);
  } catch (err) {
    record('static page', 'FAIL', describeFailure(err));
  }
}

async function checkHealth() {
  try {
    const r = await get('/api/health', { withPassword: false });
    const h = r.json;
    if (r.status !== 200 || !h || h.ok !== true) {
      record('health', 'FAIL', bodyHint(r));
      return undefined;
    }
    const gate = `passwordGate=${h.passwordGate}`;
    if (h.apiKeyConfigured !== true) {
      record('health', 'FAIL', `apiKeyConfigured=false (set SCRAPECREATORS_API_KEY, then redeploy), ${gate}`);
    } else {
      record('health', 'PASS', `apiKeyConfigured=true, ${gate}`);
    }
    return h;
  } catch (err) {
    record('health', 'FAIL', describeFailure(err));
    return undefined;
  }
}

async function checkGate(health) {
  if (!health) return;
  if (health.passwordGate !== true) {
    record('password gate', 'WARN', 'APP_PASSWORD is not set: anyone with the URL can spend credits');
    return;
  }
  try {
    // Sends no password header, so the server answers 401 before calling Scrape Creators (free).
    const r = await get('/api/credits', { withPassword: false });
    if (r.status === 401) record('password gate', 'PASS', '401 without a password');
    else record('password gate', 'FAIL', `expected 401 without a password, got ${r.status}`);
  } catch (err) {
    record('password gate', 'FAIL', describeFailure(err));
  }
}

function median(values) {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function addCoverage(label, videos) {
  for (const platform of PLATFORMS) {
    const vs = videos.filter((v) => v?.platform === platform);
    if (!vs.length) continue;
    const has = (pick) => vs.filter((v) => typeof pick(v) === 'number').length;
    const durations = vs.map((v) => v.durationSec).filter((d) => typeof d === 'number');
    coverage.push({
      label,
      platform,
      n: vs.length,
      views: has((v) => v.stats?.views),
      likes: has((v) => v.stats?.likes),
      comments: has((v) => v.stats?.comments),
      dated: vs.filter((v) => typeof v.postedAt === 'string').length,
      medianDuration: median(durations),
    });
  }
}

async function checkList(label, path) {
  if (gateBlocked) {
    record(label, 'FAIL', 'skipped: password gate is on; pass --password or TRENDSCOUT_PASSWORD');
    return;
  }
  try {
    const r = await get(path);
    const body = r.json;
    if (r.status !== 200 || !body || !Array.isArray(body.videos)) {
      record(label, 'FAIL', bodyHint(r));
      return;
    }
    const counts = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
    for (const v of body.videos) if (v && v.platform in counts) counts[v.platform]++;
    const errors = Array.isArray(body.errors) ? body.errors : [];
    const parts = PLATFORMS.map((p) => `${p} ${counts[p]}`);
    const errorText = errors.map((e) => `${e.platform}: ${e.code ?? 'error'} (${e.message})`);
    const empty = PLATFORMS.filter((p) => counts[p] === 0 && !errors.some((e) => e.platform === p));
    let detail = `${body.videos.length} videos in ${r.ms} ms (${parts.join(', ')})`;
    if (errorText.length) detail += `; errors: ${errorText.join('; ')}`;
    if (empty.length) detail += `; no results: ${empty.join(', ')}`;
    const result = body.videos.length === 0 ? 'FAIL' : errors.length || empty.length ? 'WARN' : 'PASS';
    record(label, result, detail);
    addCoverage(label, body.videos);
  } catch (err) {
    record(label, 'FAIL', describeFailure(err));
  }
}

async function checkCredits() {
  if (gateBlocked) {
    record('credits', 'FAIL', 'skipped: password gate is on; pass --password or TRENDSCOUT_PASSWORD');
    return;
  }
  try {
    const r = await get('/api/credits');
    const c = r.json?.credits;
    if (r.status !== 200 || !r.json || !('credits' in r.json)) record('credits', 'FAIL', bodyHint(r));
    else if (c === null) record('credits', 'WARN', 'balance could not be read (credits: null)');
    else if (typeof c !== 'number') record('credits', 'FAIL', 'credits is not a number');
    else if (c === 0) record('credits', 'FAIL', 'out of credits: top up in the Scrape Creators dashboard');
    else if (c < LOW_CREDITS) record('credits', 'WARN', `${c} credits left (low)`);
    else record('credits', 'PASS', `${c} credits left (cached up to 10 min)`);
  } catch (err) {
    record('credits', 'FAIL', describeFailure(err));
  }
}

function printTable() {
  const w1 = Math.max(5, ...results.map((r) => r.check.length));
  console.log(`\n${'CHECK'.padEnd(w1)}  RESULT  DETAIL`);
  console.log(`${'-'.repeat(w1)}  ------  ${'-'.repeat(40)}`);
  for (const r of results) console.log(`${r.check.padEnd(w1)}  ${r.result.padEnd(6)}  ${r.detail}`);
}

function printCoverage() {
  if (!coverage.length) return;
  console.log('\nField coverage (videos with the field / videos returned). Compare with docs/DEPLOY.md "first live call":');
  for (const c of coverage) {
    const dur = c.medianDuration === undefined ? 'n/a' : `${c.medianDuration}s`;
    console.log(
      `  ${c.label.padEnd(15)} ${c.platform.padEnd(9)} views ${c.views}/${c.n}  likes ${c.likes}/${c.n}  ` +
        `comments ${c.comments}/${c.n}  postedAt ${c.dated}/${c.n}  median duration ${dur}`,
    );
  }
}

console.log(`TrendScout smoke test: ${origin}`);
console.log(`Password: ${password ? 'provided (not shown)' : 'not provided'}`);
console.log(
  'Note: this spends roughly 3-7 Scrape Creators credits (trending + one search + credits),\n' +
    '      fewer if the server cache already has these results.',
);

await checkStaticPage();
const health = await checkHealth();
const gateBlocked = health?.passwordGate === true && !password;
await checkGate(health);
await checkList('trending', '/api/trending');
await checkList(`search ?q=${SEARCH_QUERY}`, `/api/search?q=${encodeURIComponent(SEARCH_QUERY)}`);
await checkCredits();

printTable();
printCoverage();

const failed = results.filter((r) => r.result === 'FAIL').length;
const warned = results.filter((r) => r.result === 'WARN').length;
console.log(`\n${failed ? 'FAIL' : 'PASS'}: ${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`);
process.exit(failed ? 1 : 0);
