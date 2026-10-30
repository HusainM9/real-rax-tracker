# Temporary shutdown — October 30, 2026

Historical shutdown record. The owner subsequently authorized resumption and narrowed permanent pauses to confirmed Real HTTP 500. See [the current reconciliation](real-500-only-results-2026-10-31.md); do not restore the blanket shutdown from this older record.

Owner requested an immediate temporary shutdown after being told the shared account was scraping too much and causing errors. This supersedes the performance-test plan. Do not resume imports, provider probes, local servers, deployments, or scheduled scraping without explicit owner approval.

## Confirmed actions

- Stopped the remaining local ranking matrix (session 63304). It used recorded files and no upstream network, but was stopped along with all testing. The completed 42 matrix cells remain saved; UFC-inclusive reference work was interrupted and is not a completed cell.
- Verified the linked Vercel project identity: `real-rax-tracker`, `prj_4JGLiG3w5IQowh3ptVaUpZ0x1gD0`, team `team_qPZMWvrtZZY74SKdPqc4XVXk`.
- Called Vercel's project-pause API successfully (HTTP 200). Read-back confirmed `paused: true` and `live: false`.
- Independently verified the production root, `/api/cron/marketplace-alerts`, and `/api/cron/snapshot-earnings` return HTTP 503 with `DEPLOYMENT_PAUSED`. Verification used no application/provider credentials and made no Real requests.
- Set `previewDeploymentsDisabled: true`; API read-back confirmed it. Its previous value was **false**. This prevents new preview deployments; do not assume this proves existing preview URLs are inaccessible.
- Stopped the confirmed workspace Vite server, PID 35948, on port 5174. No other project/process was targeted.
- Stopped two additional workspace-associated local trusted-worker runtimes, PIDs 37588 and 22504, after matching the absolute workspace path in their command lines. These were local helper runtimes, not evidence of separate remote scrapers; their transient REPL state may need reinitialization on an approved resume.
- Agent inventory confirms only the root agent exists; no scraping subagents remain.

Production shutdown was verified before 21:43 Asia/Riyadh (18:43 UTC). No collection, database, deployment, credential, or repository data was deleted. No new production build was published.

## Limits and restart gates

- Existing GitHub/QStash schedules were **not** deleted or edited. Their production destinations are blocked by the Vercel pause, so newly delivered invocations cannot execute those production functions. Review delayed/retried messages before resuming; do not allow a catch-up burst.
- Already-running remote invocations were not individually cancelled or observed draining. Project pausing/new-request checks are not proof that every in-flight request or an independent external consumer has stopped.
- Existing protected previews were not accessed after the browser denied permission. Do not use their import/probe controls while this shutdown is in effect.
- Local files, all UI/performance changes, and saved benchmark evidence remain intact. The performance review is incomplete and paused, not finished.
- Before restart: investigate upstream request volume/errors using logs only (no new scraping), agree on safe budgets/rate limits, review every active trigger and retry queue, and get explicit owner approval. Then separately restore preview deployment creation if wanted and unpause the Vercel project through its normal control. Do not auto-restart local or live tests.

