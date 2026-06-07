# Agent handoff — real-rax-tracker

Last verified: **88 tests passing**, **`npm run build` succeeds** (run both before shipping changes).

---

## What was just done (this session)

### 1. Reverted Potential page auto-fetch (still required DevTools)

**Deleted:**
- `src/lib/potentialEarningsFetch.ts` — had `parseSeasonYearForMeowbot()` and `fetchPotentialEarningsFromMeowbot()` wrapping `fetchDailyEarnings()` from `meowbotApi.ts`
- `src/lib/potentialEarningsFetch.test.ts`

**Reverted in:**
- `src/pages/PotentialPage.tsx` — removed `meowbotEntityId`, `passKind`, `seasonYear`, `fetchingEarnings`, `fetchEarnings()`, Fetch button, Option A/B guide. Back to paste-only: `EMPTY_FORM` has `name`, `sport`, `season`, `notes`, `rawJson`, `previewAs`. `submitAnalyze` calls `parseRealAppToolsRows(form.rawJson, { sport, rarityLabel: form.previewAs, applyOtdMultiplier: Boolean(form.previewAs) })`.
- `src/types/rax.ts` — removed `meowbotEntityId` and `passKind` from `SavedPotentialCard`
- `src/lib/storage.ts` — removed hydration for those fields in `hydratePotentialCard()`
- `src/context/RaxDataContext.tsx` — `PotentialCardInput` no longer includes `meowbotEntityId` / `passKind`; `addPotentialCard` / `updatePotentialCard` don't persist them
- `src/pages/HelpPage.tsx` — Potential blurb back to "paste realapp.tools JSON manually"
- `src/App.css` — removed `.potential-guide-block` styles

**Kept from earlier Potential work:** `PotentialAnalysisResults` component with 4-tile summary grid, `CollapsibleAnalysisSection`, `analyzePotentialCard()` monthly net + `displacedByCard` tables (`defaultOpen` on displaced + monthly sections).

**Decision:** Auto-fetch still forced users through Network → Payload for `entityId`; Mac/Safari DevTools UX made it worse than paste. No server-side realapp.com session exists for true no-DevTools import.

### 2. Lenient JSON paste for DevTools partial copies

**File:** `src/lib/realAppToolsImport.ts`

Added:
- `normalizeRealAppToolsPaste(raw)` — exported; strips BOM, markdown fences, repairs fragments starting with `earnings":` or `rows":` (missing leading `{`), extracts first balanced `{...}` / `[...]` from noisy paste
- `parseRealAppToolsJson()` — tries normalized text + auto-closing `}`, `]}`, `}}` if truncated
- `parseRealAppToolsRows()` now uses `parseRealAppToolsJson()` and throws clearer `SyntaxError` messages when paste looks partial

**Tests:** `src/lib/realAppToolsImport.test.ts` — 3 new cases for partial `earnings"/rows"` paste and wrapped response text.

**Also updated:** `src/pages/PotentialPage.tsx` tutorial — JSON must start with `{`; Chrome/Safari/Firefox-specific Network steps.

### 3. Username import — passes with no earnings → manual Entry guidance

**Files:**
- `src/lib/usernameImport.ts`
  - `getFailedPlayerPasses()` — `reason: 'no_earnings'` rows get `detail` explaining card was added and to use **Add card & earnings** on Entry
  - `importFromUsername()` — `errors.push()` for empty `dailyRows` mentions Entry page manual add
- `src/pages/EntryPage.tsx`
  - `submitUsernameImport()` — `issueParts` includes `(add RAX manually on Entry)` for `noEarningsCount`
  - `usernameImportFailedPasses` UI — links to `#add-card-earnings`; distinguishes `no_earnings` vs `fetch_error`; table shows **No earnings (card added)**

**Not changed:** `getFailedPlayerPasses()` still **filters out team passes** (`if (pass.passKind !== 'player') continue`). Team passes with no earnings go into `result.passesWithNoEarnings` and admin events but **do not appear** in the Entry failures table.

### 4. Discussed but NOT implemented

- **Video tutorial embed** on Potential (YouTube `VITE_POTENTIAL_TUTORIAL_VIDEO_ID` was proposed; no code added)

---

## Codebase state right now

### Works

