import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceAlertNotification, MarketplaceAlertRule } from '../../lib/marketplaceAlerts'

const mocks = vi.hoisted(() => ({
  requireAccountSession: vi.fn(),
  requireEarningsSession: vi.fn(),
  resolveRealApiConfig: vi.fn(),
  readMarketplaceAlertRules: vi.fn(),
  readMarketplaceNotifications: vi.fn(),
  readPendingMarketplaceNotifications: vi.fn(),
  markMarketplaceNotificationsDelivered: vi.fn(),
  saveMarketplaceScanStatus: vi.fn(),
  scanMarketplaceAlerts: vi.fn(),
  deliverMarketplaceNotifications: vi.fn(),
}))

vi.mock('../admin/_helpers', () => ({ requireAccountSession: mocks.requireAccountSession }))
vi.mock('../../lib/earningsAuth', () => ({ requireEarningsSession: mocks.requireEarningsSession }))
vi.mock('../../lib/realApi', () => ({ resolveRealApiConfig: mocks.resolveRealApiConfig }))
vi.mock('../../lib/marketplaceAlertStore', () => ({
  readMarketplaceAlertRules: mocks.readMarketplaceAlertRules,
  readMarketplaceNotifications: mocks.readMarketplaceNotifications,
  readPendingMarketplaceNotifications: mocks.readPendingMarketplaceNotifications,
  markMarketplaceNotificationsDelivered: mocks.markMarketplaceNotificationsDelivered,
  saveMarketplaceScanStatus: mocks.saveMarketplaceScanStatus,
}))
vi.mock('../../lib/marketplaceMonitor', () => ({ scanMarketplaceAlerts: mocks.scanMarketplaceAlerts }))
vi.mock('../../lib/marketplaceNotificationDelivery', () => ({
  deliverMarketplaceNotifications: mocks.deliverMarketplaceNotifications,
}))

import handler from './marketplace-scan'

const rule = { id: 'rule-1' } as MarketplaceAlertRule
const fresh = { id: 'rule-1:listing-1' } as MarketplaceAlertNotification
const older = { id: 'rule-1:listing-old' } as MarketplaceAlertNotification

beforeEach(() => {
  mocks.requireEarningsSession.mockReset().mockResolvedValue(null)
  mocks.requireAccountSession.mockReset().mockResolvedValue({ username: 'husain' })
  mocks.resolveRealApiConfig.mockReset().mockReturnValue({ baseUrl: 'https://web.realapp.com' })
  mocks.readMarketplaceAlertRules.mockReset().mockResolvedValue([rule])
  mocks.readMarketplaceNotifications.mockReset().mockResolvedValue([fresh, older])
  mocks.readPendingMarketplaceNotifications.mockReset().mockResolvedValue([fresh])
  mocks.markMarketplaceNotificationsDelivered.mockReset().mockResolvedValue(undefined)
  mocks.scanMarketplaceAlerts.mockReset().mockResolvedValue({
    notifications: [fresh], checkedListings: 10, requests: 2,
  })
  mocks.deliverMarketplaceNotifications.mockReset().mockResolvedValue({
    configured: true, channel: 'discord_dm', delivered: 1,
  })
  mocks.saveMarketplaceScanStatus.mockReset().mockResolvedValue(undefined)
})

describe('account marketplace scan endpoint', () => {
  it('accepts POST only', async () => {
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan'))
    expect(response.status).toBe(405)
    expect(mocks.requireAccountSession).not.toHaveBeenCalled()
  })

  it('returns the account authorization response unchanged', async () => {
    mocks.requireAccountSession.mockResolvedValue(Response.json({ error: 'Account login required' }, { status: 401 }))
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', { method: 'POST' }))
    expect(response.status).toBe(401)
  })

  it('requires the shared private access session before account access', async () => {
    mocks.requireEarningsSession.mockResolvedValue(
      Response.json({ error: 'Marketplace access required.' }, { status: 401 }),
    )
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', { method: 'POST' }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Marketplace access required.' })
    expect(mocks.requireAccountSession).not.toHaveBeenCalled()
  })

  it('requires a configured Real transport session', async () => {
    mocks.resolveRealApiConfig.mockReturnValue(null)
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', { method: 'POST' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('not configured') })
  })

  it('returns fresh matches separately from the complete saved feed', async () => {
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', { method: 'POST' }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      checkedListings: 10,
      requests: 2,
      newNotifications: [fresh],
      notifications: [fresh, older],
      scanStatus: {
        checkedListings: 10,
        requests: 2,
        newMatches: 1,
        delivered: 1,
        deliveryChannel: 'discord_dm',
        error: null,
      },
    })
    expect(mocks.scanMarketplaceAlerts).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'husain', rules: [rule],
    }))
    expect(mocks.saveMarketplaceScanStatus).toHaveBeenCalledWith(
      'husain', expect.objectContaining({ checkedListings: 10, newMatches: 1, delivered: 1 }), 'manual',
    )
    expect(mocks.deliverMarketplaceNotifications).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'husain', notifications: [fresh],
    }))
    expect(mocks.markMarketplaceNotificationsDelivered).toHaveBeenCalledWith('husain', [fresh.id])
  })

  it('records page-open scans separately from manual checks', async () => {
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'page' }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveMarketplaceScanStatus).toHaveBeenCalledWith(
      'husain', expect.objectContaining({ checkedListings: 10 }), 'page',
    )
  })

  it('keeps pending matches when no notification channel is configured', async () => {
    mocks.deliverMarketplaceNotifications.mockResolvedValue({
      configured: false, channel: null, delivered: 0,
    })

    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', { method: 'POST' }))

    expect(response.status).toBe(200)
    expect(mocks.markMarketplaceNotificationsDelivered).not.toHaveBeenCalled()
  })

  it('returns a bounded upstream error response', async () => {
    mocks.scanMarketplaceAlerts.mockRejectedValue(new Error('Real request failed'))
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', { method: 'POST' }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Real request failed' })
    expect(mocks.saveMarketplaceScanStatus).toHaveBeenCalledWith(
      'husain', expect.objectContaining({ error: 'Real request failed' }), 'manual',
    )
  })
})
