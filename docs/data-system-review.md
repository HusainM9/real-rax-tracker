# Data gathering and performance review

Current implementation/evidence: [Performance phase two](performance-phase-two-results.md). Annual ranking now uses exact prepared affected-day/sport scoring; guaranteed deltas and account-cache/conflict safety are corrected. Deployed repeated Packs reads measured 785 ms median versus 1,901 ms forced fresh. SQL aggregation remains drafted, disabled, and unvalidated against Postgres; remaining browser access is blocked. The sections below preserve earlier-phase measurements and next-step history.

Latest measured pass: [Codebase and performance review — October 30, 2026](codebase-review.md). It records isolated live imports of `gordon`, the cache/parallel-enrichment changes, and outstanding correctness/data-safety findings. Earlier measurements below are retained as phase-specific history, not final end-to-end claims.

## Assessment

The existing separation between Real transport, sport/season normalization, shared catalog earnings, and tracker calculations is useful and should be retained. The primary weaknesses are duplicated work, serial network dependencies, large account transfers, and catalog queries that aggregate many raw rows. Replacing the calculation rules or the front-end framework is not supported by the current evidence.

## Players and identifiers

- Real username lookup supplies user IDs; pass scans supply entity IDs, sport, season, rarity, and ownership. Sport and season normalization creates catalog keys used across imports, planning, and OTD.
- Keep IDs canonical and names for display. Collection lookup, player directory, and marketplace selection should share normalized sport/entity metadata rather than independently infer identity from names.
- The current marketplace player directory comes from catalog passes with earnings. It is not a complete authoritative list of all Real players; missing/new players require catalog ingestion or a separate verified roster source.
- A dedicated player directory separated from seasonal earnings would make discovery more complete and reduce repeated pass metadata. This needs ingestion and migration planning rather than a cosmetic UI change.

## Earnings imports

- Current work can include username lookup, pass discovery, catalog lookup, avatar enrichment, and missing/stale earnings backfill. Shared catalog rows reduce repeated Real calls across users.
- Implemented: get daily earnings rows and their count in the same first Supabase response. Single-page reads now use one request instead of two; a 1,500-row test uses two instead of three.
- Implemented earlier: keep configured request slots occupied rather than waiting for full waves. Default batch concurrency is one, so this scheduling change alone does not accelerate the default import. Higher Real concurrency requires rate-limit measurement.
- Implemented in the measured review: avatar-only PATCH/insert-if-missing writes prevent enrichment from resetting earnings metadata; avatars now run alongside earnings. Larger read-only cache probes avoid serial small earnings requests for fresh histories.
- Live `gordon` imports returned 323 cards and 12,043 earnings rows with zero failed passes. The warm old path took 9.05 seconds; three final optimized runs took 4.02–4.42 seconds (median 4.29). The first mixed-cache 51.97-second import included 143 upstream history fetches and is not a fair warm-cache comparison.
- Next: measure cold/stale imports and additional collection sizes. Do not cache an incomplete collection as complete.

## OTD optimization

- Implemented: reuse unchanged baseline and candidate rollups across comparisons and bundle analysis. Calculation rules and result ordering are preserved and covered by parity tests.
- Synthetic 600-pass/24,000-row measurement: a 15-upgrade analysis fell from about 767 ms to 313 ms. This measures local calculation time, not a complete live ranking operation.
- Latest real-import dataset: prepared baselines and affected-day indexing reduced October ranking from a warmed 718 ms to 108–182 ms in final runs, with 54 eligible candidates. Annual ranking remains a scaling priority. The review also documents a legacy guaranteed monthly/day delta inconsistency that needs a separate correctness fix.
- Large date-range catalog browse currently reads up to 80 pages of 1,000 raw earnings rows and aggregates in the function. This is an infrastructure priority: the cap can also affect completeness, not just speed.
- Next: inspect the real database query plan, then evaluate SQL aggregation, deterministic pagination, a claim-day-leading index, and reusable aggregates keyed by calculation version and data freshness. Verify result and count parity, including datasets above the existing cap, before rollout.

## Pack imports

- Per account, the current path performs username lookup followed by an unfiltered pass collection request.
- Implemented: Sync all processes up to two accounts concurrently, retaining individual errors and functional state updates. This improves multi-account scheduling; actual Real latency and rate-limit impact remain unmeasured.
- Next: consider a shared short-lived account collection snapshot for both import and pack ratings, with explicit refresh and account/sport/season scoping. Avoid multiple tools fetching the same collection independently.

