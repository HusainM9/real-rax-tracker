import {
  parseMarketplaceAlertRule,
  marketplaceRuleRarities,
  type MarketplaceAlertNotification,
  type MarketplaceAlertRule,
} from '../../lib/marketplaceAlerts'
import type { MarketplaceScanStatus } from '../../lib/marketplaceAlertStore'
import { readResponseJson } from './readResponseJson'
import { simulateMarketplaceBulkAuctions } from './marketplaceDevSimulation'

const DEV_RULES_KEY = 'rax-marketplace-alert-rules-v1'
const DEV_NOTIFICATIONS_KEY = 'rax-marketplace-alert-notifications-v1'

export type MarketplaceAlertsPayload = {
  rules: MarketplaceAlertRule[]
  notifications: MarketplaceAlertNotification[]
  storageConfigured: boolean
  scanStatus: MarketplaceScanStatus | null
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export async function loadMarketplaceAlerts(): Promise<MarketplaceAlertsPayload> {
  if (import.meta.env.DEV) {
    const rules = readLocal<unknown[]>(DEV_RULES_KEY, [])
      .map(parseMarketplaceAlertRule)
      .filter((rule): rule is MarketplaceAlertRule => rule !== null)
    return {
      rules,
      notifications: readLocal<MarketplaceAlertNotification[]>(DEV_NOTIFICATIONS_KEY, []),
      storageConfigured: true,
      scanStatus: {
        startedAt: new Date(Date.now() - 65_000).toISOString(),
        finishedAt: new Date(Date.now() - 64_000).toISOString(),
        checkedListings: 20,
        requests: 2,
        newMatches: 1,
        delivered: 0,
        deliveryChannel: null,
        error: null,
      },
    }
  }
  const response = await fetch('/api/account/marketplace-alerts', { credentials: 'include' })
  const data = await readResponseJson<MarketplaceAlertsPayload & { error?: string }>(response)
  if (!response.ok) throw new Error(data.error || `Could not load marketplace alerts (${response.status}).`)
  return data
}

export async function saveMarketplaceAlerts(
  rules: MarketplaceAlertRule[],
): Promise<MarketplaceAlertRule[]> {
  if (import.meta.env.DEV) {
    writeLocal(DEV_RULES_KEY, rules)
    return rules
  }
  const response = await fetch('/api/account/marketplace-alerts', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  })
  const data = await readResponseJson<{ rules?: MarketplaceAlertRule[]; error?: string }>(response)
  if (!response.ok) throw new Error(data.error || `Could not save marketplace alerts (${response.status}).`)
  return Array.isArray(data.rules) ? data.rules : []
}

export async function scanMarketplaceAlertsNow(
  rules: MarketplaceAlertRule[],
): Promise<{
  notifications: MarketplaceAlertNotification[]
  newNotifications: MarketplaceAlertNotification[]
  checkedListings: number
  requests: number
}> {
  if (import.meta.env.DEV) {
    const existing = readLocal<MarketplaceAlertNotification[]>(DEV_NOTIFICATIONS_KEY, [])
    const rule = rules.find((entry) => entry.enabled)
    if (!rule) return { notifications: existing, newNotifications: [], checkedListings: 0, requests: 0 }
    const demos = simulateMarketplaceBulkAuctions({ ...rule, itemType: 'bulk' })
    const feedKeys = new Set(rules.filter((entry) => entry.enabled).flatMap((entry) =>
      marketplaceRuleRarities(entry).map((rarity) => `${entry.sport}|${entry.season}|${rarity}`),
    ))
    const existingIds = new Set(existing.map((entry) => entry.id))
    const newNotifications = demos.filter((entry) => !existingIds.has(entry.id))
    writeLocal(DEV_NOTIFICATIONS_KEY, demos)
    return {
      notifications: demos,
      newNotifications,
      checkedListings: demos.length,
      requests: feedKeys.size,
    }
  }

  const response = await fetch('/api/account/marketplace-scan', {
    method: 'POST',
    credentials: 'include',
  })
  const data = await readResponseJson<{
    notifications?: MarketplaceAlertNotification[]
    newNotifications?: MarketplaceAlertNotification[]
    checkedListings?: number
    requests?: number
    error?: string
  }>(response)
  if (!response.ok) throw new Error(data.error || `Marketplace scan failed (${response.status}).`)
  const all = Array.isArray(data.notifications) ? data.notifications : []
  return {
    notifications: all,
    newNotifications: Array.isArray(data.newNotifications) ? data.newNotifications : [],
    checkedListings: data.checkedListings ?? 0,
    requests: data.requests ?? 0,
  }
}
