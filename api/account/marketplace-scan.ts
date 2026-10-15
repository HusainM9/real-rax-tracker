import { methodNotAllowed } from '../../lib/httpResponses'

import {
  markMarketplaceNotificationsDelivered,
  marketplaceAccountRoutingEnabled,
  readMarketplaceAlertRules,
  readMarketplaceDeliverySettings,
  readMarketplaceNotifications,
  readPendingMarketplaceNotifications,
  saveMarketplaceScanStatus,
  type MarketplaceScanStatus,
} from '../../lib/marketplaceAlertStore'
import { scanMarketplaceAlerts } from '../../lib/marketplaceMonitor'
import { deliverMarketplaceNotifications } from '../../lib/marketplaceNotificationDelivery'
import { requireEarningsSession } from '../../lib/earningsAuth'
import { resolveRealApiConfig, type RealApiContext } from '../../lib/realApi'
import { requireAccountSession } from '../admin/_helpers'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const accessError = await requireEarningsSession(request, 'Marketplace')
  if (accessError) return accessError
  const session = await requireAccountSession(request)
  if (session instanceof Response) return session
  const config = resolveRealApiConfig()
  if (!config) {
    return Response.json({ error: 'The Real marketplace session is not configured.' }, { status: 503 })
  }

  const body = await request.json().catch(() => null) as { source?: unknown } | null
  const source = body?.source === 'page' ? 'page' : 'manual'

  const startedAt = new Date().toISOString()
  try {
    const rules = await readMarketplaceAlertRules(session.username)
    const [deliverySettings, accountRoutingEnabled] = await Promise.all([
      readMarketplaceDeliverySettings(session.username),
      marketplaceAccountRoutingEnabled(),
    ])
    const context: RealApiContext = {
      config,
      signal: request.signal,
      publicCacheNamespace: `marketplace:${session.username}:${Date.now()}`,
    }
    const scan = await scanMarketplaceAlerts({ owner: session.username, rules, context })
    const pending = await readPendingMarketplaceNotifications(session.username)
    let delivery: Awaited<ReturnType<typeof deliverMarketplaceNotifications>> = {
      configured: false,
      channel: null,
      delivered: 0,
    }
    let deliveryWarning: string | null = null
    try {
      delivery = await deliverMarketplaceNotifications({
        owner: session.username,
        notifications: pending,
        discordUserId: deliverySettings.discordUserId,
        allowLegacyDiscordUserId: !accountRoutingEnabled,
        signal: request.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notification delivery failed.'
      deliveryWarning = `Scan completed, but ${message}`
    }
    if (delivery.delivered > 0) {
      await markMarketplaceNotificationsDelivered(session.username, pending.map((item) => item.id))
    }
    const notifications = await readMarketplaceNotifications(session.username)
    const scanStatus: MarketplaceScanStatus = {
      startedAt,
      finishedAt: new Date().toISOString(),
      checkedListings: scan.checkedListings,
      requests: scan.requests,
      newMatches: scan.notifications.length,
      delivered: delivery.delivered,
      deliveryChannel: delivery.channel,
      error: null,
      warning: [scan.warning, deliveryWarning].filter(Boolean).join(' ') || null,
    }
    await saveMarketplaceScanStatus(session.username, scanStatus, source)
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
    const scanStatus: MarketplaceScanStatus = {
      startedAt,
      finishedAt: new Date().toISOString(),
      checkedListings: 0,
      requests: 0,
      newMatches: 0,
      delivered: 0,
      deliveryChannel: null,
      error: message,
      warning: null,
    }
    await saveMarketplaceScanStatus(session.username, scanStatus, source)
    return Response.json({
      error: message,
      scanStatus,
    }, { status: 502 })
  }
}
