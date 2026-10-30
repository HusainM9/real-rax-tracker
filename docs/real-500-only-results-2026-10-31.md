# Real HTTP 500 only — safety reconciliation

October 31, 2026. Current policy, superseding the older broad safety reports. Implemented solo on `codex/performance-phase-two`, preserving the approved UI/performance work and saved data.

## What changed

- Only an actual HTTP **500 from Real** is immediately logged and durably pauses its endpoint family. Query/date/account variants and later deployments do not bypass it. The existing key namespace, old confirmed-500 records and UFC day-endpoint block remain.
- Removed permanent blocks for internal APIs, KV, Supabase, notifications, lost responses, cancellations, timeouts and HTTP 501–599. These errors stop/report the current operation, without poisoning later normal use. No new automatic Real 5xx/network retry loop was added; existing bounded 429 backoff remains.
- Removed pre-request durable reservations, owner-only/unknown-record admission bans, custom KV HTTP middleware and command/global storage latches. The official SDK uses explicit zero retries and a 15-second per-attempt deadline. Old evidence is retained, not deleted. Old browser markers are ignored, not cleared.
- Site/account/admin login forms always settle failures, show an error and allow correction. Account credential-storage exceptions produce a handled 503 rather than an unhandled 500. No Real endpoint participates in tracker login.
- An import's actual Real-500 failure retains its status and is excluded from retry actions. Unrequested passes are marked deferred, not falsely labeled 500. The import form no longer disables all imports/retries because one Real endpoint was paused; backend history remains authoritative.
- Keep private access, account rate limits, unsafe legacy-host denial, four-minute Marketplace checks, cache-only faces, and retirement of Boosts, individual player listings and standalone Earnings. No scheduler change, new cap, data deletion or dev-server restart.

## Why login failed

Saved Vercel logs show POST `/api/account/login` returned 500 at **October 31 02:09 Riyadh** (`2026-10-30T23:09:14.469Z`), request `xf87w-1793401754469-ccda8bf14d45`, deployment `dpl_7Hd2R4FRVcbEk79V8B6isem7fDit`. A storage fetch threw before returning a response; the old wrapper discarded its original exception. The exact network/runtime cause is unknown, not a proven Real or KV outage.

Separately reproduced: auth pages had no catch/finally, leaving “Signing in…” after a thrown request error. The old middleware and browser safety state could extend a transient internal failure into a lockout. Read-only local PINGs through both official SDK and custom transport later succeeded; that is not proof that deployed login recovered.

## Verification and solo review

Regression tests first demonstrated the auth spinner, broad status/unknown/internal-service bans, and false assignment of 500 to unrequested work. Coverage includes all 100 statuses from 500 through 599, durable confirmed-500 admission after module reload, legacy-record classification, partial results, storage failure isolation, actual SDK attempt counts and real auth pages/providers with fake HTTP.

Fresh local results: `npm test` passed **1,159 tests / 139 files**; `npm run lint` passed; `npm run build` passed its **383-test / 22-file** mandatory gate, the **221-module** request-boundary audit, native server ESM loading and TypeScript/Vite build. The actual-script offline Lua check passed. Source-package/secret preflight found no private fixtures, credentials or API test functions in the deployment package. No Real request, import, provider benchmark, fixture upload or account-collection replacement was performed in this reconciliation.

Solo review found and fixed the skipped-pass attribution and blanket import-form lockout with RED→GREEN tests. Deferred checks: a real import remains for the owner, production end-to-end successful account login requires their credentials, and production speed measurements were not repeated. SQL/schema/OTD logic and the previously retained performance work were not changed by this safety correction.

## Limits

- A request already in flight in a different process cannot be unsent when another process observes 500. Same-family work is serialized locally; later requests consult shared failure history.
- If failure-history reads are unavailable, only the current Real operation stops before dispatch, without a permanent global ban. If recording an observed 500 fails, it is logged and blocked in that warm process; cross-instance durable protection cannot be guaranteed during a storage outage. No claim of perfect distributed exclusion is made.
- The Lua harness executes the actual source script with in-memory Redis/JSON adapters; it is not a live Upstash integration test. No confirmed Real 500 was cleared or replayed.

## Release evidence

- App source committed/pushed as **`5bac90ab6e3d15d1141b0b7de0e2ad82896cbcbd`**, branch `codex/performance-phase-two`.
- Production deployment **`dpl_35PfmjE5SdHxhGxAnAsHSatdiTeJ`**, READY, exact source commit verified; canonical and team aliases assigned. Unique host: `real-rax-tracker-9u0x7n051-sniperhusain-9147s-projects.vercel.app`.
- Remote build independently passed **383 tests / 22 files**, the 221-module audit, native ESM check and TypeScript/Vite build. Hosting emitted an existing Edge-runtime deprecation warning; runtime migration is a separate follow-up, not silently included here.
- Read-back confirms the project is unpaused, preview creation remains disabled, and the host rule admits only the canonical/team/new unique hosts. Unsafe older deployments remain denied.
- The exact temporary account-login and retired snapshot internal-error firewall rules are now **inactive**, verified by read-back. Retired handlers remain retired; no retired endpoint/cron was executed, and no remote schedule changed.
- Production login routes returned normal **401**, not 500, in verification. However the local site-gate token/password were not accepted by production, so these checks did **not** reach account storage or prove successful tracker authentication. No password was changed, no access protection weakened and no user tracker password was used. The owner must reload and sign in normally to finish that check; offline real-handler/UI regressions cover storage and form behavior.
- Public `/login` returned **200** and referenced the exact newly built `index-CEGnP8sN.js` bundle. This verifies the new UI is served, not account authentication.
