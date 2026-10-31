// Standalone daily Earnings was removed by the owner. Collection/OTD earnings are unrelated.
export function retiredEarningsResponse(scheduled = false): Response {
  // ACK stale scheduler deliveries without running reconstruction or inviting retries.
  return Response.json({
    ok: scheduled, retired: true, disabled: true, retryable: false,
    reason: 'daily_earnings_removed',
    ...(scheduled ? {} : { error: 'The standalone Earnings feature has been removed.' }),
  }, { status: scheduled ? 202 : 410, headers: { 'Cache-Control': 'no-store' } })
}
