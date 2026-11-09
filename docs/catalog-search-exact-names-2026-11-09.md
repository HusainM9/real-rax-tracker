# Exact-name catalog search — November 9, 2026

Searching `rodri` previously applied alphabetical ordering and the 24-row limit to all substring matches. A page of earlier names containing `Rodriguez` could therefore exclude the saved `Rodri` passes entirely. Sorting those limited results in the browser could not recover the missing player.

The shared catalog search now reads case-insensitive exact names first, then fills remaining slots with the existing name, sport and season substring matches while excluding those exact names. This applies to every consumer of `/api/catalog/search`. Exact names escape SQL pattern characters, and equal names have a stable external-key tie-breaker. The existing result limits, identity deduplication and earnings metadata handling remain in place.

The pass search performs one bounded saved-catalog read if exact names fill the limit, otherwise two. This adds no Real requests, schema changes, writes or background work. A failed read stops the search rather than triggering another query or returning partial success; a later explicit search remains possible.

## Verification

- A new offline integration fixture reproduced Rodri being excluded behind 80 Rodriguez matches before the fix. The same regression also exercises another short name, case/whitespace normalization and literal pattern characters.
- Nine new integration cases run the actual store and guarded transport with only outbound catalog/storage HTTP responses simulated. They cover crowded matches, separate seasons, result limits, unchanged sport/season/partial-name matching, stopping either failed read, and later recovery.
- Full offline suite: **1,031 tests in 144 files**, with no failures or pending cases. All **143 previously existing test files** and the project safety rules are byte-for-byte unchanged.
- CI partition: **284 mandatory + 747 remaining = 1,031**, with no overlap or omissions.
- `npm run build` passed: request-boundary audit of **222 runtime modules**, mandatory **284 tests in 37 files**, native ESM loading, TypeScript and production bundling.
- Source-package and secret preflights passed. Only the shared search function, the new regression file and this report are included in the change.

The query uses the documented [PostgREST filtering operators](https://docs.postgrest.org/en/stable/references/api/tables_views.html) and [PostgreSQL pattern escaping](https://www.postgresql.org/docs/current/functions-matching.html).

No live catalog search, application API call or Real request was run. Verification uses synthetic saved-catalog rows; it does not establish which names/seasons are currently stored in production. No saved data, schedules, retired features, authentication or Real-500 protection changed, and the port-5175 copy stayed stopped.

## Production release

Source `db5d0f480a7a9d4f560a604c017339dad306d145` was committed and pushed on `codex/performance-phase-two`. Production deployment `dpl_3a9TmBKnpUGntPGdwzZ4q2XUYXti` is **READY**, with canonical and team aliases assigned; its recorded source and required `npm run build` command match the verified release.

The hosted build passed the mandatory 284 tests in 37 files, the 222-module request audit, native ESM loading, TypeScript and production bundling. Three canonical static requests verified security headers and matching entry/Optimization asset hashes. Those frontend assets are unchanged because this fix is in the shared server search; deployment source identity and offline integration regressions provide the server-change evidence. No production catalog/API search was invoked.

Private access and other firewall rules were verified unchanged. The existing unsafe-host rule was advanced to the verified deployment, retaining canonical/team access and denying older deployment hosts. No application API or Real request was made during release verification. This release record is a subsequent documentation-only commit; no second deployment is needed.
