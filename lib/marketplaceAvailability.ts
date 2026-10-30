// Owner restored alerts on October 31; player listings remain retired.
export const MARKETPLACE_ALERTS_ENABLED = true
export const MARKETPLACE_SCAN_INTERVAL_MINUTES = 4
export const MARKETPLACE_SCAN_INTERVAL_SECONDS = 240

export function marketplaceDisabledResponse(): Response {
  // ACK scheduled deliveries without encouraging scheduler retries.
  return Response.json({ ok: true, disabled: true, reason: 'owner_paused', retryable: false }, {
    status: 202, headers: { 'Cache-Control': 'no-store' },
  })
}
