import {
  parseMarketplaceAlertRule,
  marketplaceRuleRarities,
  type MarketplaceAlertNotification,
  type MarketplaceAlertRule,
} from '../../lib/marketplaceAlerts'
import type { MarketplaceScanLogEntry, MarketplaceScanStatus } from '../../lib/marketplaceAlertStore'
import { readResponseJson } from './readResponseJson'
import { simulateMarketplaceBulkAuctions } from './marketplaceDevSimulation'

const DEV_RULES_KEY = 'rax-marketplace-alert-rules-v1'
const DEV_NOTIFICATIONS_KEY = 'rax-marketplace-alert-notifications-v1'
const DEV_IGNORED_LISTINGS_KEY = 'rax-marketplace-alert-ignored-listings-v1'
const DEV_SCAN_LOG_KEY = 'rax-marketplace-alert-scan-log-v1'

export type MarketplaceAlertsPayload = {
  rules: MarketplaceAlertRule[]
  notifications: MarketplaceAlertNotification[]
  storageConfigured: boolean
  scanStatus: MarketplaceScanStatus | null
  scanLog: MarketplaceScanLogEntry[]
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
    const fallbackStatus: MarketplaceScanStatus = {
      startedAt: new Date(Date.now() - 65_000).toISOString(),
      finishedAt: new Date(Date.now() - 64_000).toISOString(),
      checkedListings: 20,
      requests: 2,
      newMatches: 1,
      delivered: 0,
      deliveryChannel: null,
      error: null,
    }
    const scanLog = readLocal<MarketplaceScanLogEntry[]>(DEV_SCAN_LOG_KEY, [])
    return {
      rules,
      notifications: readLocal<MarketplaceAlertNotification[]>(DEV_NOTIFICATIONS_KEY, []),
      storageConfigured: true,
      scanStatus: scanLog[0] ?? fallbackStatus,
      scanLog: scanLog.length > 0 ? scanLog : [{ ...fallbackStatus, id: `${fallbackStatus.startedAt}:automatic`, source: 'automatic' }],
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
  scanStatus: MarketplaceScanStatus
}> {
  if (import.meta.env.DEV) {
    const existing = readLocal<MarketplaceAlertNotification[]>(DEV_NOTIFICATIONS_KEY, [])
    const rule = rules.find((entry) => entry.enabled)
    const now = new Date().toISOString()
    const emptyStatus: MarketplaceScanStatus = {
      startedAt: now, finishedAt: now, checkedListings: 0, requests: 0,
      newMatches: 0, delivered: 0, deliveryChannel: null, error: null,
    }
    if (!rule) return { notifications: existing, newNotifications: [], checkedListings: 0, requests: 0, scanStatus: emptyStatus }
    const ignored = new Set(readLocal<string[]>(DEV_IGNORED_LISTINGS_KEY, []))
    const demos = simulateMarketplaceBulkAuctions({ ...rule, itemType: 'bulk' })
      .filter((notification) => !ignored.has(notification.listingId))
    const feedKeys = new Set(rules.filter((entry) => entry.enabled).flatMap((entry) =>
      marketplaceRuleRarities(entry).map((rarity) => `${entry.sport}|${entry.season}|${rarity}`),
    ))
    const existingIds = new Set(existing.map((entry) => entry.id))
    const newNotifications = demos.filter((entry) => !existingIds.has(entry.id))
    writeLocal(DEV_NOTIFICATIONS_KEY, demos)
    const scanStatus: MarketplaceScanStatus = {
      startedAt: now,
      finishedAt: new Date().toISOString(),
      checkedListings: demos.length,
      requests: feedKeys.size,
      newMatches: newNotifications.length,
      delivered: 0,
      deliveryChannel: null,
      error: null,
    }
    const logEntry: MarketplaceScanLogEntry = { ...scanStatus, id: `${now}:manual`, source: 'manual' }
    writeLocal(DEV_SCAN_LOG_KEY, [logEntry, ...readLocal<MarketplaceScanLogEntry[]>(DEV_SCAN_LOG_KEY, [])].slice(0, 40))
    return {
      notifications: demos,
      newNotifications,
      checkedListings: demos.length,
      requests: feedKeys.size,
      scanStatus,
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
    scanStatus?: MarketplaceScanStatus
    error?: string
  }>(response)
  if (!response.ok) throw new Error(data.error || `Marketplace scan failed (${response.status}).`)
  const all = Array.isArray(data.notifications) ? data.notifications : []
  const scanStatus = data.scanStatus ?? {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    checkedListings: data.checkedListings ?? 0,
    requests: data.requests ?? 0,
    newMatches: Array.isArray(data.newNotifications) ? data.newNotifications.length : 0,
    delivered: 0,
    deliveryChannel: null,
    error: null,
  }
  return {
    notifications: all,
    newNotifications: Array.isArray(data.newNotifications) ? data.newNotifications : [],
    checkedListings: data.checkedListings ?? 0,
    requests: data.requests ?? 0,
    scanStatus,
  }
}

export async function ignoreMarketplaceAlertListing(
  listingId: string,
): Promise<MarketplaceAlertNotification[]> {
  if (import.meta.env.DEV) {
    const ignored = new Set(readLocal<string[]>(DEV_IGNORED_LISTINGS_KEY, []))
    ignored.add(listingId)
    writeLocal(DEV_IGNORED_LISTINGS_KEY, [...ignored])
    const remaining = readLocal<MarketplaceAlertNotification[]>(DEV_NOTIFICATIONS_KEY, [])
      .filter((notification) => notification.listingId !== listingId)
    writeLocal(DEV_NOTIFICATIONS_KEY, remaining)
    return remaining
  }

  const response = await fetch('/api/account/marketplace-alerts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ignoreListingId: listingId }),
  })
  const data = await readResponseJson<{ notifications?: MarketplaceAlertNotification[]; error?: string }>(response)
  if (!response.ok) throw new Error(data.error || `Could not ignore listing (${response.status}).`)
  return Array.isArray(data.notifications) ? data.notifications : []
}
