import {
  listMarketplaceAlertOwners,
  marketplaceAccountRoutingEnabled,
  marketplaceAlertStorageConfigured,
  markMarketplaceNotificationsDelivered,
  readMarketplaceAlertRules,
  readMarketplaceDeliverySettings,
  readPendingMarketplaceNotifications,
  saveMarketplaceScanStatus,
} from '../../lib/marketplaceAlertStore.js'
import { deliverMarketplaceNotifications } from '../../lib/marketplaceNotificationDelivery.js'
import { scanMarketplaceAlerts } from '../../lib/marketplaceMonitor.js'
import { resolveRealApiConfig, type RealApiContext } from '../../lib/realApi.js'

export const config = { runtime: 'edge' }

const SOFT_BUDGET_MS = 45_000

export function isAuthorizedMarketplaceScanRequest(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const secret = process.env.MARKETPLACE_SCAN_SECRET?.trim() || process.env.CRON_SECRET?.trim()
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Marketplace scan failed.').slice(0, 300)
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  if (!isAuthorizedMarketplaceScanRequest(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!marketplaceAlertStorageConfigured()) {
    return Response.json({ error: 'Marketplace alert storage is not configured.' }, { status: 503 })
  }

  const realConfig = resolveRealApiConfig()
  if (!realConfig) {
    return Response.json({ error: 'The Real marketplace session is not configured.' }, { status: 503 })
  }

  const owners = await listMarketplaceAlertOwners()
  const accountRoutingEnabled = await marketplaceAccountRoutingEnabled()
  const startedAtMs = Date.now()
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(SOFT_BUDGET_MS)])
  const completed: Array<{
    owner: string
    checkedListings: number
    requests: number
    newMatches: number
    delivered: number
    channel: string | null
  }> = []
  const errors: Array<{ owner: string; error: string }> = []
  const deferred: string[] = []

  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index]
    if (Date.now() - startedAtMs >= SOFT_BUDGET_MS - 5_000) {
      deferred.push(...owners.slice(index))
      break
    }

    const startedAt = new Date().toISOString()
    try {
      const rules = await readMarketplaceAlertRules(owner)
      const deliverySettings = await readMarketplaceDeliverySettings(owner)
      const context: RealApiContext = {
        config: realConfig,
        signal,
        publicCacheNamespace: `marketplace-monitor:${startedAt}`,
      }
      const scan = await scanMarketplaceAlerts({ owner, rules, context, foundAt: startedAt })
      const pending = await readPendingMarketplaceNotifications(owner)
      let delivery: Awaited<ReturnType<typeof deliverMarketplaceNotifications>> = {
        configured: false,
        channel: null,
        delivered: 0,
      }
      let deliveryWarning: string | null = null
      try {
        delivery = await deliverMarketplaceNotifications({
          owner,
          notifications: pending,
          discordUserId: deliverySettings.discordUserId,
          allowLegacyDiscordUserId: !accountRoutingEnabled,
          signal,
        })
      } catch (error) {
        deliveryWarning = `Scan completed, but ${errorMessage(error)}`
      }
      if (delivery.delivered > 0) {
        await markMarketplaceNotificationsDelivered(owner, pending.map((item) => item.id))
      }
      const finishedAt = new Date().toISOString()
      await saveMarketplaceScanStatus(owner, {
        startedAt,
        finishedAt,
        checkedListings: scan.checkedListings,
        requests: scan.requests,
        newMatches: scan.notifications.length,
        delivered: delivery.delivered,
        deliveryChannel: delivery.channel,
        error: null,
        warning: [scan.warning, deliveryWarning].filter(Boolean).join(' ') || null,
      })
      completed.push({
        owner,
        checkedListings: scan.checkedListings,
        requests: scan.requests,
        newMatches: scan.notifications.length,
        delivered: delivery.delivered,
        channel: delivery.channel,
      })
    } catch (error) {
      const message = errorMessage(error)
      errors.push({ owner, error: message })
      await saveMarketplaceScanStatus(owner, {
        startedAt,
        finishedAt: new Date().toISOString(),
        checkedListings: 0,
        requests: 0,
        newMatches: 0,
        delivered: 0,
        deliveryChannel: null,
        error: message,
        warning: null,
      })
    }
  }

  return Response.json({
    ok: errors.length === 0 && deferred.length === 0,
    intervalMinutes: 5,
    owners: owners.length,
    completed,
    errors,
    deferred,
    elapsedMs: Date.now() - startedAtMs,
  })
}
