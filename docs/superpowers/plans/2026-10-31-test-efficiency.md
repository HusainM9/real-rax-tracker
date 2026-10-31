# Test efficiency implementation plan

> Execute solo with superpowers:executing-plans. The owner approved the preceding testing recommendation and asked to implement it; no additional design-choice round or subagents.

**Goal:** Reduce test maintenance and turnaround without weakening meaningful regression coverage.

**Architecture / approved design:** Native Node is the default; browser-dependent files explicitly opt into jsdom. Replace exhaustive repeated HTTP status loops with representative exact/boundary cases. Keep calculation/ranking parity, authentication/data-preservation, Real-500, redirect and native-ESM checks. Run targeted tests while iterating and the full suite at completion. CI runs the complement of the mandatory build gate, then the gated build, so tests/type-checking do not repeat within the job.

**Alternatives:** Deleting tests by count does not address the measured bottleneck (199 cases cost 83 ms). Dropping isolation or the release gate risks hidden coupling/safety regressions. No dependency, product-code change, test skip or ranking-matrix reduction is planned.

**Tech stack:** Existing Vitest 4, Node/jsdom, npm and GitHub Actions.

## Constraints and review focus

- No Real requests, new infrastructure, deployment, dev-server restart or user-data changes. Current checkout/branch; work solo.
- Preserve offline network denial in every environment, genuine Real-500 blocking, Edge manual redirects and data/auth coverage.
- Browser dependencies may be indirect; classify failures rather than masking them with global fake browser objects.
- CI remainder + build-gate file sets must be disjoint and equal the full discovered suite; standalone build must retain all mandatory tests.
- Compare sequential before/after runs; report local timings, not production app-speed gains.

## Task 1: Environment split and meaningful cases

Files: `vite.config.ts`, browser-dependent test headers, `lib/real500Policy.test.ts`, `src/lib/safeImportFetch.test.ts`.

- [x] Capture baseline JSON/timings with the unchanged suite.
- [x] Switch Node default, explicitly label browser-dependent tests; run the full suite to discover indirect dependencies, correct test environments only.
- [x] Replace 99/100 repeated status cases with real non-500 `[501,502,503,504,599]` and browser internal `[500,501,502,503,504,599]`; preserve all distinct assertions.
- [x] Full suite green, all meaningful test names retained; record count and timings.

## Task 2: CI and handoff

Files: `scripts/test-ci-remaining.mjs`, `package.json`, `.github/workflows/ci.yml`, `README.md`, this ledger.

- [x] Derive CI exclusion arguments from the existing `test:safety` command (single source of truth), forwarding user Vitest arguments and exit status.
- [x] CI runs remainder then `npm run build`; remove redundant standalone lint because build already type-checks.
- [x] Verify actual remainder/build-gate discovery union and empty intersection against the full JSON report; verify targeted CLI, full suite, type-check/build/audit/native ESM and source packaging.
- [x] Solo review and document before/after results. Leave app/deployment unchanged.

## Execution ledger

- User approved recommendation; current source starts at `e8d1ded`. Existing audit baseline: 1,165 tests/139 files, last file completed in 15.292 s; ranking matrix 8.139 s, two status files' assertions 83 ms. This is not an app benchmark.
- Ruling: use the requested current checkout/solo workflow and a compact ledger here, rather than worktrees/subagents/shell-only task wrappers. No external publish is needed for test-only changes.
- Task 1 complete: two sequential baselines passed 1,165 cases in 16.470/16.338 s outer wall time. Node split + representative cases passed 977/139 files immediately; no indirect browser failure or application change. With five new CI-selector regressions, two sequential full runs passed 982/140 files in 10.139/10.305 s (about 38% faster).
- CI selector RED: new module absent; then five selection/ambiguous-command cases GREEN. Invalid gate syntax fails explicitly rather than silently altering coverage. No test skip, isolation change or dependency added.
- Task 2 complete: actual CI remainder ran 781 cases/118 files; actual release gate ran 201/22. JSON test-ID set comparison against full 982/140 found zero overlaps, omissions or extras. Before/after comparison found exactly 188 removals, all repetitive status instances, and exactly five additions, all CI-selector regressions. Child CLI failure exit 1 is preserved.
- Final verification: full suite passed twice; gated `npm run build` passed 201 safety/runtime cases, 221-module request audit, native ESM, TypeScript and Vite. Secret/source-package preflight passed; required safety files remain packaged. The built application bundle is unchanged (`index-CEGnP8sN.js`). No live Real or other provider requests, deployment, dependency install, application logic change, user-data edit or dev-server restart.
- Final review: self-review (owner prohibits subagents). Reviewed environment annotations, Node-compatible setup, exact CI partition, fail-fast command validation, child error propagation and release packaging. No remaining important findings. Runtime timing is local Node 24 on this machine, not a promised CI/Vercel/app speed.

