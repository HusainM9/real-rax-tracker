# Collection Import Release Readiness Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; the owner requires solo implementation in the current checkout. Steps use checkbox syntax.

**Goal:** Prepare the approved website for release without bypassing the collection-import safety incident or repeating failed upstream requests.

**Architecture:** Retain React/Vite, Vercel, Supabase and the durable shared request guard. Improve the existing guard's incident evidence and import failure handling rather than add a retry/reset path. Read-only incident inspection is separate from offline verification; a build cannot resolve an unidentified live incident.

**Tech Stack:** TypeScript, React, Vitest, native Node ESM, Vercel, KV.

**Spec:** `AGENTS.md`, `docs/superpowers/specs/2026-10-31-sitewide-request-safety-design.md`, and the owner's October 31 instruction to finish collection-import/release readiness.

## Global Constraints

- HTTP 500–599 must not be repeated, including across parameter, session or deployment changes.
- Do not clear durable/browser failure records or retry uncertain operations to diagnose them.
- Work solo on `codex/performance-phase-two` in the current checkout; preserve earlier UI/performance work and saved account data.
- Faces remain cache-only; Earnings, Boosts and individual player listings stay retired/not shipped.
- Marketplace cadence remains four minutes with zero scheduler retries; no new volume caps.
- No database migration, live scraping benchmark, local dev-server restart or production promotion as part of preparing the candidate.

## Review Focus

- A cancellation before dispatch must not be mistaken for an unknown dispatched request.
- A cancellation/connection loss after dispatch must never release the safety block.
- Incident records/logs must not expose credentials, URLs, response bodies or exception messages.
- A partially failed import must not silently erase existing earnings or offer a terminal failure as retryable.
- A passing build must not be described as a recovered live import or current production performance verification.

### Task 1: Investigate and record the incident

- [x] Read the guard, collection import path and approved safety requirements; confirm current branch and stopped local servers.
- [x] Run baseline `npm test -- --reporter=dot`: 1,111 tests / 134 files passed.
- [x] Inspect existing deployment logs and hashed safety records read-only, stopping on any failed diagnostic request. Do not reproduce the import.
- [x] Record confirmed facts separately from unknown cause/provider/status.

### Task 2: Preserve actionable failure evidence and safe cancellation

**Files:** `lib/guardedUpstreamFetch.ts`, `lib/requestSafetyStore.ts`, their tests, `src/testing/requestSafetyFake.ts`.

**Interfaces:** Keep `guardedUpstreamFetch(provider, url, init, store): Promise<Response>`. Extend the existing owner-checked `finish` metadata to represent an uncertain incident without deleting the reservation; status-less ordinary completion still releases it.

- [x] RED: rejected fetch logs one redacted reference/reason/time and persists it; later callers remain blocked with the same reference.
- [x] RED: signal canceled while awaiting reservation sends no HTTP and releases only its own unused reservation; failed release stays fail-closed.
- [x] GREEN: implement minimal guard/store changes; never infer a confirmed 5xx from a transport exception.
- [x] Verify targeted guard/store tests, including all 100 HTTP 5xx statuses and legacy records without metadata.

### Task 3: Make import safety stops explicit

**Files:** `src/pages/EntryPage.tsx`, `src/pages/EntryPage.test.tsx`, collection/backfill tests if evidence identifies a failure-handling defect.

**Interfaces:** Existing `importFromUsername` and `retryFailedEarnings` retain their result types and collection semantics. Terminal errors are recognized with `isTerminalRequestFailure`; the UI must not invite a repeat after a terminal stop.

- [x] RED: a terminal import error retains its explanation/reference, says operator review is needed, and prevents another submission from this form; ordinary validation errors remain correctable.
- [x] GREEN: implement minimal safety-state presentation with no new reset/force control.
- [x] Verify existing partial-result preservation/no-terminal-retry cases and relevant UI tests.

### Task 4: Verify and hand off the candidate

- [x] Run full offline suite, `npm run lint`, gated `npm run build`, native API loading, and `git diff --check`.
- [x] Review changed code solo against the Review Focus; resolve important findings with RED→GREEN tests.
- [x] Update release-readiness report with exact checks and unresolved incident/release gates. Do not call the site finished if the collection import is still paused or its cause unconfirmed.
- [x] Preserve the dirty working branch without a blanket commit/push of earlier user changes. Production promotion requires a clearly resolved release gate, not merely a successful local build.

## Execution ledger

- Ruling: this is the existing approved safety design's repair/verification, not a new UI/infrastructure project. The owner requested execution; no new design-selection round or subagents.
- Ruling: keep the current checkout per the owner's explicit worktree preference. Earlier uncommitted changes are preserved; no blanket staging or commit.
- Pre-flight: Tasks 2 and 3 share terminal-error semantics, but Task 3 needs no new public API. Incident references travel in existing error messages; source status and no-repeat behavior must remain unchanged.
- Baseline: 1,111 offline tests / 134 files passed. No listeners on 5174 or 5175. One saved-log stream inspection returned no matching import incident; it did not invoke the app import.
- Task 1: complete. One read-only SCAN page and MGET found three status-less reservations; mapped the approved gordon lookup and catalog pass GET, neither with original incident metadata. Owner confirmed gordon on live roughly ten minutes before their reply. The saved-log UI's expanded time-range query failed; no retry/reset or app request followed. The original transport cause is not recoverable from those records.
- Task 2: complete. Five expected RED failures, then 118 guard/store tests GREEN. Further transport-category and after-dispatch abort cases pass in the final 308-test safety suite. Legacy records stay fail-closed, unknown outcomes never acquire an invented 5xx status, and normal success keeps the existing two safety-store round trips.
- Task 3: complete. Four expected RED failures exposed missing partial-failure metadata and no UI pause. Added optional metadata to existing per-pass errors, pause presentation and validation/pending compatibility; targeted tests GREEN. No retry/reset endpoint added.
- Final review: self-review only, honoring the owner's no-subagent rule. Found a surviving instruction to use deleted manual-entry controls; observed its regression RED, replaced the dead guidance in import/retry/snapshot messages, then GREEN. Added an offline real import-handler integration case proving one outbound lookup, persistent pause and the same public incident reference on a later caller.
- Final verification: 1,127 tests / 134 files; mandatory gate 308 tests / 14 files; request audit 221 runtime modules; TypeScript and Vite build; native API module-load regression. All passed. No live import or Real benchmark was attempted.
- Ruling: preserve old status-less reservations. Their initial status/outcome cannot be reconstructed, so neither a deploy nor successful mocks can be treated as permission to clear them. Cost: collection import and affected catalog reads remain unavailable until explicit incident review.
- Ruling: use this repository plan ledger rather than commit-range task helpers for the current dirty checkout. HEAD alone does not describe the approved/deployed working source; no blanket commit or deletion of prior work is justified. Cost: this pass has an author review and verified working-tree evidence, not an independently reviewed isolated commit.
- Release gate: **NOT CLEARED**. The candidate is build-verified; the original live import is not recovered or production-retested. See `docs/import-release-readiness-2026-10-31.md`.
