import {
  expectedSeasonLabelFromYear,
  normalizeSportForSeasonWindow,
  seasonYearKindForSport,
} from './seasonClaimWindow'

function normalizeMeowbotSport(raw: string): string {
  const sport = raw.trim().toLowerCase()
  if (sport === 'ncaab' || sport === 'ncaa-mens-basketball') return 'ncaam'
  if (sport === 'ncaafootball' || sport === 'ncaa-football' || sport === 'cfb') return 'ncaaf'
  return sport
}

export function isCalendarYearSportRaw(sportRaw: string): boolean {
  return seasonYearKindForSport(normalizeMeowbotSport(sportRaw)) === 'calendar'
}

export function displaySportFromRaw(raw: string): string {
  switch (normalizeMeowbotSport(raw)) {
    case 'nba':
      return 'NBA'
    case 'wnba':
      return 'WNBA'
    case 'nfl':
      return 'NFL'
    case 'ncaaf':
      return 'CFB'
    case 'mlb':
      return 'MLB'
    case 'nhl':
      return 'NHL'
    case 'ncaam':
      return 'CBB'
    case 'golf':
      return 'Golf'
    case 'fc':
    case 'soccer':
      return 'FC'
    case 'ufc':
      return 'UFC'
    default:
      return 'Other'
  }
}

/** Single source of truth for season-year encoding lives in seasonClaimWindow. */
export function seasonLabelFromSportRaw(seasonYear: number, sportRaw: string): string {
  return expectedSeasonLabelFromYear(seasonYear, normalizeMeowbotSport(sportRaw))
}

/** Same season label rules for live username import and admin ownership snapshots. */
export function resolveUsernameImportSeasonLabel(input: {
  sportRaw: string
  seasonYear: number
  otdSeasonLabel?: string | null
  passSeasonLabel?: string | null
}): string {
  if (isCalendarYearSportRaw(input.sportRaw)) {
    return String(input.seasonYear)
  }

  const normalizedOtd = input.otdSeasonLabel?.replace(/\u2013|\u2014/g, '-').trim()
  const normalizedPass = input.passSeasonLabel?.replace(/\u2013|\u2014/g, '-').trim()
  const label = normalizedOtd ?? normalizedPass
  if (label) return label

  return seasonLabelFromSportRaw(input.seasonYear, input.sportRaw)
}

export function usernameImportExternalKey(
  entityId: number,
  seasonYear: number,
  sportRaw: string,
): string {
  const sport = displaySportFromRaw(sportRaw)
  return `${entityId}|${seasonYear}|${normalizeSportForSeasonWindow(sport)}`
}

export function usernameImportPassDedupeKey(input: {
  passKind: 'player' | 'team'
  entityId: number
  seasonYear: number
  sportRaw: string
}): string {
  return `${input.passKind}|${input.entityId}:${input.seasonYear}:${input.sportRaw}`
}

export function uniqueUsernameImportPasses<T extends {
  passKind: 'player' | 'team'
  entityId: number
  seasonYear: number
  sportRaw: string
}>(passes: T[]): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const pass of passes) {
    const key = usernameImportPassDedupeKey(pass)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(pass)
  }
  return unique
}
