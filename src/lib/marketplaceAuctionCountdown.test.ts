import { describe, expect, it } from 'vitest'
import { marketplaceAuctionCountdown } from './marketplaceAuctionCountdown'

describe('marketplaceAuctionCountdown', () => {
  const now = Date.parse('2026-10-14T10:00:00.000Z')

  it('shows a live minute-and-second countdown for short auctions', () => {
    expect(marketplaceAuctionCountdown('2026-10-14T10:09:05.000Z', now)).toEqual({
      label: '9m 5s remaining',
      ended: false,
    })
  })

  it('uses compact hour and day formats for longer auctions', () => {
    expect(marketplaceAuctionCountdown('2026-10-14T12:15:00.000Z', now)?.label).toBe('2h 15m remaining')
    expect(marketplaceAuctionCountdown('2026-10-16T13:00:00.000Z', now)?.label).toBe('2d 3h remaining')
  })

  it('marks elapsed auctions as ended', () => {
    expect(marketplaceAuctionCountdown('2026-10-14T09:59:59.000Z', now)).toEqual({
      label: 'Auction ended',
      ended: true,
    })
  })

  it('omits the countdown when Real did not provide a valid end time', () => {
    expect(marketplaceAuctionCountdown(null, now)).toBeNull()
    expect(marketplaceAuctionCountdown('not-a-date', now)).toBeNull()
  })
})
