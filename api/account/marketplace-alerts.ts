import { methodNotAllowed } from '../../lib/httpResponses'

import {
  ignoreMarketplaceListing,
  marketplaceAlertStorageConfigured,
  readMarketplaceAlertRules,
  readMarketplaceDeliverySettings,
  readMarketplaceNotifications,
  readMarketplaceScanLog,
  readMarketplaceScanStatus,
  saveMarketplaceAlertRules,
  saveMarketplaceDeliverySettings,
} from '../../lib/marketplaceAlertStore'
import { parseMarketplaceAlertRule, type MarketplaceAlertRule } from '../../lib/marketplaceAlerts'
import { requireEarningsSession } from '../../lib/earningsAuth'
import { requireAccountSession } from '../admin/_helpers'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'PUT' && request.method !== 'POST') {
    return methodNotAllowed()
  }
  const accessError = await requireEarningsSession(request, 'Marketplace')
  if (accessError) return accessError
  const session = await requireAccountSession(request)
  if (session instanceof Response) return session
  if (!marketplaceAlertStorageConfigured()) {
    return Response.json({
      error: 'Marketplace alert storage is not configured.',
      storageConfigured: false,
      rules: [],
      notifications: [],
      scanStatus: null,
      scanLog: [],
    }, { status: 503 })
  }

  if (request.method === 'GET') {
    const [rules, notifications, scanStatus, scanLog, deliverySettings] = await Promise.all([
      readMarketplaceAlertRules(session.username),
      readMarketplaceNotifications(session.username),
      readMarketplaceScanStatus(session.username),
      readMarketplaceScanLog(session.username),
      readMarketplaceDeliverySettings(session.username),
    ])
    return Response.json({
      ok: true,
      storageConfigured: true,
      rules,
      notifications,
      scanStatus,
      scanLog,
      deliverySettings,
      discordBotConfigured: Boolean(process.env.MARKETPLACE_DISCORD_BOT_TOKEN?.trim()),
    })
  }

  if (request.method === 'PUT') {
    let body: { rules?: unknown; deliverySettings?: unknown }
    try {
      body = await request.json() as typeof body
    } catch {
      return Response.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    if (body.deliverySettings && typeof body.deliverySettings === 'object') {
      try {
        const input = body.deliverySettings as { discordUserId?: unknown }
        const deliverySettings = await saveMarketplaceDeliverySettings(session.username, {
          discordUserId: typeof input.discordUserId === 'string' ? input.discordUserId : null,
        })
        return Response.json({ ok: true, storageConfigured: true, deliverySettings })
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : 'Invalid Discord delivery settings.',
        }, { status: 400 })
      }
    }
    const rules = Array.isArray(body.rules)
      ? body.rules
          .map(parseMarketplaceAlertRule)
          .filter((rule): rule is MarketplaceAlertRule => rule !== null)
      : []
    const saved = await saveMarketplaceAlertRules(session.username, rules)
    return Response.json({ ok: true, storageConfigured: true, rules: saved })
  }

  if (request.method === 'POST') {
    let body: { ignoreListingId?: unknown }
    try {
      body = await request.json() as typeof body
    } catch {
      return Response.json({ error: 'Invalid request body.' }, { status: 400 })
    }
    const listingId = typeof body.ignoreListingId === 'string'
      ? body.ignoreListingId.trim()
      : ''
    if (!listingId) {
      return Response.json({ error: 'A listing ID is required.' }, { status: 400 })
    }
    const notifications = await ignoreMarketplaceListing(session.username, listingId)
    return Response.json({ ok: true, notifications, ignoredListingId: listingId })
  }

  return methodNotAllowed()
}
