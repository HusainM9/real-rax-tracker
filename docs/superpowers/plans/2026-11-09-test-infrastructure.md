# Test infrastructure implementation plan

> Execute solo with superpowers:executing-plans. The owner approved starting the audit's incremental restructuring, requires core rules and important tests to remain unchanged, and prohibits commits and deployments.

**Goal:** Establish explicit test boundaries and complete CI selection without removing existing coverage.

**Architecture:** Preserve all 140 existing test files verbatim. Keep existing service substitutes in the explicitly documented unit/UI setup; new integration tests share only offline network denial and exercise actual application services and the official SDK. Discover every test file into one named project and verify the real mandatory/remainder commands against full discovery with occurrence counts.

**Tech stack:** Installed Vitest 4, Node/jsdom, npm, GitHub Actions. No new dependency.

**Spec:** `docs/test-system-audit-2026-11-09.md`, as constrained by the owner's November 9 implementation request and current `AGENTS.md`.

## Global constraints

- Work solo in the current checkout on `codex/performance-phase-two`.
- No commits, pushes, deployments, schedule edits, live provider/application requests, data changes, or development-server starts.
- No application-rule, production Vite configuration, existing test-file, or mandatory safety-command changes.
- Preserve every current test case occurrence and all existing assertions. No consolidation or deletion in this pass.
- Shared setup always denies unmocked fetch. New integration tests use fixture configuration and actual internal modules; only outbound effects are stubbed.
- Keep the current remaining-tests plus mandatory prebuild gate, native ESM, request audit, and TypeScript checks.

## Review focus

- Repeated test titles must retain their multiplicity in partition validation.
- A new test must appear exactly once in discovery without maintaining a manual filename list.
- Integration tests must exercise actual error persistence and SDK behavior without inheriting unit service fakes.
- A storage failure must permit later explicit login and data access, without automatic retries or permanent bans.
- Test runs must not load private local configuration through the application Vite config.

## Tasks

### Task 1: Protect and classify the existing suite

- [x] Capture tracked-file hashes and a fresh full-suite baseline in ignored task scratch.
- [x] Add tests for filesystem classification into unit, UI, and integration projects; watch them fail before implementing classification.
- [x] Implement `scripts/test-projects.mjs`, `vitest.config.ts`, and shared `tests/setup/offlineNetwork.ts`. Retain all existing service fake behavior in `src/testing/offlineSetup.ts`.
- [x] Verify representative existing Node, UI, safety, and native-module tests; compare discovery with the baseline.

### Task 2: Verify real offline application boundaries

- [x] Add an account integration test before project separation; demonstrate that hidden journal substitutes prevent the expected outbound journal operation.
- [x] Run the integration project without internal service mocks. Cover login/session/data access and a storage failure followed by normal explicit recovery using the actual official SDK and journal.
- [x] Reject unexpected outbound destinations/commands in the fixture transport and retain default fetch denial outside explicit stubs.

### Task 3: Make CI selection auditable

- [x] Add failing tests for occurrence-preserving partition validation, missing/extra cases, overlaps, empty suites, and absent gate files.
- [x] Implement `scripts/test-suite-partition.mjs` and expose `test:partition` plus named-project commands. Leave `test:safety`, `prebuild`, and `build` commands unchanged.
- [x] Add CI cancellation, timeout, read permissions, partition verification, and separate result reports. Preserve workflow triggers and all scheduled workflows.
- [x] Document unit/UI legacy substitutes and the integration contract; do not describe the SDK fixture as Redis/Lua execution.

### Task 4: Complete verification

- [x] Run new focused checks, the real discovery partition, full offline tests, TypeScript, request-boundary audit, and gated production build including native ESM.
- [x] Compare every original case occurrence and all 140 existing test-file hashes with baseline; verify production/core-rule files are unchanged.
- [x] Self-review the diff and record results. Leave all work uncommitted and undeployed.

## Scope ruling

This first implementation pass delivers the independent infrastructure and boundary-testing foundation. The owner's instruction to preserve important tests overrides the audit's proposed consolidation: no existing test file is edited or removed. Actual Redis/Lua execution, real-browser smoke, optional coverage/mutation dependencies, and ranking profiling remain subsequent increments; none is simulated or claimed complete here.

## Execution ledger

- Ruling: The owner explicitly requests the current checkout, solo execution, no commits, and no deployments; these override skill defaults for worktrees, reviewer agents, and commits.
- Ruling: Preserve every existing test file rather than deciding which is important. Added integration tests supply new evidence without changing the current safety contract.
- Pre-flight: project discovery owns file classification; the partition command consumes actual Vitest discovery and the unchanged safety command. Both must preserve all current case occurrences, including nine identical retirement case names.
- Baseline artifacts: `.superpowers/test-restructuring/baseline-hashes.json`, `baseline.json`, and `baseline.log`.
- Baseline: 1,005/140 passed. The journal boundary characterization failed under the original setup because the service substitute returned success without sending the journal command; the separated integration setup passed the same behavioral check.
- New checks: 12 infrastructure cases and five account boundary cases. The current suite has 1,022 cases / 143 files. All 1,005 baseline case occurrences remain; none was removed or renamed. SHA-256 comparison confirms all 140 original test files remain byte-for-byte unchanged.
- Type checking initially identified a missing declaration for the new `.mjs` discovery helper. Added its precise `.d.mts` declaration and included the new integration/setup/configuration files in existing TypeScript checking; no compiler checks were relaxed.
- Final review: self-review, as required by the owner's no-subagent policy. Found that discovery needed to retain Vitest's `.spec` convention and block-comment environment annotations; expanded the existing new fixture test, observed RED, and corrected discovery to use the installed Vitest's annotation semantics. Fixture annotations are constructed to avoid accidentally annotating the fixture-generator test itself.
- Final review: added a failing case for the same file being assigned to two projects even when the CI partition balances. The validator now rejects that duplication; all ten partition checks pass.
- Final verification after those review changes: `npm run test:partition` passed 1,022 cases / 143 files = 284 mandatory + 738 remaining, with no overlap or omissions. Full `npm test` passed 1,022/143 with zero failures or pending cases; outer wall time was 10.13 seconds locally. The first run under new project identities took 13.48 seconds; no CI speed improvement is claimed.
- Final `npm run build` passed the unchanged 284-case / 37-file safety gate, 222-module boundary audit, native ESM check, TypeScript, and Vite production build. Standalone TypeScript also passed during iteration. JUnit output was generated and parsed locally for the integration project; the gated build generated the separate safety report. No remote CI run was triggered.
- Preservation checks: application/core-rule files, `AGENTS.md`, production Vite config, middleware, hosting/security configuration, dependency lists/lockfile, scheduled workflows, and all five existing full-suite/release-selection commands are unchanged. HEAD remains `4d7249d`; the index is empty. No commit, push, deployment, live service request, data edit, or server start occurred.
- Ruling: retain ignored baseline/results scratch while the changes are uncommitted so the owner can inspect the preservation evidence. No tests or stored application data were deleted.
- Remaining increments: actual Redis/Lua execution, built-app browser coverage, optional coverage/mutation tooling, and ranking profiling. No test consolidation was performed, including the low-value candidates from the audit.

## Release authorization

The owner subsequently requested "commit and deploy" on November 9. That authorizes committing and releasing this verified first phase on the current branch. The earlier no-commit/no-deployment restriction describes the completed implementation pass; preservation of all original tests, application logic, safety rules, data, and schedules remains in force.
