# Performance Phase Two Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner requires solo execution: no subagents or external reviewer agents.

**Goal:** Substantially accelerate exact pass rankings and repeated pack imports, remove obsolete manual collection controls, and validate on a protected deployed preview.

**Architecture:** Prepare immutable claim-day state once per ranking run and score only candidate changes while preserving the import/upgrading semantics. Reuse successful short-lived ownership snapshots with explicit freshness and refresh. Retain Supabase/Postgres as the canonical shared catalog, fixing query completeness and preparing database aggregation instead of migrating platforms without evidence.

**Tech Stack:** Existing React 19, TypeScript, Vite/Vitest, Vercel functions, KV/Redis, Supabase/Postgres. No new paid service or framework.

**Spec:** `docs/superpowers/specs/2026-10-30-performance-phase-two-design.md`

**Owner's clarified priority:** Task 2 is the main **Find the best upgrades** tool and is the first implementation priority, ahead of the entry-page cleanup. Task 3 is a separate month/day correctness fix, not the main ranking speed work. Execute in order: 2 → 3 → 4 → 1 → 5 → 6 → 7 → 8; keep the existing task numbers stable for discussion.

## Global Constraints

- Work stays solo, preserving existing local changes and saved collections.
- No live deployment, destructive database migration, account reset, exposed preview, relaxed authentication, or new service subscription in this approval.
- Do not increase Real upstream concurrency blindly or bypass its rate limits.
- Keep private benchmark fixtures ignored; never log credentials or publish collection responses.
- Do not reduce candidate coverage or change rarity/ownership/Pro rules to obtain the speedup.
- Keep backup/export and the separate Cards page.
- Database DDL requires a reviewed migration and explicit authorization; preparing SQL is not applying it.
- Follow test → observed failure → implementation → targeted verification per task. Review diffs manually; do not commit unrelated existing work. Preview deployment does not require a live promotion or a blanket Git commit.

## Review Focus

1. Owned passes with old rows absent from the incoming catalog retain those rows exactly as the existing importer does, including preview rarities and duplicate-day handling.
2. Equal earnings/names and UFC same-day sums preserve deterministic selection and candidate contribution, not just grand totals.
3. One cancelled requester cannot invalidate another shared ownership fetch; failures and expired sessions never become cache hits.
4. Account switches, offline fallback, and overlapping saves must not expose or overwrite another account/device's data.
5. A full raw-row scan page at the limit and an empty aggregate page beyond the last result must not produce false complete counts.

## Task 1 — Import-only collection tools

**Files:** Modify `src/pages/EntryPage.tsx`, `src/pages/HelpPage.tsx`; create `src/pages/EntryPage.test.tsx`.

**Interfaces:** Preserve the Entry page default export and its existing context `importFromUsername` / `retryFailedEarnings` calls. Dashboard continues embedding this component; `/entry` remains a legacy redirect. Persisted profile/schema fields are not removed.

- [ ] Add a mocked-context component test asserting username import and retry controls remain, while headings `Quick add`, `Manual add (paste JSON)`, `Saved earnings profiles`, `Player cards`, and `RAX entries` are absent. Confirm no mutation occurs on render.
- [ ] Run `npm test -- src/pages/EntryPage.test.tsx`; observe the obsolete-section assertion fail.
- [ ] Remove the five sections and their now-unused state/handlers/imports, retaining import progress, failures/retry, remembered username, and account checks. Replace recovery text referring to manual controls with retry/import guidance. Remove obsolete Help instructions and inaccurate local-only/account-saving copy.
- [ ] Rerun the test and `npm run lint`; confirm import controls and Dashboard backup controls remain. Capture a browser screenshot without importing over the owner's saved data.

## Task 2 — Find the best upgrades: exact scoring and bundle speed (first priority)

**Files:** Create `src/lib/importScenario.ts`, `src/lib/importScenario.test.ts`; modify `src/lib/passRecommendation.ts`, `src/lib/passRecommendation.test.ts`; extend `scripts/benchmark-collection.mjs` or create `scripts/benchmark-ranking.mjs` for replayable real-catalog pools.

