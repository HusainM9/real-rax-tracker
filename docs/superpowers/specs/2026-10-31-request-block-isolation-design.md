# Correct request-block isolation

The owner asked to fix the diagnosed widespread blocking, not merely clear two records. This is the scoped implementation choice following that instruction; work remains solo in the existing branch. No redesign, live request replay, deployment, record deletion or restart is implied.

## Intent and constraints

Preserve permanent, logged pauses after every observed HTTP 500–599. Stop unknown outcomes in the current operation without poisoning unrelated work. Existing unclassified provider reservations remain fail-closed because they might include a failed finalization; the old cause is not recoverable and this fix does not authorize clearing them.

Browser cancellations and transport failures must not create permanent route-wide failure markers. A later user operation still goes through the server's durable provider guard; there is no automatic retry. New confirmed-5xx browser markers include HTTP method. Existing confirmed-5xx markers remain honored conservatively, even though they lack a method. Legacy unknown browser markers remain stored as evidence, not used as a permanent global route ban. This does not clear their server-side records.

Shared catalog GETs need separate operation reservations, not one in-flight/uncertain lock for every read of the same table. Keep the existing endpoint-family key as the atomic control record: a versioned envelope contains hashed operation reservations, while a confirmed 5xx blocks the whole family. One Lua operation admits/finishes against one Redis key, avoiding multi-key/cross-slot races. Legacy owner-only family records stay blocked. Real and notification transport retain the stricter existing family serialization; do not weaken their established query/fallback no-repeat rules.

KV safety must be enforced at HTTP response level, before the SDK erases status. Use the installed SDK's public middleware hook with a one-attempt HTTP boundary, normal unencoded JSON responses and existing command serialization/deserialization. Observed HTTP 5xx freezes this instance's KV transport; uncertain transport outcomes block the exact hashed command in this instance; Redis command errors returned in HTTP 200 do not freeze unrelated commands. A storage service cannot durably record its own outage in itself: this limitation remains explicit. No global fetch monkey-patch, SDK upgrade or new application dependency. Optional isolated Lua verification tooling may be installed outside the app's dependency tree; it must never contact a real database.

## Approaches

- Selected: keep endpoint-wide confirmed-failure protection, isolate catalog operation reservations and handle browser cancellations separately. Replace the KV method-level error latch with response-aware middleware. This repairs the demonstrated coupling without bypassing failure history.
- Rejected: clearing all records or changing key namespaces without checking legacy failures would silently re-enable known/uncertain failed requests.
- Rejected: treating every exception as a permanent global outage preserves the diagnosed failure and incorrectly equates cancellation with received HTTP 5xx.

## Verification

Use real browser/server guard code and the real installed KV SDK with HTTP mocked at the external boundary. Test cancellation, method isolation, legacy known/unknown markers, concurrent catalog queries, persistent exact uncertain reservations, family-wide 5xx, late successful completion after another 5xx, legacy records and all 100 statuses. Test KV pipelines, Redis command errors, lost connections, actual attempt counts and redacted status propagation. Full offline suite, audit, native API loading and production build remain mandatory. No test sends a request to Real, the deployed app or live KV.
