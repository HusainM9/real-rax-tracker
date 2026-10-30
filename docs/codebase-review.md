# Codebase and performance review — October 30, 2026

## Phase-two update

See [the performance phase-two report](performance-phase-two-results.md) for the current implementation and evidence. Exact incremental annual rankings, corrected guaranteed deltas, short-lived Packs scan reuse, account-scoped persistence/conflict safety, import-only controls, honest capped catalog results, and fail-closed cron authorization supersede the corresponding open findings below. The earlier review is retained as a dated baseline, not a statement that those fixes are still absent. SQL aggregation remains gated/unapplied; production-wide performance and remaining protected-browser checks are not established.

## Decision

Keep React/Vite, the canonical pass identities, the shared base-earnings catalog, and the central claim engine. The measured bottlenecks are request waterfalls and repeated calculation work, not the framework or filenames. Improve those paths before considering a platform migration.

This pass includes an architecture/dependency review, targeted implementation, a real collection import, calculation parity checks, and the full regression suite. It is not a production load test, a line-by-line security audit, or proof that every route is optimally fast. No production deployment or database migration was performed.

## How the project works

| Area | Current flow and authority | Assessment |
| --- | --- | --- |
| App and pages | Lazy React routes → account/profile bootstrap → shared tracker context → page selectors and calculations | Keep route splitting. Whole-profile initialization and broad context updates need production profiling. |
| Identity and ownership | Real username lookup → owned pass scan → sport/season normalization → canonical external keys | Viable. Names are display metadata, not reliable identity. Keep shared normalization and season boundaries. |
| Collection import | Owned eligible passes → fresh shared catalog histories → Real backfill for misses/stale histories → normalized cards/performances | Viable after eliminating the cache-hit request waterfall. Keep bounded Real concurrency and partial-failure reporting. |
| Faces and metadata | Exact catalog face → sibling-season face → bounded optional Real entity lookup | Optional enrichment should run alongside earnings, with field-specific writes. Implemented below. |
| OTD, Calendar, Overlaps | Base earnings + rarity/season rules → central claim engine → daily and annual rollups | Keep one rule authority. A day pools years, takes the top two per sport, and optionally one Pro bonus; sport-specific handling stays intact. |
| Optimization and Sell | Baseline rollups → candidate scenarios → collection deltas, displacement details, and rankings | Reuse baseline/indexed day buckets. Annual ranking still scales with candidates × collection work; larger pools need another measured pass. |
| Plan | Saved intended acquisitions/upgrades → scenario data → the same claim calculations | Keep logic. Optimization's selected Plan-upgrade assumptions do not mutate the saved collection or Plan. |
| Packs | Account username/pass scans → rating lookup → sport/season pack tracking | Two-account scheduling already exists. A shared short-lived scan could avoid duplicate import/pack scans, but completeness and ownership freshness must be explicit. |
| Earnings | Public pass/booster/game data → daily reconstruction → scheduled account/day snapshots in KV → range reporting | Keep immutable successful snapshots and bounded retries. Retention cannot recover days that were never captured. |
| Marketplace | Catalog player candidates → verified owner counts → individual card-auction feeds, separate from pass/bulk feeds | Keep minimum 100 owners, bounded pagination, unknown/error states, and loaded-player sorting. Hidden from navigation for now; routes remain available. |
| Account storage | Gzip profile transfer → normalization → browser persistence and debounced conditional account saves | Remove duplicate serialization, but fix isolation/conflict behavior before adding more aggressive caching. |
| Admin and background jobs | Shared import/catalog/provider helpers → operator routes, crawls, ownership scans, snapshot and alert jobs | Keep shared helpers, access gates, budgets, backoff, and diagnostics. Do not delete externally callable routes merely because the UI no longer links them. |

## Implemented in this pass

### Faster collection imports

- Added an opt-in cache-first path to the browser earnings importer. It checks up to 80 pass keys per read-only request, with two cache probes in flight. Only misses enter the existing 16-pass Real-fetch pipeline.
- Cache probes cannot fetch from Real or update earnings. Older servers that do not support probes fall back to the regular path. Authorization, unavailable configuration, cancellation, and expired sessions remain explicit failures.
- Did not raise Real earnings-fetch concurrency or remove rate-limit/backoff safeguards.
- Ran avatar enrichment alongside earnings instead of serially before it.
- Fixed avatar writes first: existing catalog rows receive an avatar-only PATCH; newly discovered metadata uses insert-if-missing. Enrichment no longer resets earnings totals/freshness or overwrites a concurrent earnings insert.
- Bounded sibling-avatar lookups and added a 60-second, size-limited negative cache for attempted unresolved faces. Exact catalog faces are still checked first.
- Fixed Real re-import recovery: still-owned passes with retryable earnings failures retain their prior rows, remapped to the newly imported card IDs. A successful empty earnings response does not retain obsolete rows; removed ownership does not come back.