**Interfaces:** New `prepareImportScenario(data: RaxTrackerData): PreparedImportScenario` and `scoreImportScenario(prepared: PreparedImportScenario, profile: CatalogImportProfile, rarityLabel: string): ImportScenarioScore | null`. Score fields: `netClaimableDelta`, `netGuaranteedDelta`, `newClaimableRax`, `overlapRax`, `displacedRax` (all numbers). Existing public ranking/result/progress/cancellation interfaces remain unchanged.

- [ ] Write reference parity tests using `addProfileToDataAtRarity` plus full `computeYearRollup` for before/after totals and the target card contribution. Cover new and owned passes, missing incoming days, duplicate incoming/existing dates, ties, UFC sums, team handling, arbitrary rarities, simulated rarities, and mixed sports. Test that an unchanged prepared state can score multiple candidates without mutation and changed baselines use fresh contexts.
- [ ] Run the new tests and observe the missing-engine failure.
- [ ] Implement focused immutable prepared state, reusing canonical import/effective-RAX rules. Update only the affected card/day/sport candidates; preserve stable tie order and the cross-sport Pro winner. Avoid copying or rolling up the whole collection per candidate. Keep full recomputation in tests, not as a second independently maintained production scoring authority.
- [ ] Integrate the engine into synchronous/asynchronous annual ranking and each greedy rerank. Do not change caps, filters, ordering, or progress/error results. Preserve already-ranked first-pick reuse.
- [ ] Run `npm test -- src/lib/importScenario.test.ts src/lib/passRecommendation.test.ts src/lib/potentialAnalysis.test.ts src/lib/catalogImport.test.ts` and `npm run lint`.
- [ ] Re-run the same private NBA pool: 600 profiles, 40,180 rows, 505 eligible candidates. Save versioned numeric reports, compare ordered results and three picks to the reference, and collect at least five warmed timings plus the first run. Acceptance: repeatable substantial CPU reduction, initially at least 3×, without dropping candidates. Separately time discovery, profiles, avatars, ranking, and greedy picks. If unmet, profile before another algorithm change.
- [ ] Expand the comparison matrix to bundle sizes **1, 3, 5, 10, and 20**, plus a ranking-only diagnostic. Test NBA, NHL, and NFL individually; NBA + NHL; NBA + NFL; NBA + NHL + NFL; and all eligible sports with UFC excluded and included. Use fixed recorded real catalog pools for repeatable before/after comparisons; preserve the same filters, candidate caps, season exclusions, collection assumptions, and pool for each matched case.
- [ ] For each matrix cell, assert ordered ranking parity, identical greedy pick order, and matching combined guaranteed/with-Pro gain against the full-engine reference (within a documented floating-point tolerance where needed). Report requested versus actual picks if positive opportunities run out, eligible/analyzed/trimmed candidate counts, first and warmed CPU timings, full completion time, and cancelled-run behavior. Do not present a single-sport or three-pick result as evidence for every combination.

## Task 3 — Consistent guaranteed month/day deltas

**Files:** Modify `src/lib/potentialAnalysis.ts`, `src/lib/potentialAnalysis.test.ts`, `src/lib/passRecommendation.ts`, `src/lib/passRecommendation.test.ts`.

**Interfaces:** Retain `PotentialMonthlyNet.guaranteedNetDelta` and day/month result shapes, but derive their net fields from authoritative before/after totals. Candidate gross earnings remain separate.

- [ ] Add the known NBA day regression: existing values 100/90/80, new value 95; assert guaranteed net +5 and with-Pro net +15 in annual/month/day outputs. Add guaranteed → Pro, Pro → overlap, cross-sport ties, and no-Pro display cases.
- [ ] Run the targeted tests and observe the current +95 guaranteed result fail.
- [ ] Reuse prepared before/after day totals for correct guaranteed and with-Pro deltas; keep presentation fields explicitly gross versus net. Do not change the central claim rules.
- [ ] Rerun both test files and scenario parity tests; benchmark month/day calculations to prevent a full-collection recomputation regression.

## Task 4 — Fresh shared ownership scans and faster pack imports

**Files:** Create `lib/realOwnershipSnapshot.ts`, `lib/realOwnershipSnapshot.test.ts`, `api/import/_pack-ratings.test.ts`, `src/lib/packRatingsImport.test.ts`; modify `api/import/pack-ratings.ts`, `api/import/real-passes.ts`, `src/lib/packRatingsImport.ts`, `src/pages/PlanPacksPage.tsx`.

