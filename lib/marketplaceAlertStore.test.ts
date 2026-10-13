import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceAlertNotification, MarketplaceAlertRule } from './marketplaceAlerts'

const values = new Map<string, unknown>()
const sets = new Map<string, Set<string>>()
const lists = new Map<string, unknown[]>()

vi.mock('@vercel/kv', () => ({
  kv: {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && values.has(key)) return null
      values.set(key, value)
      return 'OK'
    },
    del: async (key: string) => {
      const removed = values.delete(key) || sets.delete(key) || lists.delete(key)
      return Number(removed)
    },
    sadd: async (key: string, ...members: string[]) => {
      const target = sets.get(key) ?? new Set<string>()
      for (const member of members) target.add(member)
      sets.set(key, target)
      return members.length
    },
    srem: async (key: string, ...members: string[]) => {
      const target = sets.get(key)
      if (!target) return 0
      let removed = 0
      for (const member of members) removed += Number(target.delete(member))
      return removed
    },
    smembers: async (key: string) => [...(sets.get(key) ?? [])],
    lpush: async (key: string, value: unknown) => {
      const target = lists.get(key) ?? []
      target.unshift(value)
      lists.set(key, target)
      return target.length
    },
    lrange: async (key: string, start: number, end: number) =>
      (lists.get(key) ?? []).slice(start, end + 1),
    ltrim: async (key: string, start: number, end: number) => {
      lists.set(key, (lists.get(key) ?? []).slice(start, end + 1))
      return 'OK'
    },
  },
}))

vi.mock('./adminEventStore.js', () => ({ adminStorageConfigured: () => true }))

import {
  ignoreMarketplaceListing,
  listMarketplaceAlertOwners,
  marketplaceAccountRoutingEnabled,
  markMarketplaceNotificationsDelivered,
  readMarketplaceAlertRules,
  readMarketplaceDeliverySettings,
  readMarketplaceNotifications,
  readMarketplaceScanStatus,
  readMarketplaceScanLog,
  readPendingMarketplaceNotifications,
  saveMarketplaceAlertRules,
  saveMarketplaceDeliverySettings,
  saveMarketplaceScanStatus,
  saveNewMarketplaceNotifications,
} from './marketplaceAlertStore'

const rule: MarketplaceAlertRule = {
  id: 'rule-1', name: 'NFL watch', enabled: true, sport: 'nfl', season: 2026,
  entityScope: 'all', entityId: null, entityName: '', ratingMin: null, ratingMax: null,
  rarities: [], listingMode: 'all', prestigeMode: 'all', itemType: 'bulk',
  priceMin: null, priceMax: 1000, atTargetPrice: true, noBids: true, maxSerial: null,
  createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
}

const notification: MarketplaceAlertNotification = {
  id: 'rule-1:listing-1', ruleId: 'rule-1', ruleName: 'NFL watch', listingId: 'listing-1',
  playerName: 'Player One', sport: 'nfl', season: 2026, price: 900, numBids: 0,
  rarity: 'Rare', serialNumber: null, endsAt: null, foundAt: '2026-10-12T09:50:00.000Z',
}

beforeEach(() => {
  values.clear()
  sets.clear()
  lists.clear()
})

