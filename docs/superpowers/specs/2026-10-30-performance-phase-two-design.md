# Ranking, pack import, and production validation design

Status: approved by the owner on October 30, 2026. The owner delegates the technical approach based on results and authorizes a protected Vercel preview, not a live rollout. Work stays solo, preserving existing local changes and saved collections.

## Intent

Make Optimization rankings and pack imports substantially faster without changing which passes win, hiding missing data, or substituting warm local numbers for production evidence. Remove the Dashboard's old Quick add, Manual add, Saved earnings profiles, Player cards editor, and RAX entries editor sections: collection changes now come through imports. Keep backup/export and the separate Cards page.

## Approaches

1. **Incremental exact scoring with the current stack — selected as the initial engineering approach.** Prepare collection claim-day state once, update only the candidate's affected days/cards, and reuse unchanged state during greedy reranking. Share short-lived, complete ownership scans for pack/collection imports. Keep Supabase/Postgres for durable base earnings and metadata; move broad range aggregation into the database. This removes repeated work before adding services.
2. **Versioned server-side ranking jobs — fallback if measurements justify it.** A queue/worker could offload large workloads from slow devices and reuse results by collection/catalog/rule version. It introduces job lifecycle, access scoping, cancellation, invalidation, and operating costs, and does not itself eliminate redundant calculations. Reassess if an exact incremental engine plus browser responsiveness work still misses the target.

The owner said to prioritize the best result and is open to changing infrastructure; this is an engineering selection, not an assertion that the owner chose a specific algorithm.

## Goals and acceptance

Fresh local baselines on October 30: `gordon` has 323 imported cards and 12,043 performance rows. A real NBA catalog pool of 600 profiles/40,180 daily rows leaves 505 eligible candidates; four annual-ranking samples took 3.91–4.01 seconds, and ranking plus three greedy picks took 11.78 seconds. Catalog discovery took 2.83 seconds and the parallel bulk-profile stage roughly 1.25 seconds, excluding avatar enrichment. Three pack-import requests returned 1,395 player passes in 1.30–2.42 seconds (median 1.54). These are diagnostic local/API and Node CPU observations, not deployed-production results or achieved improvements. Private reports/fixtures remain in ignored `.benchmarks/`.

- Ranking: demonstrate a substantial repeatable CPU reduction on the same collection/candidate pool (initial target at least 3×), test a larger real catalog pool, and measure complete load → rank → greedy bundle time separately. Do not reduce candidate coverage or change rarity/ownership/Pro rules to obtain the speedup.
- Owner clarification: **Find the best upgrades** is the main optimization tool and takes first priority. Verify bundle sizes 1, 3, 5, 10, and 20 across individual and mixed sports, including all-sport runs with UFC included/excluded; verify rankings and greedy picks, not just elapsed time. The separate month/day guaranteed-delta fix does not substitute for this speed work.
- Packs: eliminate duplicate in-flight reads and repeated fresh ownership scans, expose snapshot freshness, and provide force refresh. Report uncached upstream and reused-snapshot timing separately; aim for at least a 50% reduction on repeat operations without pretending that the first Real fetch becomes instantaneous.
- Correctness: before/after deltas must agree across annual, monthly, and daily reporting, including guaranteed → Pro and cross-sport bonus changes. Compare optimized results with the existing full claim engine, including ties, UFC aggregation, duplicates, owned upgrades, assumptions, and cancellation.
- Production evidence: use an access-protected Vercel preview with normal authentication and configured services. Record deployment/version, dataset, sample count, cold/warm state, API timing, transfer/decoding, scoring, and browser responsiveness. Verify live production only after an approved rollout; preview measurements alone are not production measurements.
- Findings: close each prior review item with an implemented/tested fix, a justified retain/defer decision, or a precise external-access/migration blocker. Do not describe an unmeasured or blocked item as resolved.

## Boundaries and sequence

1. Prioritize **Find the best upgrades**: implement exact prepared-state scoring and integrate it into annual ranking and greedy reranking. Split the new engine into a focused module. Keep a full-engine reference in tests; do not rely on an unrelated phantom-card path for owned upgrades. Verify the sport/bundle matrix, then use authoritative before/after totals for the separate month/day guaranteed-metric correction.
2. Add bounded ownership-snapshot reuse with username/provider-session scoping, completion checks, finite TTL, in-flight deduplication, and explicit refresh. No failed or cancelled read becomes a complete snapshot, and request cancellation must not poison other consumers. Use a durable cache only where existing storage is appropriate and validation supports it; instance memory is an optimization, not a correctness dependency.
3. Remove the Dashboard's five obsolete entry/editor sections; update Help and import recovery copy so no removed controls are recommended. Do not delete existing backup/schema fields or user data.
4. Address account-scoped browser caches and safe sync-conflict behavior before using account profile caches more aggressively. Keep legacy local data recoverable and never silently assign it to another account. A conflict must preserve local work and warn instead of automatically overwriting the latest server revision.
5. Assess database range aggregation/indexes with read-only plans where available. Prepare a restricted, compatible migration and completeness tests; do not apply production DDL without a reviewed migration and explicit authorization. Enforce an honest incomplete/unavailable result if the old scan cap is reached.
6. Resolve conditional cron authentication and retired sync compatibility findings without breaking scheduled jobs or silently removing external routes. Review usages before deletion; document any migration prerequisite.
7. Run regression tests/build, self-review the complete diff (no subagents), benchmark repeatably, deploy only an access-protected preview, and report both breakthroughs and remaining limits.

## Infrastructure decision

Supabase/Postgres remains the durable source for shared metadata/base earnings; KV remains suitable for ephemeral snapshots and operational state unless measured evidence shows otherwise. The existing model's raw-row range scans and full-profile transfers are query/data-flow concerns, not evidence that a database is inherently wrong. Keep canonical IDs and source histories; do not persist every user/candidate scenario as a separate source of truth. Precomputed results, if introduced, must be disposable and versioned.

Supporting references: [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization), [database functions](https://supabase.com/docs/guides/database/functions), and [Vercel runtime logs](https://vercel.com/docs/logs/runtime). Use actual query plans and runtime observations rather than inferring deployed performance from these capabilities.

## Non-goals and safeguards

- No live deployment, destructive database migration, account reset, exposed preview, relaxed authentication, or new service subscription in this approval.
- Do not increase Real upstream concurrency blindly or bypass its rate limits.
- Do not change the approved visual direction or Plan/Earnings layouts beyond removing obsolete import-page sections and inaccurate help copy.
- Keep private benchmark fixtures ignored; never log credentials or publish collection responses.
- No blanket deletion/rename of compatibility modules solely for appearance or an unproven speed benefit.

## Builder self-check

Existing paths and comparison semantics have been traced. Implementation details left to engineering are the prepared-index representation, cache TTL selected from freshness tests, bounded scheduling, and profiler implementation. Full-engine parity and completeness are required regardless of representation. Production SQL plans, deployed environment parity, and protected-preview access must be verified rather than assumed.
