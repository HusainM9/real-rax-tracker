import { kv } from '@vercel/kv'
import { adminStorageConfigured } from './adminEventStore.js'
import {
  parseMarketplaceAlertRule,
  type MarketplaceAlertNotification,
  type MarketplaceAlertRule,
} from './marketplaceAlerts.js'

const OWNERS_KEY = 'rax:marketplace-alerts:owners'
const RULES_PREFIX = 'rax:marketplace-alerts:rules:'
const NOTIFICATIONS_PREFIX = 'rax:marketplace-alerts:notifications:'
const NOTIFICATION_SNAPSHOT_PREFIX = 'rax:marketplace-alerts:notification-snapshot:'
const SEEN_PREFIX = 'rax:marketplace-alerts:seen:'
const PENDING_PREFIX = 'rax:marketplace-alerts:pending:'
const PENDING_IDS_PREFIX = 'rax:marketplace-alerts:pending-ids:'
const SCAN_STATUS_PREFIX = 'rax:marketplace-alerts:scan-status:'
const SCAN_LOG_PREFIX = 'rax:marketplace-alerts:scan-log:'
const IGNORED_LISTING_PREFIX = 'rax:marketplace-alerts:ignored-listing:'
const DELIVERY_SETTINGS_PREFIX = 'rax:marketplace-alerts:delivery-settings:'
const ACCOUNT_ROUTING_ENABLED_KEY = 'rax:marketplace-alerts:account-routing-enabled'
const SCAN_LEASE_KEY = 'rax:marketplace-alerts:scan-lease'
const SCAN_COOLDOWN_KEY = 'rax:marketplace-alerts:scan-cooldown'
const MAX_NOTIFICATIONS = 200
const MAX_SCAN_LOG_ENTRIES = 40
const SEEN_TTL_SECONDS = 14 * 24 * 60 * 60
const IGNORED_LISTING_TTL_SECONDS = 30 * 24 * 60 * 60
const SCAN_LEASE_TTL_SECONDS = 70
const SCAN_COOLDOWN_TTL_SECONDS = 75

export type MarketplaceScanStatus = {
  startedAt: string
  finishedAt: string
  checkedListings: number
  requests: number
  newMatches: number
  delivered: number
  deliveryChannel: string | null
  error: string | null
  warning?: string | null
}

export type MarketplaceScanLogEntry = MarketplaceScanStatus & {
  id: string
  source: 'automatic' | 'manual' | 'page'
}

export type MarketplaceDeliverySettings = {
  discordUserId: string | null
}

function ownerKey(owner: string): string {
  return owner.trim().toLowerCase()
}

function rulesKey(owner: string): string {
  return `${RULES_PREFIX}${ownerKey(owner)}`
}

function notificationsKey(owner: string): string {
  return `${NOTIFICATIONS_PREFIX}${ownerKey(owner)}`
}

function notificationSnapshotKey(owner: string): string {
  return `${NOTIFICATION_SNAPSHOT_PREFIX}${ownerKey(owner)}`
}

function seenKey(owner: string, notificationId: string): string {
  return `${SEEN_PREFIX}${ownerKey(owner)}:${notificationId}`
}

function pendingKey(owner: string, notificationId: string): string {
  return `${PENDING_PREFIX}${ownerKey(owner)}:${notificationId}`
}

function pendingIdsKey(owner: string): string {
  return `${PENDING_IDS_PREFIX}${ownerKey(owner)}`
}

function scanStatusKey(owner: string): string {
  return `${SCAN_STATUS_PREFIX}${ownerKey(owner)}`
}

function scanLogKey(owner: string): string {
  return `${SCAN_LOG_PREFIX}${ownerKey(owner)}`
}

function ignoredListingKey(owner: string, listingId: string): string {
  return `${IGNORED_LISTING_PREFIX}${ownerKey(owner)}:${listingId.trim()}`
}

