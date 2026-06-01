import type { Sport } from '../types/rax'
import { seasonLabelFromPass } from './seasonLabel'

const DEFAULT_SUPABASE_URL = 'https://mfsyhtuqybbxprgwwykd.supabase.co'
const DEFAULT_SUPABASE_KEY = 'sb_publishable_Al7QsFGnNTlknoI8KVxjag_JUwrytZy'

export type MeowbotUser = {
  userId: string | null
  avatarKey: string | null
}

export type MeowbotPassSnapshot = {
  entityId: number
  season: number
  sport: string
  label: string
  rarityLabel: string
}

export type MeowbotPassKind = 'player' | 'team'

export type MeowbotPlayerPass = {
  entityId: number
  season: number
  sportRaw: string
  pair: string
  passKind: MeowbotPassKind
  rarityLabel?: string
  playerName?: string
  seasonLabel?: string
}

export type MeowbotPlayerRow = {
  entityId: number
  playerName: string
  season: number
  seasonLabel: string
  sport: string
}

export type MeowbotTeamRow = {
  entityId: number
  teamName: string
  season: number
  seasonLabel: string
  sport: string
}

export type MeowbotPassMetadataRow = {
  entityId: number
  season: number
  seasonLabel: string
  sport: string
  name: string
}

export type MeowbotDailyRow = {
  day: string
  earnings: number
  player_box_score_id?: number | null
}

function supabaseUrl(): string {
  return import.meta.env.VITE_MEOWBOT_SUPABASE_URL || DEFAULT_SUPABASE_URL
}

function supabaseKey(): string {
  return import.meta.env.VITE_MEOWBOT_SUPABASE_KEY || DEFAULT_SUPABASE_KEY
}

async function invokeFunction(
  functionName: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`${supabaseUrl()}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseKey()}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}). Try again or use manual paste.`)
  }

  const data = (await response.json()) as { error?: string }
  if (data.error) {
    throw new Error(data.error)
  }
  return data
}

export function normalizeMeowbotSport(raw: string): string {
  const sport = raw.trim().toLowerCase()
  if (sport === 'ncaab' || sport === 'ncaa-mens-basketball') return 'ncaam'
  if (sport === 'ncaafootball' || sport === 'ncaa-football' || sport === 'cfb') return 'ncaaf'
  return sport
}

