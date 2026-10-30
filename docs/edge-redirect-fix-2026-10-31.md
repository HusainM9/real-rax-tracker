# Edge redirect compatibility correction

October 31, 2026. Solo fix in the current checkout; no Real request/probe/import or development-server restart.

## Cause

The shared outbound transport forced `redirect: 'error'`. Vercel Edge rejects this option, allowing only `follow` or `manual`. Non-Real catalog consumers surfaced the raw validation exception on OTD/optimization; the Real branch caught that exception and replaced it with “The Real response was not received.” Collection and Packs imports therefore appeared to have a Real connection problem even though the affected call failed option validation before dispatch. This is a transport bug introduced by the safety work, not evidence of a Real HTTP 500 or an account ban.

Six RED regressions reproduced both reported error forms and missing explicit redirect refusal at the HTTP/runtime boundary. The earlier Node-based gate did not model Edge's redirect constraint; passing those tests did not establish Edge compatibility.

## Correction

- Both Real and non-Real server requests force **manual** mode, including when a caller asks to follow redirects.
- The transport explicitly rejects 3xx/opaque redirects without making a follow-up request or exposing the destination/credentials. Real redirect errors are not mislabeled as a lost response or stored as 500.
- Actual Real HTTP 500 handling, durable existing blocks, UFC protection, no automatic network/5xx retries, and other clarified safeguards are unchanged. No safety history or saved collection was deleted.

## Verification

- Targeted tests: **141 / 4 files passed**, including all six new regressions and the existing Real-500/other-status policy tests.
- Full suite: **1,165 / 139 files passed**.
- `npm run lint`: passed.
- `npm run build`: passed **389 mandatory safety tests / 22 files**, the **221-module** boundary audit, native server ESM loading, TypeScript and Vite build.
- Runtime-contract tests use controlled HTTP responses and reject the unsupported option exactly as Edge does. They are not a live Real integration test; no successful production collection/Packs import is claimed.

## Release

- Source **`ef3c9b2ef777a77b6fce6ab3cf23ce60dc79d700`** committed/pushed to `codex/performance-phase-two`.
- Production **`dpl_3H8XKumX3B56Ef4xqnGTW1VQduTE`** is READY, exact source commit verified, with canonical/team aliases assigned. Unique host: `real-rax-tracker-42kdgp947-sniperhusain-9147s-projects.vercel.app`.
- Remote build independently passed **389 tests / 22 files**, the 221-module request audit, native ESM loading and TypeScript/Vite build.
- Private access and legacy unsafe-host denial remain; the host allowlist advances to the new unique build. Obsolete internal-login/retired-snapshot pauses remain inactive. No scheduler or password changes.
- No signed-in browser tab was available for end-to-end checks. Normal owner testing can resume on the corrected build; do not repeat any confirmed Real 500. This release verification does not claim a successful live collection or Packs import.
