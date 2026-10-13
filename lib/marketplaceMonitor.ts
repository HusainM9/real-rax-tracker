import {
  createMarketplaceNotification,
  marketplaceApiSport,
  marketplaceListingMatchesRule,
  type MarketplaceAlertNotification,
  type MarketplaceAlertRule,
  type MarketplaceListing,
} from './marketplaceAlerts.js'
import { saveNewMarketplaceNotifications } from './marketplaceAlertStore.js'
import { RealApiError, realGetJson, type RealApiContext } from './realApi.js'

type MarketplaceResponse = {
  listings?: MarketplaceListing[]
  listingCount?: number | null
}

type ScanGroup = {
  sport: string
  season: number
  filterCustomType: 'all' | 'ownedPlayers' | 'ownedTeams'
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
    const apiSport = marketplaceApiSport(bulkRule.sport)
    // Explicit player IDs are portable across linked accounts and do not depend on
    // whichever Real session happens to be configured on the server.
    const filterCustomType = (bulkRule.players?.length ?? 0) > 0
      ? 'all'
      : bulkRule.entityScope === 'ownedPlayers'
      ? 'ownedPlayers'
      : bulkRule.entityScope === 'ownedTeams'
        ? 'ownedTeams'
        : 'all'
    // Real caps each response at ten listings. Request every rarity together and
    // apply each rule's rarity choices locally so one cursor walk covers the whole
    // sport/season feed instead of running five separate partial scans.
    const key = [apiSport, bulkRule.season, filterCustomType].join('|')
    const existing = groups.get(key)
    if (existing) existing.rules.push(bulkRule)
    else groups.set(key, {
      sport: apiSport,
      season: bulkRule.season,
      filterCustomType,
      rules: [bulkRule],
    })
  }
  return [...groups.values()]
}

function listingEndCursor(listings: MarketplaceListing[]): string | null {
  let latest: string | null = null
  for (const listing of listings) {
    if (typeof listing.endsAt !== 'string' || !listing.endsAt.trim()) continue
    if (latest === null || listing.endsAt > latest) latest = listing.endsAt
  }
  return latest
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
  failedRequests: number
  warning: string | null
}> {
  const candidates: MarketplaceAlertNotification[] = []
  const checked = new Set<string>()
  const groups = groupRules(options.rules)
  const rejectedGroups: ScanGroup[] = []
  let requests = 0
  let incompleteFeeds = 0

  for (const group of groups) {
    let beforeEndsAt: string | undefined
    const feedListings = new Set<string>()

    while (true) {
      let response: MarketplaceResponse
      try {
        requests += 1
        response = await realGetJson<MarketplaceResponse>(
          '/cardmarketplacelistings',
          options.context,
          {
            cohort: 'all',
            filterCustomType: group.filterCustomType,
            listingType: 'userpassfull',
            prestige: 'all',
            rarity: 'all',
            season: group.season,
            sport: group.sport,
            beforeEndsAt,
          },
        )
      } catch (error) {
        // Real responds with 400 for marketplace combinations it does not expose.
        // One unsupported sport must not prevent valid feeds from scanning.
        if (
          error instanceof RealApiError &&
          error.kind === 'upstream' &&
          error.status === 400
        ) {
          rejectedGroups.push(group)
          break
        }
        throw error
      }

      const listings = Array.isArray(response.listings) ? response.listings : []
      let newlyChecked = 0
      for (const listing of listings) {
        const listingId = String(listing.id)
        if (!feedListings.has(listingId)) {
          feedListings.add(listingId)
          checked.add(listingId)
          newlyChecked += 1
        }
        for (const rule of group.rules) {
          if (!marketplaceListingMatchesRule(rule, listing)) continue
          candidates.push(createMarketplaceNotification(rule, listing, options.foundAt))
        }
      }

      // `beforeEndsAt` is inclusive, so the first listing on the next page can
      // repeat. Stop only when the feed is exhausted or the cursor cannot advance;
      // previously seen/ignored notification state never truncates this walk.
      if (listings.length < 10 || newlyChecked === 0) break
      const nextCursor = listingEndCursor(listings)
      if (!nextCursor || nextCursor === beforeEndsAt) {
        incompleteFeeds += 1
        break
      }
      beforeEndsAt = nextCursor
    }
  }

  const unique = [...new Map(candidates.map((notification) => [notification.id, notification])).values()]
  const notifications = await saveNewMarketplaceNotifications(options.owner, unique)
  const warnings = []
  if (rejectedGroups.length > 0) {
    warnings.push(`${rejectedGroups.length} of ${groups.length} feeds skipped because Real rejected them (400).`)
  }
  if (incompleteFeeds > 0) {
    warnings.push(`${incompleteFeeds} feed${incompleteFeeds === 1 ? '' : 's'} stopped because Real did not return an advancing page cursor.`)
  }
  return {
    notifications,
    checkedListings: checked.size,
    requests,
    failedRequests: rejectedGroups.length,
    warning: warnings.join(' ') || null,
  }
}
