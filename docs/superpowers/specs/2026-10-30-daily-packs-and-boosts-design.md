# Daily pack checks, rating targets, and Boosts

Status: draft for owner approval. The owner approved the interactive visual direction on October 30, 2026 and explicitly required preserving existing features. Product implementation has not started.

## Intent and agreed behavior

Make it easy to work through daily pack opening and pregame boosting across multiple Real accounts.

- Packs shows daily opening inference separately for each account and each unfinished tracked player. The owner accepts **Likely opened**, including the uncertainty that transferred ratings may create progress on the main account.
- Pack status resets at **7:00am America/New_York**, following daylight saving changes.
- The owner chose **an automatic daily check plus a fresh check on each refresh**, rather than relying on visits to establish the daily baseline.
- Each tracked player can target **380, 1,380, or 3,380 rating**. Existing trackers default to 3,380. The target applies to the combined rating across that player's accounts, as the existing tracker does.
- A new Boosts page selects a Real account and has separate **Today** and **Tomorrow** views. Each shows that day's owned player cards and applicable boost states, the full day's games, and time until each sport's first game. The owner explicitly requested Tomorrow as a separate view to support preparing next-day boosts in Real.
- The approved mockup is an addition to the existing app. It is not an instruction to replace the current Packs page with a reduced feature set.

The chosen layout uses the app's existing dark surfaces and amber accent. Packs retains player rows with account details; the addition is a daily summary, account filters, per-account status, and a per-player target control. Boosts has a Today/Tomorrow view switch, then sport countdowns above the game slate and the selected account's player cards, stacked on small screens. The selected account stays the same when switching day views.

## Approaches

1. **Visit/refresh checks only — considered, not selected.** This reuses the existing import flow with little infrastructure, but a person who visits only after opening packs may lack an earlier reading from that day.
2. **Automatic daily baseline plus refresh checks — selected by the owner.** A server job reads registered accounts each day independently of the browser. Visits, browser reloads, and explicit refresh actions fetch current data and update the day's inference. This establishes an earlier comparison without continuous polling.
3. **Continuous periodic monitoring — not selected for this version.** It could catch more changes between visits, at the cost of more Real requests. It still cannot guarantee detecting an alternate account opening and transferring cards between observations.

Use the existing React/TypeScript/Vercel/KV stack and Real transport. The scheduler recommendation below is an engineering choice based on the repository's documented QStash use, not a service selection explicitly made by the owner.

## Preserve existing behavior

Keep quick player addition, track-all actions, shared account templates and their application, per-account and per-player imports, sync-all, ownership warnings and ignore controls, manual rating editing, account editing/removal, rating-per-pack estimates, play-average imports, daily swaps, weekly-only mode, extra weekly accounts, weekly-open logging, finish projections, sorting, progress summaries, Plan linkage, and the existing explicit Finished action.

Reaching a selected rating target changes completion and estimates; it does not automatically remove the player, delete a plan, modify owned cards, or change the plan's simulated purchase rarity. Raising the target makes the retained tracker unfinished again. Keep the existing confirmation and removal semantics for the separate Finished button.

All calculations and labels that currently assume Iconic must use the selected target where they describe pack progress: remaining rating, packs needed, daily/weekly ETA, progress ratio, finish sorting, account summaries, and completion counts. Plan progress tags that derive from a tracker's ETA follow that same ETA; other Plan purchase/rarity assumptions remain unchanged.

## Daily pack evidence

### States

For an eligible daily account/player combination:

- **Likely opened:** a fresh, complete Real import observed a positive rating change between two readings that both belong to the current pack day.
- **No opening detected:** at least two valid readings exist in the current pack day and no positive change has been observed.
- **Unknown:** no usable comparison, failed/incomplete data, an invalid rating, or unresolved ownership. Include a short reason and last successful check time.

Weekly-only trackers keep their existing weekly workflow and are excluded from daily counts. Accounts with Opens packs disabled are labeled not participating and excluded from expected daily totals. A confirmed missing pass keeps its existing ownership warning and is not counted as an unopened pack. Ignoring that warning does not fabricate opening evidence. Completed players do not contribute daily checklist totals; their existing tracker remains available.

