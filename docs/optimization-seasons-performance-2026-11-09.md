# Optimization Season dropdown performance

The owner clarified that the delay affects the Season selector beside Sport and Bundle size in Find the best upgrades, before a season can be selected.

## Cause and changes

The authenticated season-list route paged through every matching catalog pass in 200-row offset pages to deduplicate year/label pairs. Large CFB/CBB catalogs repeat each pair for thousands of players. The browser started a fresh lookup for each consumer and sport revisit.

The server now orders raw season pairs by year and label. After a full page it seeks beyond the last pair, skipping remaining players with identical metadata while preserving other labels sharing the same raw year. Existing canonical season conversion, sport/pass-kind filtering, sorting and completeness remain intact. Small catalogs still finish in one read. A non-advancing page fails the current operation rather than hanging. Quoted seek values follow [PostgREST's URL grammar](https://docs.postgrest.org/en/v14/references/api/url_grammar.html) and [logical filter syntax](https://docs.postgrest.org/en/stable/references/api/tables_views.html#logical-operators); no database migration or new RPC is required.

The browser shares in-progress lookups per normalized sport and pass kind and retains successful season metadata in memory for five minutes. Cancelling one control does not abort another consumer; completed results can serve a later revisit. Returned options are copied so callers cannot mutate the cache. Failures, malformed metadata and unconfigured storage do not become cached empty lists. UFC's player/team merging is preserved. New catalog seasons may take up to five minutes to appear in an already-open tab; a full reload starts a new memory cache. The existing selector/ranking interface remains unchanged.

## Evidence and limits

Before the fix, a 3,600-row offline CFB fixture required nineteen catalog reads. After the fix it requires four reads and returns the same complete canonical season list, including two labels sharing one stored year. This is a request-count reduction on controlled data, not a measured live latency claim. Concurrent/repeated browser consumers use one request within the cache window.

The actual Optimization page test switches from a pending CFB lookup to NHL, completes CFB late and confirms NHL options stay correct, then returns to CFB and selects 2025–26 without another request. Existing numerical-ranking/optional-face behavior passes unchanged.

Final local verification: 1,003 tests / 140 files, comprising 719/103 remainder plus 284/37 mandatory safety gate. TypeScript, native ESM loading, 222-module request audit and production build passed. New tests use the default Node environment; only the existing page test uses jsdom. No live Real request, import, scan, application API call, provider benchmark, saved-data replacement, schema/schedule change or port-5175 restart was used. Current Real-500 protection, official zero-retry KV, private access and retired routes remain intact.

Release source `f118f226ea2553dac6d22911a5293ec51409f87c` deployed as production `dpl_7eMBML6dQ5wwWUeZ9zsm1vQBdsZp`, READY with canonical/team aliases assigned. Remote mandatory 284/37, native ESM, audit222 and build passed. Three static GETs verified canonical Optimization asset SHA-256 `c4fe46db8943d17b25e975cf01729094f60145929d4dc0a1692179ca75a4d740` and application entry SHA-256 `a98b7a57a2807035b1140c64ce6e1c1b1a677be1eb8188d8d969d1540dbeef63` against the local build. The unsafe-host denial was advanced to this verified deployment; other firewall rules remained unchanged. Production delivery and offline request-count/UI behavior are verified; no live catalog timing measurement or signed-in browser session was used.
