export const MARKETPLACE_PAGE_SCAN_INTERVAL_MS = 2 * 60 * 1000

export function marketplacePageScanKey(
  rules: Array<{ id: string; enabled: boolean; updatedAt: string }>,
): string {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => `${rule.id}:${rule.updatedAt}`)
    .sort()
    .join('|')
}

export function startMarketplacePageScanner(
  scan: () => void,
  intervalMs = MARKETPLACE_PAGE_SCAN_INTERVAL_MS,
): () => void {
  scan()
  const timer = window.setInterval(scan, intervalMs)
  return () => window.clearInterval(timer)
}
