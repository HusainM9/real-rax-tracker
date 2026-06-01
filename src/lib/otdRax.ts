const DEFAULT_MULTIPLIERS: Record<string, Record<number, number>> = {
  General: { 1: 1 },
  Common: { 1: 2 },
  Uncommon: { 1: 3 },
  Rare: { 1: 4 },
  Epic: { 1: 10 },
  Legendary: { 1: 25, 2: 28, 3: 32, 4: 35, 5: 40 },
  Mystic: { 1: 75, 2: 79, 3: 83, 4: 87, 5: 91, 6: 95, 7: 98, 8: 101, 9: 103, 10: 105 },
  Iconic: {
    1: 150,
    2: 153,
    3: 156,
    4: 159,
    5: 163,
    6: 167,
    7: 171,
    8: 175,
    9: 180,
    10: 185,
    11: 190,
    12: 196,
    13: 202,
    14: 208,
    15: 214,
    16: 220,
    17: 226,
    18: 233,
    19: 240,
    20: 250,
  },
}

const UFC_MULTIPLIERS: Record<string, Record<number, number>> = {
  General: { 1: 1 },
  Common: { 1: 1.2 },
  Uncommon: { 1: 1.4 },
  Rare: { 1: 1.6 },
  Epic: { 1: 2 },
  Legendary: { 1: 5, 2: 5.4, 3: 5.8, 4: 6.2, 5: 6.6 },
  Mystic: {
    1: 10,
    2: 10.2,
    3: 10.4,
    4: 10.6,
    5: 10.8,
    6: 11,
    7: 11.2,
    8: 11.4,
    9: 11.6,
    10: 11.8,
  },
  Iconic: {
    1: 20,
    2: 20.3,
    3: 20.6,
    4: 20.9,
    5: 21.2,
    6: 21.5,
    7: 21.8,
    8: 22.1,
    9: 22.4,
    10: 22.7,
    11: 23,
    12: 23.3,
    13: 23.6,
    14: 23.9,
    15: 24.2,
    16: 24.5,
    17: 24.8,
    18: 25.1,
    19: 25.4,
    20: 25.7,
  },
}

/** https://docs.realapp.link/collect/team-cards — team pass OTD multipliers */
const TEAM_MULTIPLIERS: Record<string, Record<number, number>> = {
  General: { 1: 1 },
  Common: { 1: 1.2 },
  Uncommon: { 1: 1.4 },
  Rare: { 1: 1.6 },
  Epic: { 1: 2 },
  Legendary: { 1: 2.5 },
  Mystic: { 1: 4 },
  Iconic: { 1: 6 },
}

/** https://docs.realapp.link/collect/on-this-day — Team column OTD caps */
const TEAM_CAPS: Record<string, Record<number, number | null>> = {
  General: { 1: 800 },
  Common: { 1: 1500 },
  Uncommon: { 1: 2500 },
  Rare: { 1: 4000 },
  Epic: { 1: 6000 },
  Legendary: { 1: 12000 },
  Mystic: { 1: 24000 },
  Iconic: { 1: null },
}

const DEFAULT_CAPS: Record<string, Record<number, number | null>> = {
  General: { 1: 800 },
  Common: { 1: 1000 },
  Uncommon: { 1: 1500 },
  Rare: { 1: 2000 },
  Epic: { 1: 5000 },
  Legendary: { 1: 12500, 2: 14000, 3: 16000, 4: 17500, 5: 20000 },
  Mystic: {
    1: 37500,
    2: 39500,
    3: 41500,
    4: 43500,
    5: 45500,
    6: 47500,
    7: 49000,
    8: 50500,
    9: 51500,
    10: 52500,
  },
  Iconic: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [index + 1, null])),
}

export type OtdPassKind = 'player' | 'team'

export type ParsedRarity = {
  base: string
  level: number
}

export function parseRarityLabel(rarityLabel: string | undefined): ParsedRarity {
  if (!rarityLabel?.trim()) {
    return { base: 'General', level: 1 }
  }
  const parts = rarityLabel.trim().split(/\s+/)
  const base = parts[0] ?? 'General'
  const level = parts.length > 1 ? Number.parseInt(parts[1]!, 10) : 1
  return { base, level: Number.isFinite(level) ? level : 1 }
}

function isUfcSport(sport: string): boolean {
  return sport.trim().toUpperCase() === 'UFC'
}

function multiplierTable(
  sport: string,
  passKind: OtdPassKind,
): Record<string, Record<number, number>> {
  if (isUfcSport(sport)) return UFC_MULTIPLIERS
  if (passKind === 'team') return TEAM_MULTIPLIERS
  return DEFAULT_MULTIPLIERS
}

function capTable(
  sport: string,
  passKind: OtdPassKind,
): Record<string, Record<number, number | null>> | null {
  if (isUfcSport(sport)) return null
  if (passKind === 'team') return TEAM_CAPS
  return DEFAULT_CAPS
}

export function getOtdMultiplier(
  sport: string,
  rarityLabel: string | undefined,
  passKind: OtdPassKind = 'player',
): number {
  const rarity = parseRarityLabel(rarityLabel)
  const table = multiplierTable(sport, passKind)[rarity.base]
  return table?.[rarity.level] ?? table?.[1] ?? 1
}

export function getOtdCap(
  sport: string,
  rarityLabel: string | undefined,
  passKind: OtdPassKind = 'player',
): number | null {
  const table = capTable(sport, passKind)
  if (!table) return null
  const rarity = parseRarityLabel(rarityLabel)
  const cap = table[rarity.base]?.[rarity.level] ?? table[rarity.base]?.[1]
  return cap ?? null
}

export function computeOtdRax(
  baseRax: number,
  sport: string,
  rarityLabel: string | undefined,
  passKind: OtdPassKind = 'player',
): number {
  if (!Number.isFinite(baseRax) || baseRax <= 0) return 0
  const multiplier = getOtdMultiplier(sport, rarityLabel, passKind)
  const uncapped = baseRax * multiplier
  const cap = getOtdCap(sport, rarityLabel, passKind)
  if (cap != null && uncapped > cap) return cap
  return Math.round(uncapped)
}
