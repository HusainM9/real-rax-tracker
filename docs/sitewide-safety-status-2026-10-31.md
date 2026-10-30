# Site-wide safety, marketplace cadence and speed status

Release update: the owner subsequently authorized resumption. Safeguards are now deployed in corrected production build `dpl_AUPL2KgXqbCmYMxTMoM7PyKz4znE`, with four-minute/zero-retry Marketplace scheduling active, Earnings retired, legacy deployment hosts denied, and the failed retired snapshot path still blocked. See `deployment-resume-2026-10-31.md` for the single preview boot failure, offline ESM fix, final 1,111-test suite / 298-test remote safety gate, and verified release state. The local-only statements below describe the earlier implementation checkpoint, not the final hosted state.

October 31, 2026. Owner amendment implemented locally, solo, on `codex/performance-phase-two`. No deployment, hosting unpause, remote scheduler edit, live request/benchmark or dev-server restart was performed. Earlier shutdown remains the last confirmed hosted state, not a fresh remote verification.

## Marketplace

- Alerts restored in source/UI. Individual player listings stay removed and their API stays HTTP 410. Faces remain saved-catalog/sibling-cache only.
- Scan admission is shared by cron and manual checks. An atomic start gate allows at most one admitted scan per **240 seconds**, with an independent overlap lease and owner-checked release. Completion does not extend the interval. Tests cover 120 seconds, 239 seconds, exactly 240 seconds and concurrent arrivals.
- An old two-minute hosted trigger cannot double provider scan frequency after this code is deployed. Early arrivals receive a skipped acknowledgement without provider access. The client preserves existing notifications rather than fabricating an empty scan.
- Intended primary QStash trigger for an approved rollout: `*/4 * * * *`, delivery retries disabled. This setting has **not** been edited remotely. The repository GitHub fallback is restored at ten minutes, not falsely labeled four minutes.
- Nominal scheduled scan opportunities fall from 30/hour to at most 15/hour. This halves cadence, not necessarily total traffic. Busy/deferred runs, fallback timing and manual checks can delay the next automatic scan; four minutes is not a guaranteed notification deadline.

## Site-wide 5xx rule before deployment

- Every direct HTTP call in the application runtime now goes through the shared browser guard or durable server transport. Covered callers include authentication, account/cloud data, earnings/history, admin, catalog, collection/Packs imports, marketplace and server notification delivery. KV uses its no-retry SDK boundary.
- All HTTP 500–599 are terminal. Shared provider blocks have no automatic expiry or force override. Changed queries, users, sessions and later runs cannot bypass the same failed endpoint block. Source status/non-retryability is preserved through import/catalog/manual-earnings wrappers and partial failure/error lists. Affected queues stop.
- Pending admission is not evidence of a 5xx. It defers provider access without permanently poisoning a browser merely because another invocation is in flight. Future calls still require admission; uncertain provider requests remain reserved indefinitely. A pending flag cannot override a genuine 5xx.
- `npm run build` now runs a mandatory `prebuild`: AST request-boundary audit, then offline safety regressions. Vercel's repository build command is explicitly `npm run build`. New direct fetch references/aliases or known network SDK imports outside approved boundaries fail the build. Do not skip the gate or deploy stale/prebuilt artifacts.
- The auditor is a regression guard, not a sandbox. Intentional obfuscation, external collectors/functions, old deployments, browser-managed images/fonts/assets and hosting-managed retries are not universally controlled by application code.
- KV cannot record its own outage inside unavailable storage. SDK retries are off and a warm instance latches faults; provider admission fails closed. Fresh instances still require a storage admission attempt. Recovery requires separate operator review, not repeated live failure probes.

## Speed impact

| Area | Impact |
| --- | --- |
| Optimization scoring / bundles | No scoring-algorithm change in this pass. Earlier incremental-scoring improvements remain. Pure CPU ranking does not call the guard. |
| End-to-end optimization page | Catalog discovery/transfer is guarded IO, so faster local scoring does not guarantee the same button-to-result time. |
| Faces | No extra Real entity lookups for missing faces. Saved images or placeholders only; catalog/image loading still exists. |
| Warm ownership/Packs | Successful snapshots retain the 30-second freshness window. Cache hits can avoid provider admission. Previous live medians are not re-certified. |
| Uncached imports/catalog/notifications | One KV reservation plus one owner-checked release means **two storage round trips per successful upstream attempt**, besides HTTP. Same-endpoint calls are serialized locally; cross-instance conflicts defer. No-retry/unbatched KV handling and browser JSON inspection add other overhead. Large IO-heavy imports may be noticeably slower. |
| Marketplace | Half the nominal scan frequency, not a faster individual scan. No new account-wide requests/minute or hourly quotas were added. |

Earlier protected-preview figures (Packs reused median ~785 ms; recorded-pool NBA ranking plus three picks ~674 ms) predate the guards. The ranking figure excluded catalog network loading; Packs included a different IO path. They remain historical evidence, **not current protected-runtime promises**. No new live timing distribution was measured. Any live verification must be separately authorized and never repeat a 5xx; uncontrolled burst benchmarking is not appropriate.

## Verification and review

- Full offline suite: **1,094 tests / 130 files passed**.
- Mandatory build safety suite: **284 tests / 12 files passed**, including all 100 numeric 5xx statuses in both browser and server guards.
- Request-boundary audit: **220 runtime modules passed**, including middleware. Only the two approved transport implementations contain direct fetch calls.
- TypeScript/production Vite build and `git diff --check` passed. Browser assets contain no upstream transport/storage SDK markers.
- Solo review per the owner's no-subagent instruction. Fixes include pending-versus-failed admission, original earnings/catalog status propagation and audit false-positive handling. No independent reviewer or production verification is claimed.

These changes are local, not active on the paused hosted site. An approved rollout must retain the common ledger, run the mandatory gate, set/verify the hosted four-minute/no-delivery-retry scheduler configuration without replaying known failures, and cover old previews/independent collectors.
