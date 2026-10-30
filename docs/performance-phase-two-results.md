# Performance phase two — October 30, 2026

October 31 safety addendum: timings below predate the site-wide request guards. Scoring improvements remain, but uncached IO now adds durable admission/release and same-endpoint coordination. Do not present old import/Packs figures as re-verified current production timings. See [current safety/speed status](sitewide-safety-status-2026-10-31.md) for the four-minute marketplace amendment and offline verification. No new live timings or rollout were performed.

Status: **paused by the owner after an upstream scraping warning**. Production is temporarily paused, local testing/dev server stopped, and new preview deployments disabled. See [the shutdown record](temporary-shutdown-2026-10-30.md). Do not resume tests or imports without explicit approval. Implementation remains in `codex/performance-phase-two`; no performance live rollout, account collection replacement, or database migration. Existing UI work remains intact and uncommitted. This report distinguishes local calculation tests, deployed preview evidence, and checks blocked by external access.

## Conclusions

- Keep React/Vite, Vercel, Supabase/Postgres, and the canonical claim rules. Repeated full-collection calculation and request waterfalls were demonstrated bottlenecks; a different database or framework is not required for the measured improvements.
- **Find the best upgrades** now prepares collection state once per rerank and changes only the candidate's affected day/sport. Greedy bundles still rerank the same eligible pool; no new candidate reduction buys the speedup.
- Repeated Packs reads reuse a successful, session-scoped, 30-second ownership snapshot. On the protected Vercel preview, five reused reads had a **785 ms median**, versus **1,901 ms** for five forced-fresh reads: **58.7% lower**. A first Real scan still depends on upstream latency.
- SQL aggregation is the appropriate next slice for broad date-range catalog queries, but the proposed migration remains disabled and unapplied. Actual query plans, SQL parity, and permissions must be validated before separate DDL approval.
- These results do not establish optimal speed on every device or live-production performance. Remaining production verification is listed below, not described as completed.

## What changed

### Rankings and correctness

`src/lib/importScenario.ts` prepares day buckets, card/row indexes, unchanged sport ladders, and baseline totals. Each candidate uses the canonical importer for that card, including retained historical rows and rarity assumptions. Only affected sport rankings and the cross-sport Pro winner are recomputed. The top four existing contenders plus the candidate suffice when an owned leader is removed or upgraded; the central claim helpers remain the authority.

The first ranked pick is reused, subsequent greedy steps get fresh prepared baselines, and cancellation/progress interfaces remain compatible. Stable tie ordering and total-reduction order are preserved. Legacy duplicate performance IDs use the full canonical engine because its ID-based Pro attribution has exceptional behavior; those damaged/legacy inputs do not get the normal fast path.

Month/day guaranteed gain now means the actual before/after guaranteed-total difference, not a candidate's gross earnings. Regression: existing NBA 100/90/80 plus 95 gives **+5 guaranteed / +15 with Pro**, not +95 guaranteed. Mixed-sport Pro displacement, no-Pro display, UFC sums, ties, owned upgrades, missing/duplicate dates, and unchanged input state have regression coverage.

Faces no longer hold numerical ranking results behind enrichment for every fetched candidate. Displayed ranking/bundle faces hydrate afterward; score inputs are unchanged and stale hydration is cancelled.

### Packs and imports

- Successful **unfiltered** ownership only; no cached partial OTD subset substituted for all passes.
- Username normalization and a SHA-256 provider-session fingerprint scope cache keys. Bounded instance memory, bounded in-flight scans, optional existing KV, compressed payload limit, and a finite TTL keep caches disposable.
- Concurrent readers share one upstream scan. Cancelling a reader does not cancel another reader's scan. Errors, malformed responses, and expired snapshots are not cache hits.
- Explicit force refresh bypasses cached reads. Collection replacement still forces a current scan by default, then seeds Packs reuse; this is a deliberate freshness tradeoff.
- Packs shows original last-checked time and source, with refresh control. The remaining serial per-pass username batch now runs at bounded concurrency two with individual outcomes.

The earlier collection-import changes are retained: larger read-only cache probes, unchanged bounded Real backfill, parallel optional faces, field-specific avatar writes, and preservation of old rows only for still-owned passes with retryable earnings failures.

### Import-only UI, account safety, and catalog handling

