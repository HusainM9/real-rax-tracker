# Real HTTP 500 only — safety reconciliation

Owner decision: restore normal internal authentication/storage and restrict persistent no-repeat blocking to **confirmed Real HTTP 500**, not all 5xx, unknown responses or our APIs. This supersedes the previous broad policy. Work solo in the current checkout and stack; no additional design-choice round is needed for this explicitly requested correction.

Selected approach: simplify rather than extend the locking framework. Only Real consults shared failure history; write a durable record only after an actual 500. Keep the same family hash/key so existing confirmed 500s are honored, including older record formats. Old unknown/non-500 evidence remains but is not an admission ban. Serialize same-family Real work locally; already-in-flight work across processes cannot be unsent. If history cannot be read, stop only the current Real operation. A local latch covers an observed 500 if durable recording fails; report that limitation honestly.

Use the installed official KV SDK, explicit zero retries and no custom HTTP/latches. Non-Real outbound requests are ordinary single attempts. Browser wrappers do not store/enforce route-wide bans; only explicit Real-500 metadata pauses a Real operation. Auth forms always settle errors and allow ordinary credential correction; no permanent internal-login pause. Account login handles unavailable storage as a clear 503 instead of an unhandled 500.

Rejected: keeping every old reservation as a ban preserves the unusable state. Rejected: deleting all history re-enables known failed Real requests. No new dependency, service, queue, volume cap or Real test burst is needed.

Verification: exact-500 boundary across 500–599; old confirmed vs unknown records; timeout/lost-response recovery; non-Real failures do not poison later requests; real SDK attempt counts; real auth pages/providers with mocked HTTP; handled API storage failures; full tests/build/native ESM. Non-Real read-only diagnostics are allowed. Reconcile obsolete internal firewall pauses, commit/deploy and verify without a Real import.
