export const MARKETPLACE_PAGE_SCAN_INTERVAL_MS = 5 * 60 * 1000

export function startMarketplacePageScanner(
  scan: () => void,
  intervalMs = MARKETPLACE_PAGE_SCAN_INTERVAL_MS,
): () => void {
  scan()
  const timer = window.setInterval(scan, intervalMs)
  return () => window.clearInterval(timer)
}