### Faster OTD scenario calculations

- Prepare the baseline once per batch and index existing performances by recurring claim day.
- Recalculate only days touched by the candidate, retaining every sport on those days because the Pro bonus can move between sports.
- Skip presentation-only displacement ladders during numerical catalog ranking. Interactive detail views still receive them.
- Kept the central claim rules and existing ranking behavior. Added deterministic randomized comparisons against complete claim-engine recomputation, including duplicate days, multiple sports, rarity assumptions, and Pro displacement.
- Annual ranking remains a different path and was not made universally incremental. Its remaining cost is documented below.

### Profile loading and persistence

- Normalize already decoded account objects directly instead of stringifying and parsing them again.
- Reuse the chosen full/compacted JSON when saving browser data rather than serializing it a third time.
- Kept existing storage formats and backup compatibility. No account data was migrated or removed.

### UI and naming

- Renamed the heading to **Find the best upgrades**.
- Renamed `PotentialPage.tsx` to `OptimizationPage.tsx`; retained `/potential` so existing links keep working.
- Removed Marketplace from the navbar without removing the feature or its endpoints.
- Kept the approved Plan and Earnings layouts unchanged in this pass.
- Fixed an initial empty-search debounce in player listings that could reset a just-expanded table back to 25 rows; added a timer-controlled regression test.

## Real collection benchmark

User-approved account: `gordon`. Measurements used the actual browser import module against the existing local API server, not fabricated responses. Imported data was kept separate from browser/account profiles. Normal import requests may populate the shared catalog cache.

All successful runs returned **323 cards, 12,043 performance rows, 366 claim days, and zero failed passes**. These are result-count checks, not a claim that every external response is immutable between runs. Import statistics can count canonical cache keys differently from the raw pass scan; the final imported row/card counts were checked separately.

| Measurement | Import duration | Earnings source / qualification |
| --- | ---: | --- |
| First observed baseline | 51.97 s | 181 cache hits, 143 upstream earnings fetches; mixed-cache, not a pristine cold-cache test |
| Previous serial batch path, warmed catalog | 9.05 s | 324 reported cache hits, zero upstream earnings fetches; 21 normal earnings requests |
| Larger cache probes, still serial avatars | 6.62 s | Five cache probes, zero upstream earnings fetches |
| Cache probes + parallel avatars, final run 1 | 4.29 s | Zero upstream earnings fetches |
| Final run 2 | 4.42 s | Zero upstream earnings fetches |
| Final run 3 | 4.02 s | Zero upstream earnings fetches; unresolved-face cache also warm |

Final warm-import median: **4.29 seconds**, about **53% faster** than the measured 9.05-second warm old path. The initial 52-second import is not an apples-to-apples speedup claim: warming 143 histories accounts for much of that difference. Three final runs are a useful local check, not p95 statistics. The old warm path was measured once with cache probes disabled, not a separate historical production deployment.

No target was supplied. A provisional local acceptance target of under five seconds for this warmed collection was met on all three final runs. Uncached/stale histories still depend on Real latency and throttling; no cold-import target is claimed. Final pass discovery took roughly 2–3 seconds and remains a significant external dependency.

### Calculation timings on that imported collection

Each reported CPU sample is the median of five warmed iterations after one initial iteration. They execute the real domain functions in Node/Vite SSR, not browser paint or a complete UI interaction.

| Operation | Warm old-path run | Final three runs | Interpretation |
| --- | ---: | ---: | --- |
| Claim-day calculation | 6.7 ms | 5.8–11.1 ms | Already small; no meaningful speedup claim |
| Annual collection rollup | 7.7 ms | 7.4–14.3 ms | Already small; no meaningful speedup claim |
| Annual recommendation ranking | 323 ms | 344–601 ms | Not improved in this pass; sensitive to machine load |
| October recommendation ranking | 718 ms | 108–182 ms | Prepared baseline/affected-day indexing materially reduce work |
| Fifteen owned-upgrade scenarios | 160 ms | 166–295 ms | No new improvement established by these final runs |

The ranking harness uses an analysis cap of 100 but only **54 imported profiles are eligible** after the real ranker's filters. These are owned collection profiles used as repeatable candidates, not a full external catalog discovery workload. Do not call this a 100-player or sport-wide ranking benchmark. Later runs show CPU load variation; they are included rather than selecting only the fastest sample.

