import type { PlayerCard } from '../types/rax'
import {
  catalogCandidatePassKindsForSport,
  isPlayerLikeCatalogPass,
  isUfcCatalogSport,
  looksLikeTeamPassName as sharedLooksLikeTeamPassName,
  resolveImportPassKind,
} from '../../lib/passKind'

export { catalogCandidatePassKindsForSport, isPlayerLikeCatalogPass, isUfcCatalogSport }
export { resolveImportPassKind }
export { sharedLooksLikeTeamPassName as looksLikeTeamPassName }

export function isTeamPass(
  card: Pick<PlayerCard, 'name' | 'passKind'> & { sport?: string },
): boolean {
  // UFC fighters may still be stored/imported as pass_kind=team from Real's shop path.
  if (card.sport && isUfcCatalogSport(card.sport)) return false
  if (card.passKind === 'team') return true
  if (card.passKind === 'player') return false
  return sharedLooksLikeTeamPassName(card.name)
}

export function isPlayerPass(
  card: Pick<PlayerCard, 'name' | 'passKind'> & { sport?: string },
): boolean {
  return !isTeamPass(card)
}

export function isPlayerPassForSell(
  card: Pick<PlayerCard, 'name' | 'passKind'> & { sport?: string },
): boolean {
  return isPlayerPass(card)
}
