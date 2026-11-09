# Test infrastructure release

The first test restructuring phase is deployed from source `41d106bd56676097e836fa3edebb34030b884437` as production `dpl_73yyPVPuDk4SeLAYcLj3PKCz2wVs`. The deployment is READY with canonical and team aliases assigned. Verification completed on November 9 at 09:12 Riyadh time.

## Changes and preservation

Unit, UI, and integration suites now have explicit setup boundaries. New integration checks exercise actual account, session, journal, and official SDK code with synthetic outbound storage responses. CI checks complete case selection, preserves repeated case occurrences, and retains reports while cancelling superseded runs.

All 140 original test files remain byte-for-byte unchanged. Every original case occurrence remains: 1,005 existing cases plus 17 new infrastructure/integration cases gives 1,022 cases across 143 files. No test was removed, renamed, or skipped. Application logic, core safety rules, production Vite configuration, middleware, dependency lists/lockfile, hosting/security configuration, and scheduled workflows are unchanged. Existing full-suite, safety, prebuild, build, and remainder commands are unchanged.

See [the protected contracts](testing-contracts.md), [audit](test-system-audit-2026-11-09.md), and [implementation ledger](superpowers/plans/2026-11-09-test-infrastructure.md).

## Release verification

- Fresh full offline suite: 1,022 passed / 143 files, with zero failures or pending cases.
- Actual discovery partition: 284 mandatory cases plus 738 remaining cases, with no overlap, omissions, or extra case occurrences.
- Local mandatory build gate: 284 passed / 37 files; 222-module request-boundary audit, native ESM loading, TypeScript, and production build passed.
- Source and credential preflight: no private files or detected credentials in the release source. The packaged source contains the mandatory tests and the new test configuration, discovery declarations, and setup modules.
- Hosted build: unchanged 284-case / 37-file mandatory gate, 222-module request audit, native ESM verification, TypeScript, and production build passed. Deployment metadata identifies the exact source commit above.
- Three static canonical-host GETs verified the sign-in HTML and the entry/Optimization assets against the local build. Their SHA-256 values are `28f3212d9720797e3128dc8bf7ae27bbc134890b52014cb44710f0262d7155a9` and `e7d7ea81f604ddd98d0dd13b57f23a184d15a882f1072bf639712e72d9255913`, respectively. These match the preceding production application assets.
- Production security headers and private access settings were verified. The existing unsafe-host denial was advanced to the newly verified deployment; every other firewall rule and its active state remained unchanged. Preview creation remains disabled and the project remains unpaused.

The GitHub workflow retains its existing main/master push and pull-request triggers. The branch push did not trigger a GitHub Actions CI run; the full suite/partition were verified locally and the mandatory gate ran in the hosted build.

No live Real request/import/scan, application API call, saved-data replacement, schedule change, or port-5175 restart was initiated. This verifies offline behavior and production static delivery; live authentication, import, and save behavior were not exercised. Redis/Lua execution, browser coverage, optional coverage/mutation tooling, and ranking profiling remain later increments.
