import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MARKETPLACE_PAGE_SCAN_INTERVAL_MS,
  marketplacePageScanKey,
  startMarketplacePageScanner,
} from './marketplacePageScanner'

afterEach(() => {
  vi.useRealTimers()
})

describe('marketplace page scanner', () => {
  it('uses a stable key for equivalent active rules', () => {
    const first = [
      { id: 'b', enabled: true, updatedAt: '2026-10-12T00:00:00.000Z' },
      { id: 'paused', enabled: false, updatedAt: '2026-10-12T01:00:00.000Z' },
      { id: 'a', enabled: true, updatedAt: '2026-10-12T00:00:00.000Z' },
    ]
    const sameRulesFromServer = [
      { ...first[2] }, { ...first[0] }, { ...first[1] },
    ]

    expect(marketplacePageScanKey(first)).toBe(marketplacePageScanKey(sameRulesFromServer))
    expect(marketplacePageScanKey(first)).toBe(
      'a:2026-10-12T00:00:00.000Z|b:2026-10-12T00:00:00.000Z',
    )
  })

  it('runs every two minutes while active and stops after cleanup', () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const stop = startMarketplacePageScanner(scan)

    expect(MARKETPLACE_PAGE_SCAN_INTERVAL_MS).toBe(2 * 60 * 1000)
    expect(scan).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(MARKETPLACE_PAGE_SCAN_INTERVAL_MS - 1)
    expect(scan).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(scan).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(MARKETPLACE_PAGE_SCAN_INTERVAL_MS)
    expect(scan).toHaveBeenCalledTimes(3)

    stop()
    vi.advanceTimersByTime(MARKETPLACE_PAGE_SCAN_INTERVAL_MS)
    expect(scan).toHaveBeenCalledTimes(3)
  })
})