function deliverySettingsKey(owner: string): string {
  return `${DELIVERY_SETTINGS_PREFIX}${ownerKey(owner)}`
}

export function normalizeDiscordUserId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new Error('Discord User ID must be a number.')
  const normalized = value.trim()
  if (!/^\d{15,22}$/.test(normalized)) {
    throw new Error('Enter a valid Discord User ID copied from Discord Developer Mode.')
  }
  return normalized
}

function parseNotification(entry: unknown): MarketplaceAlertNotification | null {
  try {
    const parsed = typeof entry === 'string' ? JSON.parse(entry) : entry
    return parsed && typeof parsed === 'object' ? parsed as MarketplaceAlertNotification : null
  } catch {
    return null
  }
}

export function marketplaceAlertStorageConfigured(): boolean {
  return adminStorageConfigured()
}

/**
 * Prevent overlapping scheduler deliveries from multiplying Real API traffic.
 * QStash retries failed deliveries, so one slow scan can otherwise create a
 * thundering herd of identical scans every two minutes.
 */
export async function acquireMarketplaceScanLease(): Promise<string | null> {
  if (!marketplaceAlertStorageConfigured()) return null
  if (await kv.get(SCAN_COOLDOWN_KEY)) return null
  const token = crypto.randomUUID()
  const claimed = await kv.set(SCAN_LEASE_KEY, token, {
    ex: SCAN_LEASE_TTL_SECONDS,
    nx: true,
  })
  return claimed ? token : null
}

export async function releaseMarketplaceScanLease(token: string): Promise<void> {
  if (!marketplaceAlertStorageConfigured()) return
  const current = await kv.get<string>(SCAN_LEASE_KEY)
  if (current !== token) return
  // A short post-run cooldown acknowledges delayed QStash retries without doing
  // the same exhaustive scan again. It expires before the next two-minute tick.
  await kv.set(SCAN_COOLDOWN_KEY, '1', { ex: SCAN_COOLDOWN_TTL_SECONDS })
  await kv.del(SCAN_LEASE_KEY)
}

export async function listMarketplaceAlertOwners(): Promise<string[]> {
  if (!marketplaceAlertStorageConfigured()) return []
  return (await kv.smembers(OWNERS_KEY)).sort()
}

export async function marketplaceAccountRoutingEnabled(): Promise<boolean> {
  if (!marketplaceAlertStorageConfigured()) return false
  return Boolean(await kv.get(ACCOUNT_ROUTING_ENABLED_KEY))
}

export async function readMarketplaceDeliverySettings(
  owner: string,
): Promise<MarketplaceDeliverySettings> {
  if (!marketplaceAlertStorageConfigured()) return { discordUserId: null }
  const stored = await kv.get<unknown>(deliverySettingsKey(owner))
  if (!stored || typeof stored !== 'object') return { discordUserId: null }
  const discordUserId = (stored as { discordUserId?: unknown }).discordUserId
  try {
    return { discordUserId: normalizeDiscordUserId(discordUserId) }
  } catch {
    return { discordUserId: null }
  }
}

export async function saveMarketplaceDeliverySettings(
  owner: string,
  settings: MarketplaceDeliverySettings,
): Promise<MarketplaceDeliverySettings> {
  const saved = { discordUserId: normalizeDiscordUserId(settings.discordUserId) }
  if (!marketplaceAlertStorageConfigured()) return saved
  await Promise.all([
    kv.set(deliverySettingsKey(owner), saved),
    kv.set(ACCOUNT_ROUTING_ENABLED_KEY, '1'),
  ])
  return saved
}

export async function readMarketplaceAlertRules(owner: string): Promise<MarketplaceAlertRule[]> {
  if (!marketplaceAlertStorageConfigured()) return []
  const raw = (await kv.get<unknown[]>(rulesKey(owner))) ?? []
  return raw
    .map(parseMarketplaceAlertRule)
    .filter((rule): rule is MarketplaceAlertRule => rule !== null)
}