- Removed Quick add, Manual JSON add, Saved earnings profiles, Player cards editor, and RAX entries editor from Dashboard/import. Username import, progress/cancel, retry, remembered username, backup/export, and the separate Cards page remain. Existing saved schema fields/data were not deleted.
- Browser local/IndexedDB data is scoped by tracker account. A failed bootstrap cannot fall back to another account's collection. Legacy unscoped data remains recoverable but is not silently assigned to an account.
- Saves serialize and use the previous successful revision. A conflict or uncertain save pauses automatic cloud writes and preserves local work; explicit reload warns to export first. Account switches ignore old asynchronous completions.
- A catalog scan hitting its full 80,000-row cap is explicitly **incomplete**, never an authoritative complete total. The proposed aggregate RPC preserves the total on empty offset pages and genuine RPC failures are not silently converted to zero.
- Production earnings cron now fails closed if its bearer secret is absent; a spoofable cron user-agent is not accepted. A read-only Vercel environment listing confirms `CRON_SECRET` exists for Production (values remained hidden). Matching GitHub configuration and an actual scheduled invocation remain rollout checks; presence alone does not prove a matching value.
- The legacy sync endpoint is retained with no-store/deprecation headers because unknown external callers cannot be ruled out. Its query-PIN exposure remains a documented risk, not a solved finding.

## Measurement method

Private data stays in ignored `.benchmarks/`, excluded from deployment. The isolated `gordon` fixture has **323 cards, 12,043 performance rows, and 366 recurring claim days**. The recorded ten-sport catalog contains 10,478 profiles. The fixed pools use the existing sport caps, season exclusions, filters, and collection assumptions for both engines.

Local runner: Node 24.18.1, Intel Core i9-14900K. Each matrix cell has one first run plus five warm runs; report median and full warm range, not p95. The full-engine reference runs once per combination with bundle checkpoints. It verifies the complete ordered ranking rows, greedy pick order, combined gain, and summed guaranteed gain exactly. Its one-sample timings are diagnostic baselines, not a distribution. Local asynchronous wall time includes scheduling yields; it is not exclusive profiler CPU self-time.

Scorer/reference source SHA-256: `34fd39ecd6e8f39191d9f9b62f481aa937f54d96bb0570e46ee43ca39edc5897`.
Recorded catalog SHA-256: `203937296d6fe5a1bd37693b64e9828f1cea2109b4adfa22b9094fe50728ff52`.
Resume rejects a different source or fixture hash. No builds, test suites, or browser ranking probes run alongside timed local measurements.

### Local sport × bundle matrix

**42 of 48 cells are complete** at this checkpoint. NBA, NHL, NFL, NBA+NHL, NBA+NFL, NBA+NHL+NFL, and nine sports without UFC are complete at sizes 0/1/3/5/10/20. All complete cells have exact full-reference ranking/pick/gain parity. The UFC-inclusive comparison was stopped on the owner's shutdown request; no result is claimed for its unfinished cells.

Twenty-pick results so far, seconds (one first + five warm optimized runs; reference once):

| Sports | First | Warm median | Warm range | Full-reference checkpoint |
| --- | ---: | ---: | ---: | ---: |
| NBA | 5.35 | 5.47 | 5.31–5.77 | 81.71 |
| NHL | 6.02 | 6.01 | 5.70–6.03 | 90.77 |
| NFL | 5.27 | 5.33 | 5.30–5.35 | 84.19 |
| NBA + NHL | 10.37 | 10.41 | 10.20–10.47 | 172.63 |
| NBA + NFL | 9.76 | 11.14 | 10.13–11.54 | 104.57 |
| NBA + NHL + NFL | 14.28 | 17.03 | 16.06–17.34 | 183.44 |
| Nine sports, excluding UFC | 56.91 | 53.80 | 52.98–55.14 | 820.99 |

All six returned the requested 20 picks. Pool/analyzed/prefilter-trimmed counts respectively: NBA **1,000/400/600**; NHL **588/400/188**; NFL **806/400/240**; NBA+NHL **1,588/800/788**; NBA+NFL **1,806/800/840**; NBA+NHL+NFL **2,394/1,200/1,028**. NFL-containing pools also skipped 166 profiles with no rows. These are existing caps and filters, not complete sport-wide searches or newly reduced coverage. Owned-Iconic and adjusted skips were zero in these cells. Full size-by-size timings will follow the completed matrix.

