export type SeasonYearKind = 'end' | 'start' | 'calendar'

const RAW_SPORT_MAP: Record<string, string> = {
  nba: 'NBA',
  wnba: 'WNBA',
  nfl: 'NFL',
  ncaaf: 'CFB',
  cfb: 'CFB',
  mlb: 'MLB',
  nhl: 'NHL',
  ncaam: 'CBB',
  cbb: 'CBB',
  golf: 'Golf',
  fc: 'FC',
  soccer: 'FC',
  ufc: 'UFC',
}

export function normalizeSportForSeasonWindow(sport: string): string {
  const trimmed = sport.trim()
  if (!trimmed) return 'Other'
  return RAW_SPORT_MAP[trimmed.toLowerCase()] ?? trimmed.toUpperCase()
}

function isCalendarYearSportNormalized(normalized: string): boolean {
  const upper = normalized.toUpperCase()
  return upper === 'MLB' || upper === 'WNBA' || upper === 'GOLF' || upper === 'UFC'
}

/**
 * Sports where Real's `season` is the season's first calendar year.
 * Confirmed from live Real `season` + `seasonDisplay` probes:
 * - NFL/NHL/CFB/FC: start-year (e.g. NFL `2024` + `"2024-25"`)
 * - NBA/CBB: end-year (handled by the default below)
 */
function isStartYearSportNormalized(normalized: string): boolean {
  const upper = normalized.toUpperCase()
  return upper === 'NFL' || upper === 'NHL' || upper === 'CFB' || upper === 'FC'
}

/** How Real encodes `season_year` on a pass for each sport. */
export function seasonYearKindForSport(sport: string): SeasonYearKind {
  const normalized = normalizeSportForSeasonWindow(sport)
  if (isCalendarYearSportNormalized(normalized)) {
    return 'calendar'
  }
  if (isStartYearSportNormalized(normalized)) {
    return 'start'
  }
  return 'end'
}

export type PassSeasonDateWindow = {
  start: string
  end: string
}

export type SplitSeasonLabel = {
  startYear: number
  endYear: number
}

/** Parse labels like `2024-25` into calendar start/end years. */
export function parseSplitSeasonLabel(seasonLabel: string): SplitSeasonLabel | null {
  const match = /^(\d{4})-(\d{2})$/.exec(seasonLabel.trim())
  if (!match) return null
  const startYear = Number(match[1])
  const endSuffix = Number(match[2])
  if (!Number.isInteger(startYear) || startYear < 1000) return null
  let endYear = Math.floor(startYear / 100) * 100 + endSuffix
  if (endYear <= startYear) endYear += 100
  return { startYear, endYear }
}

export function passSeasonDateWindowFromLabel(
  seasonLabel: string,
  sport: string,
): PassSeasonDateWindow | null {
  const trimmed = seasonLabel.trim().replace(/\u2013|\u2014/g, '-')
  const calendarYear = /^(\d{4})$/.exec(trimmed)
  if (calendarYear) {
    const year = Number(calendarYear[1])
    if (Number.isInteger(year) && year >= 1000) {
      return { start: `${year}-01-01`, end: `${year}-12-31` }
    }
  }

  const split = parseSplitSeasonLabel(trimmed)
  if (!split) return null

  const normalized = normalizeSportForSeasonWindow(sport)
  if (normalized === 'CBB' || normalized === 'CFB') {
    return { start: `${split.startYear}-08-01`, end: `${split.endYear}-06-30` }
  }
  if (normalized === 'NFL') {
    return { start: `${split.startYear}-08-01`, end: `${split.endYear}-04-30` }
  }
  if (normalized === 'NHL') {
    return { start: `${split.startYear}-08-01`, end: `${split.endYear}-06-30` }
  }
  return { start: `${split.startYear}-08-01`, end: `${split.endYear}-07-31` }
}