**Interfaces:** Server `getRealOwnershipSnapshot(username: string, context: RealApiContext, options?: { forceRefresh?: boolean }): Promise<{ user: RealUser; passes: RealPass[]; fetchedAt: string; source: 'real' | 'cache' }>` (use the existing exported Real user type, or its exact awaited lookup type). Browser `fetchPackRatings(username, signal?, options?: { forceRefresh?: boolean })` retains existing return fields and adds optional `fetchedAt` / `source`. API bodies accept optional boolean `forceRefresh`.

- [ ] Add fake-clock and deferred-fetch tests: normalized username/session scopes, one upstream fetch for concurrent requests, finite expiry, forced refresh, no caching errors/partial scans, aborted waiter isolation, and fresh ownership removal. Add route auth/config tests and browser response compatibility tests.
- [ ] Run these new tests and observe missing behavior fail.
- [ ] Implement a bounded, 30-second successful snapshot cache with session-fingerprinted keys, in-flight deduplication, and normal upstream concurrency. Reuse existing KV only if it improves deployed cross-instance reuse and fits payload limits; test optional-store failure fallback. Keep instance memory disposable, and do not bind shared upstream cancellation to one waiter.
- [ ] Use it for pack ratings and collection pass discovery. Deduplicate simultaneous browser pack reads; expose last-checked freshness and explicit force refresh in Packs. Replace the remaining per-pass Import all serial username loop with bounded scheduling and per-account outcomes.
- [ ] Run pack/import/scan tests. Measure at least five uncached/force-refresh and five reused-snapshot calls for `gordon`; verify the same qualifying identities/ratings and that 1,395 player-pass results are not replaced by the 323-card OTD subset. Acceptance: repeat operations at least 50% faster, with cold behavior reported separately.

## Task 5 — Account cache isolation and conflict safety

**Files:** Modify `src/lib/trackerPersistence.ts`, `src/lib/trackerPersistence.test.ts`, `src/context/RaxDataContext.tsx`, `src/components/StorageWarningBanner.tsx`; create `src/context/RaxDataContext.test.tsx` if needed for integration.

**Interfaces:** Add optional persistence scope `{ accountUsername?: string }` to `loadPersistedTrackerData` and `persistTrackerData`; anonymous/development callers retain explicit legacy access. Account callers never fall back to unscoped data. Conflict state in the context blocks further automatic cloud saves until explicit reload/recovery; preserve local data/export.

- [ ] Write account A/B isolation, failed cloud bootstrap, legacy-data retention, stale async save completion after account switch, and two-device 409 tests. Assert a conflict makes no automatic second PUT with a newer revision.
- [ ] Run tests and observe current global-fallback/retry behavior fail.
- [ ] Implement account-specific local/IDB keys and guarded bootstrap/save lifecycles. Preserve legacy data without claiming it for a signed-in account; show a recoverable warning when cloud data is unavailable. On conflict, retain local work, stop automatic overwrite attempts, and offer explicit server reload only with a clear backup/discard warning.
- [ ] Verify account tests, persistence quota/backup tests, TypeScript, and no unintended account writes in the benchmark harness.

## Task 6 — Honest range results and restricted aggregate migration

**Files:** Modify `lib/meowbotCatalogStore.ts`, `src/lib/catalogApi.ts`, `api/catalog/otd-browse.ts`, `src/pages/OtdPage.tsx`; create `lib/catalogRange.test.ts`, `supabase/migrations/20261030_catalog_range_totals.sql`.

**Interfaces:** Preserve browse `results`, `total`, `storageConfigured`; add optional `incomplete` for fallback scans. Proposed service-role RPC `catalog_range_totals_v1(p_start_date date, p_end_date date, p_sports text[], p_season_years integer[], p_pass_kind text, p_query text, p_limit integer, p_offset integer)` returns JSONB `{ rows, total }`, including a valid total for an empty page. Validate/bound range and pagination server-side.

