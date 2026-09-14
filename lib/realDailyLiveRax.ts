import { toRealPlaySportSlug } from './playAverages'
import {
  getPlayerBoxScore,
  listGamesByDay,
  listPlayerRecentPlays,
  listPlayerTopPlays,
  listTeamRecentPlays,
  type RealApiContext,
  type RealDayGame,
  type RealPlayerPlay,
} from './realApi'
import { runWithConcurrency } from './runWithConcurrency'

export type LiveDailyPassInput = {
  externalKey: string
  entityId: number
  sportRaw: string
  seasonYear: number
  passKind: 'player' | 'team'
  teamId?: number
}

export type LiveDailyRaxRow = {
  externalKey: string
  claimDay: string
  baseRaxEarned: number
  source: 'boxscore' | 'plays'
}

function positiveInt(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Walk a game payload for `{ playerId, playerBoxScoreId }` pairs (scorers, cards, …). */
export function collectPlayerBoxScoreIds(value: unknown, into = new Map<number, number>()): Map<number, number> {
  if (!value || typeof value !== 'object') return into
  if (Array.isArray(value)) {
    for (const item of value) collectPlayerBoxScoreIds(item, into)
    return into
  }
  const record = value as Record<string, unknown>
  const playerId = positiveInt(record.playerId)
  const boxId = positiveInt(record.playerBoxScoreId)
  if (playerId != null && boxId != null) into.set(playerId, boxId)
  for (const child of Object.values(record)) collectPlayerBoxScoreIds(child, into)
  return into
}

export function playingTeamIdsFromGames(games: RealDayGame[]): Set<number> {
  const ids = new Set<number>()
  for (const game of games) {
    const home = positiveInt(game.homeTeamId)
    const away = positiveInt(game.awayTeamId)
    if (home != null) ids.add(home)
    if (away != null) ids.add(away)
  }
  return ids
}

export function raxEarningsFromBoxPayload(payload: {
  advancedStats?: { raxEarnings?: unknown } | null
} | null): number {
  const raw = Number(payload?.advancedStats?.raxEarnings)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

export function performanceRaxFromPlays(plays: RealPlayerPlay[], claimDay: string): number {
  let sum = 0
  let any = false
  for (const play of plays) {
    const day = typeof play.day === 'string' ? play.day.slice(0, 10) : ''
    if (day !== claimDay) continue
    const value = Number(play.value)
    if (!Number.isFinite(value) || value <= 0) continue
    sum += value
    any = true
  }
  return any ? Math.round(sum) : 0
}

function passTeamId(pass: LiveDailyPassInput): number | null {
  if (pass.passKind === 'team') return pass.entityId > 0 ? pass.entityId : null
  return pass.teamId != null && pass.teamId > 0 ? pass.teamId : null
}

export function passesPlayingOnGameDay(
  passes: LiveDailyPassInput[],
  playingTeams: Set<number>,
): LiveDailyPassInput[] {
  const anyTeamId = passes.some((pass) => passTeamId(pass) != null)
  if (!anyTeamId) return passes.filter((pass) => pass.entityId > 0)
  return passes.filter((pass) => {
    const teamId = passTeamId(pass)
    if (teamId == null) return false
    return playingTeams.has(teamId)
  })
}

async function playsForPass(
  pass: LiveDailyPassInput,
  context: RealApiContext,
): Promise<RealPlayerPlay[]> {
  const sport = toRealPlaySportSlug(pass.sportRaw)
  if (!sport || pass.entityId <= 0) return []
  const query = { entityId: pass.entityId, sport, season: pass.seasonYear, limit: 100 }
  if (pass.passKind === 'team') {
    return listTeamRecentPlays(query, context)
  }
  const recent = await listPlayerRecentPlays({ ...query, viewFrame: 'default' }, context)
  if (recent.length > 0) return recent
  try {
    return await listPlayerTopPlays({ ...query, viewFrame: 'season' }, context)
  } catch {
    return []
  }
}

export async function collectLiveDailyRax(
  passes: LiveDailyPassInput[],
  claimDay: string,
  context: RealApiContext,
  options?: {
    concurrency?: number
    onProgress?: (progress: { completed: number; total: number }) => void
  },
): Promise<LiveDailyRaxRow[]> {
  const bySport = new Map<string, LiveDailyPassInput[]>()
  for (const pass of passes) {
    const sport = toRealPlaySportSlug(pass.sportRaw)
    if (!sport || pass.entityId <= 0) continue
    const list = bySport.get(sport) ?? []
    list.push(pass)
    bySport.set(sport, list)
  }

  const boxIds = new Map<number, number>()
  const playingTeams = new Set<number>()
  for (const sport of bySport.keys()) {
    const games = await listGamesByDay(sport, claimDay, context)
    collectPlayerBoxScoreIds(games, boxIds)
    for (const teamId of playingTeamIdsFromGames(games)) playingTeams.add(teamId)
  }

  const targets = passesPlayingOnGameDay(passes, playingTeams)
  const rows = new Map<string, LiveDailyRaxRow>()
  const concurrency = Math.max(1, options?.concurrency ?? 4)
  let completed = 0
  const total = targets.length

  await runWithConcurrency(targets, concurrency, async (pass) => {
    const boxId = boxIds.get(pass.entityId)
    let baseRaxEarned = 0
    let source: LiveDailyRaxRow['source'] = 'plays'

    if (boxId != null) {
      const box = await getPlayerBoxScore(boxId, context)
      const fromBox = raxEarningsFromBoxPayload(box)
      if (fromBox > 0) {
        baseRaxEarned = fromBox
        source = 'boxscore'
      }
    }

    if (baseRaxEarned <= 0) {
      const plays = await playsForPass(pass, context)
      baseRaxEarned = performanceRaxFromPlays(plays, claimDay)
      source = 'plays'
    }

    if (baseRaxEarned > 0) {
      rows.set(pass.externalKey, {
        externalKey: pass.externalKey,
        claimDay,
        baseRaxEarned,
        source,
      })
    }

    completed += 1
    options?.onProgress?.({ completed, total })
  })

  return [...rows.values()]
}
