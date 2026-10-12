import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceAlertNotification, MarketplaceAlertRule } from '../../lib/marketplaceAlerts'

const mocks = vi.hoisted(() => ({
  requireAccountSession: vi.fn(),
  resolveRealApiConfig: vi.fn(),
  readMarketplaceAlertRules: vi.fn(),
  readMarketplaceNotifications: vi.fn(),
  scanMarketplaceAlerts: vi.fn(),
}))

vi.mock('../admin/_helpers', () => ({ requireAccountSession: mocks.requireAccountSession }))
vi.mock('../../lib/realApi', () => ({ resolveRealApiConfig: mocks.resolveRealApiConfig }))
vi.mock('../../lib/marketplaceAlertStore', () => ({
  readMarketplaceAlertRules: mocks.readMarketplaceAlertRules,
  readMarketplaceNotifications: mocks.readMarketplaceNotifications,
}))
vi.mock('../../lib/marketplaceMonitor', () => ({ scanMarketplaceAlerts: mocks.scanMarketplaceAlerts }))

import handler from './marketplace-scan'

const rule = { id: 'rule-1' } as MarketplaceAlertRule
const fresh = { id: 'rule-1:listing-1' } as MarketplaceAlertNotification
const older = { id: 'rule-1:listing-old' } as MarketplaceAlertNotification

beforeEach(() => {
  mocks.requireAccountSession.mockReset().mockResolvedValue({ username: 'husain' })
  mocks.resolveRealApiConfig.mockReset().mockReturnValue({ baseUrl: 'https://web.realapp.com' })
  mocks.readMarketplaceAlertRules.mockReset().mockResolvedValue([rule])
  mocks.readMarketplaceNotifications.mockReset().mockResolvedValue([fresh, older])
  mocks.scanMarketplaceAlerts.mockReset().mockResolvedValue({
    notifications: [fresh], checkedListings: 10, requests: 2,
  })
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
    expect(body).toEqual({
      ok: true,
      checkedListings: 10,
      requests: 2,
      newNotifications: [fresh],
      notifications: [fresh, older],
    })
    expect(mocks.scanMarketplaceAlerts).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'husain', rules: [rule],
    }))
  })

  it('returns a bounded upstream error response', async () => {
    mocks.scanMarketplaceAlerts.mockRejectedValue(new Error('Real request failed'))
    const response = await handler(new Request('https://example.com/api/account/marketplace-scan', { method: 'POST' }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Real request failed' })
  })
})