export async function saveMarketplaceAlertRules(
  owner: string,
  rules: MarketplaceAlertRule[],
): Promise<MarketplaceAlertRule[]> {
  const parsed = rules
    .map(parseMarketplaceAlertRule)
    .filter((rule): rule is MarketplaceAlertRule => rule !== null)
    .slice(0, 50)
  if (!marketplaceAlertStorageConfigured()) return parsed
  await kv.set(rulesKey(owner), parsed)
  if (parsed.length > 0) await kv.sadd(OWNERS_KEY, ownerKey(owner))
  else await kv.srem(OWNERS_KEY, ownerKey(owner))
  return parsed
}

export async function readMarketplaceNotifications(
  owner: string,
  limit = 100,
): Promise<MarketplaceAlertNotification[]> {
  if (!marketplaceAlertStorageConfigured()) return []
  const snapshot = await kv.get<unknown[]>(notificationSnapshotKey(owner))
  if (Array.isArray(snapshot)) {
    return snapshot.slice(0, Math.max(0, limit)).flatMap((entry) => {
      const parsed = parseNotification(entry)
      return parsed ? [parsed] : []
    })
  }

  // Read the former list format until this owner's next scan writes a snapshot.
  const raw = await kv.lrange<string>(notificationsKey(owner), 0, Math.max(0, limit - 1))
  return raw.flatMap((entry) => {
    const parsed = parseNotification(entry)
    return parsed ? [parsed] : []
  })
}

export async function readMarketplaceScanStatus(
  owner: string,
): Promise<MarketplaceScanStatus | null> {
  if (!marketplaceAlertStorageConfigured()) return null
  return (await kv.get<MarketplaceScanStatus>(scanStatusKey(owner))) ?? null
}

export async function saveMarketplaceScanStatus(
  owner: string,
  status: MarketplaceScanStatus,
  source: MarketplaceScanLogEntry['source'] = 'automatic',
): Promise<void> {
  if (!marketplaceAlertStorageConfigured()) return
  const entry: MarketplaceScanLogEntry = {
    ...status,
    id: `${status.startedAt}:${source}`,
    source,
  }
  await Promise.all([
    kv.set(scanStatusKey(owner), status),
    kv.lpush(scanLogKey(owner), JSON.stringify(entry)),
  ])
  await kv.ltrim(scanLogKey(owner), 0, MAX_SCAN_LOG_ENTRIES - 1)
}

export async function readMarketplaceScanLog(
  owner: string,
  limit = 20,
): Promise<MarketplaceScanLogEntry[]> {
  if (!marketplaceAlertStorageConfigured()) return []
  const raw = await kv.lrange<string>(scanLogKey(owner), 0, Math.max(0, limit - 1))
  return raw.flatMap((value) => {
    try {
      const entry = typeof value === 'string' ? JSON.parse(value) : value
      if (!entry || typeof entry !== 'object') return []
      const candidate = entry as MarketplaceScanLogEntry
      if (
        candidate.source !== 'automatic' &&
        candidate.source !== 'manual' &&
        candidate.source !== 'page'
      ) return []
      if (!candidate.startedAt) return []
      return [candidate]
    } catch {
      return []
    }
  })
}

export async function readPendingMarketplaceNotifications(
  owner: string,
  limit = 25,
): Promise<MarketplaceAlertNotification[]> {
  if (!marketplaceAlertStorageConfigured()) return []
  const ids = (await kv.smembers(pendingIdsKey(owner))).slice(0, Math.max(0, limit))
  if (ids.length === 0) return []
  const storedValues = await kv.mget<Array<MarketplaceAlertNotification | string | null>>(
    ...ids.map((id) => pendingKey(owner, id)),
  )
  const pending: MarketplaceAlertNotification[] = []
  const staleIds: string[] = []
  for (const [index, id] of ids.entries()) {
    const stored = storedValues[index]
    if (!stored) {
      staleIds.push(id)
      continue
    }
    try {
      const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored
      if (parsed && typeof parsed === 'object') pending.push(parsed as MarketplaceAlertNotification)
    } catch {
      staleIds.push(id)
    }
  }
  if (staleIds.length > 0) await kv.srem(pendingIdsKey(owner), ...staleIds)
  return pending
}

