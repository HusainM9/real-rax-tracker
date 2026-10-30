# Product evolution plan

Status: performance phase-two implementation and protected-preview verification in progress; no live rollout. The owner has approved the current-color direction and Plan/Earnings layouts. See [the phase-two report](docs/performance-phase-two-results.md) for exact incremental rankings, Packs timing, account safety, import-only controls, and remaining access/migration gates. The owner remains open to infrastructure changes, but measured repeated work has justified improvements within the existing stack so far.

## Goals

1. Give the entire app a cohesive, modern interface that makes dense sports and RAX data easier to understand and act on.
2. Improve perceived and actual loading speed across every section, including imports and admin. Measure first and evaluate architectural changes where needed.
3. Establish a foundation for future features after the redesign and performance work are stable.

The owner considers the existing calculation logic sound. Preserve it and its results as the baseline; change calculations only when evidence shows a correctness or performance issue, with regression checks. The main goal is a site-wide revamp and a faster experience.

## Discovery and baseline

- The reference site is private. Use the owner's descriptions and any permitted, sanitized examples to identify useful workflows, visuals, and behaviors. Create an original design rather than copying branding or assets.
- Map primary journeys: onboarding and import, daily earnings, OTD discovery, evaluating and planning passes, packs, marketplace alerts, collection and sell analysis, account, and admin. Identify the most-used journeys and mobile needs with the owner.
- Capture current screenshots at desktop and mobile widths, including loading, empty, error, and populated states. Audit navigation, accessibility, and inconsistent components.
- Measure cold and warm page loads, route transitions, bundle size, API latency and call counts, long tasks, rendering, and memory for small and large collections. Include dashboard, Entry/import, Earnings, OTD, Potential, Plan, Packs, Cards, Sell, Marketplace, and Admin. Record device, network, dataset, and timestamp with results.
- Measure import stages separately: user lookup, pass scan, catalog lookup, earnings fetch, processing, and account save. Record rate limits and cache hits without collecting credentials or sensitive response data in logs.
- Benchmark collection loading and OTD calculation separately, distinguishing the first sync, repeat sync, time to first useful results, and time until complete. Check results for the same accounts, seasons, rarity rules, and dates so speed comparisons remain meaningful.
- Set realistic targets from the baseline; use p75 and p95 where useful. Candidate starting targets to validate: page shell interactive within 2.5 seconds on a typical mobile connection, cached route transitions under 500 ms, and visible progress for long imports. Treat Real upstream latency and rate limiting separately from app-controlled work.

## Phase 1 — Design direction and foundation

### Original design proposal — retained as planning history

