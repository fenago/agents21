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
   - `APP_PASSWORD`: optional shared password for the app
4. Deploy. Open `/api/health` on the live site to confirm the key is configured.

After setup, every push to `main` goes live. Pull requests get Deploy Previews. GitHub Actions CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build as a quality check; it does not deploy.

## Local development

Requires Node 22+.

```bash
npm install
npm run dev          # frontend only (the /api calls will fail)
npx netlify dev      # frontend + functions, reads .env
```

Copy `.env.example` to `.env` for local secrets. `.env` is gitignored.

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
tests/               Vitest tests
docs/PRD.md          Product requirements
```
