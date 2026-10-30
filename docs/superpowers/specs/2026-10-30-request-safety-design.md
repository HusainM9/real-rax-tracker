# Superseded draft — not the implementation scope

The owner declined the caps below and subsequently disabled marketplace alerts. See `2026-10-30-request-safety-amended.md` for the approved amendments. This file records the earlier proposal only.

Status: **draft; not approved or implemented**. Owner selected continued automatic scraping with restrictions, cache-only faces, removal of individual player listings, and no repetition of HTTP 5xx failures. This supersedes the earlier suggestion to pause automatic scraping. It does not authorize unpausing production, restarting either development server, live verification, or deploying changes.

## Intent and scope

Protect the shared Real account after its operator warned about scraping/error volume. Retain the existing marketplace bulk-rating checker, its matching rules, saved alerts, notification delivery and configured schedule. Keep other automatic jobs available under enforced limits rather than deleting their schedules or introducing a blanket pause.

Work solo in the existing `codex/performance-phase-two` checkout, preserving uncommitted UI/performance work and saved data. The separate daily-packs-boosts worktree remains stopped and is not merged or restarted as part of this change. Known failing UFC schedule requests remain prohibited.

## Approaches

1. **Account-wide permanent stop after any Real error:** previously proposed, but the owner requested continued website use and restrictions instead. Do not introduce this global feature lockout.
2. **Independent per-feature limits only:** insufficient to constrain combined traffic from simultaneous users, imports, scheduled jobs and previews.
3. **Shared request admission plus scoped durable failure blocks:** recommended implementation of the owner's selected targeted approach. Keep automation; coordinate its traffic centrally, and block failed operations without disabling unrelated provider features.

The shared admission design and numeric starting limits below are builder proposals, not provider-approved limits or already-approved owner decisions.

## Behaviour

### 1. Shared Real request budget

- Enforce admission at the common Real transport so imports, manual checks, marketplace checking and scheduled earnings use the same budget. Do not rely on each feature's worker count.
- Use the existing shared KV deployment as a durable, atomic ledger. Namespace limits independently of usernames, browser accounts, environment labels, or rotating session tokens; previews using the same provider account must not receive an independent budget.
- Proposed configurable starting ceilings: **one upstream Real request in flight; at least two seconds between starts; ten requests per minute; two hundred per hour**. Count actual HTTP attempts, including rate-limit retries, not cards in the response or cache hits.
- No safe provider rate is established. These limits constrain our traffic but cannot guarantee Real considers scraping acceptable. Confirm acceptable use/rate with the provider before any owner-approved live rollout; changes to the starting ceilings require review.
- Do not build an unbounded queue. When busy or out of budget, return an explicit busy/deferred state with the next eligible time. Automatic work remains scheduled and can continue within later budgets, without a catch-up burst. Avoid starving manual imports or repeatedly restarting the same long feed from page one.
- Give each background operation a finite request/page/time allowance and retain/checkpoint only verified progress where that operation supports it. An unfinished scan is explicitly incomplete/deferred, never silently complete. Preserve marketplace filtering and notifications when adding bounds/checkpoints; do not turn a partial feed into authoritative empty results.
- If the safety ledger is unavailable or a request outcome is uncertain, do not issue another Real request without a trustworthy admission decision. This is a safety deferral, not automatic recovery probing or a blanket feature pause. Document degraded behaviour clearly.

### 2. Durable no-repeat handling

