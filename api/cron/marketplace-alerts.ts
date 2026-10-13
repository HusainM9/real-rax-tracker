import {
  acquireMarketplaceScanLease,
  listMarketplaceAlertOwners,
  marketplaceAccountRoutingEnabled,
  marketplaceAlertStorageConfigured,
  markMarketplaceNotificationsDelivered,
  readMarketplaceAlertRules,
  readMarketplaceDeliverySettings,
  readPendingMarketplaceNotifications,
  releaseMarketplaceScanLease,
  saveMarketplaceScanStatus,
} from '../../lib/marketplaceAlertStore.js'
import { deliverMarketplaceNotifications } from '../../lib/marketplaceNotificationDelivery.js'
import { scanMarketplaceAlerts } from '../../lib/marketplaceMonitor.js'
import { resolveRealApiConfig, type RealApiContext } from '../../lib/realApi.js'

export const config = { runtime: 'edge' }

const SOFT_BUDGET_MS = 45_000

export function isAuthorizedMarketplaceScanRequest(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true
  const dedicatedSecrets = [
    process.env.MARKETPLACE_SCAN_SECRET?.trim(),
    process.env.MARKETPLACE_QSTASH_SECRET?.trim(),
  ].filter((secret): secret is string => Boolean(secret))
  const acceptedSecrets = dedicatedSecrets.length > 0
    ? dedicatedSecrets
    : [process.env.CRON_SECRET?.trim()].filter((secret): secret is string => Boolean(secret))
  const authorization = request.headers.get('authorization')
  return acceptedSecrets.some((secret) => authorization === `Bearer ${secret}`)
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Marketplace scan failed.').slice(0, 300)
}

type MarketplaceScanResult = {
  ok: boolean
  intervalMinutes: number
  owners: number
  completed: Array<{
    owner: string
    checkedListings: number
    requests: number
    newMatches: number
    delivered: number
    channel: string | null
  }>
  errors: Array<{ owner: string; error: string }>
  deferred: string[]
  elapsedMs: number
}

async function runMarketplaceScan(
  request: Request,
  realConfig: NonNullable<ReturnType<typeof resolveRealApiConfig>>,
): Promise<MarketplaceScanResult> {
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
        // Marketplace pagination can touch several pages for each tracked player.
        // Keep it serial so Real does not turn a harmless scan into a burst of 400
        // "high volume" responses, and bound retries inside this scheduled window.
        config: {
          ...realConfig,
          concurrency: 1,
          maxRetries: Math.min(realConfig.maxRetries, 2),
          retryBaseMs: Math.min(realConfig.retryBaseMs, 500),
          retryMaxMs: Math.min(realConfig.retryMaxMs, 1_500),
          timeoutMs: Math.min(realConfig.timeoutMs, 8_000),
        },
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

  return {
    ok: errors.length === 0 && deferred.length === 0,
    intervalMinutes: 2,
    owners: owners.length,
    completed,
    errors,
    deferred,
    elapsedMs: Date.now() - startedAtMs,
  }
}

function streamedJson(work: () => Promise<MarketplaceScanResult>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Returning the Response and one harmless whitespace byte immediately keeps
      // Vercel from enforcing its 25-second "initial response" timeout while the
      // scan continues inside the configured 60-second function window.
      controller.enqueue(encoder.encode(' '))
      void work()
        .then((result) => controller.enqueue(encoder.encode(JSON.stringify(result))))
        .catch((error) => controller.enqueue(encoder.encode(JSON.stringify({
          ok: false,
          error: errorMessage(error),
        }))))
        .finally(() => controller.close())
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
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

  const lease = await acquireMarketplaceScanLease()
  if (!lease) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: 'scan_in_progress',
      intervalMinutes: 2,
    }, { status: 202 })
  }

  return streamedJson(async () => {
    try {
      return await runMarketplaceScan(request, realConfig)
    } finally {
      await releaseMarketplaceScanLease(lease)
    }
  })
}
