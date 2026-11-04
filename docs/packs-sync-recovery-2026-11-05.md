# Packs import counts and account-save recovery

The owner reported repeated collection-save conflict warnings during Packs imports and “Imported 4 accounts” despite five linked accounts, with no individual account error.

## Reproduction and correction

Packs read a count mutated inside React's deferred state updater. The five ratings could all be applied while the immediate returned counts were zero or incomplete. A regression reproduced five applied updates with incorrect returned totals. Collection mutations now update a synchronous snapshot once before handing the result to React; batching remains in place and asynchronous saves use that latest snapshot.

Repeated cached scans also generated identical new state objects, causing unnecessary cloud writes. They now return the existing state unchanged and report `unchangedAccounts`. Per-player bulk import reports checked/linked accounts, updated ratings, already-current scans, missing ownership, absent usernames and individual errors separately. It still requests each distinct username once with existing concurrency two and no added Real retry.

## Cloud-save protection

Previously every HTTP 409 paused cloud saving, including independent changes from another open copy. After a conflict there is now one fresh account-storage read and a conservative three-way reconciliation against the last acknowledged snapshot. Independent fields and ID-keyed entities can combine; competing values, edit-versus-delete, conflicting order changes, ambiguous IDs and conflicting primitive arrays stay paused. Entity `updatedAt` timestamps retain the latest value after compatible content changes. Local-only caches are retained locally. Edits made while the read/save is pending are preserved; old-account completions are ignored.

Reconciliation makes at most one conditional follow-up account save. Another conflict, authentication problem or unconfirmed storage response stops it; there is no retry loop. Ordinary account reads explicitly bypass caches. Server profile revision comparison and write are one official zero-retry KV SDK EVAL, preventing two writers from passing separate GET/SET checks. Revisions advance even for saves within the same millisecond. Profile deletion and the winning revision remain authoritative.

No Real protection, schedule, authentication rule, user data or retired feature is replaced or bypassed. Verification uses offline storage/network fakes only. This does not establish which other tab/device caused the owner's production conflict or prove a live import. Existing paused browser copies may contain unsaved imports: export their local backup before refreshing; no local/cloud copy has been overwritten as part of this repair.

## Checks and release

Regression sequence: failing batched count and disjoint-conflict tests; failing atomic-save tests and cached no-op test; implementation and focused checks. Focused checks passed (24 tests / 4 files). Full offline verification passed: 981 tests / 138 files (709/102 remainder plus 272/36 mandatory gate), TypeScript, native ESM, 222-module request-boundary audit and production build. The first build caught an incorrect SDK type parameter; corrected against the installed SDK signature, then the full gated build passed. Secret preflight: 451 files, no private paths/findings.

Cloud/count release: source `ed20037371ed2cf567ee7765d077af25a0a7cade`, production `dpl_CYCUzYKy2Eya5z66P3zsvQgDjYur`, READY with canonical/team aliases assigned. Remote mandatory gate 272/36, native ESM, audit222 and build passed. Three static GETs matched canonical Packs and application-entry assets to local SHA-256; firewall protection was advanced to the verified deployment and other rules stayed unchanged. No application API call, Real request/import or user-data replacement was performed during verification.

## Daily opening evidence follow-up

While publishing the recovery release, the owner reported that imports appeared to restart the opening inference. The observation model already retains positive evidence for each account/player until its America/New_York 7am window ends. A display check incorrectly rejected that established evidence whenever a newer import timestamp was ahead of the browser's clock. The new regression reproduced this in both winter and daylight-saving windows. Display now evaluates the original positive-evidence time independently of the newest reading, preserving the badge through subsequent imports and serialized reloads. Future/unestablished evidence remains unknown, different accounts stay separate, and the badge resets at the next 7am New York boundary. No scan, timer-driven API request or scheduled job was added. Follow-up verification passed: 983 tests / 138 files (704/101 remainder and 279/37 mandatory gate), TypeScript, native ESM, audit222 and build. Both winter and daylight-saving reset/latch regressions passed after failing before the fix. Follow-up deployment pending.