## Page loading

- Routes were already split into separate downloads. Cloud account initialization still loads a whole tracker profile before storage is ready; local development bypasses part of production initialization.
- Implemented: load the import engine only when import/retry is invoked. Main production JavaScript decreased from 379.02 KB (114.08 KB gzip) to 357.59 KB (108.47 KB gzip).
- Next: instrument account-session and profile-transfer timing, payload size, decompression, render time, and query waterfalls. Evaluate account-scoped cached reads with revalidation and smaller profile slices only with conflict handling and privacy isolation preserved.

## Marketplace counts

- Player view requests the card feed, excluding bulk-rating and serial pass feeds. It automatically loads 25 qualifying players initially, with two concurrent requests and a short browser cache. Load-more requests extend the same flat table.
- Current definition of “at target”: an open card auction's current bid has reached the seller's positive target (`buyNowPrice`). This is distinct from merely having a seller target.
- Pagination is bounded; incomplete results are labeled as a lower bound. The UI should never turn a failed or incomplete request into an authoritative zero.
- The owner-count filter uses the season-specific pass-info `info.count` value, the same value Real's own client labels “Card holders.” Counts are cached for five minutes. Failed count reads remain unknown, never zero.
- A minimum of 100 verified owners is always enforced. Unknown and lower counts are hidden; the server skips auction reads for those players. Scans stop after 100 candidates per batch or on access/rate-limit failures, rather than making unbounded requests. Unavailable checks can be retried with the browser cache bypassed.
- Clickable table headers sort the loaded players in either direction by name, owners, catalog base RAX, open card count, or target-price card count. This is not a complete sport-wide listing census; the UI explicitly describes sorting as scoped to loaded players.
- A listings dropdown replaces the target-card checkbox. Individual auctions expand inline beneath their player, with current bid, seller target, and a link to Real.

## Optimization controls

- The collection-choice UI was removed. The optional Assume upgrades from Plan card lists Plan passes with individual checkboxes, plus Select all / Deselect all. Checked passes use the existing Iconic 1 assumption logic across the analyses; saved Plan and collection objects are not mutated.
- Analysis sections use cards again. The month/day analysis remains one card with a mode switch. Earnings and Plan layouts were left unchanged in this revision.

## Earnings history

- The account history route now loads 120–365 recent scheduled snapshots per account, bounded by 6,000 requested snapshots across linked accounts. This exposes saved history; it cannot recover days never captured.
- Snapshot reads use batches of 30 KV MGET keys instead of one HTTP request per snapshot. A 100-day test performs four MGET calls.
- The client opts into gzip/base64 history responses. Legacy callers still receive the original uncompressed response shape. Snapshot bootstrap builds the account/day cache in one pass rather than repeatedly copying the growing cache.
- The report offers 30-day, 90-day, all-loaded, and custom inclusive date ranges. Rankings follow the selected range. Charts group more than 45 tracked days into Monday-based weekly totals without dropping earnings.
- New history entries retain player avatars. Older entries without images use the existing identity fallback.

## Earlier phase validation — October 30, 2026

- Production build passed; all 739 tests across 101 test files passed. The initial sandbox run was blocked by temporary-file rename permissions before tests executed; rerunning outside that restriction passed.
- Personally checked Calendar, Optimization's combined month/day switch, Plan's add-pass disclosure, and Earnings' range controls in the local browser. Invalid date ranges show feedback and clear range-dependent results.
- The development Earnings preview has only 30 synthetic days, so server retention limits, weekly grouping, compression compatibility, and KV batching are covered by deterministic tests rather than a populated live account demonstration.
- The local browser is not signed into an account, so live marketplace counts remain access-protected. Populated 25-row loading, ownership qualification, sorting, inline expansion, and target filtering are verified with mocked component tests, not fabricated live counts.

## Measurement limits

Build size, deterministic request-count tests, synthetic benchmarks, and isolated live collection imports are available. The latest pass has 753 passing tests across 104 files and a passing production build. Production account/page load times, cold-import distributions, populated mobile layout, larger catalog ranking pools, and database query plans still require representative verification. These changes do not establish optimal end-to-end speed.
