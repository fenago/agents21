# TrendScout

Search trending videos across **TikTok, Instagram and YouTube**, powered by the [Scrape Creators API](https://docs.scrapecreators.com) and hosted on **Netlify**.

- Product spec: [`docs/PRD.md`](docs/PRD.md)
- Build agents: [`.claude/agents/`](.claude/agents)

## How it deploys

```
push to GitHub (main) ──► Netlify builds & deploys automatically
```

You never upload anything to Netlify by hand. Netlify builds the React site and the server functions in `netlify/functions/` from this repo, using `netlify.toml`.

### One-time Netlify setup

1. In Netlify: **Add new project → Import an existing project → GitHub**, then pick `fenago/agents21`.
2. Production branch: `main`. Leave the build settings alone; they come from `netlify.toml`.
3. **Project configuration → Environment variables**: add
   - `SCRAPECREATORS_API_KEY`: your Scrape Creators key (**never commit it**)
   - `APP_PASSWORD`: optional shared password for the app. Use a long random ASCII value; leaving it empty (or only spaces) turns the gate off
4. Deploy. Open `/api/health` on the live site to confirm the key is configured.

`netlify.toml` also sets the security headers: a strict Content-Security-Policy (same-origin scripts, styles and API calls; images from any `https:` host because thumbnails come from many platform CDNs), `Permissions-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy`. If you add a third-party script, font or API call, update the CSP there (see PRD §7.4).

After setup, every push to `main` goes live. Pull requests get Deploy Previews. GitHub Actions CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build as a quality check; it does not deploy.

## Local development

Requires Node 22+.

```bash
npm install
npm run dev          # frontend only (the /api calls will fail)
npx netlify dev      # frontend + functions, reads .env
```

Copy `.env.example` to `.env` for local secrets. `.env` is gitignored.

## API

All endpoints are `GET` only (anything else returns `405`) and live under `/api/*`, which `netlify.toml` redirects to `/.netlify/functions/:splat`. When `APP_PASSWORD` is set, `trending`, `search` and `credits` require the header `x-app-password: <password>` and otherwise return `401 { "error": "unauthorized" }`. A wrong password is answered after a fixed 300 ms delay, to slow down guessing. `health` is always public and returns only booleans (`ok`, `apiKeyConfigured`, `passwordGate`).

| Endpoint | Params | Server cache |
|---|---|---|
| `GET /api/trending` | `platforms` (optional, comma list of `tiktok,instagram,youtube`, default all), `region` (optional, 2 letters, default `US`) | 15 min per platform |
| `GET /api/search` | `q` (required, 1–100 chars; a leading `#` means hashtag search), `platforms`, `window` (`today`, `week`, `month`, `all`; default `all`), `region`, `cursor_<platform>` (load more) | 30 min per platform and page |
| `GET /api/credits` | none | 10 min |
| `GET /api/health` | none | none |

**Response for `trending` and `search`** (`VideoListResponse` in `shared/video.ts`):

```json
{
  "videos": [ { "platform": "tiktok", "id": "…", "url": "https://…", "thumbnail": "https://…", "title": "…",
                "author": { "handle": "…" }, "stats": { "views": 123 }, "postedAt": "2026-10-20T12:00:00.000Z" } ],
  "cursors": { "tiktok": 20, "youtube": "EpcDEgRjYXRz…" },
  "errors":  [ { "platform": "instagram", "code": "out_of_credits", "message": "Out of Scrape Creators credits" } ]
}
```

- Videos are interleaved round-robin across platforms (one from each in turn). Sorting is done in the browser.
- If one platform fails, the request still returns `200` with that platform listed in `errors`. `code` is one of `missing_key`, `bad_request`, `unauthorized`, `out_of_credits` (upstream `402`), `forbidden`, `not_found`, `rate_limited` (upstream `429`: "<Platform> is busy — try again shortly"), `upstream`, `timeout` or `internal`. Failed platforms are never cached.
- An empty first page (an empty trending feed, or a first search page with no results) is cached for only 2 minutes instead of the full TTL. If every platform fails because the API key is missing, the response is `500 { "error": "server_not_configured" }`.
- Every `url`, `thumbnail` and author link in a response is `https:`. Videos with an unsafe `url` are dropped.

**Load more (search).** Send the same `q`/`platforms`/`window`/`region` again and add one `cursor_<platform>` param for each entry in the previous response's `cursors`, for example `/api/search?q=cats&cursor_tiktok=20&cursor_youtube=EpcD…`. When any cursor is present, only the platforms that have a cursor are queried. A platform missing from `cursors` has no more pages. The Instagram cursor is a page number from 2 to 11; the others are at most 2000 characters.

**Credits.** `GET /api/credits` returns `{ "credits": 1234 }`, or `{ "credits": null }` if the balance can't be read. It returns `502 { "error": "credits_unavailable" }` if Scrape Creators is down. The vendor lists this call at 1 credit, which is why it is cached.

**Errors.** Invalid input returns `400 { "error": "invalid_parameter", "field": "q", "message": "…" }`. Error responses are sent with `Cache-Control: no-store`, and so is any `200` that includes platform errors. Fully successful responses use `private, max-age=60`.

## Scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest unit tests |
| `npm run build` | Production build to `dist/` |
| `npm run check` | All of the above |

## Layout

```
src/                 React app (Vite + Tailwind)
shared/              Types shared by app and functions (Video model)
netlify/functions/   Server-side API (/api/*), the only place the API key is used
  lib/               Shared code (adapters, cache, validation, password gate); never deployed as a function
tests/               Vitest tests
docs/PRD.md          Product requirements
```