Track each Real username/player identity independently, case-insensitively for usernames and using the existing canonical external key including sport and season. Main-account progress is evidence only for that account. Do not infer opening counts or assign another account's progress based on the size of a gain.

### Observation rules

The daily job saves the first valid post-reset observation for the current pack day. A first reading alone is Unknown, because rating has no verified opening timestamp. A later fresh reading compares against the previous valid reading in that same pack day. This also catches a later increase after an earlier decrease, even if the rating is still below the day's first reading.

Once a positive change is observed, retain Likely opened for the rest of that pack day, even if a subsequent transfer reduces the account's rating. Retain the evidence timestamp and relevant before/after values. An unchanged refresh cannot clear it. A failed refresh preserves previous evidence with an explicit failed/stale check indicator; failures never become No opening detected.

Manual rating edits update the existing planning estimate but do not create or alter automatic opening evidence. Old-day data, restored backups, imported historical values, account renames, and changes of sport/season cannot create a same-day observation pair. A changed username starts a new evidence identity.

Continue using the importer's existing highest-rated-copy rule for pack progress; do not silently switch to summing duplicate copies. Transfers, purchases, and changes to the highest-rated owned copy are accepted sources of false positives and explain the word Likely.

Compute the pack day from the New York date and 7am boundary, not the device date or a fixed UTC offset. Reset is a change of day key even when the browser was closed or the scheduled run failed. Handle 23- and 25-hour pack days. If an upstream read spans reset, do not compare it with a reading on the other side; establish a fresh current-day reading instead.

### Automatic daily job

Prepare an authenticated, idempotent server endpoint that requests fresh ratings for all eligible registered accounts and saves daily observations to KV. It runs while the website is closed. Registration is stored per signed-in tracker profile and follows its saved pack configuration. Build the job's worklist from the union of these registrations and deduplicate shared Real usernames for fetching.

Do not reuse the current global earnings username replacement list: one tracker profile updating its linked accounts must not remove another profile's scheduled accounts. Removed registrations stop generating work for that profile, while shared registrations remain valid. The job stores observations separately from tracker profile blobs, so it cannot overwrite concurrent collection edits or cloud-sync revisions.

Recommended primary trigger: the QStash service already documented for marketplace monitoring, with `CRON_TZ=America/New_York 0 7 * * *`. Use a stable schedule ID and a separate purpose-specific secret or verified provider signature. Prepare idempotent schedule configuration and a manual verification mode. Reuse existing service access if available; no new paid subscription is assumed.

The run is scheduled for 7am, but individual observations carry their actual capture time. Upstream latency or scheduler retries can delay a baseline, and an opening before that baseline may remain undetected. Do not promise a 7:00:00 snapshot or label a late capture as 7am. Retry only failed/deferred accounts with bounded backoff and a function deadline; successful day baselines are not overwritten. Report incomplete coverage and recover through authenticated retries and subsequent refreshes.

Vercel Hobby cron alone is unsuitable as the precise primary trigger because its documented delivery can occur anywhere within the scheduled hour. If provider access is unavailable, keep the scheduler setup explicit as unfinished operational work rather than claiming the automatic daily feature is active.

Use atomic per-identity/day updates or a bounded lock to prevent overlapping refreshes or retries from overwriting newer readings or clearing the positive-evidence latch. Cache/in-flight reuse may coalesce simultaneous requests, but an explicit refresh must request fresh upstream data rather than replaying the previous snapshot as a new reading.

### User refresh and storage

Entering/reloading Packs and using Refresh all accounts checks its eligible linked accounts. Existing Import this, Import all, and account sync actions also feed the same observation pipeline when they perform fresh reads. Avoid a second collection request just to obtain status. Show partial successes, failures, last check time, and the actual baseline time.

Persist the chosen target in the normal tracker profile and preserve it through normalization, JSON import/export, account sync, and template operations. Default missing/invalid legacy targets to 3,380. Store durable server observations per evidence identity and pack day, with a proposed seven-day expiry; the builder may adjust the retention after measuring size. Current status must survive browser closure and be available on another signed-in device. Browser-only development mode may use local observations and must say automatic server checks are unavailable.

