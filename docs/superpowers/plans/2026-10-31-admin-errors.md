# Admin error history implementation plan

> Execution: use superpowers:executing-plans, solo as required by AGENTS.md. Keep the current checkout and codex/performance-phase-two branch.

**Goal:** Ship the approved Errors-first Admin redesign with permanent, redacted error history across active application boundaries.

**Architecture:** A browser-safe event schema defines controlled operations, categories and sources. A separate append-only KV journal stores error events indefinitely through the existing zero-retry SDK. Passive server/provider/browser reporters record metadata without modifying Real admission. Admin gets a read-only, protected history API and an Errors view alongside existing Activity, Accounts and Catalog capabilities.

**Stack:** Existing TypeScript, React, Vercel Edge, official KV SDK and Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-admin-errors-design.md`.

## Global constraints

- Confirmed Real HTTP 500 alone creates a permanent endpoint-family block. Do not change or erase that admission history, including UFC daily games.
- Logging must not retry Real, add provider probes, change schedules, revive retired features, wrap the SDK HTTP transport or freeze unrelated work.
- Store controlled metadata only; no raw messages/stacks, bodies, credentials, cookies, headers, tokens or raw URLs.
- Indefinite retention, authenticated ingestion and admin-only history reads. No delete/unblock controls.
- Preserve current UI/performance work, private access, rate limits, headers and unsafe-host denial. Port 5175 remains stopped.

## Tasks

### 1. Safe journal and history API

Files: `lib/operationalErrorTypes.ts`, `lib/operationalErrorStore.ts`, `api/admin/errors.ts`, `api/admin/error-report.ts`, focused tests.

- [x] Write failing tests for controlled schema/redaction, untrusted browser reports, non-500 classification, append deduplication, indefinite retention, snapshot pagination and full-history filtering, legacy Real-500 readback, access control and storage-unavailable responses.
- [x] Implement append-only list + idempotency set via one SDK Lua command; no TTL/trimming. Read immutable history in atomic snapshot segments, filter server-side and expose a continuation cursor rather than claiming an incomplete search is exhaustive. Read and merge confirmed safety records without changing them; preserve unknown historical timestamps.
- [x] Run targeted tests and TypeScript. Expected: green.

Interfaces: `OperationalError`, `createOperationalError`, `parseBrowserErrorReport`, `appendOperationalErrors`, `listOperationalErrors`, `listConfirmedRealErrors`. UI consumes history, summary, continuation cursor and availability. Reporters send controlled inputs only.

### 2. Passive error capture

Files: `lib/operationalErrorReporter.ts`, `lib/withErrorLogging.ts`, active API exports, `lib/guardedUpstreamFetch.ts`, browser request transport and runtime listeners, relevant tests.

- [x] Write failing tests proving HTTP 400/401/429/500/503, transport/timeout and unexpected failures are recorded, logging failure cannot alter operations or retry, browser reports cannot create confirmed incidents, and server/browser duplicate reports are suppressed.
- [x] Use provider observation and active API wrappers without changing fetch counts, manual redirect refusal, bounded 429 backoff or existing response behavior. Log confirmed Real 500 immediately through the existing guard first. Schedule best-effort journal persistence with the installed Vercel lifetime helper; safe console fallback on journal failure. Keep logging/read routes out of recursive reporting.
- [x] Add authenticated browser error reporting through safeFetch, plus runtime listeners. Never send exception text, stack or response content. Retired no-network stubs and scheduling are untouched. Explicitly cover failures swallowed inside successful Marketplace streaming/partial responses.
- [x] Run focused boundary, policy and ingestion tests. Expected: green with unchanged provider dispatch/admission assertions.

### 3. Admin views and error dashboard

Files: `src/pages/AdminPage.tsx`, `src/pages/admin/AdminErrors.tsx`, scoped admin CSS and page tests.

- [x] Write failing page tests for default Errors view, history-only reads, source/status/query/date filters, correct continuation/unknown states, priority Real500 records, failed reads, and access to preserved tools through tabs.
- [x] Implement the approved layout. Preserve existing tool handlers and controls, make Catalog initially closed, and defer tab-specific reads until needed. Show actual history availability and permanent retention; show unknown data as unknown. Search submitted explicitly rather than refetching on each keystroke.
- [x] Verify actual production components with fictional offline data at desktop and phone widths; exercise tab/filter behavior. Expected: readable, no horizontal page overflow, no provider requests.

### 4. Release

- [x] Solo review against spec, with particular attention to response/cookie preservation, partial/streamed errors, history pagination while new events arrive, storage outages and untrusted ingestion.
- [x] Run the entire offline suite once, TypeScript, request audit/native ESM and gated build. Expected: all pass. Secret preflight clean.
- [ ] Commit/push and deploy only the guarded current source. Verify remote safety gates, exact source and canonical static asset hashes; retain firewall protections. No live Real import/probe or user-data replacement.
- [ ] Record evidence and limits in this plan and AGENTS.md.

## Progress

Approved design and choices recorded. Work solo; no agent/reviewer dispatch or checkout change. No live provider calls.

Offline verification: 956 tests / 136 files passed (713-test remainder and 243-test mandatory gate). TypeScript, native ESM loading, 221-module request audit, production build and secret preflight passed. Actual production components were checked in an isolated interactive sample preview at desktop and 390px phone widths, including tab/source-filter/details behavior. Author-only final review followed the required solo policy; no unresolved findings. Migration ordering and activity-message redaction/team-error retention were verified RED→GREEN. No Real requests or schedule changes. Release and explicit retained-error copy pending.