| Area | Status |
|------|--------|
| **Build / tests** | `npm test` → 22 files, 88 tests. `npm run build` → `tsc && vite build` OK |
| **Entry username import** | `importFromUsername()` in `usernameImport.ts` → Meowbot `market-data` via `fetchDailyEarnings()`; Legendary+ filter; concurrent fetch; progress via `onProgress`; cards upserted even when earnings empty |
| **Entry manual paste** | `parseRealAppToolsRows()` on Entry + Potential; partial-paste repair active |
| **Failed import UX** | `usernameImportFailedPasses` state in `EntryPage`; `getFailedPlayerPasses(result)` |
| **Admin** | `/admin/login`, `/admin` (unlisted); `ADMIN_PASSWORD` separate from `BASIC_AUTH_PASSWORD`; events in Vercel KV via `lib/adminEventStore.ts`; `postAdminEvents()` in `src/lib/adminEvents.ts` **no-ops in dev** (`import.meta.env.DEV`) |
| **Sell rankings** | `rankAllRemovedCardsAsync()` in `removeCardAnalysis.ts`; paginated results + skipped passes on `SellPage.tsx`; persisted via `saveSellRankings()` |
| **Potential** | Paste JSON only; rich analysis UI via `analyzePotentialCard()` in `potentialAnalysis.ts` |
| **Calendar** | Day claims in modal; overlap collapse styling in `App.css` |
| **Auth** | Site gate `RequireAuth`; admin `RequireAdmin` + `AdminAuthContext` |

### Broken / not working

- Nothing known broken in CI/local build as of handoff.
- **Potential / Entry paste** still fundamentally requires user to copy JSON from DevTools — lenient parser fixes common partial copies, not all formats.
- **Admin event logging** won't fire locally unless you remove the `import.meta.env.DEV` guard or test against deployed Vercel with KV env vars.

### Partial / intentional gaps

- **Team passes with no earnings** — tracked in `UsernameImportResult.passesWithNoEarnings` but hidden from `getFailedPlayerPasses()` UI (player-only table).
- **Potential `passKind`** — removed from saved profiles; `analyzePotentialCard()` still accepts optional `passKind` on `PotentialProfile` (defaults `'player'`) but Potential form doesn't expose it.
- **realapp.com authenticated import** — not implemented; username import uses Meowbot public API only.
- **Video tutorial** — not wired.

---

## What the next agent should do first

1. **Read this file**, then run:
   ```bash
   npm install
   npm test
   npm run build
   npm run dev
   ```
2. **Confirm the user's actual next task** — likely one of:
   - **Potential UX:** video embed (`VITE_POTENTIAL_TUTORIAL_VIDEO_ID` + iframe in `PotentialPage.tsx` tutorial section)
   - **Import gaps:** surface team passes in `getFailedPlayerPasses()` or separate team failures table
   - **No-earnings flow:** auto-scroll / pre-select card in `#add-card-earnings` when user clicks a failed pass row (not built yet)
3. If touching import/paste, run `src/lib/realAppToolsImport.test.ts` and `src/lib/usernameImport.test.ts` after edits.

---

## Gotchas

### Meowbot vs realapp.com
- **Username import** and any earnings fetch use **Meowbot** `market-data` (`get_daily_earnings` / `get_team_daily_earnings`) in `src/lib/meowbotApi.ts`. Optional overrides: `VITE_MEOWBOT_SUPABASE_URL`, `VITE_MEOWBOT_SUPABASE_KEY` in `.env.example`.
- **Manual paste** accepts both `rows` (realapp.tools) and `earnings` (realapp.com) arrays via `getRows()` in `realAppToolsImport.ts`.

### DevTools paste errors
- Error `Unexpected token 'e', "earnings":"...` = partial copy missing `{"` prefix. `normalizeRealAppToolsPaste()` repairs many cases; guide users to select from opening `{`.
- Safari Mac: Develop menu must be enabled; panel names differ from Chrome.

### Username import no-earnings behavior
- In `importFromUsername()` (~line 387): `cardId && dailyRows.length === 0` → card **already exists** (from `upsertCards()` earlier), zero performances, entry in `passesWithNoEarnings`.
- `getFailedPlayerPasses()` is what `EntryPage` renders — **player passes only**.