The earlier synthetic 600-pass/24,000-row upgrade benchmark in `data-system-review.md` belongs to a previous phase and is not the same dataset.

## Remaining findings, in priority order

### 1. Correctness: guaranteed monthly/day deltas can disagree with collection deltas

Location: `src/lib/potentialAnalysis.ts` (`buildPotentialMonthlyNet`) and date-ranking metrics in `src/lib/passRecommendation.ts`.

Reproduction: on one day, existing NBA values are 100, 90, and 80, with Pro enabled. Add a new NBA value of 95. Guaranteed earnings increase from 190 to 195: **+5**. Total earnings with Pro increase from 270 to 285: **+15**. The existing monthly guaranteed calculation reports **+95**, while the collection guaranteed delta correctly reports +5 and the with-Pro monthly result correctly reports +15.

Cause: the monthly/day reporting path subtracts cards displaced to overlap, but misses existing guaranteed cards that remain claimable by moving into the Pro slot. The performance refactor preserves this legacy behavior; it does not silently redefine the metric.

Next: define guaranteed gain consistently as the before/after guaranteed-total delta per day/month, separate it from candidate gross earnings, and add regression cases for guaranteed → Pro, Pro → overlap, cross-sport Pro changes, and no-Pro comparisons. This is a correctness change, not an infrastructure migration.

### 2. Data safety: account fallback isolation and conflict handling

Locations: `src/context/RaxDataContext.tsx` bootstrap/autosave; `src/lib/trackerPersistence.ts` global browser keys.

- An account-load failure can fall back to the same unnamespaced browser collection used by a previous account. This can display the wrong account's cached collection on a shared browser. Production reproduction was not attempted against real accounts.
- A save conflict retries the same local payload with the newer server revision. That can overwrite another device's changes rather than resolving the conflict.

Next: account-scoped persistence with a carefully gated legacy-data migration, clear offline/read-only states, and explicit conflict recovery. Add account-switch/load-failure and two-device conflict tests before stale-while-revalidate or partial-profile caching. Existing account behavior was not changed during the import benchmark.

### 3. Catalog completeness and database cost

Location: `lib/meowbotCatalogStore.ts`, `browseCatalogPassesByDateRange`.

The range query reads at most 80 × 1,000 raw daily earnings rows, aggregates them inside the function, and then returns a total without indicating that the scan cap may have been reached. Large ranges can therefore be incomplete as well as slow.

The checked-in SQL has an external-key-leading earnings primary/index, but no claim-day-leading index. This is a schema observation, not a measured production query plan; deployed indexes may differ.

Recommended next database slice:

1. Capture actual query timings/row counts and an authorized query plan.
2. Add a server-side aggregate/RPC returning per-pass range totals, stable ordering, and accurate pagination/counts; evaluate a claim-day-leading covering index using that plan.
3. Compare old/new results on small fixtures and datasets above 80,000 rows. Distinguish complete, partial, and unavailable results.
4. Roll out behind a compatible endpoint with a fallback and rollback path. Do not rename shared tables as a speed optimization.

No SQL migration or production database change was applied.

### 4. Ranking scale and responsiveness

Annual ranking still recomputes substantial collection work for each candidate. Candidate caps are heuristics and may exclude an otherwise best candidate. A larger real catalog pool needs correctness/quality measurements as well as elapsed time.

Next: reuse indexed baseline state for annual scenarios, measure candidate-pool completeness, and move substantial batch computation into a worker if browser long-task traces justify it. Keep one scoring authority, cancellable work, and exact-reference parity tests. Merely yielding between batches does not make the CPU calculation itself faster.

### 5. Production page/bootstrap measurements

The main production JS is now 358.14 kB / 108.64 kB gzip, and Optimization's route is 94.17 kB / 22.36 kB gzip. A previous phase reduced the main bundle by lazily importing the username engine. Bundle sizes and local build time are not page-load timings.

Next: measure production session lookup, compressed profile bytes/transfer, decompression/normalization, route downloads, render duration, and long tasks on desktop/mobile. Then consider narrower context selectors, progressive profile slices, and list virtualization. Do not introduce more account caching before finding 2 is addressed.

### 6. Conditional security/configuration hardening

- `api/cron/snapshot-earnings.ts` requires the bearer secret when `CRON_SECRET` is configured, but falls back to trusting the `vercel-cron/1.0` user-agent when it is absent. A user-agent is not an authentication secret. Production secret configuration was not inspected. Require a configured secret for production before relying on this route's protection.
- The retained `/api/profile/sync` compatibility GET accepts a passphrase in a query parameter. Its old browser caller was removed, but externally used endpoints need an audited deprecation; prefer credentials out of URLs.
- Development bypasses are intentional local behavior, not evidence that production gates are bypassed. No access gate was relaxed to obtain benchmark results.

