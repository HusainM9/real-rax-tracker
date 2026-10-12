import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MARKETPLACE_PAGE_SCAN_INTERVAL_MS,
  startMarketplacePageScanner,
} from './marketplacePageScanner'

afterEach(() => {
  vi.useRealTimers()
})

describe('marketplace page scanner', () => {
  it('runs every five minutes while active and stops after cleanup', () => {
    vi.useFakeTimers()
    const scan = vi.fn()
    const stop = startMarketplacePageScanner(scan)

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
