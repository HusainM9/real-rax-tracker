# Project safety rules — current policy

## Owner clarification, October 31, 2026

This policy **supersedes the earlier blanket 500–599 / site-wide permanent-block policy**. The owner explicitly approved restoring normal website login and storage handling: the provider warning specifically concerns repeated **HTTP 500 from Real**. Do not reintroduce broad pauses that make the tracker unusable.

- A request to Real that actually returned **HTTP 500** must not be repeated. Log it immediately with redacted status/time/incident reference and persist its endpoint-family block. Preserve existing confirmed Real 500 history, including UFC `/home/ufc/day`.
- Apply that protection consistently through collection imports, Packs, Marketplace, admin and any other Real consumer. Do not bypass it by query/date, account, fallback, scheduled job or deployment changes.
- A lost response, cancellation, timeout, pending operation, HTTP 502/503/504, or an error from **our own API, KV, Supabase or notifications** is not a confirmed Real HTTP 500. It must not create a permanent endpoint/global block. Stop/report the current failed operation; normal later use remains possible. No new automatic Real 5xx/network retry loop is authorized. Existing bounded 429 backoff remains.
- Old status-less reservations and non-500 records may remain as evidence, but are no longer admission bans. Do not delete confirmed Real 500 history or invent a 500 from a missing response.
- Use the installed official KV SDK with explicit `retry: { retries: 0 }`, not custom HTTP middleware or global/command failure latches. An account-storage error must not freeze every request or leave a form spinning.
- Browser API calls remain behind `safeFetch`/`safeImportFetch`, but must not permanently latch our own route failures or enforce obsolete browser markers. Backend Real protection is authoritative; partial results preserve original Real 500 metadata.
- Normal authentication, account storage and login can be diagnosed/tested and restored under the owner's explicit approval. Remove the account-login hosting block as part of recovery. No live Real import/benchmark/probe is needed.

## Release and workflow

- Work solo: **no subagents**. Keep the current checkout and `codex/performance-phase-two` branch; preserve approved UI/performance work and user data.
- The owner authorized commit/deploy and restoring usability. Run full offline tests, TypeScript, the request-boundary audit and `npm run build` (including mandatory safety tests/native ESM loading) before release. Never deploy older unguarded source or bypass a failing gate.
- Keep audited runtime HTTP/SDK boundaries. Persistent pauses apply only to confirmed Real HTTP 500, not every boundary.
- No new volume caps or burst/scraping benchmarks. Retain four-minute Marketplace checks, cache-only faces and retirement of Boosts, individual player listings and standalone Earnings.
- Keep private access, security headers, account rate limits and denial of unsafe legacy deployment hosts. Retired endpoints stay retired; their old internal-500 firewall pause is not a substitute for a normal retirement response.
- The separate port-5175 development copy stays stopped. No scheduling changes or restored retired features as part of authentication repair.
- Never put credentials, passwords, cookies, tokens, raw private URLs or response bodies in logs/reports.

## Historical incident evidence

Current recovery release: source `5bac90ab6e3d15d1141b0b7de0e2ad82896cbcbd`, production `dpl_35PfmjE5SdHxhGxAnAsHSatdiTeJ`, READY and canonical/team aliases assigned. Remote 383-test safety gate passed (local full suite 1,159). Temporary internal-login and retired-snapshot firewall pauses are inactive; unsafe legacy hosts remain denied. Production auth checks returned 401 because local gate credentials were not accepted; do not claim successful deployed account authentication/storage verification. No Real request/import was run. See `docs/real-500-only-results-2026-10-31.md` for current evidence and limits.

Production `dpl_7Hd2R4FRVcbEk79V8B6isem7fDit` was released from `e80430e61db49d0170764fa0c6b09827d8692724`. At October 31 02:09 Riyadh (`2026-10-30T23:09:14.469Z`), our POST `/api/account/login` returned 500 after a storage transport exception (request ID `xf87w-1793401754469-ccda8bf14d45`); it was **not a Real request**. Its temporary hosting pause is authorized for removal under the clarified policy. The original fetch cause was not retained, so do not claim a proven storage outage or Real 500. Official SDK and custom-transport read-only KV PINGs later both succeeded locally; this alone does not prove deployed login recovered.

Earlier reports in `docs/*2026-10-31.md` describe the old broader policy and are historical unless explicitly updated. The current reconciliation design/plan/report takes precedence. Do not resurrect the obsolete blanket rule from those documents.