### Admin / KV
- `postAdminEvents()` returns immediately in dev — won't see events in `/admin` locally without KV + removing/skipping DEV check.
- Production needs `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `ADMIN_PASSWORD` on Vercel.
- `reportImportAdminEvents()` called from `EntryPage.submitUsernameImport()` via `void reportImportAdminEvents(username, result)`.

### Potential vs Entry data
- `SavedPotentialCard` rows live in `data.potentialCards` — **excluded from real collection totals** (what-if only).
- Entry cards live in `data.cards` + `data.performances`.

### Sell rankings async
- `SellPage` uses `rankAllRemovedCardsAsync()` with abort/progress; skipped player passes stored in `data.sellRankings.skippedPlayerPasses` with `reason: 'no_earnings' | 'analysis_failed'`.
- `removeCardAnalysis.ts` already sets `detail: 'No RAX earnings rows — add earnings on Entry or re-import this pass.'` for no-earnings skips.

### Git / deploy
- `.env.local` is gitignored; never commit secrets.
- User rule: **do not commit unless explicitly asked**.

---

## Key files (one line each)

| Path | Purpose |
|------|---------|
| `src/pages/EntryPage.tsx` | Username import UI, `submitUsernameImport`, `usernameImportFailedPasses` table, `#add-card-earnings` form |
| `src/lib/usernameImport.ts` | `importFromUsername()`, `getFailedPlayerPasses()`, `UsernameImportResult` |
| `src/lib/meowbotApi.ts` | `fetchDailyEarnings()`, `resolveUserPasses()`, `fetchUserOtdPassMetadata()` |
| `src/lib/realAppToolsImport.ts` | `parseRealAppToolsRows()`, `normalizeRealAppToolsPaste()`, JSON repair |
| `src/pages/PotentialPage.tsx` | Paste-only potential card checker + tutorial + `PotentialAnalysisResults` |
| `src/lib/potentialAnalysis.ts` | `analyzePotentialCard()` — claimable/overlap/displaced/monthly net |
| `src/lib/removeCardAnalysis.ts` | `rankAllRemovedCardsAsync()`, sell simulation math |
| `src/pages/SellPage.tsx` | Bulk sell ranking UI, pagination, skipped passes |
| `src/pages/CalendarPage.tsx` | Calendar + day modal claims |
| `src/context/RaxDataContext.tsx` | All data mutations; `addPotentialCard`, `importFromUsername` wrapper |
| `src/lib/storage.ts` | `loadTrackerData()` / `hydratePotentialCard()` — localStorage persistence |
| `src/types/rax.ts` | `SavedPotentialCard`, `PlayerCard`, `SavedSellRankings`, etc. |
| `src/lib/adminEvents.ts` | `postAdminEvents()`, `buildImportAdminEvents()` — DEV skip at line 32 |
| `lib/adminEventStore.ts` | Vercel KV read/write for admin events |
| `lib/adminAuth.ts` | Admin session validation |
| `api/admin/events.ts` | POST/GET admin events API |
| `middleware.ts` | Auth routing for `/admin` API routes |
| `src/pages/AdminPage.tsx` | Operator log viewer |
| `.env.example` | Required env var documentation |
| `src/App.tsx` | Routes: `/entry`, `/potential`, `/sell`, `/admin`, etc. |

---

## Commands

```bash
# Install
npm install

# Dev server (Vite, default http://localhost:5173)
npm run dev

# All tests
npm test

# Single test file
npm test -- src/lib/realAppToolsImport.test.ts

# Production build (TypeScript check + Vite bundle → dist/)
npm run build

# Preview production build locally
npm run preview
```

### Env (local / Vercel)

Copy `.env.example` → `.env.local` for optional Meowbot overrides only. Admin KV vars matter on Vercel deploy, not typical local dev.

---

## Architecture quick reference

```
User browser (React SPA, localStorage via storage.ts)
  ├─ Entry: importFromUsername → meowbotApi.fetchDailyEarnings (per pass)
  ├─ Entry/Potential: parseRealAppToolsRows (paste JSON)
  ├─ claimOptimizer.ts ← performances + cards → claimable/overlap
  └─ postAdminEvents → /api/admin/events → adminEventStore (KV) [prod only]

Vercel
  ├─ Static SPA + API routes in api/
  ├─ middleware.ts (site auth + admin routes)
  └─ @vercel/kv for admin event log
```

---

## Recent commit context

Git history shows commit `6292381 potentials` touched Potential heavily. Auto-fetch was added then **removed in working tree** (files deleted, not necessarily committed). Check `git status` before assuming remote matches local.