## Result

## Follow-up: remove obsolete coverage and its retired code

Owner approved autonomous cleanup after the audit; no additional questions, deployment or live provider checks. Preserve unrelated in-progress Packs edits in this shared checkout. Keep all retirement/public-URL guards, shared Marketplace auth, current imports and historical-season/ranking coverage.

- [x] Remove disconnected player-listings UI/helpers and their tests; retain its HTTP 410 boundary.
- [x] Reduce retired Earnings handlers to retirement stubs, removing old reconstruction/history/cache helpers and archival tests. Retain three retirement configuration checks, no-network aliases and saved data (never clear KV/localStorage).
- [x] Remove the four unused legacy import/PIN modules and their tests. Consolidate re-export pass-name fixtures into shared tests; remove the obsolete unknown-outcome recovery fixture already covered by the current network-failure recovery case.
- [x] RED→GREEN: performance lab has no live Packs/collection benchmark controls. Retain local-file ranking; remove the obsolete multi-request probe and test.
- [x] Verify full suite, build/runtime gate, CI partition, native ESM, references and diff. Source deletion is recoverable through Git; no user data or live system changed.

Cleanup results: removed 33 tracked obsolete files (17 test files and 16 implementation/style files). Retained three scheduling-retirement configuration checks, removed irrelevant assertions requiring old cron times/import text, and added a real Node-adapter retirement check. The preview UI regression was RED before removing live-loop controls and GREEN afterward. Retained the unique Bruce Brown fixture in shared pass-kind coverage.

Final settled full suite: **907 passed / 125 files**. The actual CI remainder passed **706 / 104 files**, and its test-ID set exactly equals the full suite minus the mandatory 201-case gate: zero omissions or extras. Build passed **201 safety/runtime tests / 21 files**, the **211-module** request audit, native ESM, TypeScript and Vite. No references to removed modules remain in source/tests/scripts; reachability candidates now consist only of an unrelated asset and test setup helpers. Source-package and secret preflight passed. Scoped diff check passed; unrelated in-progress Packs edits were preserved, including their whitespace/style work.

One intermediate CI-remainder run failed the separately edited Packs context case `persists pack targets and records only fresh imported evidence for the matching account` (expected missing, received owned). No cleanup file was changed to suppress it; the current Packs implementation subsequently passed that focused file and the fresh full suite/build. New Packs tests were also added during verification, so these counts describe checkpoints, not a frozen release. Final release verification belongs to that ongoing reconciliation; this cleanup was not committed, pushed or deployed.

An intermediate full run included a temporary `src/testing/packsLayoutExport.test.tsx` visual-export helper (908/126). Its owner removed it after generating the proof; it is not a CI-selection omission. A fresh full run after that removal passed 907/125, exactly matching 706 remainder + 201 gate.

### Original environment-split result

| Check | Before | After |
| --- | --- | --- |
| Full-suite outer wall time (two sequential runs) | 16.470 / 16.338 s | 10.139 / 10.305 s |
| Full cases / files | 1,165 / 139 | 982 / 140 |
| jsdom files | 137 | 18 |
| CI execution | Full suite + repeated build subset; type-check twice | 781 remainder + 201 gate, type-check once |

About **38% faster** full local test runs. Calculation/ranking matrices remain intact. The remaining ranking reference matrix still contributes most test-body time; it was retained for correctness rather than cut to improve a headline. Changes are local and ready for review; no deployment is required for this testing-only task.
