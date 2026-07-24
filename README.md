# RAX On This Day Tracker

A browser-based planner for **Real Sports** RAX On This Day claims. Enter your player cards and daily RAX earnings, and the tracker shows which claims are guaranteed, which overlap, and where Pro bonus applies — before you spend RAX in the app.

Data stays in your browser (`localStorage`) unless you export a JSON backup.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL from Vite (usually `http://localhost:5173`).

## Import your collection

1. Go to **Entry**
2. Enter your Real **@username**
3. Click **Import Legendary+ passes**

Player and team passes at **Legendary, Mystic, and Iconic** are fetched via [realapp.tools](https://realapp.tools) / Meowbot's public API until that service shuts down. Re-importing updates existing cards matched by pass ID. Your username is saved locally after a successful import.

After realapp.tools closes, automatic username import is disabled. Existing imported cards and earnings remain in browser storage and JSON backups. New cards can be added manually with **Add card & earnings**, realapp.com earnings JSON paste, cached player earnings from prior imports, or single-day rows. For cards you do not own yet, use **Potential** with cached earnings or pasted JSON.

## How claims work

- **Guaranteed** — up to two player cards per sport per calendar day (highest RAX wins)
- **Overlap** — third-or-later card in the same sport on the same day (entered but not claimable)
- **Pro bonus** — optional best remaining overlap across all sports (toggle on Dashboard)

See **Help** in the app for the full guide.

## Pages

| Page | Purpose |
|------|---------|
| Dashboard | Totals, best days, rarity preview banner, export/import backup |
| Entry | Username import, cards, RAX rows, rarity preview |
| Calendar | Month/day OTD view of claimable vs overlapped RAX |
| Overlaps | Overlap days and wasted RAX by sport/card |
| Potential | What-if analysis for cards you do not own yet |
| Cards | Per-card totals, sorting, rarity preview |
| Help | Full guide and walkthroughs |

## Backup

Use **Export JSON** on the Dashboard to back up. **Import JSON** restores on another browser or device. **Clear all data** removes everything from this browser.

Treat export files as **sensitive** — they contain your Real username, card list, RAX history, saved profiles, potential cards, sell rankings, and cached player earnings in plain JSON. See **Help → Backup and privacy** in the app.

## Scripts

```bash
npm run dev      # development server
npm run build    # production build to dist/
npm run preview  # preview production build
npm run test     # unit tests
```

## Environment variables

Copy [`.env.example`](.env.example) to `.env` for local overrides (optional):

```
VITE_MEOWBOT_SUPABASE_URL=
VITE_MEOWBOT_SUPABASE_KEY=
```

Defaults are embedded in the app (publishable Meowbot key only). **Never** put private secrets in `VITE_*` variables — they ship in the browser bundle.

For production access control (Vercel only, set in the Vercel dashboard):

```
BASIC_AUTH_PASSWORD=
AUTH_SESSION_SECRET=
ADMIN_PASSWORD=
KV_REST_API_URL=
KV_REST_API_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
MEOWBOT_GLOBAL_CATALOG_URL=
MEOWBOT_GLOBAL_CATALOG_TOKEN=
```

### Real pass import (replaces realapp.tools / Meowbot)

Username import reads owned passes straight from Real's own API through the server-side route
[`api/import/real-passes.ts`](api/import/real-passes.ts), using one shared "bot" account session.
The browser cannot call Real directly (the CSP in [`vercel.json`](vercel.json) blocks it and preflight
rejects Real's custom headers), so these are **server-only** variables:

```
REAL_IMPORT_ENABLED=true
REAL_AUTH_INFO=          # <userId>!<token>!<deviceId> from the bot session
REAL_SESSION_TOKEN=      # 16 hex chars
REAL_DEVICE_UUID=
REAL_DEVICE_NAME=        # optional
REAL_DEVICE_TYPE=        # optional, defaults to desktop_web
REAL_VERSION=            # optional, defaults to 35
REAL_BASE_URL=           # optional, defaults to https://web.realapp.com
REAL_IMPORT_TIMEOUT_MS=  # optional
REAL_IMPORT_CONCURRENCY= # optional, default 2 (upstream Real calls per earnings batch)
REAL_IMPORT_MAX_RETRIES= # optional, default 5 extra attempts after HTTP 429
REAL_IMPORT_RETRY_BASE_MS= # optional, default 750
REAL_IMPORT_RETRY_MAX_MS=  # optional, default 20000
```

`REAL_AUTH_INFO`, `REAL_SESSION_TOKEN` and `REAL_DEVICE_UUID` are live credentials: set them in the
Vercel dashboard or `.env.local` only, never in `VITE_*` and never in a commit. The UI switch is
separate and must be set alongside them:

```
VITE_REAL_IMPORT_ENABLED=true
```

When the bot session expires, the route answers `502` with `code: real_session_expired` and the app
says the import session needs refreshing. Daily RAX is fetched in small batches after the pass list;
rate limits are retried with backoff, and Entry offers **Retry failed earnings** for any misses.

`ADMIN_PASSWORD` gates the unlisted `/admin` operator area (requires a normal site login first). `KV_*` vars come from linking a **Vercel KV** or **Redis** store to the project — used for central import events and minimal username/pass ownership snapshots. Without KV, the app works normally; admin logs and ownership cache stay empty.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` enable the shared Meowbot RAX catalog used by Entry page search. Create the catalog tables by running [`supabase/meowbot_catalog.sql`](supabase/meowbot_catalog.sql) in the Supabase SQL editor. Catalog imports save pass metadata even when Meowbot returns no daily earnings (`has_earnings = false` on `meowbot_passes`). Filter no-earnings passes in Supabase with `select * from meowbot_passes where has_earnings = false`. Each pass stores summed Meowbot base RAX in `total_base_rax` (for example `select name, total_base_rax from meowbot_passes where season_year = 2018 order by total_base_rax desc`). If you created the tables earlier, run the commented `alter table` statements at the bottom of [`supabase/meowbot_catalog.sql`](supabase/meowbot_catalog.sql) once, including the backfill `update` for `total_base_rax`. Successful username imports and existing browser cached profiles are uploaded into this shared catalog when Supabase is configured, so future users can search/import those RAX rows from the database. `MEOWBOT_GLOBAL_CATALOG_URL` points the admin sync route at a Meowbot export/global endpoint; `MEOWBOT_GLOBAL_CATALOG_TOKEN` is optional and is sent as a bearer token when set.

To seed the shared catalog locally without relying on `/api/*` dev routes, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, then run:

```bash
node scripts/seed-meowbot-catalog.mjs --seasons=2026,2025 --types=players,teams --limit=250 --concurrency=8
```

The script is dry-run by default. Add `--write` when you are ready to save rows to Supabase. Add `--sport=nba` or another sport to run smaller batches. Plain `npm run dev` is Vite-only, so browser calls to `/api/*` do not execute Vercel functions locally.

## Deployment (Vercel)

This app builds to static files in `dist/`. Production hosting is configured for **Vercel** with a **private GitHub repo**.

### One-time setup

1. **GitHub** — push this repo to a private GitHub repository (see [GitHub setup](#github-setup) below if not done yet).
2. **Vercel** — project is live at **https://real-rax-tracker.vercel.app**
   - [Vercel dashboard](https://vercel.com/sniperhusain-9147s-projects/real-rax-tracker)
   - Framework: **Vite** · Build: `npm run build` · Output: `dist` · Install: `npm ci`
3. **Connect Git** (after GitHub push): `npx vercel git connect`
4. **Environment variables** (Vercel → Project → Settings → Environment Variables):
   - `BASIC_AUTH_PASSWORD` — shared site password — view/rotate in Vercel dashboard only
   - `AUTH_SESSION_SECRET` — random string for signing login cookies (recommended; falls back to password if unset)
   - `ADMIN_PASSWORD` — separate password for `/admin` (operator event log)
   - **Vercel KV / Redis** — create a store in the Vercel dashboard and link it to this project (injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`)
   - Optional: `VITE_MEOWBOT_SUPABASE_URL`, `VITE_MEOWBOT_SUPABASE_KEY`
5. **Deploy** — [`vercel.json`](vercel.json) handles SPA routing and security headers. [`middleware.ts`](middleware.ts) + [`/api/auth/*`](api/auth/login.ts) enforce a signed session cookie after users sign in on the [`/login`](src/pages/LoginPage.tsx) page.

### Admin event log and ownership cache (optional)

1. Link a Vercel KV or Redis store to the project.
2. Set `ADMIN_PASSWORD` in Vercel env.
3. After deploy, sign in normally, then open `/admin/login` and enter the admin password.
4. Run a username import that hits a player pass with no daily earnings; confirm `pass_no_earnings` appears under **Logs** on `/admin`.

Browsers POST events and ownership snapshots in production only (not during `npm run dev`). Admin sees Real @usernames, reported import events, and minimal pass metadata — not users' notes, claim calculations, manual edits, or backup JSON.

### GitHub setup

If the repo is not on GitHub yet:

```bash
gh auth login
gh repo create real-rax-tracker --private --source=. --remote=origin --push
npx vercel git connect
```

Use a **private** repository. After pushing, connect it in Vercel for automatic deploys on every `main` push.

### Before sharing the live URL

1. Open the production URL in an **incognito window** — you should land on `/login`.
2. Confirm routes work after sign-in (`/entry`, `/calendar`, refresh on each).
3. Enable **Deployment Protection** for **Preview** deployments — see [scripts/PREVIEW_LOCKDOWN.md](scripts/PREVIEW_LOCKDOWN.md).
4. Follow the [site password policy](scripts/PASSWORD_POLICY.md) when sharing access.

### Alternative: Vercel Deployment Protection (Pro)

If you have Vercel Pro, you can use built-in **Password Protection** on Preview deployments. Do **not** rely on a client-only password check in React — credentials are validated on the server via `/api/auth/login`.

## Security checklist

### Access control

- [x] In-app login page at `/login` with server-validated session cookie
- [x] Edge session gate via [`middleware.ts`](middleware.ts) — credentials only in Vercel env
- [x] Set `BASIC_AUTH_PASSWORD` (and `AUTH_SESSION_SECRET`) in Vercel before sharing URL
- [x] Verify incognito redirect to `/login` on production URL
- [x] Login rate limiting on `/api/auth/login` (5 attempts / 15 min)
- [x] Static assets require session or `/login` referer ([`middleware.ts`](middleware.ts))
- [ ] Enable Preview deployment protection in Vercel dashboard — [guide](scripts/PREVIEW_LOCKDOWN.md)

**Do not** ship a client-only password check — anyone can bypass it in the bundle.

### Transport and hosting hygiene

- [x] HTTPS (automatic on Vercel)
- [x] `.env` gitignored; use [`.env.example`](.env.example) for documentation
- [ ] Restrict preview deployments (Vercel dashboard — [guide](scripts/PREVIEW_LOCKDOWN.md))
- [x] Security headers in [`vercel.json`](vercel.json) (`X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Content-Security-Policy`)

### Data and privacy (current architecture)

All tracker data lives in **browser `localStorage`** per device:

- No server-side database or multi-user isolation
- Anyone who passes the site gate only sees their own browser data
- JSON export/import is **unencrypted** — treat backups as sensitive (documented in Help)
- Username import calls public Meowbot endpoints from the client until realapp.tools shuts down
- Successful production imports may send minimal pass ownership metadata to the backend cache

### Future app-level auth (deferred)

Only needed if host-level gating is not enough:

- [ ] Auth provider (Clerk, Auth0, Supabase Auth, etc.)
- [ ] Short-lived session tokens via backend or edge function
- [ ] Keep private API keys server-side only
- [ ] Optional rate-limit proxy for imports

### Operations

- [x] Site password policy documented — [scripts/PASSWORD_POLICY.md](scripts/PASSWORD_POLICY.md)
- [ ] Keep a private list of who has the site password; rotate per policy
- [ ] Review Vercel access/analytics logs for unexpected traffic
- [x] [`public/robots.txt`](public/robots.txt) and `noindex` in [`index.html`](index.html)

## CI

GitHub Actions runs `npm test` and `npm run build` on push/PR to `main` — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Attribution

Username import uses public endpoints from [realapp.tools](https://realapp.tools) (Meowbot). This project is not affiliated with Real Sports or Meowbot.
