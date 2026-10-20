# PRD — TrendScout: Trending Social Video Search

| | |
|---|---|
| **Status** | Draft v1 — awaiting owner sign-off |
| **Date** | 2026-10-20 |
| **Repo** | `fenago/agents21` (ships to `main`) |
| **Hosting** | Netlify (static site + Netlify Functions) |
| **Data source** | [Scrape Creators API](https://docs.scrapecreators.com) |

---

## 1. Summary

TrendScout is a web app that finds **trending and high-performing short-form videos** across TikTok, Instagram and YouTube. A user can browse what's trending right now, or search a keyword or hashtag and get one ranked feed of videos across all three platforms. Each result shows the thumbnail, creator, views, likes, comments, post date and a link to the original post.

All data comes from the Scrape Creators REST API. Netlify Functions make every API call on the server, so the API key never reaches the browser.

## 2. Problem & goals

**Problem.** Creators, marketers and researchers who want to know what's working on social video have to check each app on its own. The native apps personalize their feeds, can't be searched together, and don't let you sort by actual performance.

**Goals**

| # | Goal | How we measure it |
|---|---|---|
| G1 | One search covers TikTok, Instagram and YouTube together | One query returns results from all three platforms |
| G2 | A "what's hot now" view that needs no input | The trending feed loads on page open |
| G3 | Results can be sorted and compared by performance | Sort by views, likes, comments, recency or engagement rate |
| G4 | Fast and inexpensive to run | p95 search under 6s; repeated identical queries are served from cache with no credits spent |
| G5 | The API key is never exposed | No key in client bundle, repo or network responses |

**Non-goals (v1)**
- Downloading or re-hosting videos. We only link out to the original post.
- User accounts, saved searches stored on a server, or multiple users with separate data.
- Posting or scheduling to social platforms.
- Platforms beyond TikTok, Instagram and YouTube. The architecture leaves room for them later (§11).

## 3. Users

| Persona | Need |
|---|---|
| **Content creator** | "What formats and sounds are blowing up in my niche this week?" |
| **Social / marketing manager** | "Find top-performing videos about *our category* to brief the team." |
| **Researcher / analyst** | "Compare how a topic performs across platforms." |

v1 is a **private tool** for the owner and their team, protected by a shared access password (§7.4).

## 4. User stories

1. As a user, I open the app and immediately see **trending videos** from all three platforms.
2. As a user, I type a **keyword or #hashtag** and get matching videos from every platform I've selected.
3. As a user, I **filter by platform** (TikTok / Instagram / YouTube) with toggles.
4. As a user, I **filter by time window** (today, this week, this month, all time) where the platform supports it.
5. As a user, I **sort** by views, likes, comments, newest, or engagement rate.
6. As a user, I click **Load more** to get the next page of results.
7. As a user, I click a card to **open the original post** in a new tab.
8. As a user, I can **copy a link** or **export the current results to CSV**.
9. As a user, if one platform fails, I still see the others, plus a clear notice about which one failed.
10. As the owner, I can see the **remaining credit balance** so I know when to top up.

## 5. Functional requirements

### 5.1 Trending view (default)
- **FR-1** On load, fetch trending content from each enabled platform in parallel and merge it into one grid.
- **FR-2** TikTok trending uses a region (default `US`). The user can change the region from a dropdown.
- **FR-3** "Refresh" re-fetches, but only when the cached result is older than its TTL (§7.3).

### 5.2 Search
- **FR-4** A search box accepts free text. Input starting with `#` is treated as a hashtag search on platforms that support it.
- **FR-5** Search fans out to the selected platforms in parallel. Results are normalized (§6.3) and shown in one grid.
- **FR-6** Time-window filter maps to each platform's own parameter (§6.2). Where a platform can't apply it, a small badge on that platform's results says so.
- **FR-7** Load more uses each platform's pagination token or page number.
- **FR-8** The search query, platforms, filters and sort are kept in the URL query string so a search can be shared or bookmarked.

### 5.3 Results
- **FR-9** Each video card shows the platform badge, thumbnail, title or caption (2-line clamp), creator handle, views, likes, comments, post date and an "Open" link.
- **FR-10** Client-side sort options: views, likes, comments, newest, and engagement rate ((likes + comments) / views).
- **FR-11** Results are de-duplicated by platform plus video ID. TikTok keyword search is known to return duplicates.
- **FR-12** "Export CSV" downloads the visible results.

### 5.4 Account / ops
- **FR-13** A small footer indicator shows the Scrape Creators credit balance (`/v1/account/credit-balance`), cached for 10 minutes.

## 6. Data source: Scrape Creators

### 6.1 Basics
- Base URL: `https://api.scrapecreators.com`
- Auth: header `x-api-key: <key>`
- No rate limit is enforced; the vendor suggests staying under 500 concurrent requests.
- **Cost: 1 credit per request** on every endpoint below.
- Error codes: `400` bad params, `401` bad key, `402` out of credits, `403` source blocked, `404` not found, `500` retry.

### 6.2 Endpoints used in v1

| Use | Endpoint | Key params |
|---|---|---|
| TikTok trending | `GET /v1/tiktok/get-trending-feed` | `region` (req, e.g. `US`), `trim` |
| TikTok keyword search | `GET /v1/tiktok/search/keyword` | `query` (req), `date_posted` (`yesterday`, `this-week`, `this-month`, `last-3-months`, `last-6-months`, `all-time`), `sort_by` (`relevance`, `most-liked`, `date-posted`), `region`, `cursor`, `trim` |
| TikTok hashtag search | `GET /v1/tiktok/search/hashtag` | `hashtag`, `cursor` |
| Instagram trending | `GET /v1/instagram/reels/trending` | none. Returns popular reels from the last 7 days |
| Instagram search | `GET /v2/instagram/reels/search` | `query` (req), `date_posted` (`last-week`, `last-month`, `last-year`), `page` (1–11) |
| YouTube trending | `GET /v1/youtube/shorts/trending` | none. Returns about 48 shorts per call, different on each call |
| YouTube search | `GET /v1/youtube/search` | `query` (req), `uploadDate` (`today`, `this_week`, `this_month`, `this_year`), `sortBy` (`relevance`, `popular`), `type` (`videos`, `shorts`), `region`, `continuationToken`, `includeExtras` |
| YouTube hashtag | `GET /v1/youtube/search/hashtag` | `hashtag`, `continuationToken` |
| Credits | `GET /v1/account/credit-balance` | none |

> The exact hashtag-endpoint parameter names must be confirmed against the live docs during the build.

**Time-window mapping**

| UI value | TikTok `date_posted` | Instagram `date_posted` | YouTube `uploadDate` |
|---|---|---|---|
| Today | `yesterday` | — (falls back to `last-week`) | `today` |
| This week | `this-week` | `last-week` | `this_week` |
| This month | `this-month` | `last-month` | `this_month` |
| All time | `all-time` | (omit) | (omit) |

### 6.3 Normalized video model

Each platform adapter turns its raw response into this shape:

```ts
type Video = {
  platform: 'tiktok' | 'instagram' | 'youtube';
  id: string;
  url: string;            // link to original post
  thumbnail: string;
  title: string;          // caption / title
  author: { handle: string; name?: string; avatar?: string; url?: string };
  stats: { views?: number; likes?: number; comments?: number; shares?: number };
  postedAt?: string;      // ISO 8601
  durationSec?: number;
};
```

Field sources (from the docs):
- **TikTok**: `aweme_info.statistics.play_count`, `.digg_count`, `.comment_count`; `aweme_info.video.cover.url_list[0]`; trending feed uses `aweme_list[]`.
- **Instagram**: `reels[].play_count` / `ig_play_count`, `like_count`, `comment_count`, `url`, `thumbnail_src` / `image_url`, `taken_at`, `owner` / `user`.
- **YouTube**: `shorts[]` / `videos[]` with `viewCountInt`, `likeCountInt`, `commentCountInt`, `thumbnail`, `url`, `title`, `publishDate`, `channel`.

## 7. Architecture

```
Browser (static SPA)
   │  GET /api/trending?platforms=…&region=…
   │  GET /api/search?q=…&platforms=…&window=…&cursor=…
   ▼
Netlify Functions  ──(x-api-key from env)──►  api.scrapecreators.com
   │  adapters/{tiktok,instagram,youtube}.ts → normalize → merge
   └─ cache layer (Netlify Blobs, TTL)
```

### 7.1 Stack
- **Frontend:** Vite + React + TypeScript, styled with Tailwind CSS. Static build output to `dist/`.
- **Backend:** Netlify Functions (TypeScript, Node 20), served under `/api/*` via redirects in `netlify.toml`.
- **Cache:** Netlify Blobs (key/value storage).
- **Tests:** Vitest for adapters and normalizers, using recorded JSON fixtures. Playwright smoke test of the UI against mocked functions.

### 7.2 Functions
| Function | Purpose |
|---|---|
| `trending` | Calls each platform's trending endpoint in parallel, normalizes, merges |
| `search` | Calls each platform's search (or hashtag) endpoint in parallel, normalizes, merges, returns per-platform cursors |
| `credits` | Returns the credit balance |

Each function returns `{ videos: Video[], cursors: {...}, errors: { platform: message }[] }`. A failure on one platform never fails the whole request.

### 7.3 Caching & cost control
- Cache key: endpoint plus normalized params. **TTL: 15 minutes for trending, 30 minutes for search.**
- Upstream timeout is 20 seconds per platform call. Each call is retried once on `500`. `402` (out of credits) is shown in the UI as a clear "out of credits" message.
- Rough cost per action: a trending load costs 3 credits; a 3-platform search costs 3 credits, plus 1 per platform for each "Load more".

### 7.4 Security
- `SCRAPECREATORS_API_KEY` is stored **only** as a Netlify environment variable and is never committed to the repo. `.env` is gitignored, and `.env.example` documents the variable names.
- `APP_PASSWORD` env var: when set, the functions require a matching `x-app-password` header. The SPA shows a password screen and keeps the password in `sessionStorage`.
- Inputs are validated (query ≤ 100 chars, platform whitelist, enum checks) before anything is sent upstream.
- Thumbnails are loaded directly from platform CDNs. If hotlinking is blocked, an `image-proxy` function is the fallback (open question O3).

## 8. UX

- **Layout:** header with logo, search box, and buttons to reach the platform toggles and filters. Below that, a filter bar for time window, region and sort. Then a responsive card grid (1 to 5 columns), with a footer showing credits.
- **States:** skeleton cards while loading; an empty state that suggests other queries; per-platform error chips ("Instagram unavailable — retry").
- **Accessibility:** works by keyboard, alt text on thumbnails, WCAG AA contrast, honors reduced motion.
- **Theme:** light and dark, following the system setting.
- **Mobile:** works at phone width with no horizontal scrolling.

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | First paint < 2s on 4G; p95 function latency < 6s uncached and < 300ms cached |
| Reliability | One platform failing still returns results from the others |
| Cost | No duplicate upstream calls within the cache TTL |
| Security | Key only on the server; password gate; no PII stored |
| Maintainability | Each platform is a self-contained adapter; adding a platform touches only one file plus a registry entry |

## 10. Deployment

1. Develop on a feature branch and merge into `main`.
2. Connect the repo in Netlify. Build command `npm run build`, publish directory `dist`, functions directory `netlify/functions`.
3. Set the env vars `SCRAPECREATORS_API_KEY` and `APP_PASSWORD` in the Netlify UI.
4. Every push to `main` deploys to production. Pull requests get preview deploys.

## 11. Roadmap

| Phase | Scope |
|---|---|
| **v1 (MVP)** | Everything in this document |
| v1.1 | Video detail drawer with transcript (TikTok/IG/YT transcript endpoints) and top comments |
| v1.2 | More platforms: Facebook video search, Reddit, X/Twitter, Threads, Rumble |
| v1.3 | Saved searches and watchlists (Netlify Blobs), "trending sounds" from TikTok song endpoints |
| v2 | Scheduled snapshots to track how videos trend over time; AI summaries of why a video is trending |

## 12. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Scaffold | Vite + React + TS + Tailwind, `netlify.toml`, CI lint/test pass |
| M2 | Adapters | All 3 platform adapters with fixture-based unit tests |
| M3 | Functions | `trending`, `search`, `credits` with cache, timeouts and partial failures |
| M4 | UI | Trending grid, search, filters, sort, load-more, CSV, URL state |
| M5 | Hardening | Password gate, input validation, error states, a11y pass |
| M6 | Ship | Merged to `main`, Netlify deploy live, README with setup steps |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Scrape Creators response shapes change | Adapters read fields defensively; contract tests against fixtures; vendor promises versioned changes |
| Duplicate/irrelevant results (TikTok note in docs) | De-dupe by ID; relevance-first default sort |
| Credit burn from public exposure | Password gate + cache + credit indicator |
| Thumbnail hotlink blocking | Image-proxy function fallback |
| Function timeout (Netlify default 10s sync) | 20s upstream timeout needs a higher function timeout, or parallel calls with an 8s per-platform cap. Decide during M3 |

## 14. Open questions

| # | Question | Default if unanswered |
|---|---|---|
| O1 | Is v1 private (password) or public? | Private, with a password gate |
| O2 | Default region? | `US` |
| O3 | Proxy thumbnails or hotlink them? | Hotlink first, add a proxy if broken |
| O4 | Brand name / visual identity? | "TrendScout", neutral design |
| O5 | Branch strategy? | Feature branch, then merge to `main` |
