import {
  readMarketplaceAlertRules,
  readMarketplaceNotifications,
  saveMarketplaceScanStatus,
  type MarketplaceScanStatus,
} from '../../lib/marketplaceAlertStore'
import { scanMarketplaceAlerts } from '../../lib/marketplaceMonitor'
import { requireEarningsSession } from '../../lib/earningsAuth'
import { resolveRealApiConfig, type RealApiContext } from '../../lib/realApi'
import { requireAccountSession } from '../admin/_helpers'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const accessError = await requireEarningsSession(request, 'Marketplace')
  if (accessError) return accessError
  const session = await requireAccountSession(request)
  if (session instanceof Response) return session
  const config = resolveRealApiConfig()
  if (!config) {
    return Response.json({ error: 'The Real marketplace session is not configured.' }, { status: 503 })
  }

  const startedAt = new Date().toISOString()
  try {
    const rules = await readMarketplaceAlertRules(session.username)
    const context: RealApiContext = {
      config,
      signal: request.signal,
      publicCacheNamespace: `marketplace:${session.username}:${Date.now()}`,
    }
    const scan = await scanMarketplaceAlerts({ owner: session.username, rules, context })
    const notifications = await readMarketplaceNotifications(session.username)
    const scanStatus: MarketplaceScanStatus = {
      startedAt,
      finishedAt: new Date().toISOString(),
      checkedListings: scan.checkedListings,
      requests: scan.requests,
      newMatches: scan.notifications.length,
      delivered: 0,
      deliveryChannel: null,
      error: null,
    }
    await saveMarketplaceScanStatus(session.username, scanStatus, 'manual')
    return Response.json({
      ok: true,
      checkedListings: scan.checkedListings,
      requests: scan.requests,
      newNotifications: scan.notifications,
      notifications,
      scanStatus,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Marketplace scan failed.'
    await saveMarketplaceScanStatus(session.username, {
      startedAt,
      finishedAt: new Date().toISOString(),
      checkedListings: 0,
      requests: 0,
      newMatches: 0,
      delivered: 0,
      deliveryChannel: null,
      error: message,
    }, 'manual')
    return Response.json({
      error: message,
    }, { status: 502 })
  }
}
