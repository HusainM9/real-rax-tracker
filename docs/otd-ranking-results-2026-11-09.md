# OTD ranking results and sport filter

The owner requested more total cards in OTD rankings and a way to view one sport after an All sports run.

Both the initial ranking and the baseline recalculation previously discarded every result below position fifty, even though the calculation had already analyzed those cards. The page now retains every calculated result, with existing twenty-five-row pagination. Analysis/fetch limits, ranking mathematics, ordering and greedy bundle selection remain unchanged; this exposes the analyzed pool, not every unexamined card in the catalog.

A Show sport selector inside Ranking results filters the saved result rows before pagination. Only sports present in those results are offered, with counts. Changing sport returns to page one and preserves overall rank numbers. A new ranking starts at All sports; recalculation retains the chosen sport when it still has results, otherwise it returns to All sports. The count states filtered versus total passes. Filtering does not request candidate summaries/daily profiles or rerun analysis.

Ranking Select all, Clear and bulk baseline Claim actions apply to the filtered results across their pages. Hidden selections remain intact without being included in filtered actions. These claims remain ranking-only assumptions, not changes to the actual collection. Existing individual Claim/Plan and bundle functionality are retained.

Optional player faces are now requested only for the visible page and any distinct bundle identities, preventing the larger result pool from fetching images for hidden pages. Finishing image hydration cannot reset manual ranking or bundle selection. Faces remain cache-only through the existing catalog path; account avatars remain removed.

## Verification

The real component/calculator offline test first reproduced sixty analyzed cards becoming fifty retained results. The fixture has fifty-five high-ranked NFL cards and five lower-ranked CFB cards. It now retains all sixty, filters to the five CFB cards including overall rank 56 after starting from page two, and keeps summary/bulk request counts unchanged. Clearing CFB preserves hidden NFL selections. Claiming the five filtered CFB assumptions recalculates all fifty-five remaining NFL cards, verifying both result-retention paths and filtered bulk scope.

A separate sixty-card face fixture checks that the first image batch includes only the current page/bundle, that numerical results remain available while images are pending, and that cleared ranking/bundle selections remain cleared when images arrive. Regressions failed before correction. Previous season-picker and numerical-ranking/optional-face tests remain green.

Full offline verification: 1,005 tests / 140 files (721/103 remainder, 284/37 mandatory safety gate), TypeScript, native ESM, 222-module request audit and production build passed. No live Real request/import/scan, application API call, saved-data replacement, schedule change or port-5175 restart was performed. Current Real-500 endpoint protection, official zero-retry KV, private access, security headers, Marketplace cadence, season-picker performance and retired routes remain intact. Release verification pending.