export function mapMeowbotSport(raw: string): Sport {
  const sport = normalizeMeowbotSport(raw)
  switch (sport) {
    case 'nba':
      return 'NBA'
    case 'wnba':
      return 'WNBA'
    case 'nfl':
      return 'NFL'
    case 'ncaaf':
    case 'cfb':
      return 'CFB'
    case 'mlb':
      return 'MLB'
    case 'nhl':
      return 'NHL'
    case 'ncaam':
    case 'cbb':
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

export function isUfcSportRaw(sportRaw: string): boolean {
  return normalizeMeowbotSport(sportRaw) === 'ufc'
}

export function parsePlayerPair(pair: string): MeowbotPlayerPass | null {
  const parts = pair.split(':')
  if (parts.length < 3) return null
  const entityId = Number(parts[0])
  const season = Number(parts[1])
  const sportRaw = parts.slice(2).join(':')
  if (!Number.isFinite(entityId) || entityId <= 0 || !Number.isFinite(season)) return null
  return { entityId, season, sportRaw, pair, passKind: 'player' }
}

export function buildPlayerExternalKey(entityId: number, season: number, sport: Sport): string {
  return `${entityId}|${season}|${sport}`
}

function snapshotLookupKey(entityId: number, season: number, sport: string): string {
  return `${entityId}-${season}-${normalizeMeowbotSport(sport)}`
}

function enrichPassFromSnapshot(
  pass: MeowbotPlayerPass,
  snapshotsByKey: Map<string, MeowbotPassSnapshot>,
): MeowbotPlayerPass {
  const snapshot = snapshotsByKey.get(snapshotLookupKey(pass.entityId, pass.season, pass.sportRaw))
  const seasonLabel = seasonLabelFromPass(pass.season, pass.sportRaw)
  if (!snapshot) {
    return { ...pass, seasonLabel }
  }
  return {
    ...pass,
    playerName: snapshot.label,
    rarityLabel: snapshot.rarityLabel,
    seasonLabel,
  }
}

function parsePassPairs(pairs: string[], passKind: MeowbotPassKind): MeowbotPlayerPass[] {
  return pairs
    .map(parsePlayerPair)
    .filter((pass): pass is MeowbotPlayerPass => pass !== null)
    .map((pass) => ({ ...pass, passKind }))
}

export function splitPairsForOtdRequest(
  playerPairs: string[],
  teamPairs: string[],
): { playerPairs: string[]; teamPairs: string[] } {
  const otdPlayerPairs = [...playerPairs]
  const otdTeamPairs: string[] = []

  for (const pair of teamPairs) {
    const parsed = parsePlayerPair(pair)
    if (parsed && isUfcSportRaw(parsed.sportRaw)) {
      otdPlayerPairs.push(pair)
    } else {
      otdTeamPairs.push(pair)
    }
  }

  return { playerPairs: otdPlayerPairs, teamPairs: otdTeamPairs }
}

export async function resolveUserPasses(
  username: string,
  signal?: AbortSignal,
): Promise<{
  user: MeowbotUser
  playerPairs: string[]
  teamPairs: string[]
  playerPasses: MeowbotPlayerPass[]
  teamPasses: MeowbotPlayerPass[]
  rarities: Record<string, string[]>
  passSnapshots: MeowbotPassSnapshot[]
}> {
  const trimmed = username.trim().replace(/^@/, '')
  if (!trimmed) {
    throw new Error('Enter a Real username.')
  }

  const data = (await invokeFunction(
    'resolve-listing',
    { action: 'get_user_passes', payload: { username: trimmed } },
    signal,
  )) as {
    playerPairs?: string[]
    teamPairs?: string[]
    rarities?: Record<string, string[]>
    passSnapshots?: MeowbotPassSnapshot[]
    user?: { userId?: string; avatarKey?: string }
    error?: string
  }

  const playerPairs = Array.isArray(data.playerPairs) ? data.playerPairs : []
  const teamPairs = Array.isArray(data.teamPairs) ? data.teamPairs : []
  const passSnapshots = Array.isArray(data.passSnapshots) ? data.passSnapshots : []
  const rarities = data.rarities ?? {}
  const snapshotsByKey = new Map(
    passSnapshots.map((snapshot) => [
      snapshotLookupKey(snapshot.entityId, snapshot.season, snapshot.sport),
      snapshot,
    ]),
  )

  const playerPasses = parsePassPairs(playerPairs, 'player').map((pass) =>
    enrichPassFromSnapshot(pass, snapshotsByKey),
  )
  const teamPasses = parsePassPairs(teamPairs, 'team').map((pass) =>
    enrichPassFromSnapshot(pass, snapshotsByKey),
  )

  if (playerPasses.length === 0 && teamPasses.length === 0) {
    throw new Error(`No passes found for @${trimmed}.`)
  }

  return {
    user: {
      userId: data.user?.userId ?? null,
      avatarKey: data.user?.avatarKey ?? null,
    },
    playerPairs,
    teamPairs,
    playerPasses,
    teamPasses,
    rarities,
    passSnapshots,
  }
}

export async function fetchUserOtdPassMetadata(
  entityIds: number[],
  playerPairs: string[],
  teamPairs: string[],
  signal?: AbortSignal,
): Promise<MeowbotPassMetadataRow[]> {
  const routed = splitPairsForOtdRequest(playerPairs, teamPairs)
  const data = (await invokeFunction(
    'market-data',
    {
      action: 'get_user_otd_data',
      payload: {
        entityIds,
        playerPairs: routed.playerPairs,
        teamPairs: routed.teamPairs,
      },
    },
    signal,
  )) as { playerRows?: MeowbotPlayerRow[]; teamRows?: MeowbotTeamRow[] }

  const rows: MeowbotPassMetadataRow[] = []

  for (const row of data.playerRows ?? []) {
    rows.push({
      entityId: row.entityId,
      season: row.season,
      seasonLabel: row.seasonLabel,
      sport: row.sport,
      name: row.playerName,
    })
  }

  for (const row of data.teamRows ?? []) {
    rows.push({
      entityId: row.entityId,
      season: row.season,
      seasonLabel: row.seasonLabel,
      sport: row.sport,
      name: row.teamName,
    })
  }

  return rows
}

/** @deprecated Use fetchUserOtdPassMetadata */
export async function fetchUserOtdPlayerRows(
  entityIds: number[],
  playerPairs: string[],
  signal?: AbortSignal,
): Promise<MeowbotPlayerRow[]> {
  const rows = await fetchUserOtdPassMetadata(entityIds, playerPairs, [], signal)
  return rows.map((row) => ({
    entityId: row.entityId,
    playerName: row.name,
    season: row.season,
    seasonLabel: row.seasonLabel,
    sport: row.sport,
  }))
}

export async function fetchDailyEarnings(
  params: {
    entityId: number
    season: number
    sport: string
    seasonLabel: string
    passKind?: MeowbotPassKind
  },
  signal?: AbortSignal,
): Promise<MeowbotDailyRow[]> {
  const sport = normalizeMeowbotSport(params.sport)
  const action = params.passKind === 'team' ? 'get_team_daily_earnings' : 'get_daily_earnings'
  const data = (await invokeFunction(
    'market-data',
    {
      action,
      payload: {
        entityId: params.entityId,
        season: params.season,
        sport,
        seasonLabel: params.seasonLabel,
      },
    },
    signal,
  )) as { rows?: MeowbotDailyRow[] }

  if (!Array.isArray(data.rows)) return []
  return data.rows.filter(
    (row) =>
      typeof row.day === 'string' &&
      Number.isFinite(Number(row.earnings)) &&
      Number(row.earnings) > 0,
  )
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) return []
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        throw new DOMException('Import cancelled.', 'AbortError')
      }
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index]!, index)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  await Promise.all(workers)
  return results
}

export const DEFAULT_IMPORT_CONCURRENCY = 12

export function createThrottledProgress<T>(
  callback: (value: T) => void,
  intervalMs = 250,
): (value: T) => void {
  let lastSent = 0
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (pending === null) return
    callback(pending)
    pending = null
    lastSent = Date.now()
  }

  return (value: T) => {
    pending = value
    const elapsed = Date.now() - lastSent
    if (elapsed >= intervalMs) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      flush()
      return
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = null
        flush()
      }, intervalMs - elapsed)
    }
  }
}