export async function markMarketplaceNotificationsDelivered(
  owner: string,
  notificationIds: string[],
): Promise<void> {
  if (!marketplaceAlertStorageConfigured() || notificationIds.length === 0) return
  await Promise.all([
    kv.srem(pendingIdsKey(owner), ...notificationIds),
    kv.del(...notificationIds.map((id) => pendingKey(owner, id))),
  ])
}

export async function saveNewMarketplaceNotifications(
  owner: string,
  notifications: MarketplaceAlertNotification[],
): Promise<MarketplaceAlertNotification[]> {
  if (!marketplaceAlertStorageConfigured()) return notifications
  const unique = [...new Map(notifications.map((notification) => [notification.id, notification])).values()]
  const listingIds = [...new Set(unique.map((notification) => notification.listingId))]
  const ignoredValues = listingIds.length > 0
    ? await kv.mget<unknown[]>(...listingIds.map((listingId) => ignoredListingKey(owner, listingId)))
    : []
  const ignoredListingIds = new Set(
    listingIds.filter((_, index) => Boolean(ignoredValues[index])),
  )
  const visible = unique.filter((notification) => !ignoredListingIds.has(notification.listingId))
  const seenValues = visible.length > 0
    ? await kv.mget<unknown[]>(...visible.map((notification) => seenKey(owner, notification.id)))
    : []
  const saved: MarketplaceAlertNotification[] = []
  for (const [index, notification] of visible.entries()) {
    if (seenValues[index]) continue
    const key = seenKey(owner, notification.id)
    const claimed = await kv.set(key, '1', { ex: SEEN_TTL_SECONDS, nx: true })
    if (!claimed) continue
    await kv.set(pendingKey(owner, notification.id), notification, { ex: SEEN_TTL_SECONDS })
    await kv.sadd(pendingIdsKey(owner), notification.id)
    saved.push(notification)
  }

  // This is a latest-scan snapshot, so store the whole bounded feed in one KV
  // command. The former list rewrite used hundreds of commands every two minutes.
  const current = visible.slice(0, MAX_NOTIFICATIONS)
  await kv.set(notificationSnapshotKey(owner), current)
  return saved
}

export async function ignoreMarketplaceListing(
  owner: string,
  listingId: string,
): Promise<MarketplaceAlertNotification[]> {
  const normalizedListingId = listingId.trim().slice(0, 120)
  if (!normalizedListingId || !marketplaceAlertStorageConfigured()) {
    return readMarketplaceNotifications(owner)
  }

  await kv.set(ignoredListingKey(owner, normalizedListingId), '1', {
    ex: IGNORED_LISTING_TTL_SECONDS,
  })

  const notifications = await readMarketplaceNotifications(owner, MAX_NOTIFICATIONS)
  const remaining = notifications.filter((item) => item.listingId !== normalizedListingId)
  await kv.set(notificationSnapshotKey(owner), remaining)

  const pendingIds = await kv.smembers(pendingIdsKey(owner))
  if (pendingIds.length > 0) {
    const storedPending = await kv.mget<Array<MarketplaceAlertNotification | string | null>>(
      ...pendingIds.map((id) => pendingKey(owner, id)),
    )
    const matchingIds = pendingIds.filter((_, index) => (
      parseNotification(storedPending[index])?.listingId === normalizedListingId
    ))
    if (matchingIds.length > 0) {
      await Promise.all([
        kv.srem(pendingIdsKey(owner), ...matchingIds),
        kv.del(...matchingIds.map((id) => pendingKey(owner, id))),
      ])
    }
  }

  return remaining
}