The nine-sport pool without UFC contains 9,478 profiles: 4,550 analyzed, 4,762 prefilter-trimmed, and 166 without rows. Warm/reference checkpoints: rank only **5.83/56.99 s**; one pick **6.79/56.99 s**; three picks **11.96/155.97 s**; five picks **16.87/233.25 s**; ten picks **30.53/433.09 s**; twenty picks **53.80/820.99 s**. All returned the requested pick count; twenty picks yield 690,239 combined / 612,313 guaranteed gain, identical to the reference. This is a substantial reduction, not an instant broad-bundle experience.

### No-bundle option requested by the owner

The zero-pick diagnostic runs the complete initial individual ranking and skips all greedy bundle reranks. Ordered individual rankings are identical across bundle sizes in each verified pool. It does **not** mean no calculation or less candidate coverage; it omits the search for the best joint combination. No UI control/default has been changed by this test.

Warm local processing medians, seconds:

| Sports | No bundle | 3 picks | 20 picks |
| --- | ---: | ---: | ---: |
| NBA | 0.64 | 1.14 | 5.47 |
| NHL | 0.50 | 1.09 | 6.01 |
| NFL | 0.42 | 0.92 | 5.33 |
| NBA + NHL + NFL | 1.79 | 3.63 | 17.03 |
| Nine sports without UFC | 5.83 | 11.96 | 53.80 |

Compared with a three-pick bundle, ranking-only is roughly twice as fast in these samples; the larger 20-pick differences are not a claim about the smaller mode. These measurements exclude catalog network loading, account bootstrap, and UI render. No-bundle deployed-browser timing remains unmeasured while browser access is blocked.

The earlier matched 600-profile NBA workload (505 eligible; 40,180 catalog daily rows) improved from **3,128 ms to 435 ms** for ranking and **8,958 ms to 1,059 ms** for ranking plus three picks, with exact results. This is a separate pool, not interchangeable with the larger matrix.

### Protected Vercel preview

