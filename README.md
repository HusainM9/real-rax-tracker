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
BASIC_AUTH_USER=
BASIC_AUTH_PASSWORD=
```

## Deployment (Vercel)

This app builds to static files in `dist/`. Production hosting is configured for **Vercel** with a **private GitHub repo**.

### One-time setup

1. **GitHub** — push this repo to a private GitHub repository.
2. **Vercel** — [import the repo](https://vercel.com/new):
   - Framework: **Vite**
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm ci`
3. **Environment variables** (Vercel → Project → Settings → Environment Variables):
   - `BASIC_AUTH_USER` — shared username for your group
   - `BASIC_AUTH_PASSWORD` — shared password (rotate periodically)
   - Optional: `VITE_MEOWBOT_SUPABASE_URL`, `VITE_MEOWBOT_SUPABASE_KEY`
4. **Deploy** — Vercel deploys on push to `main`. [`vercel.json`](vercel.json) handles SPA routing and security headers. [`middleware.ts`](middleware.ts) enforces HTTP Basic Auth at the edge when auth env vars are set.

### Before sharing the live URL

1. Open the production URL in an **incognito window** — you should get a browser login prompt.
2. Confirm routes work after login (`/entry`, `/calendar`, refresh on each).
3. Enable **Deployment Protection** for **Preview** deployments (Vercel → Project → Deployment Protection) so PR preview URLs are not public.

### Alternative: Vercel Deployment Protection (Pro)

If you have Vercel Pro, you can use built-in **Password Protection** or **Vercel Authentication** on Production instead of (or in addition to) middleware Basic Auth. Do **not** add a client-side password check in React.

## Security checklist

### Access control

- [x] Edge Basic Auth via [`middleware.ts`](middleware.ts) — credentials only in Vercel env
- [ ] Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` in Vercel before sharing URL
- [ ] Verify incognito login prompt on production URL
- [ ] Enable Preview deployment protection in Vercel dashboard

**Do not** ship a client-only password check — anyone can bypass it in the bundle.

### Transport and hosting hygiene

- [x] HTTPS (automatic on Vercel)
- [x] `.env` gitignored; use [`.env.example`](.env.example) for documentation
- [ ] Restrict preview deployments (Vercel dashboard — manual step)
- [x] Security headers in [`vercel.json`](vercel.json) (`X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`)

### Data and privacy (current architecture)

All tracker data lives in **browser `localStorage`** per device:

- No server-side database or multi-user isolation
- Anyone who passes the site gate only sees their own browser data
- JSON export/import is **unencrypted** — treat backups as sensitive
- Username import calls public Meowbot endpoints from the client

### Future app-level auth (deferred)

Only needed if host-level gating is not enough:

- [ ] Auth provider (Clerk, Auth0, Supabase Auth, etc.)
- [ ] Short-lived session tokens via backend or edge function
- [ ] Keep private API keys server-side only
- [ ] Optional rate-limit proxy for imports

### Operations

- [ ] Document who has the shared password; rotate `BASIC_AUTH_PASSWORD` periodically
- [ ] Review Vercel access/analytics logs for unexpected traffic
- [x] [`public/robots.txt`](public/robots.txt) and `noindex` in [`index.html`](index.html)

## CI

GitHub Actions runs `npm test` and `npm run build` on push/PR to `main` — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Attribution

Username import uses public endpoints from [realapp.tools](https://realapp.tools) (Meowbot). This project is not affiliated with Real Sports or Meowbot.
