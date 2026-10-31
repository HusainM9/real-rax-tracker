# Cards layout and import exclusions

The owner requested aligned, less awkward collection rows and moving Ignore on import to the bottom of Cards with a collection search. This is a focused refinement of the approved collection design. Work stays solo in the current checkout and branch, under the current Real 500 policy.

1. Add an offline page regression covering exclusions found outside the current collection filters/page, confirmation/cancellation, and restoring an ignored pass.
2. Use a flat, aligned collection table with readable source amounts and one Remove control. Put a separate Import exclusions panel after Sport totals. Search the entire importable collection independently of the main filters; show paginated matches only after searching. Keep existing confirmation, archival, exclusion and restore behavior.
3. Verify the real component with fictional offline data at desktop and mobile widths. Run the offline suite, TypeScript and the gated build/request audit. Review the diff solo, commit and release through the existing guarded deployment workflow.

No provider requests, import changes, scheduling changes, account avatars or retired features are part of this change. Existing collection data and calculations are preserved.

Implementation and offline verification completed:

- New page regressions failed against the old row actions/missing bottom search, then passed after implementation. They cover independent full-collection search, confirmation/cancellation, import eligibility, match pagination/query reset and allowing an existing exclusion.
- The existing exclusion/archive tests also pass. The underlying data operations were not changed.
- The production component was rendered with fictional data into an isolated static preview. Desktop and 390px phone layouts were inspected; the phone DOM reported 375px content within a 375px viewport, with no horizontal overflow. Preview controls are disabled and its CSP forbids network access.
- Full offline suite: 919 tests in 127 files, partitioned into the 718-test remainder and the 201-test mandatory build gate. TypeScript, native ESM tests, the 212-module request-boundary audit and production build pass. Secret preflight: zero findings.
- Solo final review covered collection behavior/data compatibility, scope of CSS selectors, empty and paginated searches, confirmation and restore behavior. No unresolved findings. The owner requires solo work in the current checkout, so no reviewer agent or worktree was used.

Release pending; production verification will use static website assets only.
