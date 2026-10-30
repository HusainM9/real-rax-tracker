# Request safety implementation plan

**Goal:** implement the amended request-safety design without live requests, new rate caps, deployments, restarts or data deletion. Reference: `../specs/2026-10-30-request-safety-amended.md`.

**Execution:** solo, current checkout on `codex/performance-phase-two` as explicitly selected by owner. No worktree, dependency installation or subagents. Preserve existing changes. Commit/integration deferred because this checkout includes extensive unrelated uncommitted work. Latest explicit owner directions approve the amended scope; do not repeat an approval loop.

## Tasks

1. Offline verification boundary: add default-deny fetch setup to Vitest and test it. Run a fresh baseline with no live services. All HTTP tests must explicitly mock responses.
2. Cache-only faces and marketplace retirement: first write failing tests for exact/sibling/missing faces and disabled manual/cron/listings endpoints. Remove live avatar resolution, disable marketplace UI and workflow, preserve stored rules/history. Run targeted tests.
3. Durable no-repeat transport: first write tests for all 500–599, concurrent reservation, fresh callers/query variants, non-5xx release, uncertain outcomes, storage failure and known UFC block. Add `lib/requestSafetyStore.ts`, `lib/guardedUpstreamFetch.ts` and browser-safe `lib/httpFailurePolicy.ts`. Use shared KV NX with owner-checked release and no TTL; no hidden KV retries, quotas or half-open probes. Integrate Real and Supabase transports, suppress terminal fallbacks. Test adapters against mocked storage only.
4. Import propagation: write regression tests for terminal earnings failures, stopped queues, retained prior rows and exclusion from retry lists. Propagate `upstreamStatus` / `retryable:false` through server APIs and browser helpers. Audit remaining import paths for swallowing/fallback/retry loopholes.
5. Verify and report: targeted suites, full offline tests, typecheck and build. Solo code review (owner bans reviewers/subagents). Record actual results and limits in a safety report; no claims of live protection before deployment. Keep production and both development servers stopped.

For each task: record RED failure before implementation, GREEN command/result afterwards, and any evidence-based deviation in `.superpowers/sdd/2026-10-30-request-safety/progress.md`. Existing tests asserting retired live features may be replaced, but unrelated failures are not silently removed.
