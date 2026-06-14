import type {
  CatalogDailyEarningInput,
  CatalogPassInput,
  CatalogPassKind,
} from './meowbotCatalogStore'
import { importSeasonLabelForCatalog, normalizeSportForSeasonWindow, buildCatalogExternalKey } from './seasonClaimWindow'

const DEFAULT_SUPABASE_URL = 'https://mfsyhtuqybbxprgwwykd.supabase.co'
const DEFAULT_SUPABASE_KEY = 'sb_publishable_Al7QsFGnNTlknoI8KVxjag_JUwrytZy'
const DEFAULT_CONCURRENCY = 8

type MeowbotPassSnapshot = {
  entityId: number
  season: number
  sport: string
  label: string
  rarityLabel: string
}

type ImportPass = {
  entityId: number
  seasonYear: number
  sportRaw: string
  sport: string
  seasonLabel: string
  name: string
  rarityLabel?: string
  passKind: CatalogPassKind
  externalKey: string
}

export type MeowbotCatalogImportSummary = {
  passesScanned: number
  passesUpserted: number
  rowsUpserted: number
  passesWithNoEarnings: number
  failures: string[]
  passes: CatalogPassInput[]
  dailyEarnings: CatalogDailyEarningInput[]
}

export type OtdTableImportOptions = {
  seasons: number[]
  includePlayers?: boolean
  includeTeams?: boolean
  sport?: string
  limit?: number
}

function meowbotUrl(): string {
  return (
    process.env.MEOWBOT_SUPABASE_URL?.trim() ||
    process.env.VITE_MEOWBOT_SUPABASE_URL?.trim() ||
    DEFAULT_SUPABASE_URL
  ).replace(/\/$/, '')
}

function meowbotKey(): string {
  return (
    process.env.MEOWBOT_SUPABASE_KEY?.trim() ||
    process.env.VITE_MEOWBOT_SUPABASE_KEY?.trim() ||
    DEFAULT_SUPABASE_KEY
  )
}

async function invokeMeowbot(functionName: string, action: string, payload: unknown): Promise<unknown> {
  const response = await fetch(`${meowbotUrl()}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${meowbotKey()}`,
    },
    body: JSON.stringify({ action, payload }),
  })
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok || data?.error) {
    throw new Error(data?.error || `Meowbot request failed (${response.status}).`)
  }
  return data
}

function normalizeSport(raw: string): string {
  const sport = raw.trim().toLowerCase()
  if (sport === 'ncaab' || sport === 'ncaa-mens-basketball') return 'ncaam'
  if (sport === 'ncaafootball' || sport === 'ncaa-football' || sport === 'cfb') return 'ncaaf'
  return sport
}

function isCalendarYearSport(raw: string): boolean {
  const sport = normalizeSport(raw)
  return sport === 'ufc' || sport === 'golf' || sport === 'mlb' || sport === 'wnba'
}

function isCollegeSport(raw: string): boolean {
  const sport = normalizeSport(raw)
  return sport === 'ncaaf' || sport === 'ncaam'
}

function seasonLabelFromPass(seasonYear: number, sportRaw: string): string {
  if (!Number.isInteger(seasonYear) || seasonYear < 1000) return String(seasonYear)
  if (isCollegeSport(sportRaw)) return `${seasonYear}-${String(seasonYear + 1).slice(-2)}`
  if (isCalendarYearSport(sportRaw)) return String(seasonYear)
  return `${seasonYear - 1}-${String(seasonYear).slice(-2)}`
}

