import {
  MARKETPLACE_RARITY_API_VALUES,
  createMarketplaceNotification,
  marketplaceListingMatchesRule,
  marketplaceRuleRarities,
  type MarketplaceAlertNotification,
  type MarketplaceAlertRule,
  type MarketplaceListing,
  type MarketplaceRarityApiValue,
} from './marketplaceAlerts.js'
import { saveNewMarketplaceNotifications } from './marketplaceAlertStore.js'
import { realGetJson, type RealApiContext } from './realApi.js'

type MarketplaceResponse = {
  listings?: MarketplaceListing[]
  listingCount?: number | null
}

type ScanGroup = {
  sport: string
  season: number
  filterCustomType: 'all' | 'ownedPlayers' | 'ownedTeams'
  rarity: MarketplaceRarityApiValue
  rules: MarketplaceAlertRule[]
}

function groupRules(rules: MarketplaceAlertRule[]): ScanGroup[] {
  const groups = new Map<string, ScanGroup>()
  for (const rule of rules.filter((entry) => entry.enabled)) {
    // Marketplace monitoring is intentionally bulk-rating only. Coercing here keeps
    // legacy card/serial rules from ever requesting or matching their old feeds.
    const bulkRule: MarketplaceAlertRule = rule.itemType === 'bulk'
      ? rule
      : { ...rule, itemType: 'bulk' }
    // Explicit player IDs are portable across linked accounts and do not depend on
    // whichever Real session happens to be configured on the server.
    const filterCustomType = (bulkRule.players?.length ?? 0) > 0
      ? 'all'
      : bulkRule.entityScope === 'ownedPlayers'
      ? 'ownedPlayers'
      : bulkRule.entityScope === 'ownedTeams'
        ? 'ownedTeams'
        : 'all'
    for (const rarity of marketplaceRuleRarities(bulkRule)) {
      const rarityValue = MARKETPLACE_RARITY_API_VALUES[rarity]
      const key = [bulkRule.sport, bulkRule.season, filterCustomType, rarityValue].join('|')
      const existing = groups.get(key)
      if (existing) existing.rules.push(bulkRule)
      else groups.set(key, {
        sport: bulkRule.sport,
        season: bulkRule.season,
        filterCustomType,
        rarity: rarityValue,
        rules: [bulkRule],
      })
    }
  }
  return [...groups.values()]
}

export async function scanMarketplaceAlerts(options: {
  owner: string
  rules: MarketplaceAlertRule[]
  context: RealApiContext
  foundAt?: string
}): Promise<{
  notifications: MarketplaceAlertNotification[]
  checkedListings: number
  requests: number
}> {
  const candidates: MarketplaceAlertNotification[] = []
  const checked = new Set<string>()
  const groups = groupRules(options.rules)

  for (const group of groups) {
    const response = await realGetJson<MarketplaceResponse>(
      '/cardmarketplacelistings',
      options.context,
      {
        cohort: 'all',
        filterCustomType: group.filterCustomType,
        listingType: 'userpassfull',
        prestige: 'all',
        // Real's `rarity=all` currently returns only one rarity slice. Numeric
        // feeds are the reliable way to cover every bulk rarity.
        rarity: group.rarity,
        season: group.season,
        sport: group.sport,
      },
    )
    for (const listing of Array.isArray(response.listings) ? response.listings : []) {
      checked.add(String(listing.id))
      for (const rule of group.rules) {
        if (!marketplaceListingMatchesRule(rule, listing)) continue
        candidates.push(createMarketplaceNotification(rule, listing, options.foundAt))
      }
    }
  }

  const unique = [...new Map(candidates.map((notification) => [notification.id, notification])).values()]
  const notifications = await saveNewMarketplaceNotifications(options.owner, unique)
  return { notifications, checkedListings: checked.size, requests: groups.length }
}