/** Inclusive YYYY-MM-DD window for claim days that belong on this pass. */
export function passSeasonDateWindow(seasonYear: number, sport: string): PassSeasonDateWindow | null {
  if (!Number.isInteger(seasonYear) || seasonYear < 1000) return null

  switch (seasonYearKindForSport(sport)) {
    case 'calendar':
      return { start: `${seasonYear}-01-01`, end: `${seasonYear}-12-31` }
    case 'start': {
      const normalized = normalizeSportForSeasonWindow(sport)
      if (normalized === 'NFL') return { start: `${seasonYear}-08-01`, end: `${seasonYear + 1}-04-30` }
      if (normalized === 'NHL') return { start: `${seasonYear}-08-01`, end: `${seasonYear + 1}-06-30` }
      return { start: `${seasonYear}-08-01`, end: `${seasonYear + 1}-06-30` }
    }
    case 'end': {
      const normalized = normalizeSportForSeasonWindow(sport)
      if (normalized === 'CBB') return { start: `${seasonYear - 1}-08-01`, end: `${seasonYear}-06-30` }
      return { start: `${seasonYear - 1}-08-01`, end: `${seasonYear}-07-31` }
    }
  }
}

/** Prefer a parsed season label (`2024-25`) over season_year when both are present. */
export function resolvePassSeasonDateWindow(
  seasonYear: number,
  sport: string,
  seasonLabel?: string,
): PassSeasonDateWindow | null {
  if (seasonLabel?.trim()) {
    const fromLabel = passSeasonDateWindowFromLabel(seasonLabel, sport)
    if (fromLabel) return fromLabel
  }
  return passSeasonDateWindow(seasonYear, sport)
}

/** Canonical season_year for a pass — corrects common catalog mismatches like label `2024-25` with year `2024`. */
export function resolveCatalogPassSeasonYear(
  seasonYear: number,
  seasonLabel: string,
  sport: string,
): number {
  const split = parseSplitSeasonLabel(seasonLabel)
  if (!split) return seasonYear
  const canonical = seasonYearKindForSport(sport) === 'start' ? split.startYear : split.endYear
  return canonical
}

/** Expected display label for a stored season_year (Real / Meowbot conventions). */
export function expectedSeasonLabelFromYear(seasonYear: number, sport: string): string {
  if (!Number.isInteger(seasonYear) || seasonYear < 1000) return String(seasonYear)
  switch (seasonYearKindForSport(sport)) {
    case 'calendar':
      return String(seasonYear)
    case 'start':
      return `${seasonYear}-${String(seasonYear + 1).slice(-2)}`
    case 'end':
      return `${seasonYear - 1}-${String(seasonYear).slice(-2)}`
  }
}

export function sportSkipsClaimDaySeasonFilter(sport: string): boolean {
  const normalized = normalizeSportForSeasonWindow(sport)
  // FC spans competitions; UFC Real season 2023 is an All-time sentinel (not a calendar year).
  return normalized === 'FC' || normalized === 'UFC'
}

/** Label used when fetching/importing earnings — aligned split labels are kept; others use canonical season_year. */
export function importSeasonLabelForCatalog(
  sport: string,
  seasonYear: number,
  seasonLabel?: string,
): string {
  const incoming = seasonLabel?.replace(/\u2013|\u2014/g, '-').trim() ?? ''
  const expected = expectedSeasonLabelFromYear(seasonYear, sport)
  if (!incoming) return expected

  if (
    parseSplitSeasonLabel(incoming) &&
    resolveCatalogPassSeasonYear(seasonYear, incoming, sport) === seasonYear
  ) {
    return incoming
  }

  return expected
}

/** @deprecated Use resolveUsernameImportSeasonLabel from usernameImportShared. */
export function ownershipImportSeasonLabel(
  sport: string,
  seasonYear: number,
  seasonLabel?: string,
): string {
  const normalized = normalizeSportForSeasonWindow(sport)
  if (isCalendarYearSportNormalized(normalized)) {
    return String(seasonYear)
  }

  const incoming = seasonLabel?.replace(/\u2013|\u2014/g, '-').trim() ?? ''
  if (incoming) return incoming

  return expectedSeasonLabelFromYear(seasonYear, sport)
}

export function buildCatalogExternalKey(
  entityId: number,
  seasonYear: number,
  sport: string,
): string {
  return `${entityId}|${seasonYear}|${normalizeSportForSeasonWindow(sport)}`
}