describe('marketplace alert storage', () => {
  it('stores a Discord recipient per normalized account and enables account routing', async () => {
    expect(await marketplaceAccountRoutingEnabled()).toBe(false)
    expect(await readMarketplaceDeliverySettings('husain')).toEqual({ discordUserId: null })

    await saveMarketplaceDeliverySettings('  Husain  ', {
      discordUserId: '123456789012345678',
    })

    expect(await marketplaceAccountRoutingEnabled()).toBe(true)
    expect(await readMarketplaceDeliverySettings('HUSAIN')).toEqual({
      discordUserId: '123456789012345678',
    })
    expect(await readMarketplaceDeliverySettings('another-user')).toEqual({ discordUserId: null })
  })

  it('rejects invalid Discord recipients before saving them', async () => {
    await expect(saveMarketplaceDeliverySettings('husain', { discordUserId: 'not-an-id' }))
      .rejects.toThrow('valid Discord User ID')
    expect(await marketplaceAccountRoutingEnabled()).toBe(false)
  })

  it('normalizes owner keys and lists only owners with saved rules', async () => {
    await saveMarketplaceAlertRules('  Husain  ', [rule])
    expect(await listMarketplaceAlertOwners()).toEqual(['husain'])
    expect(await readMarketplaceAlertRules('HUSAIN')).toEqual([rule])

    await saveMarketplaceAlertRules('husain', [])
    expect(await listMarketplaceAlertOwners()).toEqual([])
  })

  it('drops malformed rules and limits each account to fifty', async () => {
    const candidates = [
      { nope: true } as unknown as MarketplaceAlertRule,
      ...Array.from({ length: 55 }, (_, index) => ({ ...rule, id: `rule-${index}` })),
    ]
    const saved = await saveMarketplaceAlertRules('husain', candidates)
    expect(saved).toHaveLength(50)
    expect(saved[0].id).toBe('rule-0')
    expect(saved.at(-1)?.id).toBe('rule-49')
  })

  it('atomically deduplicates matches and replaces the visible feed on every scan', async () => {
    const first = await saveNewMarketplaceNotifications('husain', [notification])
    const duplicate = await saveNewMarketplaceNotifications('HUSAIN', [notification])
    const second = { ...notification, id: 'rule-1:listing-2', listingId: 'listing-2' }
    await saveNewMarketplaceNotifications('husain', [second])

    expect(first).toEqual([notification])
    expect(duplicate).toEqual([])
    expect(await readMarketplaceNotifications('husain')).toEqual([second])

    await saveNewMarketplaceNotifications('husain', [])
    expect(await readMarketplaceNotifications('husain')).toEqual([])
  })

  it('queues new matches until successful external delivery', async () => {
    await saveNewMarketplaceNotifications('husain', [notification])
    expect(await readPendingMarketplaceNotifications('husain')).toEqual([notification])

    await markMarketplaceNotificationsDelivered('husain', [notification.id])
    expect(await readPendingMarketplaceNotifications('husain')).toEqual([])
    expect(await readMarketplaceNotifications('husain')).toEqual([notification])
  })

  it('cleans orphaned pending ids instead of returning invalid items', async () => {
    await saveNewMarketplaceNotifications('husain', [notification])
    values.delete(`rax:marketplace-alerts:pending:husain:${notification.id}`)
    expect(await readPendingMarketplaceNotifications('husain')).toEqual([])
    expect(sets.get('rax:marketplace-alerts:pending-ids:husain')).toEqual(new Set())
  })

  it('stores and returns the latest background scan status', async () => {
    const status = {
      startedAt: '2026-10-12T09:50:00.000Z',
      finishedAt: '2026-10-12T09:50:01.000Z',
      checkedListings: 30,
      requests: 3,
      newMatches: 2,
      delivered: 2,
      deliveryChannel: 'discord',
      error: null,
    }
    expect(await readMarketplaceScanStatus('husain')).toBeNull()
    await saveMarketplaceScanStatus('husain', status)
    expect(await readMarketplaceScanStatus('HUSAIN')).toEqual(status)
    expect(await readMarketplaceScanLog('HUSAIN')).toEqual([{
      ...status,
      id: `${status.startedAt}:automatic`,
      source: 'automatic',
    }])
  })

  it('retains manual and automatic scan history newest first', async () => {
    const first = {
      startedAt: '2026-10-12T09:50:00.000Z', finishedAt: '2026-10-12T09:50:01.000Z',
      checkedListings: 30, requests: 3, newMatches: 2, delivered: 2,
      deliveryChannel: 'discord', error: null,
    }
    const second = { ...first, startedAt: '2026-10-12T09:55:00.000Z', finishedAt: '2026-10-12T09:55:01.000Z' }
    await saveMarketplaceScanStatus('husain', first)
    await saveMarketplaceScanStatus('husain', second, 'manual')

    expect((await readMarketplaceScanLog('husain')).map((entry) => entry.source)).toEqual([
      'manual', 'automatic',
    ])
  })

  it('ignores a listing across rules and removes visible and pending matches', async () => {
    const sameListingOtherRule = { ...notification, id: 'rule-2:listing-1', ruleId: 'rule-2' }
    const otherListing = { ...notification, id: 'rule-1:listing-2', listingId: 'listing-2' }
    await saveNewMarketplaceNotifications('husain', [notification, sameListingOtherRule, otherListing])

    expect(await ignoreMarketplaceListing('husain', 'listing-1')).toEqual([otherListing])
    expect(await readMarketplaceNotifications('husain')).toEqual([otherListing])
    expect(await readPendingMarketplaceNotifications('husain')).toEqual([otherListing])

    const newRuleMatch = { ...notification, id: 'rule-3:listing-1', ruleId: 'rule-3' }
    expect(await saveNewMarketplaceNotifications('husain', [newRuleMatch])).toEqual([])
    expect(await readMarketplaceNotifications('husain')).toEqual([])
  })
})
