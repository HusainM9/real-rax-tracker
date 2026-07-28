/**
 * Cumulative play rating required to reach each rarity tier (Real docs).
 * Absolute rating ≈ threshold(current rarity) + boostInfo.progress toward the next tier.
 */
export const PLAY_RATING_THRESHOLDS: ReadonlyArray<{ rarity: string; rating: number }> = [
  { rarity: 'General', rating: 0 },
  { rarity: 'Common', rating: 10 },
  { rarity: 'Uncommon', rating: 30 },
  { rarity: 'Rare', rating: 80 },
  { rarity: 'Epic', rating: 180 },
  { rarity: 'Legendary 1', rating: 380 },
  { rarity: 'Legendary 2', rating: 520 },
  { rarity: 'Legendary 3', rating: 720 },
  { rarity: 'Legendary 4', rating: 1000 },
  { rarity: 'Legendary 5', rating: 1180 },
  { rarity: 'Mystic 1', rating: 1380 },
  { rarity: 'Mystic 2', rating: 1560 },
  { rarity: 'Mystic 3', rating: 1760 },
  { rarity: 'Mystic 4', rating: 1980 },
  { rarity: 'Mystic 5', rating: 2220 },
  { rarity: 'Mystic 6', rating: 2480 },
  { rarity: 'Mystic 7', rating: 2760 },
  { rarity: 'Mystic 8', rating: 3000 },
  { rarity: 'Mystic 9', rating: 3180 },
  { rarity: 'Mystic 10', rating: 3250 },
  { rarity: 'Iconic 1', rating: 3380 },
  { rarity: 'Iconic 2', rating: 3800 },
  { rarity: 'Iconic 3', rating: 4300 },
  { rarity: 'Iconic 4', rating: 4900 },
  { rarity: 'Iconic 5', rating: 5600 },
  { rarity: 'Iconic 6', rating: 6400 },
  { rarity: 'Iconic 7', rating: 7300 },
  { rarity: 'Iconic 8', rating: 8300 },
  { rarity: 'Iconic 9', rating: 9400 },
  { rarity: 'Iconic 10', rating: 10600 },
  { rarity: 'Iconic 11', rating: 12000 },
  { rarity: 'Iconic 12', rating: 13600 },
  { rarity: 'Iconic 13', rating: 15400 },
  { rarity: 'Iconic 14', rating: 17500 },
  { rarity: 'Iconic 15', rating: 19900 },
  { rarity: 'Iconic 16', rating: 22700 },
  { rarity: 'Iconic 17', rating: 26000 },
  { rarity: 'Iconic 18', rating: 29000 },
  { rarity: 'Iconic 19', rating: 34500 },
  { rarity: 'Iconic 20', rating: 40000 },
]

function normalizeRarityKey(rarityLabel: string): string {
  const parts = rarityLabel.trim().replace(/\s+/g, ' ').split(' ')
  const baseRaw = parts[0] ?? 'General'
  const base = baseRaw.charAt(0).toUpperCase() + baseRaw.slice(1).toLowerCase()
  if (!rarityLabel.trim() || base === 'General') return 'General'
  if (base === 'Common' || base === 'Uncommon' || base === 'Rare' || base === 'Epic') {
    return base
  }
  const level = parts.length > 1 ? Number.parseInt(parts[1]!, 10) : 1
  return `${base} ${Number.isFinite(level) ? level : 1}`
}

/** Minimum cumulative play rating for a rarity label. */
export function playRatingFloor(rarityLabel: string | undefined): number | null {
  if (!rarityLabel?.trim()) return null
  const key = normalizeRarityKey(rarityLabel)
  const match = PLAY_RATING_THRESHOLDS.find(
    (row) => row.rarity.toLowerCase() === key.toLowerCase(),
  )
  return match ? match.rating : null
}

/**
 * Absolute play rating from Real boost info.
 * `progress` is rating earned toward the next tier after the current rarity floor.
 */
export function absolutePlayRating(
  rarityLabel: string | undefined,
  progress: number | undefined | null,
): number | null {
  const floor = playRatingFloor(rarityLabel)
  if (floor === null) return null
  const gained =
    progress === undefined || progress === null || !Number.isFinite(Number(progress))
      ? 0
      : Math.max(0, Math.floor(Number(progress)))
  return floor + gained
}