- Every HTTP 500–599 is terminal for the affected operation. No immediate retry, alternate endpoint/type fallback, force-refresh override, user retry-list entry, or later scheduled rerun of failed work.
- Reserve request identity durably before sending it, using an atomic per-endpoint operation marker. Concurrent readers must not slip a duplicate request past the failure check. A crash/timeout with an unknown outcome must not automatically expire into permission to reissue it.
- For Real, quarantine the failed method/host/path family across query variants so changing the day/filter, credentials or caller cannot repeat the failing endpoint through a different entry point. Store hashes and minimal status/reason metadata; never credentials, raw private responses or full sensitive URLs. Successful completion can release its reservation; known failed/uncertain operations have no automatic expiry/probe or reset control in this phase.
- Seed the known failed UFC home-day schedule path into the prohibited-operation rules; no live reproduction or variants.
- Preserve original upstream status and a non-retryable reason through server wrappers, compressed/partial backfill responses, browser helpers and UI. Abort affected batches/crawls and stop queuing more work after a terminal failure, while preserving valid saved collection data and clearly reporting incomplete work.
- Remove Supabase catalog's explicit 5xx retries too. Audit its import-facing callers so changing batch size or falling back to another query does not immediately reissue failed work. Keep dependency failure scopes distinct; do not claim this is proof Supabase caused the Real warning.
- Audit transport-adjacent fallbacks such as pack play averages and avatar enrichment. Do not hide a terminal 5xx in an empty result or a successful partial result which the caller then retries.
- Existing legacy/third-party import wrappers must not become an alternate way around the Real safety guard. External function internals are not present here; their upstream behaviour cannot be certified from this checkout or treated as one known-budget provider request.

### 3. Faces are cache-only

- Resolve faces from the exact saved catalog row, then an existing same-entity/sport row from another season. Otherwise use the current placeholder.
- Remove the resolver's live Real player/team lookup, alternate-type fallback and implicit creation of provider-derived metadata. No caller-supplied option can silently enable live filling.
- Reuse avatar keys already included in an explicitly requested ownership response; that does not justify an additional entity request. Existing images and saved avatars remain intact.
- Remove Real credential/configuration requirements from the face-only API. Preserve compatible response fields where consumers rely on them; successful live-fill count is always zero.

### 4. Remove individual player listings; keep marketplace alerts

- Remove the Player listings tab/component from Marketplace Alerts. Retain the bulk checker, owned-player selector, saved rules, history and delivery UI.
- Disable the dedicated individual-player listings API before any provider access, so direct URLs/old clients cannot continue that scraping path. Do not leave the endpoint live merely because navigation is gone.
- Remove or retire unreferenced individual-listing client/source files only after reference checks. Do not remove shared marketplace rule, identity, ownership or notification helpers, or saved account data.
- Apply the universal 5xx no-repeat rule to the existing checker, but do not change its matching logic or delete its scheduler. Shared budgets may defer/bound a scan; expose that honestly.

## Validation and release constraints

- Verification is **offline only**: mocked provider/KV/Supabase responses and recorded fixtures. Install a test-level network deny guard before importing request modules; an accidentally unmocked fetch must fail locally rather than reach a live service.
- Test all 5xx statuses, restart/new-caller persistence, force refresh, concurrent request admission, uncertain/crashed operations, storage outages, quota boundaries, no fallback after failure, retry-list exclusion and preservation of prior collection data.
- Test exact/sibling/missing faces with zero provider calls; verify the individual listings tab is absent and its endpoint cannot call Real; ensure existing marketplace rules/checker tests remain valid.
- Test automatic jobs still exist, respect limits and report deferral/incompleteness without duplicate notifications or catch-up loops. Never claim a mocked verification establishes a provider-approved rate or live production behaviour.
- Run targeted tests, the full offline suite, TypeScript and the build, then solo review. No live probes, dev server, deployment, schedule/config mutation in external services, migration, or production unpause is authorized by this design.

## Trade-offs and limits

Cached calculations remain fast; uncached imports/background scans become slower under the shared budget. A 143-history cold import cannot retain its former 52-second timing at ten requests per minute, and competes for the hourly budget with other activity. Persistent failure blocks may require separate operator investigation to restore an affected endpoint; unrelated endpoints can still work within budget.

Requests made by already-running old deployments, sibling worktrees, independent scripts or third-party collectors are outside an undeployed local code guard. Keep existing shutdown controls in force and audit those sources before any restart. No code change can retroactively cancel completed requests or identify Real's internal exception without logs.

Implementation plan and product changes follow only after approval of this design, including the proposed initial limits or replacements supplied by the owner/provider.