- [ ] Add tests for data above 80,000 rows, cap reached with a full last page, empty page beyond total, filter parity, stable ordering, missing RPC fallback, and real RPC failures not silently treated as zero.
- [ ] Run tests and observe completeness/aggregate behavior fail.
- [ ] Prepare parameterized SQL aggregation and a query-plan-justified claim-day-leading index. Qualify relations/search path and revoke access from anon/public/authenticated roles; grant only the existing service role. Read-only EXPLAIN and local SQL checks require actual authorized database access; do not claim they ran if only REST access exists.
- [ ] Add compatible RPC use with honest bounded-scan fallback and an incomplete-results message. Run existing catalog/browser/API tests.
- [ ] Review migration separately. Apply no production DDL under this plan approval; if execution access or approval is missing, report exact pending validation and retain Supabase with that prerequisite documented.

## Task 7 — Security/compatibility finding conclusions

**Files:** Modify `api/cron/snapshot-earnings.ts`, `api/cron/_snapshot-earnings.test.ts`, `README.md`; inspect `api/profile/sync.ts`, `.github/workflows/earnings-snapshot.yml`, remaining audit candidates and caller references; record decisions in `docs/codebase-review.md`.

**Interfaces:** Production cron authorization requires configured `CRON_SECRET` and its bearer token; development bypass remains local-only. Do not delete the legacy profile endpoint or change external credentials silently.

- [ ] Add production-no-secret and spoofed-user-agent tests asserting denial; run to observe the existing fallback failure.
- [ ] Fail closed in production. Verify scheduled route aliases still delegate correctly and document the required deployment/workflow secret before any live promotion. Do not print secret values.
- [ ] Audit legacy sync and module references. Retain the query-credential compatibility GET only as a documented deprecation prerequisite if external usage cannot be verified; add no-store/deprecation guidance or a body-based read alternative if compatible. Never label retained risk as fixed.
- [ ] Run auth/cron/profile tests and the runtime-module audit. Conclude each remaining cleanup item as removed, still used, or deliberately retained with reason; do not equate renamed files with faster execution.

## Task 8 — Full verification, protected preview, and findings report

**Files:** Create `docs/performance-phase-two-results.md`; update `docs/codebase-review.md`, `docs/data-system-review.md`, `PRODUCT_EVOLUTION_PLAN.md`; add explicit private-fixture exclusions to `.vercelignore` if needed.

**Interfaces:** Benchmark outputs are numeric stage reports with version/dataset/cache-state/sample count. Deployed timing requests use normal access checks; no benchmark API may expose private collections or secrets.

- [ ] Run `npm run lint`, `npm test`, `npm run build`, and `git diff --check`; inspect actual output. Self-review complete changes, including failure states and existing dirty work.
- [ ] Repeat ranking/import benchmarks without competing builds/tests. Report first/warm/reused/force-refresh ranges and medians; do not report p95 from a handful of samples. Verify collection counts, candidate order, and picks unchanged except the intentional guaranteed-metric correction.
- [ ] Include the Task 2 sport × bundle-size matrix in the report and exercise representative single-sport, mixed-sport, all-sport, and 20-pick workloads on the protected preview. Clearly distinguish the complete local matrix from any smaller deployed sample; make no production-wide claim from preview-only evidence.
- [ ] Check Vercel project/auth/configuration and preview protection using existing authorized tooling. Exclude `.env*` and `.benchmarks/` from deployment. Deploy only a protected preview; if protection or required access cannot be verified, stop deployment and report the concrete blocker rather than exposing the app.
- [ ] Use normal authentication to verify representative preview APIs, request/response counts, configured cache behavior, error handling, and version. Measure browser scoring/loading on a dedicated authorized test profile/origin, never replacing the owner's stored collection. Record any unavailable browser/account instrumentation honestly.
- [ ] Publish the report with before/after timings, all changes, database methodology decision, and a disposition for every prior finding: implemented/tested, justified retain/defer, or exact approval/access blocker. Live production performance remains unverified until a separately approved rollout and measurement.

## Plan self-review

Spec coverage: Tasks 1–4 cover import-only UI, exact rankings, monthly/day correctness, and pack speed; Tasks 5–7 cover prior findings; Task 8 covers deployed verification and reporting. The five Review Focus conditions have explicit tests in Tasks 2, 4, 5, and 6. Existing interfaces remain compatible unless the spec intentionally corrects net reporting or safety behavior. Database migration and live rollout require separate authorization; no task assumes unavailable SQL credentials or preview access. The owner has already selected solo execution.
