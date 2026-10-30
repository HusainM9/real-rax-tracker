# Targeted request safety — amended owner-approved scope

October 30, 2026. Supersedes the draft proposing traffic caps and retaining marketplace scans. The owner's latest instruction approves implementation with **no new rate caps** and **marketplace alerts disabled until further notice**. No live rollout, provider requests, server restart or production unpause is authorized. Work solo in the existing dirty `codex/performance-phase-two` checkout; preserve unrelated UI/performance work and saved data.

## Decisions

- Disable marketplace alerts in the UI and at both manual/scheduled entry points before storage, provider access or notification delivery. Acknowledge disabled cron invocations without a retry-inducing failure. Disable the repository workflow too. Preserve saved rules/history; do not delete remote schedules or account data.
- Retire the individual-player listings endpoint and remove its tab from the active page. Old clients must not reach Real through it.
- Faces resolve from exact catalog records, then saved sibling-season avatars, otherwise the existing placeholder. Remove implicit player/team probes and provider credential requirements. Legacy options cannot enable live filling.
- Every HTTP 500–599 is terminal. Persist a pre-request reservation in shared KV and retain it after a 5xx or uncertain outcome, across callers, credentials, query variants and deployments sharing that ledger. Block known failed UFC home-day queries without probing. No automatic expiry, force override, fallback workaround or reset UI.
- Release a reservation only after a definite non-5xx response. Admission is per endpoint family, not an account-wide request quota. Different endpoint families remain independent. If the durable ledger is unavailable, do not contact the upstream service.
- Preserve original status/non-retryable classification through Real errors, backfill partial responses and browser retry lists. Stop affected queues and retain valid collection data. Remove Supabase's explicit 5xx retries and audit import fallbacks.
- No new requests/minute, spacing, hourly caps or blanket automatic-scraping pause. Other automatic jobs remain present; production/dev shutdown remains in force separately.

## Interfaces and failure policy

The server-only safety transport uses a hashed provider/method/origin/path identity (no credentials, query strings or private response bodies). Shared KV reservations use atomic NX and owner-checked release, no expiration. A known failure is permanent until separate operator investigation. Pending/uncertain requests are also blocked: a crash cannot silently grant permission to repeat. KV's own transport retries are disabled. A storage outage defers provider work rather than falling back to process memory.

Browser-safe error helpers carry `upstreamStatus` and `retryable: false`, including when a wrapper returns a non-5xx status or partial HTTP 200. Existing successful fixtures and cached calculations are unaffected. Supabase and Real have separate namespaces; conservative endpoint-family blocking may temporarily disable more than one item on a failed table/endpoint.

## Verification / limitations

Use mocked fetch/KV and local fixtures only, with a default-deny test fetch. Test all 5xx codes, fresh callers, query changes, concurrency, unknown outcomes, storage failure, fallback suppression, partial-response propagation and cache-only faces. Run targeted tests, full suite, typecheck and build, then solo review. Do not benchmark or reproduce against Real, Supabase or paused hosting.

These changes do not prove successful-request volume is acceptable to Real. The owner declined caps. Undeployed changes do not protect old deployments, sibling worktrees, external functions or independent collectors. Remote schedules are not changed by this local implementation. Keep shutdown controls in force pending a separately approved rollout.
