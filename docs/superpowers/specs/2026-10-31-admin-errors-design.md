# Admin redesign and error history — approved design

The owner requested a clearer Admin page that retains errors of every type, with confirmed Real HTTP 500 incidents receiving the highest priority. This expands the current import-focused event list into an operational error history.

## Proposed layout

Open Admin on an Errors view. Put a prominent confirmed Real 500 section above the full error history. Show timestamp, source, observed HTTP status (or Unknown), operation, safe summary and incident reference. Provide search and source/status/type/date filters, pagination, and expandable safe details. Show storage/read failures explicitly; never show a failed log read as an empty healthy history. No replay, retry, unblock or delete control belongs on a confirmed Real 500 entry.

Keep existing import activity, account management and catalog tools in separate views within Admin. This makes errors immediately visible without removing existing capabilities. Admin uses stored data only. Its first authenticated history read copies retained legacy import-error metadata into the permanent journal once, using the backend's own storage configuration. The copy is idempotent, keeps original records, and never calls Real or starts provider work. The existing catalog/manual tools stay explicit actions under their current protections.

## Approaches

Selected by the owner: Errors, Activity, Accounts and Catalog views, with Errors selected initially. This keeps operational failures at the front and moves large maintenance forms out of the way. Alternative considered: one scrolling page with Errors first and all existing tools folded below. That keeps the old navigation model but produces a much longer page.

## What is recorded

Record failed active API operations, provider HTTP failures of all statuses, network/timeouts, import/Packs/Marketplace failures, authentication/storage/notification failures and unexpected browser errors. Expected validation/access failures remain distinguishable from operational failures. Deduplicate repeated submissions and server/browser reporting of the same event. Related failures observed at separate boundaries are error events, not additional confirmed Real 500 incidents. Browser-reported provider/status claims are not authoritative confirmation of a Real 500. Retired no-network endpoint stubs remain untouched; failures rejected outside the application, or past failures never retained, cannot be reconstructed by this journal.

Use a separate operational error journal. Do not change the Real endpoint admission store or turn non-500 errors into blocks. Confirmed Real 500 evidence must still be logged immediately and saved through the existing authoritative guard. Preserve and display existing confirmed history, including the UFC daily endpoint; old evidence with unknown time/status must retain those unknowns. Existing import activity remains readable. Past errors that were never stored cannot be reconstructed from the current event list.

Only store whitelisted metadata: generated references, time, safe source/category, method, sanitized operation/family identifier and a controlled summary. Never capture request/response bodies, raw URLs, passwords, cookies, tokens, headers or unfiltered exception messages/stacks. Server/API/browser reporters must avoid recursive logging and make no automatic retry. If journal storage fails, retain the redacted runtime fallback and report history availability accurately; do not freeze the website or erase confirmed Real 500 evidence.

## Persistence and constraints

History survives refresh, navigation and deployment. The owner selected indefinite retention for all history. No expiry, trimming, purge or removal of existing confirmed evidence is authorized. Search and pagination must cover persisted history rather than just the currently loaded rows; a bounded search segment with more history available must say so explicitly. Reading Admin must not trigger a provider request, scan, benchmark, background job or scheduling change.

Work solo in the current checkout and branch. Keep current authentication/access/security/rate limits and all retired features retired. Use the official zero-retry KV SDK and current audited HTTP boundaries. Add meaningful offline tests for classification, redaction, persistence/fallback, duplicate reporting, access control, filtering/pagination and unchanged Real-500 admission behavior. Verify TypeScript, the full offline suite, native ESM loading, the request-boundary audit and the gated build before any release.

## Status

Owner approved the Errors-first tabbed layout and indefinite retention on October 31, 2026. The isolated mockup uses fictional events and makes no provider requests. Proceed with implementation solo.
