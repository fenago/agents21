# Deploying TrendScout to Netlify

This is the one-time setup for the repo owner, followed by a checklist to confirm the live site works. After setup, every push to `main` deploys on its own.

All build settings live in [`netlify.toml`](../netlify.toml), so you don't type any of them into the Netlify UI:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` (`health`, `trending`, `search`, `credits`; `lib/` is shared code, not a function) |
| Node version | 22 |
| Routing | `/api/*` → `/.netlify/functions/:splat`, everything else → `/index.html` (SPA) |
| Headers | CSP and the other security headers on every path |

## 1. Connect the repo

1. Sign in at [app.netlify.com](https://app.netlify.com).
2. **Add new project → Import an existing project → GitHub.** Authorize the Netlify GitHub app if Netlify asks, and give it access to `fenago/agents21`.
3. Pick **`fenago/agents21`**.
4. **Branch to deploy: `main`.** Leave the build command, publish directory and functions directory as they are. Netlify fills them in from `netlify.toml`.
5. Before you click Deploy, open **Add environment variables** (or add them in step 2 below and redeploy):

| Key | Value | Notes |
|---|---|---|
| `SCRAPECREATORS_API_KEY` | Your Scrape Creators API key | Required. Tick **Contains secret values**. Never put it in the repo or give it a `VITE_` prefix. |
| `APP_PASSWORD` | A long random ASCII password | Strongly recommended, because without it anyone with the URL can spend your credits. Tick **Contains secret values**. |

   To generate a password: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`. Use plain ASCII only (letters, digits, `-`, `_`). Leading and trailing spaces are ignored, and a value made only of spaces turns the gate off.

6. Click **Deploy**. The first build takes about 1–2 minutes.

## 2. Environment variables later on

Go to **Project configuration → Environment variables**. Both variables must be available to **Functions** ("All scopes" is fine).

**Changing a variable does not affect a deploy that is already live.** After any change, go to **Deploys → Trigger deploy → Deploy project** so the functions pick up the new value.

## 3. Verify the deploy

Replace `https://<site>.netlify.app` with your site's URL. It is shown at the top of the project overview.

1. **Health (free, no password):** open `https://<site>.netlify.app/api/health`. You should see
   `{"ok":true,"apiKeyConfigured":true,"passwordGate":true}`.
   `passwordGate` is `false` if you left `APP_PASSWORD` unset.
2. **Smoke script** (from a clone of the repo, Node 22+, no install needed):

   ```bash
   TRENDSCOUT_PASSWORD='<APP_PASSWORD>' npm run smoke -- https://<site>.netlify.app
   # or: node scripts/smoke.mjs https://<site>.netlify.app --password=<APP_PASSWORD>
   ```

   The script checks the static page and its security headers, `/api/health`, that the API answers `401` without a password, `/api/trending`, one `/api/search?q=cats` and `/api/credits`. It prints a PASS/WARN/FAIL table with per-platform video counts and errors, then a field-coverage table for step 4 below. It never prints the password. **It spends roughly 3–7 Scrape Creators credits**, or fewer if those results are already cached. Exit code `1` means at least one FAIL. A WARN (for example, one platform failing) does not fail the run.
3. **Use the site** at `https://<site>.netlify.app`:
   - Enter the password. It is kept for the browser tab session only.
   - The trending grid loads with TikTok, Instagram and YouTube cards. Change the TikTok region.
   - Search for a keyword and a `#hashtag`. Toggle platforms, change the time window and sort order.
   - **Load more** adds a second page.
   - **Export CSV** downloads the visible results. **Copy link** reproduces the search.
   - The footer shows "N credits left".
   - Open DevTools → Console. There should be no CSP errors (broken thumbnails would also show up here).
4. **First live call checks.** The adapters were built from the docs and recorded fixtures, so check these against real data. The smoke script's field-coverage table shows most of them.
   - **Instagram search views:** some reels in `/v2/instagram/reels/search` may have no view count. The card then shows no views, and those reels have no engagement rate. If `views` is close to `0/N` for Instagram search, report it so the adapter can read a different field.
   - **YouTube likes and comments:** keyword search sends `includeExtras=true` and reads `likeCountInt` / `commentCountInt` (with fallbacks). If YouTube search shows `likes 0/N` or `comments 0/N`, the field names differ in live data. Hashtag search (`#tag`) has views only, which is expected.
   - **TikTok duration units:** the adapter treats `video.duration` as milliseconds. The median TikTok duration should look like a short video (roughly 5–180 s). A median like `0s` or `1s` means the API sends seconds and the adapter must not divide by 1000.
   - Thumbnails from every platform render. If one platform's images are blank, its CDN may block hotlinking (PRD open question O3).

## 4. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/api/*` returns `500 {"error":"server_not_configured"}`, or the app says the server is missing its API key | `SCRAPECREATORS_API_KEY` is not set or not available to Functions. Set it (scope: Functions or All), then **Trigger deploy**. `/api/health` should then show `apiKeyConfigured: true`. |
| The password screen keeps coming back (401 loop) | The password you typed does not match `APP_PASSWORD` exactly (it is case-sensitive). Use ASCII only, because non-ASCII characters can't be sent in a header. If you just changed `APP_PASSWORD`, you must redeploy. Check with `curl -i -H 'x-app-password: <pw>' https://<site>.netlify.app/api/credits`. |
| `/api/health` returns 404, HTML, or "Function not found" | Functions were not deployed, or the redirect is missing. In the deploy log, look for "Functions bundling" listing `credits.ts, health.ts, search.ts, trending.ts`. Under **Project configuration → Build & deploy**, check that the functions directory is `netlify/functions`, or empty so `netlify.toml` wins. Also check that `netlify.toml` (with the `/api/*` redirect *before* the `/*` SPA rule) is at the repo root on `main`. `/.netlify/functions/health` should work even when the redirect is broken. |
| Function log shows Netlify Blobs errors | The cache is best-effort, so requests still succeed (uncached, costing credits on every call). Blobs needs no setup on Netlify. If errors persist, redeploy, and check that `@netlify/blobs` is in `dependencies` (it is). |
| Error chip "Out of Scrape Creators credits", or the footer shows 0 | Top up in the Scrape Creators dashboard. Results already cached keep working until they expire. |
| One platform shows "busy" (`rate_limited`) or "unavailable" (`upstream`, `timeout`) | Upstream trouble for that platform only. Try again in a minute. Failed platforms are never cached. |
| Build fails | Read the deploy log. `npm run check` reproduces the build locally. If the log mentions exposed secrets, a secret value ended up in the repo or the build output. Remove it and rotate the key. |

Function logs are under **Logs → Functions** in the Netlify UI. They never contain the key or the password.

## 5. Rotate the Scrape Creators API key

The API key was pasted into a chat session during development, so **rotate it before or right after the first deploy**:

1. In the Scrape Creators dashboard, create a new API key and revoke the old one.
2. In Netlify, open **Project configuration → Environment variables → `SCRAPECREATORS_API_KEY`**, replace the value and save.
3. **Deploys → Trigger deploy → Deploy project.**
4. Open `/api/health` and run the smoke script again.

Do the same to change `APP_PASSWORD`: update the variable, then redeploy. Everyone has to enter the new password on their next visit.

## 6. After setup

- Every push to `main` deploys to production. Pull requests get Deploy Previews, which use the same env vars unless you scope them per context.
- GitHub Actions CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and the build. It doesn't deploy.
- To roll back, go to **Deploys**, pick an earlier deploy and choose **Publish deploy**.
