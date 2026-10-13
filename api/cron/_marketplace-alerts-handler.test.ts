import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  marketplaceAlertStorageConfigured: vi.fn(),
  acquireMarketplaceScanLease: vi.fn(),
  releaseMarketplaceScanLease: vi.fn(),
  listMarketplaceAlertOwners: vi.fn(),
  marketplaceAccountRoutingEnabled: vi.fn(),
  readMarketplaceAlertRules: vi.fn(),
  readMarketplaceDeliverySettings: vi.fn(),
  readPendingMarketplaceNotifications: vi.fn(),
  markMarketplaceNotificationsDelivered: vi.fn(),
  saveMarketplaceScanStatus: vi.fn(),
  deliverMarketplaceNotifications: vi.fn(),
  scanMarketplaceAlerts: vi.fn(),
  resolveRealApiConfig: vi.fn(),
}))

vi.mock('../../lib/marketplaceAlertStore.js', () => ({
  marketplaceAlertStorageConfigured: mocks.marketplaceAlertStorageConfigured,
  acquireMarketplaceScanLease: mocks.acquireMarketplaceScanLease,
  releaseMarketplaceScanLease: mocks.releaseMarketplaceScanLease,
  listMarketplaceAlertOwners: mocks.listMarketplaceAlertOwners,
  marketplaceAccountRoutingEnabled: mocks.marketplaceAccountRoutingEnabled,
  readMarketplaceAlertRules: mocks.readMarketplaceAlertRules,
  readMarketplaceDeliverySettings: mocks.readMarketplaceDeliverySettings,
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
  mocks.acquireMarketplaceScanLease.mockReset().mockResolvedValue('scan-lease')
  mocks.releaseMarketplaceScanLease.mockReset().mockResolvedValue(undefined)
  mocks.listMarketplaceAlertOwners.mockReset().mockResolvedValue(['husain'])
  mocks.marketplaceAccountRoutingEnabled.mockReset().mockResolvedValue(true)
  mocks.readMarketplaceAlertRules.mockReset().mockResolvedValue([{ id: 'rule-1' }])
  mocks.readMarketplaceDeliverySettings.mockReset().mockResolvedValue({
    discordUserId: '123456789012345678',
  })
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
      intervalMinutes: 2,
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
    expect(mocks.deliverMarketplaceNotifications).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'husain',
      discordUserId: '123456789012345678',
      allowLegacyDiscordUserId: false,
    }))
    expect(mocks.saveMarketplaceScanStatus).toHaveBeenCalledWith(
      'husain',
      expect.objectContaining({
        checkedListings: 10, requests: 1, newMatches: 1,
        delivered: 1, deliveryChannel: 'discord', error: null,
      }),
    )
    expect(mocks.releaseMarketplaceScanLease).toHaveBeenCalledWith('scan-lease')
  })

  it('acknowledges an overlapping scheduler delivery without starting another scan', async () => {
    mocks.acquireMarketplaceScanLease.mockResolvedValue(null)

    const response = await handler(request())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      skipped: true,
      reason: 'scan_in_progress',
    })
    expect(mocks.scanMarketplaceAlerts).not.toHaveBeenCalled()
  })

  it('does not clear pending matches when no delivery channel is configured', async () => {
    mocks.deliverMarketplaceNotifications.mockResolvedValue({
      configured: false, channel: null, delivered: 0,
    })
    const response = await handler(request())
    await response.json()
    expect(mocks.markMarketplaceNotificationsDelivered).not.toHaveBeenCalled()
  })

  it('resolves a different Discord recipient for every rule owner', async () => {
    mocks.listMarketplaceAlertOwners.mockResolvedValue(['first-user', 'second-user'])
    mocks.readMarketplaceDeliverySettings
      .mockResolvedValueOnce({ discordUserId: '111111111111111111' })
      .mockResolvedValueOnce({ discordUserId: '222222222222222222' })

    const response = await handler(request())
    await response.json()

    expect(mocks.deliverMarketplaceNotifications).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        owner: 'first-user',
        discordUserId: '111111111111111111',
        allowLegacyDiscordUserId: false,
      }),
    )
    expect(mocks.deliverMarketplaceNotifications).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        owner: 'second-user',
        discordUserId: '222222222222222222',
        allowLegacyDiscordUserId: false,
      }),
    )
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
