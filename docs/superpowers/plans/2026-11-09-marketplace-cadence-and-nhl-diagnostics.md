# Marketplace cadence and NHL diagnosis

**Goal:** Restore four-minute scheduled scan opportunities and establish why the selected NHL auctions are missing without a live diagnostic scan or changing saved rules.

**Evidence:** Read-only storage inspection found one owner, ten selected NHL players (including Jack Eichel without overrides), four other selected players, fourteen requests per run, aggregate 11–17 returned listings and repeated eight-minute gaps. Scans finish in about five seconds. The NHL rule uses season 2027, a default 25 RAX/rating cap, all rarities, and Rare–Legendary target-price filtering. The owner confirmed the Eichel example is Rare with a 25/rating target. Existing logs have no per-sport return counts. The exact 240-second cooldown starts after variable scheduler/storage latency; a slightly early next tick skips a whole interval.

**Architecture:** Keep the shared four-minute gate and overlap lease. Only authenticated scheduled callers may wait once for a nearly expired cooldown (at most five seconds, abortable), then use the unchanged atomic NX admission; manual/duplicate/early requests still skip. Add bounded per-feed diagnostics to the normal monitor result and existing scan history, showing sports/players/counts and numeric returned seasons, never bodies/URLs/credentials. Do not guess a different NHL API season or add fallback requests.

**Constraints:** Work solo in the current checkout/branch. Preserve confirmed Real 500 protection, official zero-retry KV, four-minute cadence, retired routes and user data. No scheduler changes or manual/live diagnostic scans.

- [ ] Reproduce scheduler jitter with fake time/storage, preserving 239/240-second and concurrent admission regressions; test abort/long-cooldown behavior. Implement only the scheduled bounded wait and wire its caller.
- [ ] Exercise the exact Eichel default settings through the real matcher/monitor against offline fixtures. Check Rare/Epic/Legendary inherit default limits and explicit overrides remain distinct.
- [ ] Record per-feed return counts/match counts/returned seasons/rejection or pagination warnings in scheduled/manual scan status; render readable sport counts in the existing scan log. Verify old logs remain valid.
- [ ] Run focused tests, the complete offline suite partition, TypeScript, request audit, native ESM and production build. Review changes, commit, deploy and verify static delivery/firewall protections.
- [ ] Inspect the next ordinary scheduled scan's stored metadata without triggering a scan. If the evidence identifies another cause, reproduce it offline before changing behavior. Report what was observed and any remaining uncertainty.