/** Try every likely catalog key — listing season_year often differs from stored canonical keys. */
export function catalogExternalKeyCandidates(input: {
  entityId: number
  sport: string
  seasonYear: number
  seasonLabel?: string
}): string[] {
  const sport = normalizeSportForSeasonWindow(input.sport)
  const seasonLabel = input.seasonLabel?.replace(/\u2013|\u2014/g, '-').trim() ?? ''
  const keys = new Set<string>()

  keys.add(buildCatalogExternalKey(input.entityId, input.seasonYear, sport))

  if (seasonLabel) {
    keys.add(
      buildCatalogExternalKey(
        input.entityId,
        resolveCatalogPassSeasonYear(input.seasonYear, seasonLabel, sport),
        sport,
      ),
    )
  }

  const catalogLabel = importSeasonLabelForCatalog(sport, input.seasonYear, seasonLabel)
  keys.add(
    buildCatalogExternalKey(
      input.entityId,
      resolveCatalogPassSeasonYear(input.seasonYear, catalogLabel, sport),
      sport,
    ),
  )

  return [...keys]
}

export function canonicalCatalogPassMetadata(input: {
  entityId: number
  sport: string
  seasonYear: number
  seasonLabel: string
}): {
  seasonYear: number
  seasonLabel: string
  externalKey: string
  aligned: boolean
} {
  const sport = normalizeSportForSeasonWindow(input.sport)
  const kind = seasonYearKindForSport(input.sport)
  const incomingLabel = input.seasonLabel.trim().replace(/\u2013|\u2014/g, '-')

  // End-year / calendar: Real `season_year` is authoritative. Old CBB start-year labels
  // (season 2026 stored as "2026-27") must rewrite the label — not bump the year to 2027.
  if (kind === 'end' || kind === 'calendar') {
    const seasonYear = input.seasonYear
    const seasonLabel = expectedSeasonLabelFromYear(seasonYear, input.sport)
    const externalKey = buildCatalogExternalKey(input.entityId, seasonYear, sport)
    const aligned =
      incomingLabel === seasonLabel &&
      buildCatalogExternalKey(input.entityId, input.seasonYear, sport) === externalKey
    return { seasonYear, seasonLabel, externalKey, aligned }
  }

  // Start-year sports: prefer a parsed label when season_year still uses old end-year keys.
  const seasonYear = resolveCatalogPassSeasonYear(input.seasonYear, input.seasonLabel, input.sport)
  const seasonLabel = expectedSeasonLabelFromYear(seasonYear, input.sport)
  const externalKey = buildCatalogExternalKey(input.entityId, seasonYear, sport)
  const aligned =
    input.seasonYear === seasonYear &&
    incomingLabel === seasonLabel &&
    buildCatalogExternalKey(input.entityId, input.seasonYear, sport) === externalKey
  return { seasonYear, seasonLabel, externalKey, aligned }
}

export function isCatalogSeasonMetadataAligned(
  seasonYear: number,
  seasonLabel: string,
  sport: string,
): boolean {
  const trimmed = seasonLabel.trim().replace(/\u2013|\u2014/g, '-')
  return canonicalCatalogPassMetadata({ entityId: 0, sport, seasonYear, seasonLabel: trimmed }).aligned &&
    seasonYear === resolveCatalogPassSeasonYear(seasonYear, trimmed, sport)
}

export function claimDayDateValue(claimDay: string): string | null {
  return /^(\d{4}-\d{2}-\d{2})/.exec(claimDay.trim())?.[1] ?? null
}

export function claimDayInPassSeason(
  claimDay: string,
  seasonYear: number,
  sport: string,
  seasonLabel?: string,
): boolean {
  if (sportSkipsClaimDaySeasonFilter(sport)) return true

  const window = resolvePassSeasonDateWindow(seasonYear, sport, seasonLabel)
  if (!window) return true
  const date = claimDayDateValue(claimDay)
  if (!date) return true
  return date >= window.start && date <= window.end
}

export function filterDailyRowsToPassSeason<
  T extends { claimDay: string },
>(rows: T[], seasonYear: number, sport: string, seasonLabel?: string): T[] {
  return rows.filter((row) => claimDayInPassSeason(row.claimDay, seasonYear, sport, seasonLabel))
}
