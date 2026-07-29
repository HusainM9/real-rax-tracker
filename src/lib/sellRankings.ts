import type { RarityFilterValue, SortDirection } from './cardSort'
import { legendaryPlusRarityFilter, normalizeRarityTier, type RarityTier } from './rarityFilter'
import type { BulkSellRankRow } from './removeCardAnalysis'
import type { SavedSellRankRow, SavedSellRankings, Sport } from '../types/rax'

export type SellRankSortKey =
  | 'netClaimable'
  | 'freedOnOthers'
  | 'lostIfSold'
  | 'claimableNow'
  | 'name'

export const SELL_RANK_SORT_OPTIONS: { value: SellRankSortKey; label: string }[] = [
  { value: 'netClaimable', label: 'Net claimable' },
  { value: 'freedOnOthers', label: 'Freed on others' },
  { value: 'lostIfSold', label: 'Lost if sold' },
  { value: 'claimableNow', label: 'Claimable now' },
  { value: 'name', label: 'Player name' },
]

export function toSavedSellRankRow(row: BulkSellRankRow): SavedSellRankRow {
  return {
    cardId: row.analysis.card.id,
    name: row.analysis.card.name,
    sport: row.analysis.card.sport,
    season: row.analysis.card.season,
    rarityLabel: row.analysis.card.rarityLabel,
    passKind: row.analysis.card.passKind,
    avatar: row.analysis.card.avatar,
    claimableNow: row.claimableNow,
    lostClaimableRax: row.analysis.lostClaimableRax,
    freedClaimableRax: row.analysis.freedClaimableRax,
    netClaimableDelta: row.analysis.netClaimableDelta,
  }
}

export function buildSavedSellRankings(
  result: {
    rankings: BulkSellRankRow[]
    skippedWithoutEarnings: number
    skippedTeamPasses: number
    skippedPlayerPasses: SavedSellRankings['skippedPlayerPasses']
  },
  calculatedAt: string,
): SavedSellRankings {
  return {
    calculatedAt,
    skippedWithoutEarnings: result.skippedWithoutEarnings,
    skippedTeamPasses: result.skippedTeamPasses,
    skippedPlayerPasses: result.skippedPlayerPasses,
    rows: result.rankings.map(toSavedSellRankRow),
  }
}

export function sellRankRowRarityTier(row: SavedSellRankRow): RarityTier | 'Unknown' {
  const label = row.rarityLabel?.trim()
  if (!label) return 'Unknown'
  const tier = normalizeRarityTier(label)
  return tier === 'Other' ? 'Unknown' : tier
}

export function filterSellRankRows(
  rows: SavedSellRankRow[],
  sportFilter: Sport | 'All',
  rarityFilter: RarityFilterValue,
  searchQuery = '',
): SavedSellRankRow[] {
  const bySport =
    sportFilter === 'All' ? rows : rows.filter((row) => row.sport === sportFilter)

  const byRarity = (() => {
    if (rarityFilter === 'All') return bySport
    if (rarityFilter === 'Legendary+') {
      const tiers = legendaryPlusRarityFilter()
      return bySport.filter((row) => tiers.has(sellRankRowRarityTier(row) as RarityTier))
    }
    if (rarityFilter === 'Unknown') {
      return bySport.filter((row) => sellRankRowRarityTier(row) === 'Unknown')
    }
    return bySport.filter((row) => sellRankRowRarityTier(row) === rarityFilter)
  })()

  const query = searchQuery.trim().toLowerCase()
  if (!query) return byRarity

  return byRarity.filter((row) => {
    const haystack = [row.name, row.sport, row.season, row.rarityLabel ?? '']
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  })
}

function compareSellRankRows(a: SavedSellRankRow, b: SavedSellRankRow, sortKey: SellRankSortKey): number {
  if (sortKey === 'name') {
    return a.name.localeCompare(b.name)
  }

  const aValue =
    sortKey === 'netClaimable'
      ? a.netClaimableDelta
      : sortKey === 'freedOnOthers'
        ? a.freedClaimableRax
        : sortKey === 'lostIfSold'
          ? a.lostClaimableRax
          : a.claimableNow
  const bValue =
    sortKey === 'netClaimable'
      ? b.netClaimableDelta
      : sortKey === 'freedOnOthers'
        ? b.freedClaimableRax
        : sortKey === 'lostIfSold'
          ? b.lostClaimableRax
          : b.claimableNow

  return aValue - bValue || a.name.localeCompare(b.name)
}

export function sortSellRankRows(
  rows: SavedSellRankRow[],
  sortKey: SellRankSortKey,
  direction: SortDirection,
): SavedSellRankRow[] {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...rows].sort(
    (a, b) => compareSellRankRows(a, b, sortKey) * multiplier,
  )
}
