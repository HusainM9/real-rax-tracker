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

Player and team passes at **Legendary, Mystic, and Iconic** are fetched via [realapp.tools](https://realapp.tools) / Meowbot's public API — no Real Sports API key required. Re-importing updates existing cards matched by pass ID. Your username is saved locally after a successful import.

You can also paste JSON from realapp.tools per card (Advanced section) or add rows manually. For cards you do not own yet, use **Potential** with the `market-data` JSON walkthrough.

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

Treat export files as **sensitive** — they contain your Real username, card list, and RAX history in plain JSON. See **Help → Backup and privacy** in the app.

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
```

`ADMIN_PASSWORD` gates the unlisted `/admin` operator area (requires a normal site login first). `KV_*` vars come from linking a **Vercel KV** or **Redis** store to the project — used for a central import event log (passes skipped for no earnings, etc.). Without KV, the app works normally; admin logs stay empty.

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

### Admin event log (optional)

1. Link a Vercel KV or Redis store to the project.
2. Set `ADMIN_PASSWORD` in Vercel env.
3. After deploy, sign in normally, then open `/admin/login` and enter the admin password.
4. Run a username import that hits a player pass with no daily earnings; confirm `pass_no_earnings` appears under **Logs** on `/admin`.

Browsers POST events in production only (not during `npm run dev`). Admin sees Real @usernames and reported import events — not other users' card data.

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
- Username import calls public Meowbot endpoints from the client

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