- Keep the existing page names, routes, and familiar workflows. Organize the same navigation more clearly without hiding frequent destinations behind icons alone.
- Use a restrained sports-data style: a quieter dark shell, one consistent accent, readable typography, subtle separators, and compact cards with clear headings. Take inspiration from [Linear's attention to hierarchy and consistent controls](https://linear.app/now/behind-the-latest-design-refresh) and [ESPN's score and game information hierarchy](https://michael-maler.com/work/espn/), while retaining this app's own identity.
- Simplify each page header to its title, one short explanation when necessary, and its primary action. Group secondary controls and advanced settings so existing capabilities remain easy to find.
- Make the dashboard lead with useful totals and next actions; move infrequently used backup and reset controls into a clearly labeled settings area, preserving access.
- Keep dense data in compact, sortable tables on desktop, with clear status labels and readable mobile layouts. Use consistent loading, empty, error, and last-updated states.
- Start with the shell and Dashboard as a reviewable sample, then apply the approved pattern to one familiar workflow such as Packs. No visual implementation until the owner reviews the direction.

- Agree on visual direction, information hierarchy, branding, accessibility requirements, and desktop/mobile navigation. Produce a small set of representative mockups: dashboard, a dense analysis view, and Packs or Earnings.
- Define design tokens for color, typography, spacing, surfaces, borders, motion, and semantic statuses; build reusable controls, cards, tables, filters, dialogs, charts, skeletons, and feedback states.
- Prototype the app shell and navigation, including clear grouping of related sections and a compact mobile experience. Preserve existing workflows and links.
- Validate color contrast, keyboard and screen-reader behavior, focus management, reduced motion, and responsive layouts. Test real long names, large numbers, many accounts, and narrow screens.
- Deliver a representative vertical slice first, then refine the component system before extending it to other pages.

Exit: approved direction, reusable components, and a verified desktop/mobile slice without lost functionality.

## Phase 2 — Performance and data-flow improvements

Initial production build baseline (2026-10-30, local build): main JavaScript 378.31 kB / 113.97 kB gzip; main CSS 86.25 kB / 16.35 kB gzip; Potential route 102.71 kB / 23.51 kB gzip. Vite reports 318 ms for its build stage, which is not page load time. These sizes do not identify the primary bottleneck; real collection and OTD timings are still needed.

- Profile the existing React/Vite app before choosing changes. Routes are already lazy-loaded; inspect their actual bundle sizes and shared dependencies before further splitting. Large candidates include `PotentialPage.tsx`, `PlanPacksPage.tsx`, and the global `App.css`.
- Investigate the whole-profile loading and saving in `RaxDataContext`: large payloads, serialization, redundant saves, and broad context updates may affect responsiveness. Measure before changing; preserve local fallback, backup/restore, conflict handling, and existing data.
- Profile expensive calculations and long lists; consider memoized selectors, incremental computation, pagination or virtualization, and background workers only where measurements show benefit.
- Audit catalog and Real requests for duplicate calls, batching, bounded concurrency, cancellation, caching, and freshness indicators. Respect upstream rate limits; do not increase concurrency blindly. Show cached results promptly when safe, with explicit refresh and stale/error states.
- Improve perceived speed with meaningful skeletons, progressive rendering, and import progress. Avoid blocking an entire page on optional data.
- Review Supabase queries and indexes, payload sizes, serverless cold starts, and KV access using measured traces. The owner is open to infrastructure changes. If the profile model or hosting is a bottleneck, compare alternatives on measured benefit, cost, privacy, data migration, compatibility, rollout, and rollback before choosing a pivot.
- Re-run the same baseline for each major improvement and check that calculations, freshness, and data integrity remain correct.

Exit: documented before/after results for all major routes and import stages, with any unmet targets and upstream constraints recorded.

## Phase 3 — Roll out the UI overhaul

1. App shell, navigation, dashboard, account and onboarding.
2. Core daily workflows: Earnings, Entry, OTD, Calendar and Overlaps.
3. Decision workflows: Potential, Plan, Packs, Cards, Sell and Marketplace.
4. Admin, Help, login and remaining supporting states.

For each group: preserve existing capabilities, migrate to shared components, test mobile and desktop, compare performance against baseline, and verify keyboard access, loading, errors, empty states, and real-data flows. Roll out in reviewable increments with a rollback path.

Exit: all routes use the new system, core workflows pass end-to-end checks, and no major performance or accessibility regressions remain.

## Phase 4 — Future feature discovery

Prioritize after phases 1–3 based on actual workflows and the reference-site review. Candidate ideas, not commitments:

- Unified collection health and next-action dashboard across earnings, packs, plans, and marketplace alerts.
- Cross-account comparison and ownership gaps, with clear freshness and source information.
- Saved filters, watchlists, and configurable alerts across OTD and potential purchases.
- Better scenario comparisons for buy, sell, and upgrade decisions.
- Import and data-quality diagnostics with a clear explanation of missing or stale data.

For each candidate, define the user problem, success measure, data availability, estimated cost, and privacy implications before implementation.

### Capabilities described on the private reference site

1. **Faster collection sync.** Determine whether it uses a cached snapshot, account-specific data, fewer requests, incremental updates, or a different data source. Profile our username scan and earnings backfill, then investigate incremental refresh and shared catalog reuse. Compare completeness and freshness as well as elapsed time.
2. **Faster OTD calculations.** Separate data retrieval, transformation, and calculation time. Evaluate precomputed daily aggregates, indexed lookups, memoization, and incremental recalculation, depending on measured bottlenecks. Verify totals and overlap rules against current results and representative edge cases.
3. **Today's boosters.** Show games on the selected day and owned players who are playing, with an indication of which have and have not been boosted when the data supports it. Surface available boosters if that data can be obtained. The owner does not require a specific recommendation or optimization. Our Earnings reconstruction reads public data for boosters attached to active passes; that does not establish access to unused inventory. Verify schedule-to-player matching, status, freshness, and the Real day/reset boundary; applying a booster can remain a manual Real action.
4. **Player market listings.** Add a separate view within Marketplace Alerts to browse all available listings for a selected player, with listing details and useful filters. Our alert scanner already targets individual player feeds, but currently scans bulk-rating listings; establish coverage for each desired listing type and robust pagination. Show the last refresh and disclose partial results or upstream limits.
5. **Daily pack-open status.** Show whether each selected account opened relevant packs today using a public lookup, without requiring the user to log into Real. The reference site demonstrates this is possible there; identify and validate the source available to this app, its reset time and timezone, and pack coverage. Our pack tracker already supports logged weekly openings. Show unknown or stale status explicitly and support multiple accounts.

Implement all five capabilities. For each, document the source and access requirements, a representative example, completeness, data freshness, limitations, and a correctness test. Prioritize the first two alongside the performance work; integrate the remaining features into the redesigned workflows, using shared foundations when available.

## Real account sync investigation

The reference site is private and its cURL request has not been provided, so its endpoint, permissions, and purpose are unknown. If useful, ask for a **redacted** example containing only the request method, endpoint path, and non-sensitive parameter names. Do not request or paste cookies, authorization headers, session tokens, device identifiers, passwords, or private response data.

A cURL command is a representation of an HTTP request; it can include browser session credentials. Depending on the endpoint and method, another site could use it to read account-specific data, authenticate as the user, or perform an action. Its method, path, payload, response, and how credentials are handled determine what it actually does. Do not assume it provides full account access or faster sync without evidence.

Current app: Real imports use a shared server-configured Real session to look up a username and retrieve pass data; pack ratings and earnings use related Real data flows. The app's own tracker account sync separately saves tracker data to its configured server store. Compare any proposed per-user session approach with the current model for access coverage, refresh behavior, credential handling, expiration, user control, compatibility with Real's terms, and performance. Decide whether a change is justified only after understanding the other site's flow.

## Immediate next steps

1. Finish the real-pool sport/bundle matrix and protected-preview all-sport/20-pick and collection-import checks. Exact annual scoring, guaranteed month/day correction, and account isolation/conflict recovery are implemented with regression coverage.
2. Restore approved preview/Supabase browser access; complete read-only SQL query-plan, filter/collation, and permission validation. The aggregate/index migration is drafted, disabled, and not applied; any DDL needs separate approval.
3. Measure deployed route/bootstrap and representative mobile responsiveness, cold/stale imports, and realistic payload transfer. Do not present local warm numbers or preview-only scoring as live-production timings.
4. Before an approved live rollout, verify matching cron secrets, exclude preview-only probes/private fixtures, and define runtime checks plus rollback. Current work stays on its separate performance branch with existing UI edits preserved.
5. Continue the remaining feature discovery in [daily-feature-discovery.md](docs/daily-feature-discovery.md), without assuming unavailable public endpoints or unused-booster access.
