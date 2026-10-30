# Request-safety changes — October 30, 2026

Historical checkpoint, not the current operating policy. See the owner-approved [Real-500-only reconciliation](real-500-only-results-2026-10-31.md). Marketplace alerts were subsequently resumed at four minutes; broad internal/unknown/other-5xx bans are removed.

Implemented locally on `codex/performance-phase-two`, solo. **Not deployed.** Production shutdown was not lifted, no dev server was started, and no provider/service probes were made. Read-only OS inspection found no listeners on ports 5174 or 5175. This report is not production verification.

## Changes

- **Marketplace alerts disabled until further notice:** page renders a notice without mounting scan/listing effects. Manual and scheduled scan APIs acknowledge disabled status before auth-storage lookups, provider calls or notification delivery. Repository workflow is disabled, including manual dispatch. Saved rules/history remain intact. Remote QStash/GitHub settings were not modified; undeployed local changes do not alter old deployments.
- **Individual player listings removed from the active page:** direct API returns HTTP 410 without upstream access. Dormant implementation helpers remain unreferenced rather than deleting unrelated shared marketplace data/logic.
- **Faces cache-only:** exact saved catalog avatar, then saved same-entity/sport sibling-season avatar, otherwise placeholder. No Real player/team lookups or alternate entity-type probes, even if a legacy caller supplies live-fill options. Face API no longer resolves Real credentials. Existing images remain available.
- **Persistent Real/Supabase/legacy-import no-repeat guard:** hash method/origin/path (ignoring query variants) and atomically reserve it in shared KV before sending a request. HTTP 500–599 retains a permanent blocked record; uncertain outcomes retain the reservation. No force override, automatic expiry, fallback probe or reset UI. Known failed UFC home-day requests are blocked without probing. Failed storage admission prevents provider access.
- **Error propagation:** original status and `retryable:false` survive Real errors, partial earnings results and API wrappers. Pack-play fallback cannot hide a terminal failure. Earnings queues and the current scheduled snapshot run stop on terminal failures; skipped work is reported instead of treated as an empty earnings series. Existing earnings for failed, still-owned passes are retained, and those failures are not offered for retry.
- **Browser protection:** import/catalog/admin helpers persist a supplementary localStorage block after HTTP 5xx, embedded terminal failures or uncertain requests. Partial successful earnings can still be kept. Supabase's explicit 5xx retries and KV SDK automatic retries are removed; storage commands and pipelines latch faults in the current instance. Shared worker pools stop scheduling after a rejecting worker.
- **No new rate caps:** no spacing, requests/minute or hourly quotas were added. Same-endpoint reservations coordinate overlapping requests; unrelated endpoints are not globally disabled. Other automatic features remain in the code, subject to the separate hosting shutdown.
- **Bundle boundary:** public catalog/shop page-size contracts were separated from server modules so the storage/provider SDK is not pulled into browser assets by those constants.

## Verification

All tests use explicitly mocked responses or local data, with default-deny fetch installed for accidental network access.

| Check | Result |
| --- | --- |
| Baseline before implementation | 842 tests / 119 files passed |
| Final full offline suite (`npm test -- --reporter=dot`) | **967 tests / 126 files passed** |
| Production compilation/bundle (`npm run build`, includes TypeScript) | **Passed** |
| Whitespace/error check (`git diff --check`) | **Passed** |
| Browser-asset audit for upstream transport/storage SDK markers | No matches |

New coverage includes every numeric status from 500 through 599, changed queries, fresh transport callers, concurrent admission, uncertain outcomes, storage outages, independent endpoints, Supabase timeout failures, blocked fallback, partial-result retention, retry-list exclusion, cache-only faces and disabled marketplace entry points. RED/GREEN evidence and full logs are in the ignored request-safety execution ledger. Existing tests expecting a 500 fallback were changed to assert stopping; dormant checker behavior remains tested under an explicit test-only enabled flag, while separate tests verify the actual disabled configuration.

## Limits / rollout gates

1. Local code cannot protect old deployments, external collectors or the stopped sibling worktree until a separately approved rollout replaces/disables them. No rollout or restart is authorized by these results.
2. Shared enforcement requires all provider-calling deployments to use the same trustworthy KV ledger. Do not delete its safety keys or give previews independent ledgers. A concurrent deployment encountering a pending endpoint defers without another provider request. A crash can leave that endpoint blocked indefinitely; this is intentional, not an expiring recovery probe.
3. KV cannot durably record its own outage inside the unavailable KV. Automatic SDK retries are off and a warm instance stops storage commands after a fault; provider work fails closed. A fresh instance still needs a storage admission attempt. This is **not** an outage-proof global prohibition on control-plane requests across fresh instances. Storage recovery requires separate operator review, not live repetition to diagnose a known 5xx.
4. Browser storage is supplementary, scoped to that browser/origin. Clearing it cannot clear shared provider blocks. External legacy function internals are not available in this checkout, so their internal scraping behavior is not certified.
5. No acceptable provider traffic rate has been established. Avoiding 5xx repeats does not establish that successful-request volume is acceptable; the owner declined new caps. These tests establish local behavior, not permission from Real or production performance/safety under live load.

No commit, deployment, migration, account-data deletion or external schedule mutation was performed.
