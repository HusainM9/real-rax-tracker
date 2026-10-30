# Request Block Isolation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Owner requires solo work in the current checkout; no subagents or blanket commit of earlier changes.

**Goal:** Fix the reproduced blocking cascade while retaining the HTTP 500–599 no-repeat rule.

**Architecture:** Separate browser cancellation from confirmed failure; isolate catalog operations inside an atomic endpoint-family safety envelope; enforce KV HTTP status before SDK error conversion. Retain legacy provider blocks and existing Real family serialization.

**Tech Stack:** Existing TypeScript/React, Vitest, Vercel KV SDK, Redis Lua and native Node.

**Spec:** `docs/superpowers/specs/2026-10-31-request-block-isolation-design.md`

## Global Constraints

- Preserve all confirmed 500–599 blocks, original status, redacted logs and no automatic retries.
- Preserve live unclassified provider records, data and hosting/scheduler state. No provider probes, dev-server restart or deployment.
- Current checkout/branch, solo implementation; keep prior UI/performance work, retired features and cache-only faces unchanged.

## Review Focus

- Cancelled reads must not poison a different query or method.
- Legacy browser markers must never discard a confirmed 5xx; malformed records fail closed.
- Concurrent catalog completions must never erase another operation's confirmed failure.
- SDK pipelines and transport exceptions must make exactly one HTTP attempt and preserve source 5xx.
- No raw URLs, query values, command arguments, credentials or response bodies in incident logs.

### Task 1: Browser cancellation and method isolation

**Files:** `src/lib/safeImportFetch.ts`, `src/lib/safeImportFetch.test.ts`.
**Interfaces:** Keep `safeFetch`/`safeImportFetch(input, init): Promise<Response>`. Version method-aware confirmed-failure markers without deleting old evidence.

- [x] RED: aborted requests and legacy status-less markers do not permanently ban later route use; a failed GET does not block PUT; legacy confirmed 5xx and malformed markers stay blocked.
- [x] GREEN: do not persist new browser transport-only/embedded status-less terminal failures; stop that operation without automatic retry. Honor confirmed failures for the same method across query variants.
- [x] Verify browser suite, all 100 5xx statuses and UI import stop tests.

### Task 2: KV response-aware, single-attempt transport

**Files:** `lib/noRetryKv.ts`, `lib/noRetryKv.test.ts`, `scripts/audit-request-safety.mjs`, audit tests, store-test SDK fake.
**Interfaces:** Preserve `getNoRetryKv(): VercelKV` and exported `kv`. Use SDK public `.use()` middleware; no other consumer may access raw HTTP/SDK clients.

- [x] RED with real installed SDK: one network attempt, source 503 preserved, pipeline guarded, HTTP-200 command error does not freeze a subsequent unrelated command, uncertain exact command blocked but unrelated command permitted.
- [x] GREEN: one HTTP attempt with redirects rejected, no SDK next/retry invocation, redacted response-aware incidents. Never globally monkey-patch fetch.
- [x] Verify real-SDK cases and audit allowlist confined to the KV transport boundary.

### Task 3: Atomic catalog operation isolation

**Files:** `lib/requestSafetyStore.ts`, its tests, `lib/guardedUpstreamFetch.ts`, its tests, `src/testing/requestSafetyFake.ts`.
**Interfaces:** Extend `reserve(key, owner, operation?)` and `finish(key, owner, status?, context?, operation?)`. Omitted operation keeps existing family behaviour. Catalog GET operations use canonical query hashes; never store raw query text. Keep the existing family key and recognize legacy records.

- [x] RED: different catalog queries can run while one is in flight/uncertain; the identical uncertain query stays blocked; confirmed 5xx still blocks every query, including after another success; legacy records remain blocked.
- [x] GREEN: single-key Lua envelope, owner-checked per-operation completion and family-wide confirmed failure. Other providers retain strict family serialization.
- [x] Verify guards, store protocol, query-order canonicalization, all 100 5xx cases and import-handler regression.

### Task 4: Verification and handoff

- [x] Full offline suite, TypeScript, mandatory audit/build, native module loading and diff checks.
- [x] Solo final review against the five focus cases; important fixes require RED→GREEN.
- [x] Update safety policy/report with precise behaviour, limitations and remaining live-record review. Do not imply source fixes were deployed or original live import recovered.

## Execution ledger

- Ruling: proceed with the owner's explicit “Fix it” instruction rather than another design-selection round. Existing stack and no-repeat constraint remain; the design above records implementation choices, not new authority to reset/replay live requests.
- Ruling: retain original family keys and unclassified provider records. Cost: existing live reservations still need explicit incident review even after the code is corrected.
- Pre-flight: Task 2 retains the KV client API consumed by Task 3. Task 3's optional operation argument preserves Real/notification call semantics and older test fakes. Task 1 does not release provider safety records.
- Diagnosis: four offline characterizations reproduced broad blocking without a 5xx. Installed KV SDK `retry: false` internally permits two network attempts, and its normal error conversion discards HTTP status. Public SDK middleware is available and will be verified with the real SDK, not a createClient mock.
- Task 1: four initial browser failures reproduced, then 120 browser/import-UI tests passed. Legacy status-less browser evidence remains stored; legacy confirmed failures remain enforced.
- Task 2: seven real-SDK regressions reproduced, including two actual fetch attempts under the old SDK setting. Response-aware middleware passes seven tests; store/audit checks also pass. Intermediate full suite: 1,141 tests, typecheck clean.
- Task 3: three catalog regressions and four store protocol failures reproduced before implementation. Single-key envelope retains the existing family namespace and legacy blocks. Catalog/store/import targeted verification expanded to 250 tests, including all 100 catalog 5xx statuses.
- Verification improvement: install a disposable test-only Lua VM under ignored `.superpowers/lua-validation`, with install scripts disabled and no application dependency/lockfile changes. `scripts/verify-request-safety-lua.mjs` executes the actual Lua source with isolated JSON/GET/SET/DEL adapters, not a rewritten admission algorithm. It is an interpreter-level check, not a deployed Redis compatibility claim.
- Solo review caught malformed operation records and delayed admission after persisted 5xx. Both received failing regressions before correction. Keep the warm family latch until all locally active admissions drain; retain it indefinitely if failure persistence fails.
- Final gate: 1,258 tests / 134 files; mandatory safety 439 / 14; audit 221 runtime modules; TypeScript/native API loading/production build passed. Actual Lua interpreter check passed for 100 status families and malformed/legacy/ownership/concurrency interleavings. Source-package dry run includes safety tests and excludes API test functions/private fixtures. Diff check passed with existing Windows line-ending warnings.
- Review verdict: scoped source fix implemented and verified offline, with no unresolved code finding in the reviewed five focus cases. Live incident recovery, actual deployed Redis behavior, cross-instance storage-outage durability and production speed verification remain explicit limitations, not passing claims. Report: `docs/request-block-isolation-results-2026-10-31.md`. No deployment/record reset/provider replay performed.
