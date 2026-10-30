# Request-block isolation fix — October 31, 2026

## Outcome

The reproduced blocking cascade is fixed in the local source and passes the offline gates. **Not deployed; the unresolved live collection-import records remain preserved.** No Real request, live import, production database call, safety-record deletion, scheduler change or development-server restart was performed in this implementation pass. Work stayed solo on `codex/performance-phase-two`, preserving earlier uncommitted changes.

The original `gordon` incident still has no recorded HTTP status or transport cause. These fixes address demonstrated defects in our safeguards; they do not establish why that original request lost its response or prove that Real rejected it.

## Confirmed defects and corrections

| Boundary | Reproduced defect | Correction |
| --- | --- | --- |
| Browser | Cancellations/network-only errors created permanent route bans; the old key also coupled GET and PUT. | Persist only confirmed 5xx in new method-aware markers. Stop an unknown operation without automatic retry. Honor legacy confirmed/malformed markers; retain status-less browser evidence without using it as a permanent route ban. Server admission still applies. |
| Shared catalog | Every query of a table shared one pending/uncertain reservation, blocking unrelated reads. | Only catalog GETs isolate canonical query hashes in an atomic envelope under the **same existing family key**. Identical uncertain queries remain paused. A confirmed 5xx blocks the entire family. Legacy owner-only family records remain blocked. |
| KV | Any SDK exception froze every subsequent storage operation, including Redis command errors delivered in HTTP 200. Installed SDK `retry: false` also made two HTTP attempts after a transport failure and discarded source HTTP status. | Public SDK middleware makes one raw HTTP attempt with redirects rejected. It captures original 5xx before SDK conversion; HTTP-200 command errors no longer freeze unrelated commands. Unknown transport outcomes pause the exact hashed command in that warm instance. Command/pipeline codecs remain supplied by the installed SDK. |

No broad volume caps, automatic expiry, force override, fallback around 5xx or provider re-probe was added. Real and notification transports retain strict family serialization and uncertain-outcome pauses. Cache-only faces, four-minute Marketplace behavior, retired features and ranking calculations are unchanged.

## Safety and concurrency review

- Catalog completion checks operation ownership in one single-key Lua evaluation. A late successful query cannot erase another query's confirmed family failure. Completion without an operation cannot delete a scoped envelope.
- A local family failure latch covers admissions already waiting for storage when 5xx arrives. It stays until local work drains and durable failure persistence is acknowledged; failed persistence retains the warm-instance latch without expiry.
- Interpreter tests caught a malformed-operation edge: false/null/non-record slots must fail closed, not look like free reservations. The failing case was corrected and rerun.
- A separate RED→GREEN regression caught delayed admission after a persisted 5xx; the queued query now sends no HTTP.
- Logs contain timestamps, status/category, UUID references and hashes, not raw query text, command arguments, provider response bodies or credentials.
- Existing legacy provider records are not migrated, cleared or bypassed by namespace changes. Browser marker handling does not release a provider record.

## Fresh verification

| Check | Result |
| --- | --- |
| Full offline suite | **1,258 tests / 134 files passed** |
| Mandatory prebuild safety suite | **439 tests / 14 files passed** |
| Catalog/store/import targeted suite | **250 tests passed** |
| Browser/import UI targeted suite | **120 tests passed** |
| Real installed KV SDK regression suite | **7 tests passed**, with HTTP mocked at the boundary |
| Request-boundary audit | **221 runtime modules passed**; raw HTTP remains confined to the three approved boundaries |
| TypeScript / production build | Passed, including mandatory prebuild and native Node API module-load verification with network forbidden |
| Actual safety Lua in isolated VM | Passed: all 100 5xx statuses, late success, unknown-operation isolation, ownership, legacy records, malformed state and clean completion |
| Source package dry run | Passed; zero API test functions / private fixture or scratch-tool files |
| Diff whitespace check | Passed; existing Windows line-ending warnings only |
| Live import / deployment | **Not performed** |

The full suite's 15.93 seconds is test-runner time, not an import/ranking benchmark. No new production performance claim is made.

### Re-running the optional Lua check

The app's dependencies and lockfile were not changed. The optional harness runs the actual template literals from `lib/requestSafetyStore.ts` in [Fengari](https://github.com/fengari-lua/fengari), using isolated JSON and GET/SET/DEL adapters. It is stronger than a rewritten storage fake but **not** a real Redis/Upstash deployment test. Its test-tool package must be installed explicitly; the harness never installs anything or reads live credentials.

```powershell
npm install --prefix .superpowers/lua-validation --no-save --package-lock=false --ignore-scripts --no-audit --no-fund fengari@0.1.5
node scripts/verify-request-safety-lua.mjs .superpowers/lua-validation
```

This run used Fengari 0.1.5 from an ignored disposable tool directory. Normal `npm test`, `npm run lint`, `npm run build`, the Lua harness and source-package dry run all use no live provider requests.

## Remaining boundaries, not silently resolved

1. **Live import is still paused by its old records.** The preserved Real username and shared catalog reservations need an explicit incident-review/recovery decision; this fix does not authorize erasing unknown history or repeating any known 5xx. Do not use another account, parameter or deployment to bypass them.
2. **Production deployment and normal-use verification remain separate.** This pass did not change aliases, firewall rules, schedulers or stopped dev hosts. Old denied preview URLs do not become valid because source tests pass.
3. **Storage-outage durability has limits.** KV cannot persist its own HTTP outage into the unavailable store. Its transport latch is warm-instance only. If a provider failure cannot be finalized durably, its exact reservation remains, but cross-instance family-wide failure propagation cannot be guaranteed until storage is available and the incident is reviewed. Already-dispatched concurrent catalog reads cannot be unsent. Do not call this a universal distributed no-repeat guarantee.
4. **Review was solo**, as requested; it is not independent review. Known live incident recovery, production Redis behavior and new production speed measurements were explicitly set aside, not graded as passing.

Execution ledger: `docs/superpowers/plans/2026-10-31-request-block-isolation.md`.
