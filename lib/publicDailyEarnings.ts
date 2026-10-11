import {
  RealApiError,
  getRealBoosterCardInfo,
  getRealGamePlayerBoxScores,
  getRealHomeDayGames,
  getRealPlayerBoxScore,
  getUserByUsername,
  listPasses,
  normalizeRealUsernameInput,
  type RealApiContext,
  type RealBoosterRarityGroup,
  type RealPass,
  type RealPlayerBoxScore,
  type RealStatValue,
} from './realApi.js'

export type PublicDailyEarningsInfo = {
  id: string
  type: string
  label: string
  value: string
}

export type PublicDailyEarningsRow = {
  id: string
  totalEarnings: number
  pass: {
    id: string
    label: string
    sport: string
    season: string
    entityType: string
    avatar: string
    rarityLabel: string
  }
  infos: PublicDailyEarningsInfo[]
}

export type PublicDailyEarningsResult = {
  ok: true
  source: 'public_reconstruction'
  username: string
  day: string
  dayDisplay: string
  emptyMessage: string
  earnings: PublicDailyEarningsRow[]
  dailyTotal: number
  capturedAt: string
}

type BoosterSelection = {
  statTypes: string[]
  labels: string[]
  values: number[]
}

/** Real's "plays today" collection rolls to the new day at about 7 AM Eastern. */
export function currentRealEarningsDay(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const offset = Number(parts.hour) < 7 ? -1 : 0
  return new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset),
  )
    .toISOString()
    .slice(0, 10)
}

