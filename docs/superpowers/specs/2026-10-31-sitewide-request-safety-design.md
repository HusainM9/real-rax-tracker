# Site-wide safety and four-minute marketplace — owner amendment

The owner's October 31 instruction restores marketplace alerts at four minutes, retains cache-only faces/removal of individual listings, and requires the HTTP 500–599 no-repeat rule site-wide before any deployment. This is a precise amendment to the existing safety implementation, not approval to unpause hosting, deploy, probe providers, change remote schedulers or run live benchmarks. Continue solo in the current dirty branch; preserve unrelated changes.

## Design

Use the existing guarded transports everywhere, rather than separate feature-specific retry policies. All browser API requests use the persistent browser failure latch; all server outbound HTTP uses durable pre-request admission. Notification delivery is included. KV SDK retries remain off. Failures preserve original upstream status and non-retryability, and scanning queues stop after terminal failure. External/browser-managed asset loading and an unavailable safety control plane cannot be claimed as universally controlled by application code.

Restore alerts in the local code and UI, but not individual player listings. Both manual and scheduled scans share one atomic four-minute start gate and an overlap lease. Trigger arrivals before the interval expires are acknowledged without another provider scan. Restore the repository's existing ten-minute fallback; do not pretend it is a four-minute scheduler. Document the required QStash four-minute trigger and zero delivery retries for a separately authorized rollout. A two-minute legacy trigger cannot bypass the server gate.

Make request auditing a mandatory build step. Reject unguarded app fetch/SDK call sites before building. Verify actual 5xx behavior using offline mocks. Do not weaken the guard to preserve old timing numbers. Report extra durable-store round trips analytically, and clearly label earlier benchmarks as pre-safety measurements, not current production times.

## Approaches

- Selected: extend the existing shared safety transports and enforce cadence at the backend. This covers manual/cron callers and does not depend solely on a scheduler edit.
- Rejected: only changing scheduler copy/interval leaves direct requests and old scheduler deliveries unconstrained.
- Not selected: global monkey-patching fetch or an account-wide kill switch changes unrelated runtime behavior and still cannot govern infrastructure-managed HTTP retries.