## Boosts data and behavior

### Account and player coverage

Reuse the linked Real accounts already defined by shared templates and tracker account usernames, deduplicated by normalized username. Do not require a special primary account. The initial selection is the first configured account; remember selection within the current tracker account, and clear it on sign-out/account switch.

Read the selected account's complete public pass collection through the configured server-side Real transport. Do not use the known-incomplete playstoday filter as the source of ownership and do not limit the feature to the Legendary/Mystic/Iconic cards imported for OTD planning.

Show all non-refunded owned player copies, preserving pass-instance IDs and serials. Active-season players with a verified scheduled matchup are shown first; other owned players remain accessible in a separate section. Inactive-season copies are identified as such. Missing team/event association is Unknown matchup, not No game today. A team's scheduled game is a possible appearance; do not claim a confirmed lineup from it.

Boosted means Real explicitly reports an attached one-game card booster for that copy that applies to the game/day in the selected view. Explicit false can show Needs boost for an eligible upcoming player when the source's day semantics are established. An absent/contradictory flag, unavailable collection, or unclear applicability is Unknown. Display attached booster details when present without inventing their value. Distinguish one-game boosters from permanent rating/rarity multipliers. No boost is applied or consumed by this page.

Refresh fetches the selected account's current boost state. Display the check time and keep copies independent. Current flags after a game cannot prove whether that player was boosted at tip-off; do not present this as a historical audit or assume booster expiration occurs at the pack reset.

The owner reports that Real supports preparing next-day boosts. During read-only discovery, inspect the day/game fields or day-scoped response Real uses for that feature and verify the difference between Today and Tomorrow for the same owned copy. The existing `playstomorrow` query is a lead for contextual data, not an authoritative complete ownership list. A generic attached-booster flag alone must not be duplicated as Boosted in both views. Preserve ownership from the full collection and join verified day/game-specific evidence onto it. If applicability cannot be established for a row, show Unknown for that day with a reason. Resolving Real's current response semantics is a builder investigation, not a request for the owner to reverse-engineer its API.

### Daily slate and countdowns

Include all games/events for all Real-supported sports already represented in the app: NBA, WNBA, NFL, CFB, MLB, NHL, CBB, Golf, FC, and UFC, including games with no owned players. Do not fetch only sports or teams in the selected collection. Retain scheduled, live, final, postponed, and cancelled status where the provider exposes it.

Owner clarification: Boosts uses the **same 7am New York day boundary as Packs**. Today is the current reset day, and Tomorrow is the next reset day, incremented as a New York calendar date rather than by a fixed 24 hours. Before 7am, Today continues showing the previous reset day's slate. At 7am both views advance, and an open page reloads the relevant slate/evidence while retaining the selected relative view. Label the actual date and ET game times explicitly.

Each view has its own full slate, player-to-game matches, boost applicability, coverage state, and first-game countdowns. Do not mix tomorrow's games into today's list. Verify whether Real's schedule endpoint already uses its reset-day convention; otherwise compose the source day pages needed to cover the selected 7am-to-7am interval and deduplicate by sport/event ID. Retain ongoing multi-day tournaments with appropriate status. Countdowns use absolute start timestamps and update locally without refetching the slate every second.

Each sport shows time until its earliest valid scheduled start. Once that first event starts, show Started/live/final as appropriate and optionally the next upcoming start. Show No games only for a verified empty complete slate; unknown times, partial sport coverage, cancellations, and postponed/TBD events receive explicit states rather than a fabricated zero or countdown. Golf and UFC use event/tournament associations, not team-ID matching.

Read-only data discovery is required before implementing the final normalizer: inspect representative live scheduled-game responses to identify trustworthy start timestamps, team labels, statuses, and per-sport coverage. The existing `getRealHomeDayGames` is useful for earnings but currently discards rich game fields and can reconstruct only already-started CFB games from activity. It is not yet a proven complete future-slate source. Extend or supplement it with verified Real schedule/game data while preserving earnings behavior. Capture sanitized schema fixtures, not credentials or private collection dumps.

