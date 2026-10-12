import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAccountSession: vi.fn(),
  requireEarningsSession: vi.fn(),
  marketplaceAlertStorageConfigured: vi.fn(),
  readMarketplaceAlertRules: vi.fn(),
  readMarketplaceNotifications: vi.fn(),
  readMarketplaceScanStatus: vi.fn(),
  readMarketplaceScanLog: vi.fn(),
  saveMarketplaceAlertRules: vi.fn(),
  ignoreMarketplaceListing: vi.fn(),
}))

vi.mock('../admin/_helpers', () => ({ requireAccountSession: mocks.requireAccountSession }))
vi.mock('../../lib/earningsAuth', () => ({ requireEarningsSession: mocks.requireEarningsSession }))
vi.mock('../../lib/marketplaceAlertStore', () => ({
  marketplaceAlertStorageConfigured: mocks.marketplaceAlertStorageConfigured,
  readMarketplaceAlertRules: mocks.readMarketplaceAlertRules,
  readMarketplaceNotifications: mocks.readMarketplaceNotifications,
  readMarketplaceScanStatus: mocks.readMarketplaceScanStatus,
  readMarketplaceScanLog: mocks.readMarketplaceScanLog,
  saveMarketplaceAlertRules: mocks.saveMarketplaceAlertRules,
  ignoreMarketplaceListing: mocks.ignoreMarketplaceListing,
}))

import handler from './marketplace-alerts'

beforeEach(() => {
  mocks.requireEarningsSession.mockReset().mockResolvedValue(null)
  mocks.requireAccountSession.mockReset().mockResolvedValue({ username: 'husain' })
  mocks.marketplaceAlertStorageConfigured.mockReset().mockReturnValue(true)
  mocks.readMarketplaceAlertRules.mockReset().mockResolvedValue([])
  mocks.readMarketplaceNotifications.mockReset().mockResolvedValue([])
  mocks.readMarketplaceScanStatus.mockReset().mockResolvedValue(null)
  mocks.readMarketplaceScanLog.mockReset().mockResolvedValue([])
  mocks.saveMarketplaceAlertRules.mockReset().mockResolvedValue([])
  mocks.ignoreMarketplaceListing.mockReset().mockResolvedValue([])
})

describe('account marketplace alerts endpoint', () => {
  it('returns recent scan activity with the alert payload', async () => {
    mocks.readMarketplaceScanLog.mockResolvedValue([{ id: 'scan-1', source: 'automatic' }])
    const response = await handler(new Request('https://example.com/api/account/marketplace-alerts'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scanLog: [{ id: 'scan-1', source: 'automatic' }],
    })
  })

  it('ignores a listing for the signed-in account', async () => {
    const response = await handler(new Request('https://example.com/api/account/marketplace-alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ignoreListingId: 'listing-42' }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.ignoreMarketplaceListing).toHaveBeenCalledWith('husain', 'listing-42')
    await expect(response.json()).resolves.toMatchObject({ ignoredListingId: 'listing-42' })
  })

  it('rejects an empty listing ID', async () => {
    const response = await handler(new Request('https://example.com/api/account/marketplace-alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ignoreListingId: '  ' }),
    }))

    expect(response.status).toBe(400)
    expect(mocks.ignoreMarketplaceListing).not.toHaveBeenCalled()
  })
})
