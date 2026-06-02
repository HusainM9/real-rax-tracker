import type { PlayerCard } from '../types/rax'

/** Real team OTD passes often use abbreviated names like "DEN Nuggets" or "Boise St". */
export function looksLikeTeamPassName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  if (/^team\s+\d+$/i.test(trimmed)) return true

  // City/airport code + mascot (e.g. DEN Nuggets, LAL Lakers, KC Chiefs).
  if (/^[A-Z]{2,4}\s+[A-Za-z]/.test(trimmed)) return true

  // College short form (e.g. Boise St, Ohio St).
  if (/^[A-Za-z]+(?:\s+[A-Za-z]+)*\sSt\.?$/i.test(trimmed)) return true

  return false
}

export function isTeamPass(card: Pick<PlayerCard, 'name' | 'passKind'>): boolean {
  if (card.passKind === 'team') return true
  if (card.passKind === 'player') return false
  return looksLikeTeamPassName(card.name)
}

export function isPlayerPass(card: Pick<PlayerCard, 'name' | 'passKind'>): boolean {
  return !isTeamPass(card)
}

export function isPlayerPassForSell(card: Pick<PlayerCard, 'name' | 'passKind'>): boolean {
  return isPlayerPass(card)
}
