import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  marketplaceAlertStorageConfigured: vi.fn(),
  listMarketplaceAlertOwners: vi.fn(),
  readMarketplaceAlertRules: vi.fn(),
  readPendingMarketplaceNotifications: vi.fn(),
  markMarketplaceNotificationsDelivered: vi.fn(),
  saveMarketplaceScanStatus: vi.fn(),
  deliverMarketplaceNotifications: vi.fn(),
  scanMarketplaceAlerts: vi.fn(),
  resolveRealApiConfig: vi.fn(),
}))

vi.mock('../../lib/marketplaceAlertStore.js', () => ({
  marketplaceAlertStorageConfigured: mocks.marketplaceAlertStorageConfigured,
  listMarketplaceAlertOwners: mocks.listMarketplaceAlertOwners,
  readMarketplaceAlertRules: mocks.readMarketplaceAlertRules,
  readPendingMarketplaceNotifications: mocks.readPendingMarketplaceNotifications,
  markMarketplaceNotificationsDelivered: mocks.markMarketplaceNotificationsDelivered,
  saveMarketplaceScanStatus: mocks.saveMarketplaceScanStatus,
}))
vi.mock('../../lib/marketplaceNotificationDelivery.js', () => ({
  deliverMarketplaceNotifications: mocks.deliverMarketplaceNotifications,
}))
vi.mock('../../lib/marketplaceMonitor.js', () => ({ scanMarketplaceAlerts: mocks.scanMarketplaceAlerts }))
vi.mock('../../lib/realApi.js', () => ({ resolveRealApiConfig: mocks.resolveRealApiConfig }))

import handler from './marketplace-alerts'

const originalNodeEnv = process.env.NODE_ENV
const originalSecret = process.env.MARKETPLACE_SCAN_SECRET

function request(method = 'POST', secret = 'market-secret'): Request {
  return new Request('https://example.com/api/cron/marketplace-alerts', {
    method,
    headers: { authorization: `Bearer ${secret}` },
  })
}

beforeEach(() => {
  process.env.NODE_ENV = 'production'
  process.env.MARKETPLACE_SCAN_SECRET = 'market-secret'
  mocks.marketplaceAlertStorageConfigured.mockReset().mockReturnValue(true)
  mocks.listMarketplaceAlertOwners.mockReset().mockResolvedValue(['husain'])
  mocks.readMarketplaceAlertRules.mockReset().mockResolvedValue([{ id: 'rule-1' }])
  mocks.readPendingMarketplaceNotifications.mockReset().mockResolvedValue([{ id: 'notification-1' }])
  mocks.markMarketplaceNotificationsDelivered.mockReset().mockResolvedValue(undefined)
  mocks.saveMarketplaceScanStatus.mockReset().mockResolvedValue(undefined)
  mocks.deliverMarketplaceNotifications.mockReset().mockResolvedValue({
    configured: true, channel: 'discord', delivered: 1,
  })
  mocks.scanMarketplaceAlerts.mockReset().mockResolvedValue({
    notifications: [{ id: 'notification-1' }], checkedListings: 10, requests: 1,
  })
  mocks.resolveRealApiConfig.mockReset().mockReturnValue({ baseUrl: 'https://web.realapp.com' })
})

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  if (originalSecret === undefined) delete process.env.MARKETPLACE_SCAN_SECRET
  else process.env.MARKETPLACE_SCAN_SECRET = originalSecret
})

describe('hosted marketplace monitor endpoint', () => {
  it('rejects unsupported methods and bad credentials', async () => {
    expect((await handler(request('DELETE'))).status).toBe(405)
    expect((await handler(request('POST', 'wrong'))).status).toBe(401)
    expect(mocks.listMarketplaceAlertOwners).not.toHaveBeenCalled()
  })

  it('reports missing KV and Real configuration before scanning', async () => {
    mocks.marketplaceAlertStorageConfigured.mockReturnValue(false)
    expect((await handler(request())).status).toBe(503)

    mocks.marketplaceAlertStorageConfigured.mockReturnValue(true)
    mocks.resolveRealApiConfig.mockReturnValue(null)
    expect((await handler(request())).status).toBe(503)
    expect(mocks.scanMarketplaceAlerts).not.toHaveBeenCalled()
  })

  it('scans every rule owner, delivers pending matches, and records status', async () => {
    const response = await handler(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      intervalMinutes: 5,
      owners: 1,
      completed: [{
        owner: 'husain', checkedListings: 10, requests: 1,
        newMatches: 1, delivered: 1, channel: 'discord',
      }],
      errors: [],
      deferred: [],
    })
    expect(mocks.markMarketplaceNotificationsDelivered).toHaveBeenCalledWith(
      'husain', ['notification-1'],
    )
    expect(mocks.saveMarketplaceScanStatus).toHaveBeenCalledWith(
      'husain',
      expect.objectContaining({
        checkedListings: 10, requests: 1, newMatches: 1,
        delivered: 1, deliveryChannel: 'discord', error: null,
      }),
    )
  })

  it('does not clear pending matches when no delivery channel is configured', async () => {
    mocks.deliverMarketplaceNotifications.mockResolvedValue({
      configured: false, channel: null, delivered: 0,
    })
    await handler(request())
    expect(mocks.markMarketplaceNotificationsDelivered).not.toHaveBeenCalled()
  })

  it('isolates owner failures and records them for the UI', async () => {
    mocks.listMarketplaceAlertOwners.mockResolvedValue(['broken', 'working'])
    mocks.scanMarketplaceAlerts
      .mockRejectedValueOnce(new Error('Real rate limited this request'))
      .mockResolvedValueOnce({ notifications: [], checkedListings: 8, requests: 1 })
    mocks.readPendingMarketplaceNotifications.mockResolvedValue([])
    mocks.deliverMarketplaceNotifications.mockResolvedValue({
      configured: false, channel: null, delivered: 0,
    })

    const response = await handler(request())
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.errors).toEqual([{ owner: 'broken', error: 'Real rate limited this request' }])
    expect(body.completed).toHaveLength(1)
    expect(body.completed[0].owner).toBe('working')
    expect(mocks.saveMarketplaceScanStatus).toHaveBeenCalledWith(
      'broken', expect.objectContaining({ error: 'Real rate limited this request' }),
    )
  })
})