References: [Vercel project pause](https://vercel.com/docs/projects/managing-projects#pausing-a-project), [project settings API](https://vercel.com/docs/rest-api/projects/update-an-existing-project).

## HTTP 500 review — existing evidence only

Subsequent clarification: the owner's no-repeat rule covers **all HTTP 500–599**, for every dependency, not only HTTP 500. The historical findings below distinguish actual transport behavior from this broader required policy. Runtime enforcement remains incomplete; do not resume to test it live.

The owner subsequently established a hard no-repeat rule for anything returning HTTP 500. This is recorded in the repository-root `AGENTS.md`. No affected endpoint was called, no process restarted, and no benchmark run during this review. Only documentation changed; end-to-end runtime enforcement has **not** been implemented or deployed.

HTTP 500 means the responding server encountered an unexpected condition and could not fulfill the request. It does not identify the underlying cause or prove excess traffic. HTTP 429 specifically indicates rate limiting. Sources: [HTTP semantics, section 15.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.1), [429 semantics](https://www.rfc-editor.org/rfc/rfc6585.html#section-4).

Confirmed in the current checkout:

- `lib/realApi.ts` throws immediately for a 500. Its transport retry loop handles 429 and HTTP 400 containing `high volume`, with five extra attempts by default. It is incorrect to describe this as an automatic 500 retry loop.
- Higher-level safety is incomplete. `listPlayerPlaysForPackAverage` catches all top-plays errors and calls the recent-plays endpoint; `listTeamRecentPlays` converts upstream errors to an empty result. Those are failure masking/continuation paths, not proof that the exact failed URL was retried during this incident.
- Earnings backfill records a failed pass and continues others. Its serialized failure retains `kind`/message but not the numeric upstream status. The importer adds failures to the user-retry list without excluding 500s. A later re-import or retry can therefore repeat previously failed work; there is no durable no-repeat barrier in these paths.
- Code documents a historical Real endpoint issue: `/players/{id}/sport/{sport}/plays/top` with `viewFrame=default` can return 500. The top-plays wrapper currently defaults to `season`. This comment is not a production incident log and does not establish the cause of the newly reported errors.
- Live import/Packs benchmarks added provider traffic. The saved first `gordon` import reports 143 upstream earnings-wrapper requests, plus discovery/enrichment; this counter is not a complete provider HTTP-attempt audit. Packs benchmarks performed five forced-fresh scans locally and five in the protected preview, in addition to cached reads. The recorded sport/bundle ranking matrix used saved files, not live Real scraping.
- Repository schedules document a primary two-minute marketplace trigger and a ten-minute GitHub fallback, plus earnings snapshot triggers. These are potential recurring traffic sources; their actual delivery volume at the incident time has not been established. No shared-account global request budget or durable 500-stop state was found in the inspected transport/backfill/ownership paths. Per-operation concurrency limits are not a global account-wide budget.

The inspected saved collection-import reports have zero pass failures and only HTTP 200 app-route responses; the saved catalog capture has 147 HTTP 200 app-route responses. These records are not complete upstream/production logs. This initial review inspected the main checkout's artifacts only and did not find an incident response there. **The later cross-worktree review below found actual repeated UFC schedule 500s in the daily-features workstream.** The provider's underlying server-side exception and whether those errors alone explain its warning remain unconfirmed. Do not claim the ranking calculation or Supabase caused it.

Before any restart, the missing evidence is a redacted endpoint/path, timestamp/timezone, and existing upstream or hosting error/request logs, not another live reproduction. Review retries, fallback continuations, scheduled re-entry, and delayed queues, and implement/test the no-repeat barrier offline before any owner-approved rollout. The website remains paused.

## Passive normal-use risk review

Question: could stopping the performance tests alone prevent recurrence during normal use? **Not reliably.** Live tests added requests, but recurring jobs and some ordinary feature actions can still generate substantial shared-session traffic. This assessment is from the current checkout and saved artifacts, not a new live traffic measurement or proof of the exact deployed build's behavior.

| Path | Evidence in code | Recurrence risk |
| --- | --- | --- |
| Saved collection pages and numerical rankings | Core scoring runs on local collection plus shared Supabase catalog data. The saved sport/bundle matrix is recorded-file processing. | Ranking CPU work itself is not Real scraping. Avatar enrichment is a separate exception below. |
| Collection and Packs imports | Collection discovery defaults to fresh ownership; Packs reuses successful ownership for only 30 seconds. Earnings history is shared/cache-first, default 12 hours; settled historical seasons can stay warm 30 days. Force refresh bypasses relevant reads. | Cold/stale histories, multiple users, repeated refresh and cache expiry still contact Real. Per-invocation concurrency is not an account-wide request budget. |
| Marketplace background alerts | `lib/marketplaceMonitor.ts` walks ten-listing pages until exhausted/cursor stops, even for previously seen notifications. No numeric page/request cap in this walk; scheduled route has a 45-second time budget. Repository documents two-minute QStash primary plus ten-minute GitHub fallback. | Primary cadence alone is 30 trigger opportunities per hour, not 30 provider requests: each successful scan can make many paginated calls across owners/feeds. Actual active QStash settings/delivery counts were not fetched. A KV scan lease and 75-second post-run cooldown mitigate scheduler overlap; they do not cover the manual scan route or imports/earnings. |
| Individual player listings | Page automatically scans up to 100 candidates per effect to find 25 qualifying players, two workers. Uncached holder checks make Real calls; qualifying players can need up to ten card-listing pages each. Browser listing cache is 60 seconds; holder cache is five-minute instance memory. | A single page action can fan out significantly. 5xx holder errors can become unknown owners; listing errors can become incomplete results. Browser stops explicitly for 401/403/429/503, not every 5xx. |
| Earnings live refresh and snapshots | Public reconstruction fetches user/ownership, sport/day games, relevant games, relevant owned box-score details and needed booster data. Discovery/game/detail pools can be wider than the configured base concurrency. Scheduled snapshots force fresh persistent box-score reads; successful normal snapshots are skipped on later attempts, but golf finalizers deliberately do not use that skip. Public three-minute response cache is instance-local and namespace-scoped, not cross-job durable deduplication. | Busy sport days, many tracked usernames, simultaneous refreshes/jobs and failed/unfinished snapshots can create bursts. No cross-trigger earnings lease found in the inspected route. The current Earnings page's one-minute timer only advances the date; it does not scrape every minute. |
| Missing faces | `api/catalog/avatars.ts` can call Real after exact/sibling catalog misses. Resolver defaults to up to 40 missing keys per request, three workers, with player/team fallback; browser bulk avatar requests can run in parallel. Unresolved suppression is only one-minute instance memory. | Some apparently database-backed browsing can cause hidden upstream reads and swallow/continue after 5xx. Existing face data avoids this work. |
| Supabase transport | `isRetryableSupabaseError` explicitly retries 502/503/504 and certain 500 timeout/deadlock responses. Browser catalog bulk concurrency is eight. | Separate from proof of Real account overload, but explicitly conflicts with the new all-5xx no-repeat policy and must be addressed before restart. |

Saved evidence narrows the test contribution: the first live import recorded 143 earnings-wrapper calls; the next five saved live imports recorded zero earnings backfill calls, although ownership/avatar work could still contact Real. Two later import-timing reports are replay mode. The ten forced-fresh Packs scans (five local, five preview) added live discovery traffic. These records do not justify describing the whole optimization session as two hours of continuous Real scraping, nor do they prove that testing could not have contributed to the warning. Complete upstream attempt counts, timing and errors remain unknown.

Conservative conclusions and restart prerequisites (recommendations only, not implemented):

1. Keep production paused. Do not run provider probes, re-imports, live reproduction, stress tests, or scheduler catch-up.
2. Use existing redacted logs to attribute request counts/statuses by endpoint, trigger and time. Do not infer the exact provider-side failure from a generic 5xx or an app-route 200 alone.
3. Require durable all-5xx stop state across automatic retries, fallback paths, manual reruns and scheduled re-entry, preserving source status. The existing project instructions are agent policy, not runtime enforcement.
4. Agree a provider-approved shared-session traffic budget before resuming; coordinate all live-data features through it. Local concurrency limits, cache TTLs and faster responses do not establish a safe aggregate rate.
5. Prioritize reducing full recurring marketplace walks, use explicit bounded/stale-aware refresh, and serve missing faces with placeholders while live enrichment is disabled. Preserve earnings correctness when considering deduplication; do not blindly remove required finalization reads.
6. Keep numerical speed testing on recorded data. A preview and production using the same provider session still share upstream traffic; protected preview access is not traffic isolation.

Only policy/report documentation changed during this passive review. No live requests, tests, application changes, migrations, deployments or restarts were performed. Exact incident cause remains unconfirmed without existing request/error logs.

## Actual October 30 development activity — cross-worktree follow-up

The owner asked to investigate the day's specific burst rather than assume ordinary website use caused the warning. This follow-up read existing session records for this project, including the separate `daily-packs-boosts` worktree, and its existing local fixtures. No request was reproduced. The earlier review was incomplete because it had not included that second workstream.

All times below are **Asia/Riyadh (UTC+3), October 30**. Session records use UTC; times here are explicitly converted, not inferred from filenames.

| Time | Actual activity/evidence | What it establishes |
| --- | --- | --- |
| 19:09 | First saved main-checkout `gordon` live import: 51.97 seconds, 143 upstream earnings-wrapper calls, zero reported failed passes. | A concentrated block of live history-fetch traffic, plus ownership/optional metadata calls. Not a complete HTTP-attempt count; the 143 counter excludes transport-internal retries. |
| 19:11–19:22 | Five subsequent saved live imports report zero earnings backfill calls; ownership/avatar work could still contact Real. | Do not multiply the 143 by every warm run or label all subsequent calculations scraping. The final saved avatar response reports zero successful Real fills, but not a complete count of attempted/failed fills across earlier runs. |
| 20:08 and 20:39–20:40 | Main performance work did five forced-fresh Packs scans locally and five in the protected preview, with cached-read comparisons. | Ten extra live ownership scans. Normally each does username lookup plus one complete pass request, before any transport retries. The returned 1,395 passes are records in a response, not 1,395 requests per scan. |
| 20:07 | The daily-features workstream copied the main `.env.local` into `C:/Users/Husain/.codex/worktrees/daily-packs-boosts/real-rax-tracker`. | Separate worktrees/ports were not configured with independent Real credentials. No secret values were extracted into this report. |
| 20:12–20:36 | Daily-features discovery saved successful user-pass/filter, booster-context and ten-sport day responses. | Additional live endpoint-discovery traffic occurred during the performance work. These saved discovery responses are 200s, not evidence of repeated 500s by themselves. |
| 21:09:07 | `.benchmarks/gordon-live-boosts.local.json` in the daily worktree records day `2026-10-30`; UFC has `coverage: partial` and `Real API request failed (500).` The simultaneously saved ratings result has source `real`. | A concrete live provider failure was saved outside the main checkout. It was exposed as partial data rather than stopping the feature. |
| 21:12:47 | Existing browser snapshot shows the UFC section, `Partial coverage`, `Real API request failed (500).`, and `Schedule unavailable.` | The failure was visible during live Boosts verification. This display alone is not an additional provider request. |
| 21:14:13 | Browser tool record clicks the live Boosts `Refresh status` control after the error snapshot. | The failed operation was rerun after a visible 500; no durable failed-request exclusion was present. Its exact individual response set was not separately saved. |
| 21:33:49 onward | A forced POST to the local `/api/account/boosts` route returns HTTP 200 in 5,895 ms but includes UFC `Real API request failed (500).` in its partial-coverage result. | A later distinct live refresh again returned the same feature-level failure. An app-route 200 did not mean all provider requests succeeded. |
| 21:35:57–21:36:06 | A recorded forced `loadDailyBoosts('gordon', realDay(), ..., true)` timing check logs **22 Real requests**. Its per-request records show **one UFC 500 and 21 HTTP 200s**; the UFC schedule call for the adjacent date is 200. A separate user-profile lookup in that tool call also returned 200. | Direct provider-level evidence of another UFC failure, not merely a repeated UI rendering or a mocked test. The sample's 22 counts are for this Boosts timing run only, not the day's total. |

### Confirmed mechanism

In the daily worktree's `lib/dailyBoostsService.ts`, a forced refresh requests `/home/{sport}/day` for **all ten sports and two source dates**: 20 schedule calls, alongside username/ownership discovery (22 requests in the captured run). Two schedule workers operate concurrently. Each per-date error is caught and stored as partial coverage, and the worker continues to the next date/sport. The route returns the result as a successful HTTP 200. Schedule cache lifetime is only 60 seconds, instance-local, and a forced refresh bypasses its read.

`src/pages/BoostsPage.tsx` runs the loader on initial load, date/account changes and refresh. After a refresh increases `revision`, it passes `revision > 0` as force refresh for subsequent effect runs as well. This allows later view changes to bypass the short cache, too. The actual saved records demonstrate repeated live UFC failures at 21:09, around 21:34, and around 21:36, with a further explicit refresh between those checks. The 21:12 snapshot is not counted as a separate error request without its own transport record.

This is **repetition through whole-operation reruns and error masking**, not evidence that `realGetJson` immediately retried a 500 inside its retry loop. The failing path is the UFC home-day schedule query for the current tested day, `2026-10-30`; the forced timing run's source code requests that day before the adjacent day, and its first UFC response is 500 while the next is 200. Do not reissue the failed query or try variants to reproduce it.

### UFC count: reconstructed minimum, not a complete access log

Further read-only counting establishes **at least nine calls to the `/home/ufc/day` endpoint family**, with different `day` parameters, in the inspected daily-feature work:

- One successful next-day discovery call saved as `ufc-slate.json` (HTTP 200).
- Four distinct completed forced Boosts checks, each issuing two UFC date queries: the 21:08 forced local POST (HTTP 200, `partial: [ufc]`); the 21:09 saved live result; the later 21:34 forced local POST; and the 21:36 instrumented service run. The two-date loop already existed in the 20:35 service implementation, and force refresh bypassed its cache. These checks were separated by completed responses, not counted twice as simultaneous readers of one in-flight scan.

Thus `1 + (4 × 2) = 9` is a **code-and-saved-execution-derived lower bound**, not nine individually logged HTTP access records. Three distinct checks explicitly document a 500: 21:09, 21:34, and 21:36. The 21:08 partial-sport summary does not preserve the numeric UFC error, so it is not added as a fourth confirmed 500. Browser page loads, Today/Tomorrow switches, and the 21:14 refresh are additional candidate requests; their exact upstream counts/statuses cannot be reconstructed reliably from UI snapshots alone, so they are not included. Do not count displayed error text, repeated source reads, fixture replays or mocked tests as additional HTTP requests. Do not present nine as the full day's total or all nine as failures.

The four forced runs also imply 80 sport/date schedule reads across all ten sports, before ownership lookups and any rate-limit retries; this is the same multiplication behind the nine-call minimum and not a separate additive traffic category. The instrumented run alone directly records its 22 upstream requests.

The confirmed data-reading work included username/profile lookup, complete/filtered ownership and pass rating/rarity/boost flags, missing/stale per-pass daily earnings, sport/day schedules, booster metadata discovery, and optional player/entity avatar lookups. Packs scan responses contained many pass records but were not one request per pass. Nothing in the inspected Boosts path applied a booster or opened a pack: it used authenticated GETs to read schedule/ownership data. The owner notes UFC cannot be boosted; that makes including it in boost-oriented checks unnecessary, but does not by itself prove why its schedule GET returned 500. The adjacent-date UFC response succeeded in the instrumented sample. Background marketplace traffic remains a separate unquantified source, not a confirmed count in this reconstruction.

### Attribution and limits

- The strongest concrete error-producing development activity found is repeated live Boosts/day-schedule verification in the **separate daily-features worktree**, overlapping the import/Packs performance work. The first cold collection import is a separate confirmed volume contributor.
- The large fixed-pool OTD ranking matrix used recorded files and local calculations. Its repeated numerical reranks did not issue Real requests. Catalog capture read the shared Supabase catalog. Live import/enrichment around the ranking workflow must still be distinguished from the mathematical calculation itself.
- A single sampled run with 21 successful requests and one failing UFC/date query supports investigating a particular endpoint/input failure rather than assuming every request was being rate limited. It does not reveal Real's internal exception or rule out aggregate load as a contributing factor.
- These records establish real repeated 500-producing work, but not the provider's full account-wide log, exact error total, all retry attempts, other-user traffic, or proof that this one path alone caused the warning.
- This does not establish that the whole normal website is unusable, nor that every normal-use route is safe. The concrete failing operation can be isolated from saved collection browsing and local OTD calculations. The proposed account-wide lockout has not been implemented or approved as a design; this follow-up is diagnosis only.

### Additional shutdown limit discovered

A read-only local listener/process check found PID **48632** still listening on **127.0.0.1:5175**, with its command line identifying the separate daily-packs-boosts worktree. The earlier shutdown stopped the main checkout's port 5174 server, not this newly identified server. A listening server is not proof of continuing scraping, and it was not accessed, stopped, or restarted during this diagnosis. Production remains paused; that hosting pause does not disable an independently running local server. Do not claim every local project server was stopped.

Only this documentation/policy record changed. No live HTTP calls, browser activity, benchmarks, code fixes, deployments, or restart actions occurred during the follow-up.

### Owner-requested shutdown of port 5175

The owner subsequently explicitly requested disabling this development copy. Fresh read-only checks confirmed port 5175 belonged to Node PID **48632**, running Vite from the exact daily-packs-boosts worktree above with `--port 5175`. Stopped that verified process only. OS-level read-back confirmed **zero port-5175 listeners** and that the stopped process no longer existed. No website/API/Real requests were used for verification. No files, credentials or saved data were deleted; no deployment, source removal or other server was changed. Do not restart this development copy without explicit owner approval.

### Subsequent local safety implementation

The owner declined the proposed request caps and then requested disabling marketplace alerts until further notice. Local implementation now disables marketplace scans/UI/workflow, retires player listings, makes faces cache-only and adds persistent upstream 5xx blocking/import error propagation. See `request-safety-results-2026-10-30.md` for verified tests, exact scope and limitations. This supersedes the earlier design proposal to retain marketplace scanning under numerical caps. No live request, deployment, remote schedule change or restart was made during implementation; the hosting shutdown remains in force. Final OS-only inspection found no listeners on 5174 or 5175. Historical statements above describing documentation-only turns remain historical, not the status of this later code change.
