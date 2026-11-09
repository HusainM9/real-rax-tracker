# OTD ranking results and sport filtering

**Request:** Show more total cards in Rank OTD Net and let an All sports result be viewed by sport.

**Current behavior:** The calculator already returns its complete analyzed pool, but both the initial run and baseline recalculation discard everything below the top fifty. The remaining rows are paginated twenty-five at a time. All returned result identities are currently hydrated together, and bulk baseline actions use the entire retained result set.

**Implementation choice:** Retain all already-calculated rows and keep twenty-five per page. Add a Show sport control inside Ranking results, using only sports present in the completed result and filtering before pagination. Preserve overall rank numbers and show filtered/total counts. Filtering does not fetch candidates or rerun analysis. Existing analysis-pool limits and numerical calculations stay unchanged.

**Interaction details:** New ranking runs start at All sports/page one; sport changes reset to page one. Bulk Select/Clear/Claim actions act only on the filtered sport's results, including its other pages. Hidden selections are preserved without including them in filtered actions. Optional saved catalog faces hydrate only the current page and bundle; face completion must not reset a user's selection.

**Constraints:** Solo/current branch and checkout, no Real request/scan, no new provider or schedule work, no port-5175 restart. Preserve data, safety guards, existing bundle/claim/plan functionality and season-picker improvements. No new dependency or layout redesign.

- [x] Reproduce the top-fifty truncation and verify a lower-ranked sport remains available through a real component/real calculator offline test.
- [x] Retain all analyzed results, filter before pagination and preserve global positions/counts across sport changes and recalculation.
- [x] Scope bulk actions to filtered results and preserve selection through optional face hydration; hydrate only visible identities.
- [ ] Run focused and complete offline tests, TypeScript, native ESM, request audit and build; review, commit/deploy, verify static delivery/firewall and record limits.

Verification: the real calculator/component fixture first ranked sixty passes but retained fifty, excluding all five CFB passes ranked 56–60. It now exposes all sixty, filters CFB from page two to its five rows with global ranks preserved, and does not make another summary/bulk request. Clearing CFB leaves hidden NFL selection intact; claiming the five CFB rows recalculates fifty-five remaining NFL results rather than truncating them. Optional face completion no longer reselects cleared ranking or bundle checkboxes. A sixty-row face fixture requests only the twenty-five visible identities plus any distinct bundle identities. Full offline 1,005/140, mandatory 284/37, native ESM, TypeScript, audit222 and build passed. Release pending.
