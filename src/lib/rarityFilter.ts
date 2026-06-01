import type { MeowbotPlayerPass } from './meowbotApi'
import { normalizeMeowbotSport } from './meowbotApi'

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

export function legendaryPlusRarityFilter(): Set<RarityTier> {
  return new Set(LEGENDARY_PLUS_TIERS)
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

export function passRarityLookupKey(pass: MeowbotPlayerPass): string {
  return `${pass.entityId}-${pass.season}-${normalizeMeowbotSport(pass.sportRaw)}`
}

export function rarityLabelsForPass(
  pass: MeowbotPlayerPass,
  rarities: Record<string, string[]>,
  snapshotRarity?: string,
): string[] {
  const fromMap = rarities[passRarityLookupKey(pass)]
  if (fromMap?.length) return fromMap
  if (snapshotRarity?.trim()) return [snapshotRarity.trim()]
  return []
}

export function passMatchesRarityFilter(
  pass: MeowbotPlayerPass,
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
