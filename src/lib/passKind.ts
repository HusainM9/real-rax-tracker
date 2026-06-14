import type { PlayerCard } from '../types/rax'
import {
  looksLikeTeamPassName as sharedLooksLikeTeamPassName,
  resolveImportPassKind,
} from '../../lib/passKind'

export { resolveImportPassKind }
export { sharedLooksLikeTeamPassName as looksLikeTeamPassName }

export function isTeamPass(card: Pick<PlayerCard, 'name' | 'passKind'>): boolean {
  if (card.passKind === 'team') return true
  if (card.passKind === 'player') return false
  return sharedLooksLikeTeamPassName(card.name)
}

export function isPlayerPass(card: Pick<PlayerCard, 'name' | 'passKind'>): boolean {
  return !isTeamPass(card)
}

export function isPlayerPassForSell(card: Pick<PlayerCard, 'name' | 'passKind'>): boolean {
  return isPlayerPass(card)
}
