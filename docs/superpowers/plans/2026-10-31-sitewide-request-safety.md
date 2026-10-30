# Site-wide request safety implementation plan

> Execute solo with superpowers:executing-plans and test-driven development. This is the owner's exact amendment to the existing plan, not a new product design approval cycle.

**Goal:** restore four-minute marketplace alerts and cover all application-controlled request paths with the existing no-repeat rule before deployment.
**Spec:** `../specs/2026-10-31-sitewide-request-safety-design.md`.
**Constraints:** no deployment/unpause, provider probes, remote schedule changes, server restart or subagents. No new account request-volume caps. Preserve dirty checkout; defer commits/integration.

## Tasks

1. Marketplace: write cadence regression tests using time-aware fake storage; confirm RED at <240 seconds. Make shared start admission atomic, owner-check release, and use it for manual/cron requests. Restore alerts/UI/fallback, retain individual-listings HTTP 410. Stop current scan queues on terminal errors and preserve metadata. Test normal auth behavior, skipped arrivals, enabled notice removal, old client listings and terminal errors.
2. Site-wide transport: write failing regressions for earnings/account requests and notification 5xx followed by a new caller. Route remaining browser HTTP through the common latch and server notification HTTP through durable admission. Preserve partial error metadata. Test network failure, all 5xx, forbidden fallback/retry and queued work after failure.
3. Deployment gate and report: write behavior tests for an AST-based call-site auditor (safe fixture passes, direct fetch/SDK/request alias fails). Run it automatically before every build. Complete runtime audit, full offline suite, typecheck/build, solo review; document speed trade-offs and unresolved infrastructure limits. Never run live timing tests to refresh old numbers.

## Review focus

- Scheduled/manual requests must share cadence without expiring failed endpoint blocks.
- Time-aware storage tests must cover the 239/240-second boundary and concurrent callers.
- Browser error wrappers must not offer retries after a status is translated or embedded in 200 JSON.
- Notification retries on later schedules must stop before the failing upstream endpoint.
- Build audit must catch request aliases, not merely a particular text spelling, and must not pull server transports into client bundles.
