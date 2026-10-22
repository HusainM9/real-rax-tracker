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
  filterEntityType?: 'player' | 'team'
  filterEntityId?: number
  rules: MarketplaceAlertRule[]
}

/** Real models UFC fighters as team entities in targeted marketplace filters. */
function marketplaceEntityTypeForTrackedAthlete(apiSport: string): 'player' | 'team' {
  return apiSport === 'ufc' ? 'team' : 'player'
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
    // Explicit player IDs are portable across linked accounts and let us exhaust
    // only feeds that can actually match the saved alert. This keeps complete
    // pagination inside the serverless execution window.
    if ((bulkRule.players?.length ?? 0) > 0) {
      for (const player of bulkRule.players!) {
        const filterEntityType = marketplaceEntityTypeForTrackedAthlete(apiSport)
        const key = [apiSport, bulkRule.season, filterEntityType, player.entityId].join('|')
        const existing = groups.get(key)
        if (existing) existing.rules.push(bulkRule)
        else groups.set(key, {
          sport: apiSport,
          season: bulkRule.season,
          filterCustomType: 'all',
          filterEntityType,
          filterEntityId: player.entityId,
          rules: [bulkRule],
        })
      }
      continue
    }

    const filterCustomType = bulkRule.entityScope === 'ownedPlayers'
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

type GroupScanResult = {
  candidates: MarketplaceAlertNotification[]
  checkedIds: string[]
  requests: number
  rejected: boolean
  incomplete: boolean
}

async function scanGroup(
  group: ScanGroup,
  context: RealApiContext,
  foundAt?: string,
): Promise<GroupScanResult> {
  const candidates: MarketplaceAlertNotification[] = []
  const checkedIds = new Set<string>()
  let beforeEndsAt: string | undefined
  let requests = 0
  let incomplete = false

  while (true) {
    let response: MarketplaceResponse
    try {
      requests += 1
      response = await realGetJson<MarketplaceResponse>(
        '/cardmarketplacelistings',
        context,
        {
          cohort: 'all',
          filterCustomType: group.filterCustomType,
          filterEntityType: group.filterEntityType,
          filterEntityId: group.filterEntityId,
          listingType: 'userpassfull',
          prestige: 'all',
          rarity: 'all',
          season: group.season,
          sport: group.sport,
          beforeEndsAt,
        },
      )
    } catch (error) {
      if (
        error instanceof RealApiError &&
        error.kind === 'upstream' &&
        error.status === 400
      ) {
        return {
          candidates,
          checkedIds: [...checkedIds],
          requests,
          rejected: true,
          incomplete,
        }
      }
      throw error
    }

    const listings = Array.isArray(response.listings) ? response.listings : []
    let newlyChecked = 0
    for (const listing of listings) {
      const listingId = String(listing.id)
      if (!checkedIds.has(listingId)) {
        checkedIds.add(listingId)
        newlyChecked += 1
      }
      for (const rule of group.rules) {
        if (!marketplaceListingMatchesRule(rule, listing)) continue
        candidates.push(createMarketplaceNotification(rule, listing, foundAt))
      }
    }

    // `beforeEndsAt` is inclusive, so the first listing on the next page can
    // repeat. Stop only when the feed is exhausted or the cursor cannot advance;
    // previously seen/ignored notification state never truncates this walk.
    if (listings.length < 10 || newlyChecked === 0) break
    const nextCursor = listingEndCursor(listings)
    if (!nextCursor || nextCursor === beforeEndsAt) {
      incomplete = true
      break
    }
    beforeEndsAt = nextCursor
  }

  return {
    candidates,
    checkedIds: [...checkedIds],
    requests,
    rejected: false,
    incomplete,
  }
}

async function scanGroupsWithConcurrency(
  groups: ScanGroup[],
  context: RealApiContext,
  foundAt?: string,
): Promise<GroupScanResult[]> {
  const results = new Array<GroupScanResult>(groups.length)
  let nextIndex = 0
  const concurrency = Math.max(1, Math.min(4, context.config.concurrency || 1))

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= groups.length) return
      results[index] = await scanGroup(groups[index], context, foundAt)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, () => worker()))
  return results
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
  const groupResults = await scanGroupsWithConcurrency(groups, options.context, options.foundAt)
  let requests = 0
  let rejectedGroups = 0
  let incompleteFeeds = 0
  for (const result of groupResults) {
    candidates.push(...result.candidates)
    result.checkedIds.forEach((id) => checked.add(id))
    requests += result.requests
    rejectedGroups += Number(result.rejected)
    incompleteFeeds += Number(result.incomplete)
  }

  const unique = [...new Map(candidates.map((notification) => [notification.id, notification])).values()]
  const notifications = await saveNewMarketplaceNotifications(options.owner, unique)
  const warnings = []
  if (rejectedGroups > 0) {
    warnings.push(`${rejectedGroups} of ${groups.length} feeds skipped because Real rejected them (400).`)
  }
  if (incompleteFeeds > 0) {
    warnings.push(`${incompleteFeeds} feed${incompleteFeeds === 1 ? '' : 's'} stopped because Real did not return an advancing page cursor.`)
  }
  return {
    notifications,
    checkedListings: checked.size,
    requests,
    failedRequests: rejectedGroups,
    warning: warnings.join(' ') || null,
  }
}