function displaySport(raw: string): string {
  switch (normalizeSport(raw)) {
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

function rawSportFromDisplay(sport: string): string {
  switch (sport.trim().toUpperCase()) {
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
    case 'GOLF':
      return 'golf'
    case 'FC':
      return 'fc'
    case 'UFC':
      return 'ufc'
    default:
      return sport.trim().toLowerCase()
  }
}

function externalKey(entityId: number, seasonYear: number, sport: string): string {
  return `${entityId}|${seasonYear}|${sport}`
}

/** Real end-year/start-year encoding for catalog import. season_year from discovery/admin is authoritative. */
export function canonicalizeImportPass(pass: ImportPass): ImportPass {
  const sport = normalizeSportForSeasonWindow(pass.sport)
  const seasonYear = pass.seasonYear
  const seasonLabel = importSeasonLabelForCatalog(pass.sport, seasonYear, pass.seasonLabel)
  return {
    ...pass,
    sport,
    seasonYear,
    seasonLabel,
    externalKey: buildCatalogExternalKey(pass.entityId, seasonYear, sport),
  }
}

function parsePair(pair: string, passKind: CatalogPassKind): ImportPass | null {
  const parts = pair.split(':')
  if (parts.length < 3) return null
  const entityId = Number(parts[0])
  const seasonYear = Number(parts[1])
  const sportRaw = parts.slice(2).join(':')
  if (!Number.isFinite(entityId) || !Number.isFinite(seasonYear) || !sportRaw) return null
  const sport = displaySport(sportRaw)
  return {
    entityId,
    seasonYear,
    sportRaw,
    sport,
    seasonLabel: seasonLabelFromPass(seasonYear, sportRaw),
    name: passKind === 'team' ? `Team ${entityId}` : `Player ${entityId}`,
    passKind,
    externalKey: externalKey(entityId, seasonYear, sport),
  }
}

function snapshotKey(entityId: number, seasonYear: number, sportRaw: string): string {
  return `${entityId}-${seasonYear}-${normalizeSport(sportRaw)}`
}

function metadataKey(entityId: number, seasonYear: number, sportRaw: string): string {
  return `${entityId}|${seasonYear}|${normalizeSport(sportRaw)}`
}

async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      if (item !== undefined) await worker(item)
    }
  })
  await Promise.all(workers)
}

async function resolveUsernamePasses(username: string): Promise<ImportPass[]> {
  const data = (await invokeMeowbot('resolve-listing', 'get_user_passes', {
    username: username.replace(/^@/, '').trim(),
  })) as {
    playerPairs?: string[]
    teamPairs?: string[]
    passSnapshots?: MeowbotPassSnapshot[]
  }

  const snapshots = new Map(
    (data.passSnapshots ?? []).map((snapshot) => [
      snapshotKey(snapshot.entityId, snapshot.season, snapshot.sport),
      snapshot,
    ]),
  )
  const passes = [
    ...(data.playerPairs ?? []).map((pair) => parsePair(pair, 'player')),
    ...(data.teamPairs ?? []).map((pair) => parsePair(pair, 'team')),
  ].filter((pass): pass is ImportPass => pass !== null)

  for (const pass of passes) {
    const snapshot = snapshots.get(snapshotKey(pass.entityId, pass.seasonYear, pass.sportRaw))
    if (!snapshot) continue
    pass.name = snapshot.label || pass.name
    pass.rarityLabel = snapshot.rarityLabel || undefined
  }

  return enrichPassMetadata(passes)
}

async function getAvailableMeowbotSeasons(): Promise<number[]> {
  const data = (await invokeMeowbot('market-data', 'get_available_seasons', {})) as {
    seasons?: unknown[]
  }
  return (data.seasons ?? [])
    .map((season) => Number(season))
    .filter((season) => Number.isFinite(season) && season > 0)
    .sort((a, b) => b - a)
}

