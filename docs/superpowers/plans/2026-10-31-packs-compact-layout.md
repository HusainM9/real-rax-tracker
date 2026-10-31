# Compact Packs and season matching plan

> Execute solo with superpowers:executing-plans in the current checkout/branch.

**Approved spec:** Owner requested account-avatar removal, an Import all action next to Track all, a corrected toolbar and NHL 2026–27 ownership imports. Owner selected the displayed **A · Compact board** concept: player/actions header, target/rating/ETA overview, one compact account row with inline rating/status/open toggle/import, editing details behind Edit, and estimation/weekly/swap controls in a foldaway section. Keep all existing functionality and data.

**Architecture:** Reuse `normalizeRealPass` at the Packs API boundary so collection and Packs keys agree. The global Import all action reuses the existing distinct-username sync, not per-player scans. Existing guarded transport, explicit imports, opening inference, targets and account persistence remain. Stop collecting/rendering account avatars; keep any old optional stored metadata inert for export compatibility.

**Constraints:** No live Real requests, no new schedules/retired features, no port-5175 restart, no user-data replacement. Preserve all confirmed Real-500 blocks and release gates. Local loopback concepts use example data without external resources.

- [x] RED: endpoint regressions for NHL 2026–27 start/end-year payloads, older NHL and NBA/CBB/NFL conventions; no added requests.
- [x] GREEN: use shared pass normalization for entity/sport/season/rarity before building rating keys.
- [x] RED: global Import all shares one call per distinct account across players, busy states and no mount import; avatar elements absent; compact Edit/settings preserve fields and weekly controls.
- [x] GREEN: remove account image display/response collection, implement the approved compact card and aligned responsive toolbar; reuse existing callbacks and sync function.
- [x] Verify actual production components offline at desktop/phone sizes; targeted tests during iteration, then full tests, TypeScript, boundary audit, mandatory build/native ESM. Separate solo review.
- [x] Commit/deploy the guarded source, verify exact source/static assets and retained host policy. No live import verification.

## Ledger

- Initial base `1613285`, clean current checkout. Other project chat idle after its finished release coordination.
- Root cause: Packs built keys from raw `RealPass.season`; collection normalizes start-year NHL values to catalog end-years. A label of 2026–27 could therefore accompany `entity|2026|NHL` instead of the planned `entity|2027|NHL`.
- User chose A in the visual comparison. No additional design approval is needed; preserve weekly/date logs, swaps, all editing/import/finish/ignore controls while changing their placement.
- Observed four season-key regressions RED; shared normalization made the 42-case endpoint/normalizer set GREEN, including already-normalized NHL without double increment. Imports still perform the same two fake upstream calls per fresh account scan.
- Compact UI tests observed RED before implementation; GREEN confirms target/edit/settings/weekly controls, no mount import, one global call per distinct normalized username across two players, and disabled overlapping bulk clicks. Avatar response removal was separately RED→GREEN.
- Solo review caught a new-account editor closing on the first typed username character. A focused rerender regression was RED, then GREEN after leaving the native disclosure uncontrolled. Existing account/user isolation and inference storage remain intact.
- Ruling: retain the unused validated legacy `realProfile` field through normal data hydration/export instead of purging saved records. New profile extraction, API propagation, writes and avatar rendering are removed.
- Offline production-component preview passed desktop and 390px checks. At phone width the content width equals the 375px layout viewport, and the open edit panel stays between x=62 and x=334. Viewport reset; temporary test/tab removed; inert preview only remains on port 5180. No provider requests or saved data changes.
- Final local verification: full suite **917/126**, mandatory gate **201/21**, **211-module** boundary audit, native ESM, TypeScript and Vite all passed. Secret/source preflight clean. Proof: `packs-compact-final.png` in the chat visualization directory. Live account imports remain unverified by design.
- Released source **`9a3c0a645660542bb1cc21f77cd5b5586b7e0097`**, production **`dpl_5Ua2uTTqEHwdqGqFnBQ47ymbLGRr`**, READY with canonical/team aliases assigned. Remote mandatory **201/21** cases, native ESM, 211-module audit and build passed. The canonical site's new Packs asset exactly matches the local verified asset by filename/SHA-256 and contains the compact layout/bulk action without account avatars.
- Host policy advanced only to the verified guarded deployment; existing private access and legacy unsafe-host denial remain. Verification used three static site reads, zero application API calls and zero Real calls. No existing ownership flag or rating was manually corrected; the normalized keys are applied on the next normal explicit import. No schedules, credentials or saved user data changed.