function numeric(value: unknown): number {
  const raw = typeof value === 'string' ? value.replace(/,/g, '').split('/')[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function parsePassEarningsMultiplier(value: unknown): number {
  if (typeof value !== 'string') return 1
  const parsed = Number(value.match(/^\s*([\d.]+)x/i)?.[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function boosterSelection(
  pass: RealPass,
  rarityGroups: RealBoosterRarityGroup[],
): BoosterSelection | null {
  const card = pass.boosterCardInfo
  if (!card?.statBoostKey || card.rarity == null) return null
  const rarity = String(card.rarity)
  const group = rarityGroups.find(
    (candidate) => String(candidate.rarity ?? candidate.key ?? '') === rarity,
  )
  const selection = group?.statBoostKeyInfo?.find(
    (candidate) => candidate.statBoostKey === card.statBoostKey,
  )
  if (!selection?.info?.length) return null
  return {
    statTypes: card.statBoostKey.split('_'),
    labels: selection.info.map((info) => info.label?.trim() || 'Stat'),
    values: selection.info.map((info) => numeric(info.boostValue)),
  }
}

function statValueMap(values: RealStatValue[] | undefined): Map<string, number> {
  return new Map(
    (values ?? []).map((stat) => [String(stat.type ?? ''), numeric(stat.value)]),
  )
}

export function calculatePublicPassEarnings(input: {
  pass: RealPass
  performances: Array<{ baseEarnings: number; statValues?: RealStatValue[] }>
  rarityGroups?: RealBoosterRarityGroup[]
}): { totalEarnings: number; infos: PublicDailyEarningsInfo[] } {
  const multiplier = parsePassEarningsMultiplier(input.pass.boostInfo?.multiplier)
  const selection = boosterSelection(input.pass, input.rarityGroups ?? [])
  let baseTotal = 0
  let boosterTotal = 0
  const boosterStatTotals = new Map<string, { count: number; value: number }>()

  for (const performance of input.performances) {
    const base = Math.max(0, Math.round(numeric(performance.baseEarnings)))
    baseTotal += base
    if (!selection) continue
    const stats = statValueMap(performance.statValues)
    selection.statTypes.forEach((type, index) => {
      const count = stats.get(type) ?? 0
      const value = count * (selection.values[index] ?? 0)
      boosterTotal += value
      const label = selection.labels[index] ?? `Stat ${type}`
      const prior = boosterStatTotals.get(label) ?? { count: 0, value: 0 }
      boosterStatTotals.set(label, { count: prior.count + count, value: prior.value + value })
    })
  }

  const infos: PublicDailyEarningsInfo[] = [
    { id: 'base', type: 'base', label: 'Base RAX', value: String(baseTotal) },
    { id: 'multiplier', type: 'multiplier', label: 'Pass multiplier', value: `${multiplier}x` },
  ]
  for (const [label, stat] of boosterStatTotals) {
    infos.push({
      id: `booster-${label.toLowerCase()}`,
      type: 'booster',
      label,
      value: `${stat.count} (+${Math.ceil(stat.value)})`,
    })
  }

  return {
    // Real rounds its base first and rounds any fractional booster result upward at the end.
    totalEarnings: Math.ceil(baseTotal * multiplier + boosterTotal),
    infos,
  }
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, worker))
  return results
}

function passTeamId(pass: RealPass): string {
  const nested = pass.entity?.teamId
  return String(nested ?? pass.teamId ?? '')
}

function formatDay(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(parsed.getTime())
    ? day
    : parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Reconstructs a user's active player-pass earnings using only public collection, game and
 * booster data. The configured Real session is transport only and does not need to belong to
 * the requested username.
 */
export async function reconstructPublicDailyEarnings(
  usernameInput: string,
  day: string,
  context: RealApiContext,
): Promise<PublicDailyEarningsResult> {
  // Collection calls stay conservative, while independent public game/box-score reads can use
  // a slightly wider pool so large collections finish within a serverless invocation.
  const detailConcurrency = Math.min(4, Math.max(1, context.config.concurrency * 2))
  const username = normalizeRealUsernameInput(usernameInput)
  const user = await getUserByUsername(username, context)
  const allPasses = await listPasses({ userId: user.id }, context)
  const activePairs = new Map<string, { sport: string; season: number }>()
  for (const pass of allPasses) {
    const sport = typeof pass.sport === 'string' ? pass.sport : ''
    const season = Number(pass.season)
    if (
      pass.entityType === 'player' &&
      pass.isActive === true &&
      !pass.isRefunded &&
      sport &&
      Number.isFinite(season)
    ) {
      activePairs.set(`${sport}|${season}`, { sport, season })
    }
  }

  const pairs = [...activePairs.values()]
  const todayPages = await mapLimit(pairs, context.config.concurrency, (pair) =>
    listPasses(
      {
        userId: user.id,
        entityType: 'player',
        sport: pair.sport,
        season: pair.season,
        filter: 'playstoday',
      },
      context,
    ),
  )
  const passById = new Map<string, RealPass>()
  for (const pass of todayPages.flat()) {
    if (pass.isActive !== true || pass.isRefunded) continue
    passById.set(String(pass.id ?? `${pass.sport}:${pass.season}:${pass.entityId}`), pass)
  }
  const passes = [...passById.values()]
  const passesBySport = new Map<string, RealPass[]>()
  for (const pass of passes) {
    const sport = String(pass.sport ?? '')
    if (!sport) continue
    passesBySport.set(sport, [...(passesBySport.get(sport) ?? []), pass])
  }

  const sports = [...passesBySport.keys()]
  const homePages = await mapLimit(sports, context.config.concurrency, async (sport) => ({
    sport,
    games: await getRealHomeDayGames(sport, day, context),
  }))
  const relevantGames = homePages.flatMap(({ sport, games }) => {
    const sportPasses = passesBySport.get(sport) ?? []
    const teamIds = new Set(sportPasses.map(passTeamId).filter(Boolean))
    const canFilterTeams = teamIds.size > 0 && sportPasses.every((pass) => passTeamId(pass))
    const selected = canFilterTeams
      ? games.filter(
          (game) =>
            teamIds.has(String(game.homeTeamId ?? '')) ||
            teamIds.has(String(game.awayTeamId ?? '')),
        )
      : games
    return selected.flatMap((game) =>
      game.id == null ? [] : [{ sport, gameId: game.id }],
    )
  })

  const gameRows = await mapLimit(relevantGames, detailConcurrency, async (game) => ({
    ...game,
    rows: await getRealGamePlayerBoxScores(game.sport, game.gameId, context),
  }))
  const ownedPlayerIds = new Set(passes.map((pass) => String(pass.entityId ?? '')))
  const relevantBoxes = new Map<string, RealPlayerBoxScore>()
  for (const page of gameRows) {
    for (const box of page.rows) {
      if (box.id == null || !ownedPlayerIds.has(String(box.playerId ?? ''))) continue
      relevantBoxes.set(String(box.id), box)
    }
  }

  const boxDetails = await mapLimit(
    [...relevantBoxes.entries()],
    detailConcurrency,
    async ([id, summary]) => ({ id, summary, detail: await getRealPlayerBoxScore(id, context) }),
  )
  const performancesByPlayer = new Map<
    string,
    Array<{ baseEarnings: number; statValues?: RealStatValue[] }>
  >()
  for (const { summary, detail } of boxDetails) {
    const box = detail.playerBoxScore ?? summary
    if (box.day && box.day !== day) continue
    if (box.didNotPlay === true || box.played === false) continue
    const baseEarnings = numeric(detail.advancedStats?.raxEarnings)
    const playerId = String(box.playerId ?? summary.playerId ?? '')
    if (!playerId || baseEarnings <= 0) continue
    performancesByPlayer.set(playerId, [
      ...(performancesByPlayer.get(playerId) ?? []),
      { baseEarnings, statValues: box.statValues ?? summary.statValues },
    ])
  }

  const boostedBySport = new Map<string, RealPass>()
  for (const pass of passes) {
    if (pass.boosterCardInfo && pass.boostInfo?.isCardBoosted) {
      boostedBySport.set(String(pass.sport ?? ''), pass)
    }
  }
  const boosterPages = await mapLimit(
    [...boostedBySport.entries()],
    context.config.concurrency,
    async ([sport, pass]) => ({
      sport,
      groups: await getRealBoosterCardInfo(
        {
          userPassId: pass.id!,
          userId: user.id,
          entityType: pass.entityType ?? 'player',
          sport,
        },
        context,
      ),
    }),
  )
  const boosterGroups = new Map(boosterPages.map((page) => [page.sport, page.groups]))
  for (const pass of passes) {
    if (
      pass.boosterCardInfo &&
      pass.boostInfo?.isCardBoosted &&
      !boosterSelection(pass, boosterGroups.get(String(pass.sport ?? '')) ?? [])
    ) {
      throw new RealApiError(
        'invalid_response',
        `Real did not return the public booster values needed for ${pass.label ?? 'a boosted pass'}.`,
      )
    }
  }

  const earnings = passes.flatMap((pass): PublicDailyEarningsRow[] => {
    const performances = performancesByPlayer.get(String(pass.entityId ?? '')) ?? []
    if (performances.length === 0) return []
    const calculated = calculatePublicPassEarnings({
      pass,
      performances,
      rarityGroups: boosterGroups.get(String(pass.sport ?? '')),
    })
    if (calculated.totalEarnings <= 0) return []
    return [{
      id: String(pass.id ?? ''),
      totalEarnings: calculated.totalEarnings,
      pass: {
        id: String(pass.id ?? ''),
        label: pass.label ?? 'Player pass',
        sport: pass.sportLabel ?? pass.sport ?? '',
        season: pass.seasonDisplay ?? String(pass.season ?? ''),
        entityType: pass.entityType ?? 'player',
        avatar: pass.entityAvatar ?? pass.entity?.avatar ?? '',
        rarityLabel: pass.boostInfo?.rarityLabel ?? '',
      },
      infos: calculated.infos,
    }]
  })
  earnings.sort((a, b) => b.totalEarnings - a.totalEarnings || a.pass.label.localeCompare(b.pass.label))

  return {
    ok: true,
    source: 'public_reconstruction',
    username: user.userName,
    day,
    dayDisplay: formatDay(day),
    emptyMessage:
      earnings.length === 0 ? 'No public player-card earnings were found for this day.' : '',
    earnings,
    dailyTotal: earnings.reduce((sum, row) => sum + row.totalEarnings, 0),
    capturedAt: new Date().toISOString(),
  }
}