async function discoverOtdTablePasses(options: OtdTableImportOptions): Promise<ImportPass[]> {
  const seasons = options.seasons.length > 0 ? options.seasons : await getAvailableMeowbotSeasons()
  const sportFilter = options.sport?.trim().toLowerCase()
  const passes = new Map<string, ImportPass>()

  if (options.includePlayers !== false) {
    const data = (await invokeMeowbot('market-data', 'get_otd_earnings_table', { seasons })) as {
      rows?: Array<{
        entityId?: number
        playerName?: string
        season?: number
        seasonLabel?: string | null
        sport?: string
      }>
    }
    for (const row of data.rows ?? []) {
      const entityId = Number(row.entityId)
      const seasonYear = Number(row.season)
      const sportRaw = String(row.sport ?? '')
      if (!Number.isFinite(entityId) || !Number.isFinite(seasonYear) || !sportRaw) continue
      if (sportFilter && normalizeSport(sportRaw) !== normalizeSport(sportFilter)) continue
      const sport = displaySport(sportRaw)
      const pass: ImportPass = {
        entityId,
        seasonYear,
        sportRaw,
        sport,
        seasonLabel: row.seasonLabel?.trim() || seasonLabelFromPass(seasonYear, sportRaw),
        name: String(row.playerName ?? `Player ${entityId}`),
        passKind: 'player',
        externalKey: externalKey(entityId, seasonYear, sport),
      }
      passes.set(`player|${pass.externalKey}`, pass)
    }
  }

  if (options.includeTeams !== false) {
    const data = (await invokeMeowbot('market-data', 'get_team_otd_earnings_table', { seasons })) as {
      rows?: Array<{
        entityId?: number
        teamName?: string
        season?: number
        seasonLabel?: string | null
        sport?: string
      }>
    }
    for (const row of data.rows ?? []) {
      const entityId = Number(row.entityId)
      const seasonYear = Number(row.season)
      const sportRaw = String(row.sport ?? '')
      if (!Number.isFinite(entityId) || !Number.isFinite(seasonYear) || !sportRaw) continue
      if (sportFilter && normalizeSport(sportRaw) !== normalizeSport(sportFilter)) continue
      const sport = displaySport(sportRaw)
      const pass: ImportPass = {
        entityId,
        seasonYear,
        sportRaw,
        sport,
        seasonLabel: row.seasonLabel?.trim() || seasonLabelFromPass(seasonYear, sportRaw),
        name: String(row.teamName ?? `Team ${entityId}`),
        passKind: 'team',
        externalKey: externalKey(entityId, seasonYear, sport),
      }
      passes.set(`team|${pass.externalKey}`, pass)
    }
  }

  const discovered = [...passes.values()]
  return Number.isFinite(options.limit) && options.limit && options.limit > 0
    ? discovered.slice(0, options.limit)
    : discovered
}

async function enrichPassMetadata(passes: ImportPass[]): Promise<ImportPass[]> {
  if (passes.length === 0) return []
  const playerPairs = passes
    .filter((pass) => pass.passKind === 'player' || normalizeSport(pass.sportRaw) === 'ufc')
    .map((pass) => `${pass.entityId}:${pass.seasonYear}:${pass.sportRaw}`)
  const teamPairs = passes
    .filter((pass) => pass.passKind === 'team' && normalizeSport(pass.sportRaw) !== 'ufc')
    .map((pass) => `${pass.entityId}:${pass.seasonYear}:${pass.sportRaw}`)
  const entityIds = [...new Set(passes.map((pass) => pass.entityId))]

  const data = (await invokeMeowbot('market-data', 'get_user_otd_data', {
    entityIds,
    playerPairs,
    teamPairs,
  })) as {
    playerRows?: Array<{ entityId: number; season: number; sport: string; seasonLabel: string; playerName: string }>
    teamRows?: Array<{ entityId: number; season: number; sport: string; seasonLabel: string; teamName: string }>
  }
  const names = new Map<string, { name: string; seasonLabel: string }>()
  for (const row of data.playerRows ?? []) {
    names.set(metadataKey(row.entityId, row.season, row.sport), {
      name: row.playerName,
      seasonLabel: row.seasonLabel,
    })
  }
  for (const row of data.teamRows ?? []) {
    names.set(metadataKey(row.entityId, row.season, row.sport), {
      name: row.teamName,
      seasonLabel: row.seasonLabel,
    })
  }

  return passes.map((pass) => {
    const metadata = names.get(metadataKey(pass.entityId, pass.seasonYear, pass.sportRaw))
    return metadata
      ? {
          ...pass,
          name: metadata.name || pass.name,
          seasonLabel: metadata.seasonLabel?.trim() || pass.seasonLabel,
        }
      : pass
  })
}

