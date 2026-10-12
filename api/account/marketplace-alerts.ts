import {
  marketplaceAlertStorageConfigured,
  readMarketplaceAlertRules,
  readMarketplaceNotifications,
  readMarketplaceScanStatus,
  saveMarketplaceAlertRules,
} from '../../lib/marketplaceAlertStore'
import { parseMarketplaceAlertRule, type MarketplaceAlertRule } from '../../lib/marketplaceAlerts'
import { requireAccountSession } from '../admin/_helpers'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  const session = await requireAccountSession(request)
  if (session instanceof Response) return session
  if (!marketplaceAlertStorageConfigured()) {
    return Response.json({
      error: 'Marketplace alert storage is not configured.',
      storageConfigured: false,
      rules: [],
      notifications: [],
      scanStatus: null,
    }, { status: 503 })
  }

  if (request.method === 'GET') {
    const [rules, notifications, scanStatus] = await Promise.all([
      readMarketplaceAlertRules(session.username),
      readMarketplaceNotifications(session.username),
      readMarketplaceScanStatus(session.username),
    ])
    return Response.json({ ok: true, storageConfigured: true, rules, notifications, scanStatus })
  }

  if (request.method === 'PUT') {
    let body: { rules?: unknown }
    try {
      body = await request.json() as typeof body
    } catch {
      return Response.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    const rules = Array.isArray(body.rules)
      ? body.rules
          .map(parseMarketplaceAlertRule)
          .filter((rule): rule is MarketplaceAlertRule => rule !== null)
      : []
    const saved = await saveMarketplaceAlertRules(session.username, rules)
    return Response.json({ ok: true, storageConfigured: true, rules: saved })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
