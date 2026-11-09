# Real RAX Tracker

Current safety policy: only **confirmed HTTP 500 from Real** creates a persistent endpoint pause. Internal API/storage/notification errors, unknown responses and other 5xx do not permanently disable the site. See [the current reconciliation report](docs/real-500-only-results-2026-10-31.md); older broad safety reports are historical.

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

Vite normally serves the app at `http://localhost:5173`. The custom development plugin in `vite.config.ts` also runs compatible routes under `api/` using local environment settings. Development authentication bypasses and this local adapter are not a replacement for testing production middleware, cookies, cron delivery, or Vercel runtime limits.

Copy [`.env.example`](.env.example) to `.env.local` for local configuration. Never commit `.env.local` or place private credentials in `VITE_*` variables—Vite exposes those values to the browser bundle.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run lint` | Run strict TypeScript checks |
| `npm test` | Run the Vitest suite once |
| `npm test -- src/lib/claimOptimizer.test.ts` | Run relevant tests while iterating |
| `npm run test:unit` | Run existing Node suites with their compatibility service fakes |
| `npm run test:ui` | Run existing jsdom suites with their compatibility service fakes |
| `npm run test:integration` | Run actual application services with only outbound effects simulated |
| `npm run test:partition` | Verify that discovered cases run once across the CI remainder and mandatory gate |
| `npm run test:ci:remaining` | CI complement of the mandatory build gate; not a replacement for full validation |
| `npm run build` | Type-check and create the production bundle in `dist/` |
| `npm run preview` | Preview the production bundle locally |
| `npm run seed:catalog` | Run the shared-catalog seed script |
| `npm run bench:collection` | Offline recorded-fixture benchmark; live import bursts are not authorized |
| `node scripts/audit-runtime-modules.mjs` | Report conservative dependency-cleanup candidates |

GitHub Actions runs the CI remainder, then `npm run build`, whose prebuild runs the mandatory safety/runtime tests. Together these cover the full suite once; build also type-checks, so CI does not repeat standalone lint. `npm test` remains the simple full-suite command for local final validation.

Tests default to native Node. Browser-dependent files opt into jsdom using `// @vitest-environment jsdom`; offline network denial applies to both environments. Keep Real-500, Edge redirect, authentication, data-preservation and calculation/ranking regressions. During development run the relevant files; at completion run the full suite and before release the gated build. No live Real scraping is part of these checks.

`vitest.config.ts` discovers every test file into one named project. Tests under `tests/integration/` use only the shared offline network guard; they do not inherit application-service substitutes. The existing `unit` and `ui` projects retain `src/testing/offlineSetup.ts`, which explicitly substitutes the request-safety store, KV boundary, and error journal for compatibility with the unchanged suites. These labels describe execution setup, not a claim that all current Node tests are isolated units. Existing per-file jsdom annotations remain supported.

Test configuration does not import the application Vite config or load local environment files. Integration tests supply synthetic configuration and simulate external HTTP only. Their storage response fixtures verify SDK serialization and application wiring; they do not execute Redis/Lua or prove real Redis concurrency. New tests must reject unexpected outbound effects, and integration tests should not mock internal application services.

CI verifies actual full/gate/remainder discovery before execution, preserving repeated test-title occurrences and rejecting missing cases, overlapping selection, missing gate files, and files assigned to multiple projects. It retains separate remaining/gate JUnit reports, cancels superseded runs, and keeps the existing workflow triggers. Local full-suite and release-gate requirements are unchanged. See [the protected contracts](docs/testing-contracts.md), [the audit](docs/test-system-audit-2026-11-09.md), and [implementation ledger](docs/superpowers/plans/2026-11-09-test-infrastructure.md).

See [the codebase review](docs/codebase-review.md) for measured import/calculation results, remaining correctness and data-safety findings, and benchmark privacy/limitations. Private benchmark fixtures stay in ignored `.benchmarks/` and must not be published.

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
| `/` | Dashboard, collection import, backup controls, and summary |
| `/entry` | Legacy import link; redirects to Dashboard's import section |
| `/earnings`, `/earnings/access` | Retired; redirect to Dashboard |
| `/marketplace` | Marketplace alerts; hidden from the navbar (individual player listings retired) |
| `/calendar` | Calendar view of claimable and overlapping RAX |
| `/otd` | Browse OTD opportunities |
| `/overlaps` | Analyze overlap days and unclaimable RAX |
| `/potential` | Optimization: compare upgrades/new passes and selected Plan upgrade assumptions |
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
- `CRON_SECRET` remains an optional legacy secret/fallback for Marketplace authorization. Standalone Earnings snapshots are retired; do not configure or resume their schedules.
- `MARKETPLACE_QSTASH_SECRET` for the primary four-minute QStash marketplace schedule
- `MARKETPLACE_SCAN_SECRET` for the GitHub Actions marketplace fallback (falls back to `CRON_SECRET`)
- One optional marketplace delivery channel: private Discord DMs with `MARKETPLACE_DISCORD_BOT_TOKEN`; a Discord channel webhook with `MARKETPLACE_DISCORD_WEBHOOK_URL`; or Telegram with `MARKETPLACE_TELEGRAM_BOT_TOKEN` plus `MARKETPLACE_TELEGRAM_CHAT_ID`. Each signed-in marketplace account can save its own Discord User ID. `MARKETPLACE_DISCORD_USER_ID` remains a legacy single-user fallback only until account routing is enabled.
- `VITE_REAL_IMPORT_ENABLED` for the corresponding browser UI switch
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the shared catalog
- `ADMIN_PASSWORD` for operator access