Do not quietly reduce All games to games returned by an incomplete source. Surface partial coverage while resolving the source, and treat supported-sport slate coverage as a release acceptance requirement. Missing team IDs, individual events, multi-game days, and duplicate owned copies need explicit matching behavior. Ambiguous matches remain Unknown rather than being guessed by player-name text.

Use a short server cache for shared slates (proposed 60 seconds), keyed by the selected day, and reuse it across account switches. Cache boost applicability by account, owned copy and selected day/game, not by account alone. Refresh forces a fresh account read for the visible day and requests a fresh slate; simultaneous requests may share one in-flight fetch. Show the data's actual capture time, preserve a failed-refresh indicator, and protect account-specific browser caches from being reused under another tracker login. Switching views loads that day's data independently and discards late responses for the previously visible account/day.

## Integration and acceptance

Add `/boosts` and a Boosts navigation link without removing existing routes or nav entries. Retain the approved Packs structure and fit the new daily controls into it. Reuse existing identity, select, panel, loading, and error treatments where suitable.

Protect user endpoints with the existing site/tracker-account session rules and derive the tracker owner server-side. Cron endpoints require real secret/signature verification and fail closed in production. Keep Real credentials server-side and avoid logging collection payloads. These are standard requirements for the new endpoints, not a request to refactor unrelated auth or earnings code.

Required verification:

- Spring/fall DST, before/at/after 7am, reset while closed/open, and an upstream read spanning reset.
- First observation Unknown; equal fresh comparison No opening detected; positive delta Likely opened; decrease then increase; sticky same-day evidence; new-day reset; failed/partial reads; manual edits; duplicate copies; ownership changes; overlapping and out-of-order requests.
- Scheduled account registration survives browser closure, isolates tracker owners, deduplicates Real fetches, handles removals, and reports retries/deferred accounts without overwriting successful evidence.
- Targets 380/1,380/3,380 change every affected estimate/completion display and survive backup/sync; legacy data stays at 3,380; increasing a completed target restores unfinished status without data deletion.
- Boost states for true/false/absent/conflicting flags, separate duplicates, account switching, missing mappings, active/inactive seasons, empty and partial slates, TBD/postponed games, multiple games, and individual sports. Verify distinct Today/Tomorrow game lists and boost states for the same owned copy, switching views during requests, and both views rolling forward at the 7am boundary, including DST.
- Representative live future-slate coverage and countdown timestamps for supported sports; no claim of full coverage from earnings-only fixtures.
- Browser verification on desktop and mobile, existing Packs workflow regression checks, TypeScript checks, relevant automated tests, and production build. Verify a scheduled invocation and durable result on a deployed configured environment before claiming unattended checks are operational.

Keep the unrelated in-progress workspace edits intact. No replacement of existing data, broad cleanup, redesign of other pages, continual polling, push notifications, booster inventory planner, or automated action inside Real is included.

## What remains the builder's call

Module/endpoint names, internal KV keys, whether to extend the existing pack import response or compose a focused endpoint, exact small-cache/retention limits, and responsive details are implementation choices. The builder must inspect the current working files because other project work is in progress. Any missing live schedule fields/provider access must be reported with its concrete effect rather than filled with sample data.

## Sources and visual reference

- Existing code: `src/pages/PlanPacksPage.tsx`, `src/lib/packTracker.ts`, `src/lib/plannedPasses.ts`, `src/lib/storage.ts`, `src/context/RaxDataContext.tsx`, `api/import/pack-ratings.ts`, `lib/realApi.ts`, `lib/publicDailyEarnings.ts`, and `docs/daily-feature-discovery.md`.
- [QStash schedules and IANA timezone support](https://upstash.com/docs/qstash/features/schedules).
- [Vercel Hobby cron scheduling precision](https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Approved base visual direction: `.superpowers/brainstorm/daily-packs-boosts/content/daily-packs-boosts.html`; the follow-up Tomorrow view is previewed in `daily-packs-boosts-v2.html` in the same directory (ignored local mockups, sample data only).
