import type { MeowbotPassKind } from './meowbotApi'
import { computeOtdRax, getOtdMultiplier } from './otdRax'
import type { PlayerCard, RaxPerformance, Sport } from '../types/rax'

export function sportToMeowbotSlug(sport: Sport): string {
  switch (sport) {
    case 'NBA':
      return 'nba'
    case 'WNBA':
      return 'wnba'
    case 'NFL':
      return 'nfl'
    case 'CFB':
      return 'ncaaf'
    case 'MLB':
      return 'mlb'
    case 'NHL':
      return 'nhl'
    case 'CBB':
      return 'ncaam'
    case 'Golf':
      return 'golf'
    case 'FC':
      return 'soccer'
    case 'UFC':
      return 'ufc'
    default:
      return 'other'
  }
}

export function rarityLabelFromNotes(notes: string): string | undefined {
  const match = notes.match(
    / · ((?:General|Common|Uncommon|Rare|Epic|Legendary|Mystic|Iconic)(?: \d+)?)$/,
  )
  return match?.[1]
}

function estimateBaseRax(performance: RaxPerformance, card: PlayerCard): number | null {
  if (performance.baseRaxEarned != null && performance.baseRaxEarned > 0) {
    return performance.baseRaxEarned
  }
  if (!card.rarityLabel?.trim()) return null
  const sport = sportToMeowbotSlug(card.sport)
  const passKind = card.passKind ?? 'player'
  const multiplier = getOtdMultiplier(sport, card.rarityLabel, passKind)
  if (multiplier <= 0) return null
  return performance.raxEarned / multiplier
}

/** Raw stat RAX before OTD rarity multipliers — unaffected by rarity preview. */
export function getBaseRaxEarned(performance: RaxPerformance, card: PlayerCard): number {
  const base = estimateBaseRax(performance, card)
  if (base != null && base > 0) return base
  return performance.raxEarned
}

export function getEffectiveRaxEarned(performance: RaxPerformance, card: PlayerCard): number {
  const previewRarity = card.simulatedRarityLabel?.trim()
  if (!previewRarity) return performance.raxEarned

  const base = estimateBaseRax(performance, card)
  if (base == null || base <= 0) return performance.raxEarned

  const sport = sportToMeowbotSlug(card.sport)
  const passKind = card.passKind ?? 'player'
  return computeOtdRax(base, sport, previewRarity, passKind)
}

export function withEffectiveRax(performance: RaxPerformance, card: PlayerCard): RaxPerformance {
  const raxEarned = getEffectiveRaxEarned(performance, card)
  if (raxEarned === performance.raxEarned) return performance
  return { ...performance, raxEarned }
}

export const RARITY_PREVIEW_OPTIONS = [
  '',
  'General 1',
  'Common 1',
  'Uncommon 1',
  'Rare 1',
  'Epic 1',
  'Legendary 1',
  'Legendary 5',
  'Mystic 1',
  'Mystic 5',
  'Mystic 10',
  'Iconic 1',
  'Iconic 5',
  'Iconic 10',
  'Iconic 20',
] as const

export type { MeowbotPassKind }
