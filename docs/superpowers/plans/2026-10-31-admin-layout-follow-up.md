# Admin layout follow-up implementation plan

> Execute solo with superpowers:executing-plans under AGENTS.md. This corrects the approved Admin layout using the owner's screenshots; retain the current branch and checkout.

**Goal:** Bound Admin's width and make shop crawl controls readable.

**Architecture:** Scoped container CSS plus semantic grouping of existing JSX; no handler or transport changes.

**Tech Stack:** Existing React, TypeScript and CSS.

**Spec:** `docs/superpowers/specs/2026-10-31-admin-layout-follow-up-design.md`.

## Constraints and review focus

No Real requests, changed scheduling, data replacement or restored retired features. Preserve all crawl controls/disabled states. Inspect wide/phone containment, season preset selection, idle action availability, folded recovery controls and other Admin tabs. Remove the preview-only width wrapper so it cannot conceal production defects. This reversible presentation change needs visual verification and existing behavior tests, not implementation-mirroring tests.

## Task

- [x] Update `src/pages/AdminPage.tsx` and `src/pages/admin/AdminPage.css`: capped container, scope/run groups, folded cursor tools, deliberate button sizes, responsive stacking.
- [x] Rebuild the offline production-component preview without an artificial outer container; verify at 2520px, 1440px and 390px. Exercise presets and disclosure controls only, without running maintenance actions.
- [x] Run existing Admin/component tests while iterating; run the remaining offline suite plus the mandatory build once before release (TypeScript, native ESM and request audit included).
- [ ] Review diff for unchanged handlers; commit/push/deploy, verify exact source/static delivery and preserve firewall protections. Record release evidence.

## Evidence

The original Admin route is outside the normal application shell. The previous preview-only wrapper concealed the missing production max-width; that wrapper is now removed. The production container measures 1,216px at both 2,520px and 1,440px viewports. At a 390px phone viewport, document client/content widths both measure 375px (remaining width is the vertical scrollbar). Presets are stacked, full-width 36px buttons on phones. The NBA/NHL preset still selects season 2027 and those two sports. Recovery disclosure opens normally. No run, backfill, manual cursor mutation or provider operation was executed. Existing focused tests: 15/2 passed.

Final source verification: 961 tests / 136 files passed (713/104 remainder plus 248/32 mandatory gate). TypeScript, native ESM, 221-module request-boundary audit and production build passed. Secret preflight: 446 files, no private paths/findings. Solo review found no handler/request changes; no new tests were added for presentation-only markup/CSS. Release pending.
