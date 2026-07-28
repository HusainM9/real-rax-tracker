export const RARITY_TIERS = [
  'General',
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mystic',
  'Iconic',
] as const

export type RarityTier = (typeof RARITY_TIERS)[number]

export const LEGENDARY_PLUS_TIERS = ['Legendary', 'Mystic', 'Iconic'] as const satisfies readonly RarityTier[]

/** Optional username-import expansion beyond Legendary+. */
export const RARE_IMPORT_TIER = 'Rare' as const satisfies RarityTier
export const EPIC_IMPORT_TIER = 'Epic' as const satisfies RarityTier
export const EPIC_AND_RARE_IMPORT_TIERS = [RARE_IMPORT_TIER, EPIC_IMPORT_TIER] as const

export type RarityFilterPass = {
  entityId: number
  season: number
  sportRaw: string
}

function normalizeMeowbotSport(raw: string): string {
  const sport = raw.trim().toLowerCase()
  if (sport === 'ncaab' || sport === 'ncaa-mens-basketball') return 'ncaam'
  if (sport === 'ncaafootball' || sport === 'ncaa-football' || sport === 'cfb') return 'ncaaf'
  return sport
}

export function legendaryPlusRarityFilter(): Set<RarityTier> {
  return new Set(LEGENDARY_PLUS_TIERS)
}

export type UsernameImportRarityOptions = {
  includeRare?: boolean
  includeEpic?: boolean
}

/** Legendary+ by default; optionally include Rare and/or Epic for username import. */
export function usernameImportRarityFilter(
  options: UsernameImportRarityOptions | boolean = {},
): Set<RarityTier> {
  const includeRare = typeof options === 'boolean' ? options : Boolean(options.includeRare)
  const includeEpic = typeof options === 'boolean' ? options : Boolean(options.includeEpic)
  const tiers = legendaryPlusRarityFilter()
  if (includeRare) tiers.add(RARE_IMPORT_TIER)
  if (includeEpic) tiers.add(EPIC_IMPORT_TIER)
  return tiers
}

export function isLegendaryPlusRarity(rarityLabel?: string): boolean {
  const tier = normalizeRarityTier(rarityLabel ?? '')
  return (LEGENDARY_PLUS_TIERS as readonly string[]).includes(tier)
}

export function normalizeRarityTier(label: string): RarityTier | 'Other' {
  const trimmed = label.trim()
  for (const tier of RARITY_TIERS) {
    if (trimmed === tier || trimmed.startsWith(`${tier} `)) {
      return tier
    }
  }
  return 'Other'
}

export function passRarityLookupKey(pass: RarityFilterPass): string {
  return `${pass.entityId}-${pass.season}-${normalizeMeowbotSport(pass.sportRaw)}`
}

export function rarityLabelsForPass(
  pass: RarityFilterPass,
  rarities: Record<string, string[]>,
  snapshotRarity?: string,
): string[] {
  const fromMap = rarities[passRarityLookupKey(pass)]
  if (fromMap?.length) return fromMap
  if (snapshotRarity?.trim()) return [snapshotRarity.trim()]
  return []
}

export function passMatchesRarityFilter(
  pass: RarityFilterPass,
  rarities: Record<string, string[]>,
  snapshotRarity: string | undefined,
  selectedTiers: Set<RarityTier> | undefined,
): boolean {
  if (!selectedTiers || selectedTiers.size === RARITY_TIERS.length) {
    return true
  }
  if (selectedTiers.size === 0) {
    return false
  }

  const labels = rarityLabelsForPass(pass, rarities, snapshotRarity)
  if (labels.length === 0) {
    return true
  }

  return labels.some((label) => selectedTiers.has(normalizeRarityTier(label) as RarityTier))
}

export function defaultRaritySelection(): Set<RarityTier> {
  return legendaryPlusRarityFilter()
}