### 7. Maintainability and compatibility

Largest modules include Optimization (~4,356 lines), recommendations (~2,002), Admin (~1,872), Packs (~1,674), and Entry/import (~1,550). Split pure scoring, feature hooks, transport, and presentation into focused modules with tests; doing so improves safety and maintainability, not automatically execution speed.

The `meowbot*` names cover shared catalog and compatibility responsibilities still used by current Real flows. Rename internal modules incrementally only when ownership is clear. Avoid a wholesale provider/table rename with no measured benefit.

## Removed or renamed code

Added `scripts/audit-runtime-modules.mjs`, a conservative TypeScript-AST dependency audit rooted at the app, middleware, API routes, scripts, and public assets. Its output is a set of candidates, not proof that external consumers do not exist.

Removed these unreferenced starter/retired client files after checking references:

- `src/counter.ts`, `src/style.css`
- `src/assets/typescript.svg`, `src/assets/vite.svg`
- `src/components/ImportShutdownNotice.tsx`
- `src/lib/onboarding.ts`, `src/lib/catalogPublish.ts`
- `src/lib/cloudSyncCredentials.ts`, `src/lib/playerEarningsCache.ts`, `src/lib/profileSync.ts`
- `src/lib/playRating.ts` (unused forwarding wrapper)

Moved the play-rating test beside the server/shared authority (`lib/playRating.test.ts`) and renamed the Optimization page as described above. Removed tracked code is recoverable through Git. No saved collections, credentials, database rows, or live API routes were deleted. Unreferenced code was already outside the active bundle, so its removal is not credited with a runtime speedup.

The final audit reports 324 total source files, including 105 test/benchmark files. It still identifies `src/assets/hero.png` and four server/compatibility modules (`meowbotGlobalCatalog`, `meowbotServerImport`, `syncPinRules`, `usernameOwnershipImport`) for follow-up. They were retained rather than assuming static unreachability proves safe deletion.

## Validation and reproduction

- Full Vitest suite: **753 tests passed across 104 test files**. The audit also counts a benchmark file, explaining its different file count.
- Strict TypeScript checks and production build passed.
- Coverage added for read-only cache hit/miss probes, stopping queued probes after authorization failure, old-server fallback, failed Real re-import retention, empty-response handling, avatar-only/insert-if-missing writes, negative avatar caching, account decoding, optimized/full-engine scenario parity, and the player-table debounce regression.
- Personally checked the changed Optimization heading and navbar in a separate local preview tab. The local preview uses development auth behavior; it is not a populated production-account page-load benchmark.
- Tests needed the normal unsandboxed runner because the sandbox previously prevented temporary-file renames; no test was counted as passed from a blocked run.

Commands (run from the repository root with the local API server available on port 5174):

```sh
npm run dev -- --host 127.0.0.1 --port 5174
npm run bench:collection -- gordon --live --label repeat
npm run bench:collection -- gordon --live --legacy-batches --label legacy
npm run bench:collection -- gordon --label replay
node scripts/audit-runtime-modules.mjs
npm run lint
npm test
npm run build
```

Live runs use the normal configured APIs and shared-cache writes. Replay uses the most recently recorded request/response fixture: it measures local processing, not real network performance, and needs recapture if request shapes change. Do not run competing CPU-heavy builds/tests while collecting comparative timing samples.

Private fixtures and detailed reports live in ignored `.benchmarks/`, including `gordon-before.json`, `gordon-warm-legacy.json`, `gordon-warm-probe.json`, and `gordon-parallel-1/2/3.json`. They contain collection data but no saved request credentials; do not publish them. Browser and account profile data were not replaced by this harness.

## Next sequence

1. Resolve the guaranteed monthly/day reporting inconsistency with explicit before/after regression cases.
2. Isolate account caches and make save-conflict recovery safe.
3. Instrument production page/bootstrap timings and a larger, representative ranking workload.
4. Replace capped raw-row date browsing with a measured database aggregate/index migration.
5. Share complete short-lived ownership scans across collection/pack workflows where freshness permits; validate cold imports and multiple accounts under real throttling.
6. Split the large feature modules and remove remaining compatibility code only after endpoint/operational usage is audited.

There is no evidence yet that switching front-end frameworks, hosting providers, or the entire data store would outperform these targeted changes enough to justify the migration risk.
