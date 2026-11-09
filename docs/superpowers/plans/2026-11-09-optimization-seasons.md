# Optimization season picker performance

**Goal:** Make the Season dropdown in Find the best upgrades available sooner, preserving every catalog season and the existing ranking behavior.

**Cause:** `listCatalogSeasonYears` walks all matching player rows in 200-row offset pages just to deduplicate year/label pairs. A large college sport can repeat the same season thousands of times. `fetchCatalogSeasonYears` also starts fresh requests for repeated/overlapping consumers, including sport revisits.

**Approach:** Keep the existing authenticated catalog route and guarded storage transport. Order season rows by raw year and label, and advance past the last complete pair after each full page. This skips remaining players with that same pair without losing labels sharing a raw year; no migration/RPC or partial list is required. Coalesce browser requests per canonical sport/pass kind and keep successful metadata in memory for five minutes. Caller cancellation does not abort another consumer; failures/unconfigured storage are not cached. Existing season merging and ranking remain unchanged.

**Constraints:** Solo, current branch/checkout; no Real requests, live benchmarks, user-data writes, schedule changes or port-5175 restart. Preserve current Real-500/Edge/auth/storage boundaries.

- [x] Write failing offline tests proving complete canonical seasons with fewer reads on a duplicate-heavy fixture, small-catalog behavior and non-advancing response handling.
- [x] Implement season-pair pagination; run focused storage tests.
- [x] Write failing browser API tests for concurrent consumers, revisits, expiry, cancellation, sport/pass-kind isolation and failure recovery; implement the small metadata cache.
- [x] Verify the actual Optimization dropdown still selects/filters seasons correctly, including rapid sport changes and stale completions.
- [x] Run the complete offline suite partition, TypeScript, request audit, native ESM and build; review, commit, deploy and verify production static assets/firewall. Record measured offline request reduction without inventing live timing numbers.

Local verification passed: 1,003 tests / 140 files (719/103 remainder plus 284/37 mandatory gate), TypeScript, native ESM, audit222 and build. The 3,600-row CFB fixture dropped from nineteen reads before the fix to four after it, retaining all canonical season options including different labels sharing one raw year. A small catalog still takes one read. Browser tests cover shared requests, immutable cache results, five-minute expiry, independent cancellation, recovery after failures/unconfigured storage, UFC player/team merging and malformed metadata. The actual Optimization page test confirms a pending CFB lookup cannot replace NHL options, and a later CFB revisit enables the dropdown and permits selecting 2025–26 without another request.

Released source `f118f226ea2553dac6d22911a5293ec51409f87c` as production `dpl_7eMBML6dQ5wwWUeZ9zsm1vQBdsZp`, READY with canonical/team aliases. Remote 284/37 mandatory gate, native ESM, audit222 and build passed. Canonical Optimization page and entry hashes matched the local build, unsafe-host denial was advanced to the verified deployment and other firewall rules stayed unchanged. Verification used three static GETs, no application API or Real request. See `docs/optimization-seasons-performance-2026-11-09.md` for limits.
