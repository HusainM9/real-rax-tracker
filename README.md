# Real RAX Tracker

Real RAX Tracker is a private planning and analysis app for Real Sports On This Day (OTD) claims. It imports owned player and team passes, tracks daily RAX earnings, identifies claim overlaps, and helps compare potential purchases, sales, and pack plans.

## What it does

- Imports Legendary, Mystic, and Iconic passes from Real through server-side API routes
- Tracks guaranteed claims, same-sport overlaps, and the optional Pro bonus
- Provides calendar, OTD, card, profile, potential-purchase, sell, and pack-planning views
- Stores tracker profiles in a configured Vercel KV/Redis account store
- Supports JSON backup and restore
- Maintains an optional shared Supabase catalog of pass metadata and daily earnings
- Includes an admin area for import diagnostics, ownership snapshots, and catalog crawls

## Tech stack

- React 19, React Router, TypeScript, and Vite
- Vercel Functions and edge middleware
- Vercel KV/Redis for accounts, synced tracker profiles, and operational data
- Supabase for the shared pass and earnings catalog
- Vitest for unit tests

## Local development

Requirements: Node.js 22 and npm.

```bash
npm ci
npm run dev
```

Vite normally serves the app at `http://localhost:5173`. The Vite development server does not execute the Vercel functions under `api/`; use Vercel's local development tooling when testing complete authentication, import, or account-sync flows.

Copy [`.env.example`](.env.example) to `.env.local` for local configuration. Never commit `.env.local` or place private credentials in `VITE_*` variables—Vite exposes those values to the browser bundle.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run lint` | Run strict TypeScript checks |
| `npm test` | Run the Vitest suite once |
| `npm run build` | Type-check and create the production bundle in `dist/` |
| `npm run preview` | Preview the production bundle locally |
| `npm run seed:catalog` | Run the shared-catalog seed script |

GitHub Actions runs lint, tests, and the production build for pushes and pull requests.

## Application structure

```text
src/           React UI, contexts, browser-side domain logic, and tests
api/           Vercel serverless routes for auth, accounts, imports, catalog, and admin
lib/           Shared/server-side domain logic and tests
scripts/       Catalog maintenance, audits, probes, and operational documentation
supabase/      Shared-catalog SQL schema and migrations
middleware.ts  Site access gate and security middleware
vercel.json    Deployment, routing, and security-header configuration
```

The app has three access layers:

1. A site-wide password gate protects the deployment.
2. Tracker accounts provide individual synced profiles.
3. A separate admin password protects operational tools under `/admin`.

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard and summary |
| `/entry` | Import passes and edit cards or earnings |
| `/earnings` | View daily active-season player-card earnings and account totals |
| `/calendar` | Calendar view of claimable and overlapping RAX |
| `/otd` | Browse OTD opportunities |
| `/overlaps` | Analyze overlap days and unclaimable RAX |
| `/potential` | Evaluate passes not currently owned |
| `/plan` | Plan future claims and acquisitions |
| `/packs` | Track pack plans |
| `/cards` | Review and sort cards |
| `/profile` | Profile statistics |
| `/sell` | Compare sell candidates |
| `/account` | Account and sync controls |
| `/help` | In-app user guide |
| `/admin` | Restricted operator tools |

## Configuration

The full variable list and safe defaults live in [`.env.example`](.env.example). The main groups are:

- `BASIC_AUTH_PASSWORD` and `AUTH_SESSION_SECRET` for the deployment gate
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`, and optional `TRACKER_SYNC_SECRET` for accounts and sync
- `REAL_*` server variables for Real pass and earnings import
- `CRON_SECRET` for the scheduled 6:30 AM Eastern public earnings snapshots
- `VITE_REAL_IMPORT_ENABLED` for the corresponding browser UI switch
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the shared catalog
- `ADMIN_PASSWORD` for operator access

`REAL_AUTH_INFO`, `REAL_SESSION_TOKEN`, and `REAL_DEVICE_UUID` are live credentials. Keep them in local or Vercel environment settings only.

The Earnings page reconstructs daily totals from Real's public active-pass, booster, and box-score data. The complete linked-account list is synchronized to server storage and refreshed every morning just before Real's reset. Two separate once-daily Vercel cron jobs cover the EST and EDT offsets (compatible with Hobby scheduling limits); the endpoint's `America/New_York` guard allows only the 6:30 AM invocation to create snapshots.

## Shared catalog

Create the catalog tables using [`supabase/meowbot_catalog.sql`](supabase/meowbot_catalog.sql). For existing installations, review and apply the relevant repair migration in [`supabase/catalog_season_repair.sql`](supabase/catalog_season_repair.sql).

The catalog seed script is dry-run by default:

```bash
npm run seed:catalog -- --seasons=2026,2025 --types=players,teams --limit=250 --concurrency=8
```

Add `--write` to persist results. Use `--sport=nba` (or another supported sport) for a smaller run.

## Deployment

The production target is Vercel. It builds with `npm run build` and serves `dist/`; [`vercel.json`](vercel.json) configures SPA routing and security headers. Configure all secrets in the Vercel project rather than in the repository.

Before sharing a deployment:

1. Verify an incognito visit redirects to `/login`.
2. Sign in and refresh several protected routes directly.
3. Restrict preview deployments using [`scripts/PREVIEW_LOCKDOWN.md`](scripts/PREVIEW_LOCKDOWN.md).
4. Follow [`scripts/PASSWORD_POLICY.md`](scripts/PASSWORD_POLICY.md) when distributing or rotating access.

## Data and privacy

Tracker data can contain usernames, owned passes, notes, and earnings history. Synced accounts store this data in the configured server-side store; JSON exports contain it in plain text. Treat exports and infrastructure credentials as sensitive.

Operational imports may also store minimal ownership metadata and catalog earnings when their backing services are configured. The project is not affiliated with Real Sports, Real, or Meowbot.
