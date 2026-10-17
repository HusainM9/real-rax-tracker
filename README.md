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
| `/marketplace` | Create marketplace listing alerts and review matched listings |
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
- `CRON_SECRET` for bearer-token protection on scheduled public earnings snapshots. Add the same value as a GitHub Actions repository secret so the independent morning fallback can invoke the endpoint. When omitted in Vercel, the endpoint accepts only Vercel's native `vercel-cron/1.0` invocation marker and still enforces the snapshot-time window.
- `MARKETPLACE_QSTASH_SECRET` for the primary two-minute QStash marketplace schedule
- `MARKETPLACE_SCAN_SECRET` for the GitHub Actions marketplace fallback (falls back to `CRON_SECRET`)
- One optional marketplace delivery channel: private Discord DMs with `MARKETPLACE_DISCORD_BOT_TOKEN`; a Discord channel webhook with `MARKETPLACE_DISCORD_WEBHOOK_URL`; or Telegram with `MARKETPLACE_TELEGRAM_BOT_TOKEN` plus `MARKETPLACE_TELEGRAM_CHAT_ID`. Each signed-in marketplace account can save its own Discord User ID. `MARKETPLACE_DISCORD_USER_ID` remains a legacy single-user fallback only until account routing is enabled.
- `VITE_REAL_IMPORT_ENABLED` for the corresponding browser UI switch
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the shared catalog
- `ADMIN_PASSWORD` for operator access

`REAL_AUTH_INFO`, `REAL_SESSION_TOKEN`, and `REAL_DEVICE_UUID` are live credentials. Keep them in local or Vercel environment settings only.

The Earnings page reconstructs daily totals from Real's public active-pass, booster, and box-score data. The complete linked-account list is synchronized to server storage and refreshed every morning before Real's reset. DST-aware Vercel cron jobs attempt snapshots at 4:30, 5:00, and 5:30 AM Eastern, followed by verification and recovery attempts through the 6:00 AM hour. Because Hobby cron delivery can be delayed by nearly an hour, `.github/workflows/earnings-snapshot.yml` independently retries the endpoint at :35 and :55 throughout the EDT/EST recovery range. Every configured route accepts runs throughout the full 4:00–6:59 AM Eastern window, and successful account/day snapshots are never overwritten. A manual workflow dispatch performs an authenticated end-to-end test against one linked account without saving an early snapshot. Each invocation uses up to four minutes of its five-minute function allowance so the complete linked-account list can finish in one run. Alternating retries process accounts from the opposite end of the linked-account list, preventing later accounts from repeatedly being starved if Real rate-limits an earlier run. Coverage is rechecked against saved KV snapshots before every response so deferred accounts already saved by another invocation are not falsely reported missing. If Real continues returning `429` after its request-level backoff, the job makes one bounded account-level retry, stops before the serverless deadline, and defers all remaining unsaved accounts to the next invocation.

Marketplace alerts use Real's authenticated listing feed and the shared catalog for sport-aware player selection. Rules, Discord recipients, deduplicated matches, pending deliveries, and the last scan result are stored in KV per tracker account. The page can scan on demand and refreshes its saved feed once per minute without making another Real request. Discord DM delivery opens a private channel with that account's saved Discord user and sends from the installed bot; the bot token remains server-side and never enters the browser bundle. Once any account saves a Discord recipient, accounts without one keep their matches pending rather than falling back to another user's DMs.

Unattended marketplace monitoring is triggered by a QStash schedule every two minutes, even when the site is closed. QStash forwards `MARKETPLACE_QSTASH_SECRET` as an `Authorization: Bearer` header to `/api/cron/marketplace-alerts`. The endpoint scans every account that has at least one saved marketplace rule, loads that account's saved Discord recipient, deduplicates matches, and retries undelivered Discord or Telegram alerts on the next run. `.github/workflows/marketplace-monitor.yml` remains as an independent five-minute fallback using `MARKETPLACE_SCAN_SECRET`; it also supports manual dispatch for verification. Do not add the rapid schedule to `vercel.json` on a Vercel Hobby project because Hobby cron frequency is too limited for auction monitoring.

`Serial number` and `Bulk rating` are separate rule choices and feeds: serial-number rules request `listingType=userpassserial`, while bulk-rating rules request `listingType=userpassfull`. An `All` rule scans both pass feeds plus the card feed.

## Data and privacy

Tracker data can contain usernames, owned passes, notes, and earnings history. Synced accounts store this data in the configured server-side store; JSON exports contain it in plain text. Treat exports and infrastructure credentials as sensitive.

Operational imports may also store minimal ownership metadata and catalog earnings when their backing services are configured. The project is not affiliated with Real Sports, Real, or Meowbot.
