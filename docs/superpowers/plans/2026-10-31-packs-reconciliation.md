# Packs reconciliation implementation plan

> **For agentic workers:** Use superpowers:executing-plans, solo in the current checkout as required by AGENTS.md.

**Goal:** Carry the approved Packs targets, embedded opening indicators, account presentation and Cards styling into the recovered website.

**Architecture:** Keep `codex/performance-phase-two` and its current guarded transport/storage. Save per-account/player observations alongside existing tracker data using only successful explicit Packs imports, with original scan timestamps. The page clock changes display status at 7am America/New_York without fetching. Reuse safe avatar URLs already returned by an existing profile response; unresolved keys use initials.

**Tech stack:** Existing React, TypeScript, Vitest, Vite and account persistence.

**Spec:** Owner-approved recommendations in this chat on October 31; this compact record supersedes the earlier daily-scanning/Boosts portions of the October 30 design.

## Global constraints

- Current checkout/branch, solo; preserve the other chat's completed, approved test-efficiency edits and all saved user data.
- No live Real requests, benchmarks, background scans, new schedulers, Boosts, retired features or port-5175 restart.
- Preserve confirmed Real HTTP 500 history, safeFetch/safeImportFetch, official zero-retry KV, manual redirects and release gates.
- Targets are 380, 1380 and 3380; missing/invalid legacy target defaults to 3380. Reaching a target does not delete the planned pass.
- Opening status is inference, separately per username/player. First reading is Unknown; later equal/lower readings show No opening detected; positive gain latches Likely opened for that pack day. Transfers can also cause gain.
- Reusing a scan cannot create a comparison. Missing/failed/invalid data does not erase evidence. Reset-spanning scans cannot prove opening. Manual rating edits do not create evidence.
- Avatars need an available HTTPS media.realapp.com URL, lazy loading and initials on image failure. No guessed CDN paths or avatar-only profile requests.

## Review focus

- Old or out-of-order scans must not regress ratings or fabricate comparisons.
- Renaming accounts and switching tracker users must not reuse another identity's evidence/avatar.
- DST transitions and the exact 7am reset must invalidate yesterday's visible status without a request.
- Old exports and malformed optional metadata must preserve existing tracker data.
- Loading and rendering Packs must make no ownership/profile requests; avatar image failure must not probe alternatives.

## Task 1: Targets and observation model

Files: `src/lib/dailyPacks.ts`, its test, `src/types/rax.ts`, `src/lib/storage.ts`, `src/lib/packTracker.ts`, `src/context/raxDataContextTypes.ts`, `src/context/RaxDataContext.tsx`, relevant tests.

- [x] Write RED tests for target calculations/defaults, NY reset/DST, fresh/equal/positive/stale readings, identity changes, persistence and manual-edit separation.
- [x] Implement pure observation/validation helpers; retain optional metadata through normal account persistence and import application. Pass original scan timing into the existing action.
- [x] Run targeted tests and type-check; commit this independently testable change.

## Task 2: Existing response metadata and embedded presentation

Files: `lib/realApi.ts`, `lib/realOwnershipSnapshot.ts`, `api/import/pack-ratings.ts`, `src/lib/packRatingsImport.ts`, `src/pages/PlanPacksPage.tsx`, `src/components/AccountAvatar.tsx`, `src/components/PlayerPackOpenings.tsx`, `src/components/CollapsiblePanel.tsx`, their tests.

- [x] Write RED tests proving existing profile data/timestamps survive, import still uses the same requests, page mount causes no import, targets and per-player statuses render, and avatar fallback does not retry.
- [x] Pass through validated existing avatar URLs and scan start/end times; do not add requests. Render target control, per-player account statuses and selected account avatars.
- [x] Port only Packs settings layout and Cards rows/metrics styling from the old branch; retain current import guards and controls.
- [x] Run relevant tests and commit.

## Task 3: Verification and release

- [x] Perform a separate solo diff review against the constraints, including cross-account/stale response paths and generated source package.
- [x] Run full offline tests, TypeScript, request-boundary audit and mandatory gated production build/native ESM checks; inspect each result.
- [x] Produce an offline/static visual proof using fictional fixtures without connecting to Real or changing account data. Keep port 5175 stopped.
- [x] Commit only reviewed approved source; deploy through the existing release process if its controls are available and verify the exact guarded build. No live import verification.

## Execution ledger

- Initial product base: `e8d1ded`. Other chat completed test-efficiency work (982 passing offline tests, build passed) but has not committed it. Do not overwrite its changes.
- Ruling: use the approved recommendation as the short spec and execute now; no repeated approval cycle, worktree or subagent. User explicitly accepted the recommendations and AGENTS.md requires solo/current checkout.
- Ruling: observations live in existing account-scoped tracker data, not a new tracking API/KV job. This preserves refresh/reset display without additional Real requests.
- Ruling: accept only supplied, validated media URLs for account images. Raw avatar hashes alone cannot justify inventing an unverified URL; those accounts retain initials until a URL is available.

- Task 1/2 complete: observed RED then GREEN for target/evidence/persistence, context import ordering and manual-edit isolation, metadata passthrough, UI/no-mount-import and image fallback. Targeted 58/58 passed. Task commits combined because the response timestamp and persisted evidence interfaces form one user-facing migration.
- Final solo review (required solo policy): confirmed the page adds no profile/ownership fetch, original guarded import/auth paths remain, failed/missing imports retain evidence, and no scheduler/retired branch code was copied. Review caught stale ownership resurrection; a RED context regression proved it, and saving the missing scan timestamp made it GREEN.
- Verification: full offline suite 907/125 passed; mandatory build 201/21 passed, 211-module request-boundary audit passed, native server ESM and TypeScript/Vite passed. Supplied-URL image fallback verified without retry. No live Real request or collection replacement.
- Static production-component preview uses fictional records, no scripts/remote assets, CSP default-src none and disabled controls at port 5180. Desktop and phone-width DOM checks found no horizontal overflow. Port 5175 stays stopped. Proof: packs-reconciled.png and cards-reconciled.png in the chat visualizations directory.
- The other chat finished its separately owner-approved test-efficiency and dead-code cleanup; its changes were preserved and passed the same combined full suite/build. Release includes those approved changes in a separate commit.
- Ruling: no independent reviewer or branch-integration menu; owner requires solo/current checkout and has already authorized commit/deploy. Reviewed the diff separately after implementation. No deferred product defect identified; opportunistic avatars may remain initials for opaque keys by design.
- Release completed: Packs commit `5f243a5`, approved test/retired-source cleanup `0183fb0ce7e44f4f978892ad14846ca346efa3ae`, both pushed on the existing branch. Production `dpl_7QwjuYTS3ebzxT6WQkpWd52Aqws4` READY, exact source commit checked, canonical/team aliases assigned. Remote mandatory 201/21 gate, native ESM, 211-module request audit and build passed.
- Hosting read-back: the three-host admission rule advances only to the verified guarded deployment; legacy unsafe hosts remain denied. Existing private access is retained, no passwords/environment/scheduler settings changed.
- Canonical verification: `/login` returned 200, and the referenced new Packs UI chunk matched the local asset by name and SHA-256. This required three static website reads and zero application API/Real calls. Successful live import and account-avatar availability are not claimed. Port 5175 has no listener; only the inert fictional preview is served on 5180.