async function fetchDailyRows(pass: ImportPass): Promise<CatalogDailyEarningInput[]> {
  const canonicalPass = canonicalizeImportPass(pass)
  const data = (await invokeMeowbot(
    'market-data',
    canonicalPass.passKind === 'team' ? 'get_team_daily_earnings' : 'get_daily_earnings',
    {
      entityId: canonicalPass.entityId,
      season: canonicalPass.seasonYear,
      sport: normalizeSport(canonicalPass.sportRaw),
      seasonLabel: canonicalPass.seasonLabel,
    },
  )) as { rows?: Array<{ day?: string; earnings?: number; player_box_score_id?: number | null }> }

  const rows = (data.rows ?? [])
    .map((row) => ({
      externalKey: canonicalPass.externalKey,
      claimDay: /^(\d{4}-\d{2}-\d{2})/.exec(row.day ?? '')?.[1] ?? '',
      baseRaxEarned: Number(row.earnings),
      playerBoxScoreId: row.player_box_score_id ?? null,
    }))
    .filter(
      (row) =>
        row.claimDay &&
        Number.isFinite(row.baseRaxEarned) &&
        row.baseRaxEarned > 0,
    )

  return rows
}

function passToCatalogInput(
  pass: ImportPass,
  hasEarnings: boolean,
  totalBaseRax: number,
): CatalogPassInput {
  return {
    externalKey: pass.externalKey,
    entityId: pass.entityId,
    passKind: pass.passKind,
    sport: pass.sport,
    seasonYear: pass.seasonYear,
    seasonLabel: pass.seasonLabel,
    name: pass.name,
    rarityLabel: pass.rarityLabel,
    hasEarnings,
    totalBaseRax,
    sourceUpdatedAt: new Date().toISOString(),
  }
}

export async function fetchMeowbotUsernamePasses(username: string): Promise<ImportPass[]> {
  return resolveUsernamePasses(username)
}

export async function importMeowbotUsernameToCatalog(username: string): Promise<MeowbotCatalogImportSummary> {
  const passes = await resolveUsernamePasses(username)
  return importPassesToCatalogPayload(passes)
}

export async function importSpecificMeowbotPassToCatalog(input: {
  entityId: number
  seasonYear: number
  sport: string
  passKind: CatalogPassKind
  name?: string
  rarityLabel?: string
  seasonLabel?: string
}): Promise<MeowbotCatalogImportSummary> {
  const sportRaw = rawSportFromDisplay(input.sport)
  const sport = displaySport(sportRaw)
  const pass: ImportPass = canonicalizeImportPass({
    entityId: input.entityId,
    seasonYear: input.seasonYear,
    sportRaw,
    sport,
    seasonLabel: input.seasonLabel?.trim() || seasonLabelFromPass(input.seasonYear, sportRaw),
    name: input.name?.trim() || (input.passKind === 'team' ? `Team ${input.entityId}` : `Player ${input.entityId}`),
    rarityLabel: input.rarityLabel?.trim() || undefined,
    passKind: input.passKind,
    externalKey: externalKey(input.entityId, input.seasonYear, sport),
  })
  const [enriched] = await enrichPassMetadata([pass])
  return importPassesToCatalogPayload([canonicalizeImportPass(enriched ?? pass)])
}

export async function importOtdTablePassesToCatalog(
  options: OtdTableImportOptions,
): Promise<MeowbotCatalogImportSummary> {
  const passes = await discoverOtdTablePasses(options)
  return importPassesToCatalogPayload(passes)
}

async function importPassesToCatalogPayload(passes: ImportPass[]): Promise<MeowbotCatalogImportSummary> {
  const catalogPasses = new Map<string, CatalogPassInput>()
  const dailyEarnings: CatalogDailyEarningInput[] = []
  const failures: string[] = []
  let passesWithNoEarnings = 0

  await runWithConcurrency(passes, async (pass) => {
    try {
      const canonicalPass = canonicalizeImportPass(pass)
      const rows = await fetchDailyRows(pass)
      if (rows.length === 0) {
        passesWithNoEarnings += 1
        catalogPasses.set(canonicalPass.externalKey, passToCatalogInput(canonicalPass, false, 0))
        return
      }
      const totalBaseRax = rows.reduce((sum, row) => sum + row.baseRaxEarned, 0)
      catalogPasses.set(canonicalPass.externalKey, passToCatalogInput(canonicalPass, true, totalBaseRax))
      dailyEarnings.push(...rows)
    } catch (error) {
      failures.push(`${pass.name}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  })

  return {
    passesScanned: passes.length,
    passesUpserted: catalogPasses.size,
    rowsUpserted: dailyEarnings.length,
    passesWithNoEarnings,
    failures,
    passes: [...catalogPasses.values()],
    dailyEarnings,
  }
}

