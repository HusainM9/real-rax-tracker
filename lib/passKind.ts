export type ImportPassKind = 'player' | 'team'

/** UFC is stored under Real's entity/team shop path but fighters are individual athletes. */
export function isUfcCatalogSport(sport: string): boolean {
  return sport.trim().toUpperCase() === 'UFC'
}

/**
 * Player-like catalog rows for Potential / Entry search.
 * Includes UFC fighters even when `pass_kind` is still `team` from shop crawls.
 */
export function isPlayerLikeCatalogPass(pass: {
  passKind: ImportPassKind
  sport: string
}): boolean {
  if (pass.passKind === 'player') return true
  return pass.passKind === 'team' && isUfcCatalogSport(pass.sport)
}

/**
 * Which `pass_kind` values to request when listing catalog candidates for a sport.
 * UFC shop crawls write `team` (and may later write `player`); merge both.
 */
export function catalogCandidatePassKindsForSport(sport: string): ImportPassKind[] {
  return isUfcCatalogSport(sport) ? ['team', 'player'] : ['player']
}

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

function normalizeMeowbotSport(raw: string): string {
  const sport = raw.trim().toLowerCase()
  if (sport === 'soccer') return 'fc'
  return sport
}

function looksLikeFcTeamPassName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  // FC team passes often use club codes (MCI, ARS, LIV) or "MCI Card" style labels.
  if (/^[A-Z]{3}$/.test(trimmed)) return true
  if (/^[A-Z]{2,4}\s+Card$/i.test(trimmed)) return true
  return false
}

/** Correct Meowbot passKind for imports — prefer team when the label is clearly a team pass. */
export function resolveImportPassKind(input: {
  passKind?: ImportPassKind
  name?: string
  sportRaw?: string
  sport?: string
}): ImportPassKind {
  if (input.passKind === 'team') return 'team'

  const name = input.name?.trim() ?? ''
  const sportRaw = input.sportRaw?.trim() ?? ''
  const sportDisplay = input.sport?.trim() ?? ''
  const sport = normalizeMeowbotSport(sportRaw || sportDisplay)

  if (looksLikeTeamPassName(name)) return 'team'
  if (sport === 'fc' && looksLikeFcTeamPassName(name)) return 'team'

  return input.passKind ?? 'player'
}
