# Marketplace cadence and NHL diagnosis

**Goal:** Restore four-minute scheduled scan opportunities and establish why the selected NHL auctions are missing without a live diagnostic scan or changing saved rules.

**Evidence:** Read-only storage inspection found one owner, ten selected NHL players (including Jack Eichel without overrides), four other selected players, fourteen requests per run, aggregate 11–17 returned listings and repeated eight-minute gaps. Scans finish in about five seconds. The NHL rule uses season 2027, a default 25 RAX/rating cap, all rarities, and Rare–Legendary target-price filtering. The owner confirmed the Eichel example is Rare with a 25/rating target. Existing logs have no per-sport return counts. The exact 240-second cooldown starts after variable scheduler/storage latency; a slightly early next tick skips a whole interval.

**Architecture:** Keep the shared four-minute gate and overlap lease. Only authenticated scheduled callers may wait once for a nearly expired cooldown (at most five seconds, abortable), then use the unchanged atomic NX admission; manual/duplicate/early requests still skip. Add bounded per-feed diagnostics to the normal monitor result and existing scan history, showing sports/players/counts and numeric returned seasons, never bodies/URLs/credentials. Do not guess a different NHL API season or add fallback requests.

**Constraints:** Work solo in the current checkout/branch. Preserve confirmed Real 500 protection, official zero-retry KV, four-minute cadence, retired routes and user data. No scheduler changes or manual/live diagnostic scans.

- [x] Reproduce scheduler jitter with fake time/storage, preserving 239/240-second and concurrent admission regressions; test abort/long-cooldown behavior. Implement only the scheduled bounded wait and wire its caller.
- [x] Exercise the exact Eichel default settings through the real matcher/monitor against offline fixtures. Rare and Epic inherit the default 25 ratio, and an over-limit target is excluded. Existing rarity/override regressions remain intact.
- [x] Record per-feed return counts/match counts/returned seasons/rejection or pagination warnings in scheduled/manual scan status; render readable sport counts in the existing scan log. Verify old logs remain valid.
- [ ] Run focused tests, the complete offline suite partition, TypeScript, request audit, native ESM and production build. Review changes, commit, deploy and verify static delivery/firewall protections.
- [ ] Inspect the next ordinary scheduled scan's stored metadata without triggering a scan. If the evidence identifies another cause, reproduce it offline before changing behavior. Report what was observed and any remaining uncertainty.

## Ordinary-run evidence and season follow-up

Diagnostic/timing release `d9fea8ba47af47c3f3395f7fd2b01143dc2d6445` / `dpl_6mrHiyNhhPoakPhgt3S75DuUZoYM` reached READY with aliases; full offline 991/138, remote mandatory 284/37, audit222, TypeScript/native ESM/build passed. Canonical Marketplace asset matched local SHA-256 `266d1fb72363623ec7b9d4d95e2db04436c12655a4b2b884d4dc4e2043c260b3`; unsafe-host denial advanced, other rules unchanged.

Read-only inspection of the ordinary scheduled run at `2026-11-09T03:04:01.614Z` confirmed all ten NHL 2027 queries returned zero listings, with no rejection/cursor/error warning. The other four player feeds returned eleven listings total. This is before rarity/ratio matching, so the saved default limit cannot explain those empty NHL results. No scan or delivery was manually triggered. Existing NHL adapters translate catalog end-year 2027 to Real start-year 2026; the Marketplace path had no corresponding conversion. Next correction applies one shared NHL-only translation to request construction and listing-season comparison, retaining catalog season in rules/notifications. No alternate-year fallback or additional feed is introduced. Offline season regressions failed first; production observation after the corrected normal run remains required before claiming recovered NHL coverage.