Verification deployment: [protected preview](https://real-rax-tracker-5cowsosaa-sniperhusain-9147s-projects.vercel.app/performance-check), `dpl_Akztr2AU2jjaaU1imeBZMQjpuMk1`. Vercel Authentication, the shared site gate, and normal tracker authentication remain enabled. No bypass remains and no production alias was promoted.

The build-flagged test screen is outside the account-data provider: selected files stay in tab memory, there is no fixture-upload endpoint, and tests perform no collection/Plan saves. The screen is excluded from normal production builds and navigation.

| Deployed measurement | First / forced-fresh | Warm / reused | Verification |
| --- | ---: | ---: | --- |
| Packs, five fresh + five reused API reads | Median 1,901.1 ms; range 1,141.8–2,515.7 | Median 785.3 ms; range 577.8–944.5 | All 1,395 passes; identical canonical rating hash; cache retains original fetched-at time |
| NBA, ranking + 3 picks; recorded pool, 400 analyzed | 718.3 ms | Median 674.3 ms; range 661.8–696.5 | All six ranking/pick hashes and gain totals match local core exactly |
| NBA + NFL + NHL, ranking + 10 picks; recorded pool, 1,200 analyzed | 4,821.4 ms | Median 4,794.5 ms; range 4,743.4–8,717.1 | All six ranking/pick hashes and gain totals match local core exactly; 318,143 combined gain; variance retained |

The browser measurements execute deployed JavaScript against the recorded catalog; they exclude live catalog discovery/transfer, account bootstrap, and persistence. There is no deployed old-engine baseline. Do not divide new browser timings by old Node timings and call that a production speedup. `scripts/verify-preview-rankings.mjs` verified all 12 saved samples offline using the same normalized collection, recorded profiles, filters, and caps, with network requests prohibited. Ranking order, complete pick objects/order, counts, and both gain digests/totals agree exactly.

Local Packs reuse was 51 ms median versus 1,928 ms forced fresh. **51 ms is not a Vercel claim**: the deployed aggregate request time is higher. Network, decoding, authentication, KV, and runtime contributions were not individually isolated. The 30-second cache may miss across serverless instances or after expiry; correctness never requires a cache hit.

Earlier local live collection imports returned the same 323 cards / 12,043 rows / zero failures. Warm median was **4.29 s**, versus **9.05 s** on the prior warm batch path. The initial 51.97 s run fetched 143 uncached histories and is not a matched cold baseline. A deployed memory-only collection-import distribution has not yet been obtained.

## Finding dispositions and infrastructure decision

| Finding | Conclusion |
| --- | --- |
| Repeated annual full-collection scoring | Implemented exact affected-day/sport scoring; full matrix verification in progress. Keep the current stack for this workload. |
| Incorrect guaranteed month/day delta | Fixed with before/after authoritative totals and regression cases. |
| Duplicate Packs ownership reads | Implemented complete 30-second snapshots, cancellation isolation, force refresh; measured deployed repeat reduction exceeds the provisional 50% target. |
| Slow initial Real request / cold history import | External latency remains; no blind concurrency increase or cold-speed guarantee. More deployed cold/stale samples required. |
| Wrong-account browser fallback / automatic conflict overwrite | Fixed account scoping, serialized saves, stale-completion isolation, and explicit recovery; deterministic tests, not destructive real-account experiments. |
| Range scan cap / raw-row aggregation | Incomplete result fixed; aggregate/index migration drafted, flag off. SQL runtime, collation/filter parity, permissions, and query plans await authorized access and later DDL approval. |
| Whole-profile page bootstrap / mobile responsiveness | Still unmeasured on representative deployed devices. Do not replatform or add aggressive caching without traces. A worker remains an option for slower devices/large bundles, not an already demonstrated need. |
| Cron secret fallback | Code fixed; Vercel Production secret presence verified without reading its value. Matching workflow configuration and successful scheduled authorization remain rollout checks. |
| Legacy query-PIN GET | Retained with no-store/deprecation; coordinated removal still needed if external consumers can migrate. |
| Dead starter/retired client modules | Eleven removed in the earlier pass; page renamed to Optimization while retaining `/potential`. Removal is maintainability, not a credited runtime speedup. |
| Remaining statically unreachable asset/compatibility modules | Retain `src/assets/hero.png`, `meowbotGlobalCatalog`, `meowbotServerImport`, `syncPinRules`, and `usernameOwnershipImport` until external usage/asset ownership is known. They are not proven hot-path costs. |
| Supabase as durable store | Appropriate for canonical identities and normalized base histories. Evaluate query shape/indexes first; retain KV for short-lived snapshots. Scenario scores should remain disposable/versioned derivatives, not another source of truth. |

## Verification and outstanding gates

Fresh regression run at 21:03 local time: **840 tests / 118 files passed** (13.09 s). `npm run lint`, `npm run build`, and whitespace checks passed; Git's LF→CRLF notices are not whitespace failures. Normal build has no preview probe screen/strings. Main JS: 363.17 kB / 110.22 kB gzip; Optimization route: 94.74 kB / 22.52 kB gzip. These are asset sizes, not page-load times. The audit reports 346 source files / 119 test-or-benchmark files and the same five retained unreachable candidates. No product code changed after this run; remaining work is benchmark evidence and documentation.

Browser access to both the exact preview origin and `supabase.com` remains denied by a saved permission or managed policy, including the retry after the owner changed the global default to always allow. No alternate API/browser/protocol workaround was used. The all-sport browser attempt was interrupted and the tab crashed; completion/results are unknown and not counted. The remaining all-sport/20-pick preview checks, deployed collection imports, and read-only SQL plans are blocked until those origins are accessible.

The owner subsequently supplied a screenshot showing Default and exact-preview permissions set to **Always allow**, and confirmed no explicit block entries. A further ordinary attempt was still denied for each site. This is an unresolved mismatch between the visible settings and browser-control enforcement, not evidence that the owner has failed to grant permission. No repeated settings changes are requested.

The SQL draft has not been parsed/executed against Postgres. It must remain disabled until validation; no database change is authorized by this performance implementation approval. Live production requires a separately approved rollout, configuration checks, matched runtime measurements, and rollback monitoring. Author self-review is used because the owner prohibits subagents; it is weaker than independent review.

Migration review also requires atomic installation of the function plus its REVOKE/GRANT (for example, an explicit transaction) before application, so a separately executed CREATE cannot briefly inherit PUBLIC execution. PostgreSQL documents the default function privilege and same-transaction restriction pattern in [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html). This remains a **do-not-apply** prerequisite, not a claim of verified SQL behavior. A static text assertion would not substitute for actual Postgres permission/rollback testing. Its [EXPLAIN guide](https://www.postgresql.org/docs/current/using-explain.html) also distinguishes planner costs from output conversion/transfer costs: a good plan alone does not establish end-to-end page speed. Lower-priority follow-up: prefilter sorting still repeats some gross-earnings estimates; no additional performance gain from memoizing that work has been measured or claimed.

Reproduce local recorded-pool verification:

```sh
node scripts/benchmark-ranking.mjs --matrix --reference --label verified-matrix --resume
node scripts/verify-preview-rankings.mjs .benchmarks/ranking-preview-nba3.json .benchmarks/ranking-preview-mixed10.json
npm run lint
npm test
npm run build
git diff --check
```

The first command requires the private fixtures and an existing matching report when `--resume` is used. Remove `--resume` for a new report. Never publish private fixture contents or deployment credentials.

## Engineering rulings and tradeoffs

These preserve the execution ledger's decisions in their original order:

1. Use the owner's current checkout on a new branch, not another worktree, to preserve UI/localhost work. Cost: a branch does not isolate existing uncommitted files; no blanket commits/resets.
2. Work solo, including author self-review, per the owner's instruction. Cost: no independent second pair of eyes.
3. Retain the ignored ledger until implementation/verification and any requested scoped commits are recoverable. Cost: extra local scratch artifacts, not runtime work.
4. Collection replacement forces a fresh ownership scan and seeds Packs reuse. Cost: collection pass discovery does not automatically get the 30-second cached-read improvement.
5. Deduplicate upstream scans, not every optional KV read. Cost: a bounded duplicate KV lookup can occur on concurrent cold requests, not duplicate Real scans.
6. Prepare the correctness task during network-only fixture capture. Cost: capture timings are not comparative calculation evidence; the matrix runs alone afterward.
7. Export shared claim helpers instead of duplicating rules. Cost: changes affect all claim consumers and require core/parity regression coverage.
8. Discard overlapping early scorer/profile timing samples. Cost: a clean rerun; their correctness comparisons are not discarded.
9. Conflict recovery uses confirmed full-page reload through the existing bootstrap. Cost: unsynced work is discarded only after an explicit export/discard warning.
10. Gate the range RPC until SQL plans, permissions, and parity are validated. Cost: the old bounded path remains, now labeled incomplete when capped.
11. Legacy duplicate performance IDs use canonical full recomputation. Cost: slower analysis for that exceptional input; normal imports retain the fast path.
12. Hydrate displayed faces after numerical results. Cost: a brief fallback image; stale hydration is cancelled.
13. Retain the legacy sync route with no-store/deprecation. Cost: query-PIN exposure remains until coordinated removal; it is not labeled fixed.
14. Pause the initial matrix for the avatar/duplicate-ID fixes and rerun final source. Cost: discard partial reference work rather than mixing revisions.
15. Add a build-flagged, authenticated, memory-only preview probe outside account persistence. Cost: QA code must remain excluded from normal builds; this was checked.
16. Resume only completed parity-verified cells with matching recorded scorer/catalog hashes. Cost: partial reference work is repeated; guard coverage is not a license to change other rule dependencies or the collection fixture between cells.

Deferred minor: repeated gross-estimate work inside prefilter sorting remains unoptimized; no gain is claimed. Outstanding SQL/browser/rollout gates above are not downgraded to cosmetic issues.

## Testing incidents and safeguards

- Vercel CLI 65.8's `curl` command unexpectedly created an automation bypass during an authentication probe. This was disclosed, that command was stopped, and only the new bypass was revoked through Vercel's official API. Read-back confirmed zero bypass entries and unchanged preview protection. It is not used for subsequent verification.
- Supabase's initial OAuth redirect included credentials in the browser tool's automatic URL output. Inspection stopped; no redirect credentials were extracted, reused, or copied into fixtures/reports. The owner finished sign-in themselves; later interaction was limited to the clean editor URL and the separately approved read-only scope. No SQL was executed.
- Saved browser-policy denials were respected even after visible permissions showed Allow. No alternate browser, raw protocol, credential extraction, or API workaround was used to reach the blocked preview or database content.