`REAL_AUTH_INFO`, `REAL_SESSION_TOKEN`, and `REAL_DEVICE_UUID` are live credentials. Keep them in local or Vercel environment settings only.

The standalone Earnings page was removed on October 31. Its manual/tracking APIs return HTTP 410 and snapshot endpoints acknowledge stale scheduled requests without provider or storage work, including forced requests. Their obsolete reconstruction/history workers, disconnected UI and archival tests have been removed; compatibility handlers and retirement guards remain. Earnings Vercel schedules are removed and the GitHub fallback job is disabled in source. Saved history is preserved; collection-import earnings backfill and all OTD/optimization calculations remain supported. The private earnings-named access helpers are retained because Marketplace shares them. Local cleanup does not change deployed code or remote schedules until a separately approved rollout.

Marketplace alerts use Real's authenticated listing feed and the shared catalog for sport-aware player selection. Rules, Discord recipients, deduplicated matches, pending deliveries, and the last scan result are stored in KV per tracker account. The page can scan on demand and refreshes its saved feed once per minute without making another Real request. Discord DM delivery opens a private channel with that account's saved Discord user and sends from the installed bot; the bot token remains server-side and never enters the browser bundle. Once any account saves a Discord recipient, accounts without one keep their matches pending rather than falling back to another user's DMs.

Marketplace monitoring uses a four-minute interval, even when the page is closed. The primary QStash schedule uses `*/4 * * * *`, with delivery retries disabled and `MARKETPLACE_QSTASH_SECRET` forwarded as an `Authorization: Bearer` header to `/api/cron/marketplace-alerts`. The server enforces one scan start per four minutes across scheduled/manual requests. It loads each account's rules and Discord recipient and deduplicates matches. Confirmed Real HTTP 500 pauses that Real endpoint; notification failures do not create permanent bans, and undelivered alerts remain pending. The repository workflow retains its independent ten-minute fallback using `MARKETPLACE_SCAN_SECRET`. This safety reconciliation does not change remote schedules.

Every release must use `npm run build`, whose `prebuild` runs the request-boundary audit and offline Real-500 safety regressions. Every Real consumer uses the shared backend guard. Browser requests and non-Real services have ordinary error handling, and the official KV SDK makes one attempt per operation. A green build does not authorize a Real probe or repeating a known Real 500. See `AGENTS.md` and the current reconciliation report for policy and durability limitations.

`Serial number` and `Bulk rating` are separate rule choices and feeds: serial-number rules request `listingType=userpassserial`, while bulk-rating rules request `listingType=userpassfull`. An `All` rule scans both pass feeds plus the card feed.

## Data and privacy

Tracker data can contain usernames, owned passes, notes, and earnings history. Synced accounts store this data in the configured server-side store; JSON exports contain it in plain text. Treat exports and infrastructure credentials as sensitive.

Operational imports may also store minimal ownership metadata and catalog earnings when their backing services are configured. The project is not affiliated with Real Sports, Real, or Meowbot.

Successful raw ownership scans can be reused for 30 seconds within the same provider-session scope. Packs shows the original scan time and offers forced refresh. Collection replacement requests fresh ownership by default. Failed scans are never reused as empty ownership.

Signed-in browser caches are account-specific. Unassigned legacy browser data is retained but never automatically assigned to a signed-in account. An offline bootstrap or save conflict pauses cloud writes; export a Dashboard backup before explicitly reloading the server copy.

### Catalog range migration (not applied)

`supabase/migrations/20261030_catalog_range_totals.sql` is a restricted service-role-only aggregate draft. Keep `CATALOG_RANGE_RPC_ENABLED` unset until authorized SQL execution, permission tests, representative EXPLAIN plans, Unicode/name-order parity and JSON result parity are verified. The fallback reports partial results when its 80,000-row scan cap is reached. No production database DDL is authorized by the performance plan.

### Legacy sync deprecation

`GET /api/profile/sync` remains only for unknown external compatibility callers. Its PIN query parameter can appear in history/proxy logs even with `no-store`; this risk is not fixed by caching headers. Current browser code uses session-based `/api/account/data` instead. Do not build new callers of query-credential sync. Remove it only after external usage and a migration window are confirmed. The old PUT remains compatible during that window.
