import { readMarketplaceAlertRules, readMarketplaceNotifications } from '../../lib/marketplaceAlertStore'
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

  try {
    const rules = await readMarketplaceAlertRules(session.username)
    const context: RealApiContext = {
      config,
      signal: request.signal,
      publicCacheNamespace: `marketplace:${session.username}:${Date.now()}`,
    }
    const scan = await scanMarketplaceAlerts({ owner: session.username, rules, context })
    const notifications = await readMarketplaceNotifications(session.username)
    return Response.json({
      ok: true,
      checkedListings: scan.checkedListings,
      requests: scan.requests,
      newNotifications: scan.notifications,
      notifications,
    })
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : 'Marketplace scan failed.',
    }, { status: 502 })
  }
}
