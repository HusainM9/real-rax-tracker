# NHL Marketplace routing and stale alert names

The owner reported a rule showing `ACTIVE · NHL 2027` with the title `FC owned players` and asked whether it requested NHL listings.

## Cause and correction

The title is saved independently from `sport` and `season`. Editing a generated FC rule to NHL cleared the old player selection and changed the filter, but kept the FC title. The shared parser also retained that stale title.

Generated names in the exact `<known sport> owned players` format now follow the selected sport on edit/save and when saved rules are read. Custom names and other rule scopes remain unchanged. No one-off production data rewrite is needed: the next ordinary rule load displays the corrected title. Historical notifications remain untouched.

## Request verification

An offline HTTP-boundary test ran the real monitor, Real request builder and guarded transport against a fetch stub with fixture credentials and an in-memory safety store. A rule named `FC owned players`, with sport `nhl`, season `2027` and five synthetic selected players, produced exactly five GETs to `/cardmarketplacelistings`. Every captured query included `sport=nhl`, `season=2027`, `filterEntityType=player`, `listingType=userpassfull` and its selected player ID. None used `fc` or `soccer`. Redirect handling remained manual. This test passed before the label fix, demonstrating that the stored name was not used for routing.

Two regressions first failed with expected `NHL owned players` / actual `FC owned players`: parsing the old saved rule, and editing FC to NHL through the actual page. Both pass after the fix. The page test verifies that the NHL 2027 cached player replaces the old FC selection and the saved rule keeps NHL sport/season/players; a parallel case preserves a custom name.

Focused verification: 65 tests / 3 files passed. Full offline verification: 966 tests / 136 files passed (718/104 remainder, 248/32 mandatory safety gate). TypeScript, native ESM, the 221-module request-boundary audit and production build passed. No live Real call, scan, import, notification, saved-data replacement or scheduling change was performed. This verifies request construction, not a captured production scan.

Released application source `d80f1164e5d398bbcd6615f33cbc169ba13d0f7f` as production `dpl_BWVTSLHZZqj1Ei2EthntnLXWNpS5`, READY with canonical/team aliases assigned. Remote mandatory gate 248/32, native ESM, 221-module audit and production build passed. Three static GETs verified canonical `MarketplaceAlertsPage-DUZkJxou.js` matched local SHA-256 `1aabae6c060b844030801e2127d95405869f0dcf7228d732f19396803d6c30b9`. Legacy-host denial was advanced to the verified release; all other firewall rules were unchanged. No application API call or live scan was triggered during release verification.
