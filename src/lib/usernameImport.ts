import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
import {
  legendaryPlusRarityFilter,
  passMatchesRarityFilter,
  usernameImportRarityFilter,
} from '../../lib/rarityFilter'
import {
  resolveUsernameImportSeasonLabel,
  usernameImportExternalKey,
} from '../../lib/usernameImportShared'
import { filterDailyRowsToPassSeason } from '../../lib/seasonClaimWindow'
import { createId } from './id'
import { resolveImportUserPasses } from './importPassProvider'
import {
  buildPlayerExternalKey,
  createThrottledProgress,
  DEFAULT_IMPORT_CONCURRENCY,
  fetchDailyEarnings,
  fetchUserOtdPassMetadata,
  mapMeowbotSport,
  runWithConcurrency,
  type MeowbotPlayerPass,
} from './meowbotApi'
import { parseRealAppToolsDailyRows } from './realAppToolsImport'
import {
  fetchDailyRaxRows,
  type DailyRaxBackfillResult,
  type EarningsBackfillPass,
} from './realEarningsImport'
import { ignoredPassKeySet } from './ignoredPasses'
import { resolveImportPassKind } from './passKind'
import { fetchCatalogAvatars } from './catalogApi'
import { avatarByExternalKey } from './realMedia'
import { passMetadataKey } from './seasonLabel'
import type {
  PlayerCard,
  RaxPerformance,
  RaxTrackerData,
  Sport,
} from '../types/rax'

export type UsernameImportProgress = {
  phase: 'resolving' | 'fetching' | 'earnings'
  current: number
  total: number
  label: string
}

/** Per-day RAX backfill accounting, present only for providers that support it (Real). */
export type DailyRaxBackfillSummary = {
  passes: number
  cacheHits: number
  fetched: number
  upstreamRequests: number
  rowsReturned: number
  /** False when the shared catalog is unavailable, so nothing was cached for the next import. */
  cacheConfigured: boolean
  cancelled: boolean
}

export type UsernameImportResult = {
  cardsCreated: number
  cardsUpdated: number
  rowsImported: number
  skipped: number
  passesFetched: number
  passesSkipped: number
  /** Legendary+ passes skipped because this tracker user marked them ignore-on-import. */
  passesIgnored: number
  cachedPlayerPasses: number
  ownedPasses: OwnedPassSnapshot[]
  cachedProfiles: []
  errors: string[]
  passesWithNoEarnings: PassWithNoEarnings[]
  passFetchErrors: PassFetchError[]
  dailyRaxBackfill?: DailyRaxBackfillSummary
  /**
   * Passes whose daily RAX fetch failed and can be retried without re-scanning the pass list.
   * Cache-first backfill means already-imported passes stay fast on a full re-import too.
   */
  retryableEarningsPasses: EarningsBackfillPass[]
}

export type OwnedPassSnapshot = {
  name: string
  sport: Sport
  season: string
  seasonYear: number
  entityId: number
  rarityLabel?: string
  externalKey: string
  passKind: 'player' | 'team'
}

export type PassWithNoEarnings = {
  name: string
  sport: Sport
  season: string
  rarityLabel?: string
  externalKey: string
  passKind: 'player' | 'team'
}

export type PassFetchError = {
  name: string
  sport: Sport
  season: string
  rarityLabel?: string
  externalKey: string
  passKind: 'player' | 'team'
  message: string
}

export type FailedPlayerPassImport = {
  name: string
  sport: Sport
  season: string
  rarityLabel?: string
  externalKey?: string
  passKind?: 'player' | 'team'
  reason: 'no_earnings' | 'fetch_error'
  detail: string
  /** True when daily RAX can be re-fetched without redoing the whole username import. */
  retryable?: boolean
}

export function getFailedPlayerPasses(result: UsernameImportResult): FailedPlayerPassImport[] {
  const failed: FailedPlayerPassImport[] = []
  const retryableKeys = new Set(result.retryableEarningsPasses.map((pass) => pass.externalKey))

  for (const pass of result.passesWithNoEarnings) {
    if (pass.passKind !== 'player') continue
    failed.push({
      name: pass.name,
      sport: pass.sport,
      season: pass.season,
      rarityLabel: pass.rarityLabel,
      externalKey: pass.externalKey,
      passKind: pass.passKind,
      reason: 'no_earnings',
      detail:
        'No daily earnings returned from import. The card was still added — add RAX manually on the Entry page (Add card & earnings: select this card, paste JSON or add day by day).',
      retryable: false,
    })
  }

  for (const pass of result.passFetchErrors) {
    if (pass.passKind !== 'player') continue
    const retryable = retryableKeys.has(pass.externalKey)
    failed.push({
      name: pass.name,
      sport: pass.sport,
      season: pass.season,
      rarityLabel: pass.rarityLabel,
      externalKey: pass.externalKey,
      passKind: pass.passKind,
      reason: 'fetch_error',
      detail: retryable
        ? `${pass.message} Use "Retry failed earnings" below to re-fetch only these misses (cache-first).`
        : pass.message,
      retryable,
    })
  }

  return failed.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.sport.localeCompare(b.sport) ||
      a.season.localeCompare(b.season),
  )
}

type CardDraft = Pick<
  PlayerCard,
  'name' | 'sport' | 'season' | 'notes' | 'externalKey' | 'rarityLabel' | 'passKind' | 'avatar'
>

type PerformanceDraft = Pick<
  RaxPerformance,
  'cardId' | 'claimDay' | 'raxEarned' | 'baseRaxEarned' | 'note'
>

export type UsernameImportOptions = {
  signal?: AbortSignal
  onProgress?: (progress: UsernameImportProgress) => void
  concurrency?: number
  /** Include Rare in addition to Legendary+. Default false. */
  includeRare?: boolean
  /** Include Epic in addition to Legendary+. Default false. */
  includeEpic?: boolean
}

type OwnershipSnapshotPass = {
  name: string
  sport: string
  season: string
  seasonYear: number
  entityId: number
  rarityLabel?: string
  externalKey: string
  passKind: 'player' | 'team'
  earnings?: Array<{
    claimDay: string
    baseRaxEarned: number
    playerBoxScoreId?: number | null
  }>
}

type OwnershipSnapshotPayload = {
  source?: string
  username?: string
  importedAt?: string
  updatedAt?: string
  error?: string
  rarities?: Record<string, string[]>
  passes?: OwnershipSnapshotPass[]
  passesEncoding?: 'gzip-base64'
  passesPayload?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function passLabel(pass: MeowbotPlayerPass): string {
  if (pass.playerName) return pass.playerName
  return pass.passKind === 'team' ? `Team ${pass.entityId}` : `Player ${pass.entityId}`
}

function withResolvedPassKind(pass: MeowbotPlayerPass): MeowbotPlayerPass {
  const passKind = resolveImportPassKind({
    passKind: pass.passKind,
    name: pass.playerName ?? passLabel(pass),
    sportRaw: pass.sportRaw,
  })
  return passKind === pass.passKind ? pass : { ...pass, passKind }
}

function snapshotEarningsToDrafts(
  cardId: string,
  pass: MeowbotPlayerPass,
  sport: Sport,
  earnings: NonNullable<OwnershipSnapshotPass['earnings']>,
): PerformanceDraft[] {
  // Trust pass.passKind: Real entityType is authoritative; Meowbot already ran
  // withResolvedPassKind. Re-running the name heuristic here misclassified initials
  // names (e.g. "DJ Giddens") as team and applied 6× instead of 150×.
  const passKind = pass.passKind ?? 'player'
  const parsed = parseRealAppToolsDailyRows(
    earnings.map((row) => ({
      day: row.claimDay,
      earnings: row.baseRaxEarned,
      player_box_score_id: row.playerBoxScoreId ?? undefined,
    })),
    {
      sport,
      rarityLabel: pass.rarityLabel,
      applyOtdMultiplier: true,
      passKind,
    },
  )

  return parsed.rows.map((entry) => ({
    cardId,
    claimDay: entry.claimDay,
    raxEarned: entry.raxEarned,
    baseRaxEarned: entry.baseRaxEarned,
    note: entry.note,
  }))
}

function attachAdminSnapshotEarnings(
  current: RaxTrackerData,
  snapshotPasses: OwnershipSnapshotPass[],
  cardIdByExternalKey: Map<string, string>,
): {
  data: RaxTrackerData
  rowsImported: number
  passesWithNoEarnings: PassWithNoEarnings[]
  passFetchErrors: PassFetchError[]
  errors: string[]
} {
  const performanceDrafts: PerformanceDraft[] = []
  const cardIdsToReplace = new Set<string>()
  const passesWithNoEarnings: PassWithNoEarnings[] = []
  const errors: string[] = []

  for (const pass of snapshotPasses) {
    const sportRaw = rawSportFromDisplay(pass.sport)
    const sport = mapMeowbotSport(sportRaw) as Sport
    const externalKey = usernameImportExternalKey(pass.entityId, pass.seasonYear, sportRaw)
    const cardId = cardIdByExternalKey.get(externalKey)
    if (!cardId) continue

    const seasonLabel = resolveUsernameImportSeasonLabel({
      sportRaw,
      seasonYear: pass.seasonYear,
      passSeasonLabel: pass.season,
    })
    const passMeta = {
      name: pass.name,
      sport,
      season: seasonLabel,
      rarityLabel: pass.rarityLabel,
      externalKey,
      passKind: pass.passKind,
    }
    const meowbotPass: MeowbotPlayerPass = {
      entityId: pass.entityId,
      season: pass.seasonYear,
      sportRaw,
      pair: `${pass.entityId}:${pass.seasonYear}:${sportRaw}`,
      passKind: pass.passKind,
      rarityLabel: pass.rarityLabel,
      playerName: pass.name,
      seasonLabel: pass.season,
    }

    if (pass.earnings && pass.earnings.length > 0) {
      cardIdsToReplace.add(cardId)
      performanceDrafts.push(...snapshotEarningsToDrafts(cardId, meowbotPass, sport, pass.earnings))
      continue
    }

    passesWithNoEarnings.push(passMeta)
    errors.push(
      `${pass.name}: no daily earnings in admin snapshot — add RAX manually on the Entry page (Add card & earnings).`,
    )
  }

  const merged = mergePerformances(current, performanceDrafts, cardIdsToReplace)
  return {
    data: merged.data,
    rowsImported: merged.rowsImported,
    passesWithNoEarnings,
    passFetchErrors: [],
    errors,
  }
}

async function loadMeowbotPerformanceDrafts(
  pass: MeowbotPlayerPass,
  sport: Sport,
  seasonLabel: string,
  cardId: string,
  signal?: AbortSignal,
): Promise<{ drafts: PerformanceDraft[]; skipped: number }> {
  const dailyRows = await fetchDailyEarnings(
    {
      entityId: pass.entityId,
      season: pass.season,
      sport: pass.sportRaw,
      seasonLabel,
      passKind: pass.passKind,
    },
    signal,
  )
  if (dailyRows.length === 0) {
    return { drafts: [], skipped: 0 }
  }

  const parsed = parseRealAppToolsDailyRows(dailyRows, {
    sport,
    rarityLabel: pass.rarityLabel,
    applyOtdMultiplier: true,
    passKind: resolveImportPassKind({
      passKind: pass.passKind,
      name: pass.playerName ?? passLabel(pass),
      sportRaw: pass.sportRaw,
      sport,
    }),
  })

  return {
    drafts: parsed.rows.map((entry) => ({
      cardId,
      claimDay: entry.claimDay,
      raxEarned: entry.raxEarned,
      baseRaxEarned: entry.baseRaxEarned,
      note: entry.note,
    })),
    skipped: parsed.skipped,
  }
}

function uniquePasses(passes: MeowbotPlayerPass[]): MeowbotPlayerPass[] {
  const seen = new Set<string>()
  const unique: MeowbotPlayerPass[] = []
  for (const pass of passes) {
    const key = `${pass.passKind}|${pass.pair}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(pass)
  }
  return unique
}

function resolvePassSeasonLabel(
  pass: MeowbotPlayerPass,
  seasonLabelByKey: Map<string, string>,
  metaKey: string,
): string {
  return resolveUsernameImportSeasonLabel({
    sportRaw: pass.sportRaw,
    seasonYear: pass.season,
    otdSeasonLabel: seasonLabelByKey.get(metaKey),
    passSeasonLabel: pass.seasonLabel,
  })
}

function rawSportFromDisplay(sport: string): string {
  const normalized = sport.trim().toUpperCase()
  switch (normalized) {
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
      return normalized.toLowerCase()
  }
}

function isLegendaryPlusSnapshotPass(
  pass: MeowbotPlayerPass,
  rarities: Record<string, string[]>,
): boolean {
  return passMatchesRarityFilter(
    pass,
    rarities,
    pass.rarityLabel,
    legendaryPlusRarityFilter(),
  )
}

function baseForFullCollectionReplace(current: RaxTrackerData): RaxTrackerData {
  return {
    ...current,
    cards: [],
    performances: [],
    cachedPlayerEarnings: [],
    savedCardProfiles: [],
  }
}

function upsertCards(
  current: RaxTrackerData,
  drafts: CardDraft[],
): { data: RaxTrackerData; cardsCreated: number; cardsUpdated: number; cardIdByExternalKey: Map<string, string> } {
  const cardIdByExternalKey = new Map(
    current.cards
      .filter((card) => card.externalKey)
      .map((card) => [card.externalKey as string, card.id]),
  )
  let cardsCreated = 0
  let cardsUpdated = 0
  const cards = [...current.cards]

  for (const draft of drafts) {
    if (!draft.externalKey) continue
    const existingId = cardIdByExternalKey.get(draft.externalKey)
    if (existingId) {
      const existingIndex = cards.findIndex((card) => card.id === existingId)
      if (existingIndex >= 0) {
        const existing = cards[existingIndex]!
        cards[existingIndex] = {
          ...existing,
          name: draft.name || existing.name,
          sport: draft.sport,
          season: draft.season || existing.season,
          notes: draft.notes || existing.notes,
          rarityLabel: draft.rarityLabel ?? existing.rarityLabel,
          passKind: draft.passKind ?? existing.passKind,
          avatar: draft.avatar ?? existing.avatar,
          simulatedRarityLabel: undefined,
        }
        cardsUpdated += 1
      }
    } else {
      const id = createId('card')
      cards.push({
        id,
        name: draft.name,
        sport: draft.sport,
        season: draft.season,
        notes: draft.notes,
        externalKey: draft.externalKey,
        rarityLabel: draft.rarityLabel,
        passKind: draft.passKind,
        avatar: draft.avatar,
        createdAt: nowIso(),
      })
      cardIdByExternalKey.set(draft.externalKey, id)
      cardsCreated += 1
    }
  }

  return {
    data: { ...current, cards },
    cardsCreated,
    cardsUpdated,
    cardIdByExternalKey,
  }
}

function mergePerformances(
  current: RaxTrackerData,
  drafts: PerformanceDraft[],
  cardIdsToReplace: Set<string>,
): { data: RaxTrackerData; rowsImported: number; skipped: number } {
  const keptPerformances = current.performances.filter(
    (performance) => !cardIdsToReplace.has(performance.cardId),
  )
  const existingKeys = new Set(
    keptPerformances.map(
      (performance) => `${performance.cardId}|${performance.claimDay}|${performance.raxEarned}`,
    ),
  )
  const createdAt = nowIso()
  const imported: RaxPerformance[] = []
  let skipped = 0

  for (const draft of drafts) {
    const key = `${draft.cardId}|${draft.claimDay}|${draft.raxEarned}`
    if (existingKeys.has(key)) {
      skipped += 1
      continue
    }
    existingKeys.add(key)
    imported.push({
      id: createId('perf'),
      cardId: draft.cardId,
      claimDay: draft.claimDay,
      raxEarned: draft.raxEarned,
      baseRaxEarned: draft.baseRaxEarned,
      note: draft.note,
      createdAt,
    })
  }

  if (imported.length === 0 && keptPerformances.length === current.performances.length) {
    return { data: current, rowsImported: 0, skipped }
  }

  return {
    data: {
      ...current,
      performances: keptPerformances.concat(imported),
    },
    rowsImported: imported.length,
    skipped,
  }
}

async function fetchOwnershipSnapshotPayload(
  username: string,
  signal?: AbortSignal,
): Promise<OwnershipSnapshotPayload & { passes: OwnershipSnapshotPass[] }> {
  const response = await fetch('/api/import/ownership', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
    signal,
  })
  const text = await response.text()
  let body: OwnershipSnapshotPayload | null = null
  if (text.trim()) {
    try {
      body = JSON.parse(text) as OwnershipSnapshotPayload
    } catch {
      const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 160)
      throw new Error(
        response.ok
          ? `Admin snapshot returned invalid JSON: ${snippet}`
          : `Admin snapshot failed (${response.status}): ${snippet}`,
      )
    }
  }
  if (!body) {
    throw new Error(`Ownership import returned non-JSON response (${response.status}).`)
  }
  if (!response.ok) {
    const errorMessage =
      typeof body.error === 'string'
        ? body.error
        : `Ownership import failed (${response.status}).`
    throw new Error(errorMessage)
  }

  let passes = body.passes
  if (
    (!passes || passes.length === 0) &&
    body.passesEncoding === 'gzip-base64' &&
    typeof body.passesPayload === 'string'
  ) {
    passes = (await gunzipBase64ToJson(body.passesPayload)) as OwnershipSnapshotPass[]
  }

  if (!Array.isArray(passes) || passes.length === 0) {
    throw new Error('Admin snapshot contained no passes.')
  }

  return { ...body, passes }
}

export async function importFromUsername(
  current: RaxTrackerData,
  username: string,
  options?: UsernameImportOptions,
): Promise<{ data: RaxTrackerData; result: UsernameImportResult }> {
  const errors: string[] = []
  const passesWithNoEarnings: PassWithNoEarnings[] = []
  const passFetchErrors: PassFetchError[] = []
  const reportProgress = options?.onProgress
    ? createThrottledProgress(options.onProgress)
    : undefined
  const concurrency = options?.concurrency ?? DEFAULT_IMPORT_CONCURRENCY

  reportProgress?.({ phase: 'resolving', current: 0, total: 1, label: 'Looking up username…' })
  const resolved = await resolveImportUserPasses(username, options?.signal)

  const providedPasses = [...resolved.playerPasses, ...resolved.teamPasses]
  // Real reports entityType itself, so the name-shape heuristic is only needed for Meowbot.
  const allPasses = resolved.metadataAuthoritative
    ? providedPasses
    : providedPasses.map(withResolvedPassKind)
  const includeRare = Boolean(options?.includeRare)
  const includeEpic = Boolean(options?.includeEpic)
  const rarityFilter = usernameImportRarityFilter({ includeRare, includeEpic })
  const extras = [
    includeRare ? 'Rare' : null,
    includeEpic ? 'Epic' : null,
  ].filter(Boolean)
  const rarityLabel = extras.length > 0 ? `Legendary+ / ${extras.join(' / ')}` : 'Legendary+'
  const eligiblePasses = allPasses.filter((pass) =>
    passMatchesRarityFilter(
      pass,
      resolved.rarities,
      pass.rarityLabel,
      rarityFilter,
    ),
  )
  const passesSkipped = allPasses.length - eligiblePasses.length
  const ignoredKeys = ignoredPassKeySet(current)
  const selectedPasses = eligiblePasses.filter((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw) as Sport
    const externalKey = buildPlayerExternalKey(pass.entityId, pass.season, sport)
    return !ignoredKeys.has(externalKey)
  })
  const passesIgnored = eligiblePasses.length - selectedPasses.length
  const passesToFetch = uniquePasses(selectedPasses)

  if (eligiblePasses.length === 0) {
    throw new Error(`No ${rarityLabel} passes found for this username.`)
  }
  if (selectedPasses.length === 0) {
    throw new Error(
      passesIgnored > 0
        ? `All ${rarityLabel} passes for this username are on your ignore list.`
        : `No ${rarityLabel} passes found for this username.`,
    )
  }

  const seasonLabelByKey = new Map<string, string>()
  const nameByKey = new Map<string, string>()

  if (!resolved.metadataAuthoritative) {
    reportProgress?.({
      phase: 'resolving',
      current: 1,
      total: 1,
      label: 'Loading pass metadata…',
    })

    const otdPassRows = await fetchUserOtdPassMetadata(
      [...new Set(passesToFetch.map((pass) => pass.entityId))],
      passesToFetch.filter((pass) => pass.passKind === 'player').map((pass) => pass.pair),
      passesToFetch.filter((pass) => pass.passKind === 'team').map((pass) => pass.pair),
      options?.signal,
    )
    for (const row of otdPassRows) {
      const key = passMetadataKey(row.entityId, row.season, row.sport)
      seasonLabelByKey.set(key, row.seasonLabel)
      nameByKey.set(key, row.name)
    }
  }

  const describePass = (pass: MeowbotPlayerPass) => {
    const sport = mapMeowbotSport(pass.sportRaw) as Sport
    const metaKey = passMetadataKey(pass.entityId, pass.season, pass.sportRaw)
    return {
      sport,
      name: nameByKey.get(metaKey) ?? passLabel(pass),
      seasonLabel: resolvePassSeasonLabel(pass, seasonLabelByKey, metaKey).trim(),
      externalKey: buildPlayerExternalKey(pass.entityId, pass.season, sport),
    }
  }

  // Real's /userpasses omits entity.avatar for college (ncaam/ncaaf) players; resolve via
  // catalog + Real `/players/{id}/sport/{slug}` (same path Cards uses).
  const catalogAvatarKeys = selectedPasses
    .filter((pass) => !pass.avatar?.trim())
    .map((pass) => describePass(pass).externalKey)
  let catalogAvatars = new Map<string, string>()
  if (catalogAvatarKeys.length > 0) {
    try {
      const { avatars } = await fetchCatalogAvatars(catalogAvatarKeys, options?.signal)
      catalogAvatars = avatarByExternalKey(avatars)
    } catch {
      // Catalog optional — import still proceeds without faces.
    }
  }

  const resolvePassAvatarKey = (pass: MeowbotPlayerPass, externalKey: string) =>
    pass.avatar?.trim() || catalogAvatars.get(externalKey)

  const cardDrafts: CardDraft[] = selectedPasses.map((pass) => {
    const described = describePass(pass)
    const rarityNote = pass.rarityLabel ? ` · ${pass.rarityLabel}` : ''
    return {
      externalKey: described.externalKey,
      name: described.name,
      sport: described.sport,
      season: described.seasonLabel,
      notes: `Imported from @${username.replace(/^@/, '')}${rarityNote}`,
      rarityLabel: pass.rarityLabel,
      passKind: pass.passKind,
      avatar: resolvePassAvatarKey(pass, described.externalKey),
    }
  })

  const { data: withCards, cardsCreated, cardsUpdated, cardIdByExternalKey } = upsertCards(
    baseForFullCollectionReplace(current),
    cardDrafts,
  )

  const performanceDrafts: PerformanceDraft[] = []
  let fetchSkipped = 0
  let dailyRaxBackfill: DailyRaxBackfillSummary | undefined
  const total = passesToFetch.length
  let completed = 0

  if (resolved.dailyEarningsAvailable) {
    await runWithConcurrency(
      passesToFetch,
      concurrency,
      async (pass) => {
        const described = describePass(pass)
        const passMeta = {
          name: described.name,
          sport: described.sport,
          season: described.seasonLabel,
          rarityLabel: pass.rarityLabel,
          externalKey: described.externalKey,
          passKind: pass.passKind,
        }
        const cardId = cardIdByExternalKey.get(described.externalKey)

        try {
          if (!cardId) return

          const { drafts, skipped } = await loadMeowbotPerformanceDrafts(
            pass,
            described.sport,
            described.seasonLabel,
            cardId,
            options?.signal,
          )
          fetchSkipped += skipped
          if (drafts.length > 0) {
            performanceDrafts.push(...drafts)
          } else {
            passesWithNoEarnings.push(passMeta)
            errors.push(
              `${described.name}: no daily earnings from Meowbot — add RAX manually on the Entry page (Add card & earnings).`,
            )
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Could not fetch daily earnings.'
          passFetchErrors.push({ ...passMeta, message })
          errors.push(`${described.name}: ${message}`)
        } finally {
          completed += 1
          reportProgress?.({
            phase: 'fetching',
            current: completed,
            total,
            label: described.name,
          })
        }
      },
      options?.signal,
    )
  } else if (resolved.earningsBackfillAvailable) {
    // Real's pass list carries only a lifetime `earned` total, so per-day rows come from the
    // batched, cache-first backfill route instead of the pass-list response.
    reportProgress?.({ phase: 'earnings', current: 0, total, label: 'Fetching daily RAX…' })

    const backfillPasses: EarningsBackfillPass[] = passesToFetch.map((pass) => {
      const described = describePass(pass)
      return {
        externalKey: described.externalKey,
        entityId: pass.entityId,
        passKind: pass.passKind,
        sportRaw: pass.sportRaw,
        seasonYear: pass.season,
        seasonLabel: described.seasonLabel,
        name: described.name,
        rarityLabel: pass.rarityLabel,
        avatar: resolvePassAvatarKey(pass, described.externalKey),
      }
    })

    let backfill: DailyRaxBackfillResult | null = null
    let backfillCancelled = false
    try {
      backfill = await fetchDailyRaxRows(backfillPasses, {
        signal: options?.signal,
        onProgress: ({ completed: done, total: passTotal }) =>
          reportProgress?.({
            phase: 'earnings',
            current: done,
            total: passTotal,
            label: 'Fetching daily RAX…',
          }),
      })
    } catch (error) {
      // The cards are already assembled, so a failed or cancelled backfill keeps the pass list
      // rather than throwing the whole import away. Re-running the import retries it.
      if (error instanceof DOMException && error.name === 'AbortError') {
        backfillCancelled = true
        errors.push(
          'Daily RAX fetch cancelled — the pass list was still imported. Re-run the import to fetch RAX (already-cached passes return instantly).',
        )
      } else {
        errors.push(
          `Daily RAX fetch failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }. The pass list was still imported — re-run the import to retry.`,
        )
      }
    }

    const failureByKey = new Map(
      (backfill?.failures ?? []).map((failure) => [failure.externalKey, failure]),
    )
    const backfillByKey = new Map(backfillPasses.map((pass) => [pass.externalKey, pass]))
    const retryableEarningsPasses: EarningsBackfillPass[] = []
    dailyRaxBackfill = {
      passes: backfillPasses.length,
      cacheHits: backfill?.stats.cacheHits ?? 0,
      fetched: backfill?.stats.fetched ?? 0,
      upstreamRequests: backfill?.stats.upstreamRequests ?? 0,
      rowsReturned: backfill?.stats.rowsReturned ?? 0,
      cacheConfigured: backfill?.stats.cacheConfigured ?? false,
      cancelled: backfillCancelled,
    }

    for (const pass of passesToFetch) {
      const described = describePass(pass)
      const passMeta = {
        name: described.name,
        sport: described.sport,
        season: described.seasonLabel,
        rarityLabel: pass.rarityLabel,
        externalKey: described.externalKey,
        passKind: pass.passKind,
      }
      const cardId = cardIdByExternalKey.get(described.externalKey)

      const failure = failureByKey.get(described.externalKey)
      if (failure) {
        passFetchErrors.push({ ...passMeta, message: failure.message })
        errors.push(`${described.name}: ${failure.message}`)
        const retryPass = backfillByKey.get(described.externalKey)
        if (retryPass) retryableEarningsPasses.push(retryPass)
        continue
      }

      const rows = backfill?.rowsByExternalKey.get(described.externalKey) ?? []
      const seasonRows = filterDailyRowsToPassSeason(
        rows,
        pass.season,
        described.sport,
        described.seasonLabel,
      )
      if (seasonRows.length === 0) {
        passesWithNoEarnings.push(passMeta)
        if (backfill) {
          errors.push(
            `${described.name}: Real returned no daily RAX for this pass — add RAX manually on the Entry page (Add card & earnings).`,
          )
        } else {
          // Cancelled / fatal backfill: every unresolved pass is retryable.
          const retryPass = backfillByKey.get(described.externalKey)
          if (retryPass) retryableEarningsPasses.push(retryPass)
        }
        continue
      }
      if (!cardId) continue

      performanceDrafts.push(
        ...snapshotEarningsToDrafts(cardId, pass, described.sport, seasonRows),
      )
    }

    completed = total
    reportProgress?.({
      phase: 'earnings',
      current: completed,
      total,
      label: 'Finished daily RAX',
    })

    // Only cards that received rows are replaced, so a pass whose earnings call failed keeps the rows
    // an earlier import stored for it.
    const cardIdsToReplace = new Set(performanceDrafts.map((draft) => draft.cardId))
    const { data: finalData, rowsImported, skipped } = mergePerformances(
      withCards,
      performanceDrafts,
      cardIdsToReplace,
    )
    const ownedPasses: OwnedPassSnapshot[] = allPasses.map((pass) => {
      const described = describePass(pass)
      return {
        name: described.name,
        sport: described.sport,
        season: described.seasonLabel,
        seasonYear: pass.season,
        entityId: pass.entityId,
        rarityLabel: pass.rarityLabel,
        externalKey: described.externalKey,
        passKind: pass.passKind,
      }
    })

    return {
      data: finalData,
      result: {
        cardsCreated,
        cardsUpdated,
        rowsImported,
        skipped: skipped + fetchSkipped,
        passesFetched: selectedPasses.length,
        passesSkipped,
        passesIgnored,
        cachedPlayerPasses: 0,
        ownedPasses,
        cachedProfiles: [],
        errors,
        passesWithNoEarnings,
        passFetchErrors,
        dailyRaxBackfill,
        retryableEarningsPasses,
      },
    }
  } else {
    for (const pass of passesToFetch) {
      const described = describePass(pass)
      passesWithNoEarnings.push({
        name: described.name,
        sport: described.sport,
        season: described.seasonLabel,
        rarityLabel: pass.rarityLabel,
        externalKey: described.externalKey,
        passKind: pass.passKind,
      })
    }
    completed = total
    errors.push(
      'Imported the pass list only — per-day RAX history is not available from this provider. Add RAX on the Entry page (Add card & earnings) or paste realapp.com earnings JSON.',
    )
    reportProgress?.({
      phase: 'fetching',
      current: completed,
      total,
      label: 'Imported pass list',
    })
  }

  // Only cards that received rows are replaced, so a pass whose earnings call failed keeps the rows
  // an earlier import stored for it.
  const cardIdsToReplace = new Set(performanceDrafts.map((draft) => draft.cardId))
  const { data: finalData, rowsImported, skipped } = mergePerformances(
    withCards,
    performanceDrafts,
    cardIdsToReplace,
  )
  const ownedPasses: OwnedPassSnapshot[] = allPasses.map((pass) => {
    const described = describePass(pass)
    return {
      name: described.name,
      sport: described.sport,
      season: described.seasonLabel,
      seasonYear: pass.season,
      entityId: pass.entityId,
      rarityLabel: pass.rarityLabel,
      externalKey: described.externalKey,
      passKind: pass.passKind,
    }
  })

  return {
    data: finalData,
    result: {
      cardsCreated,
      cardsUpdated,
      rowsImported,
      skipped: skipped + fetchSkipped,
      passesFetched: selectedPasses.length,
      passesSkipped,
      passesIgnored,
      cachedPlayerPasses: 0,
      ownedPasses,
      cachedProfiles: [],
      errors,
      passesWithNoEarnings,
      passFetchErrors,
      dailyRaxBackfill,
      retryableEarningsPasses: [],
    },
  }
}

export async function importFromAdminOwnership(
  current: RaxTrackerData,
  username: string,
  options?: UsernameImportOptions,
): Promise<{ data: RaxTrackerData; result: UsernameImportResult }> {
  const reportProgress = options?.onProgress
    ? createThrottledProgress(options.onProgress)
    : undefined
  reportProgress?.({ phase: 'resolving', current: 0, total: 1, label: 'Loading admin snapshot…' })

  const snapshot = await fetchOwnershipSnapshotPayload(username, options?.signal)
  const rawPasses = Array.isArray(snapshot.passes) ? snapshot.passes : []
  const rarities = snapshot.rarities ?? {}
  const allPasses: MeowbotPlayerPass[] = rawPasses.map((pass) => {
    const sportRaw = rawSportFromDisplay(pass.sport)
    return withResolvedPassKind({
      entityId: pass.entityId,
      season: pass.seasonYear,
      sportRaw,
      pair: `${pass.entityId}:${pass.seasonYear}:${sportRaw}`,
      passKind: pass.passKind,
      rarityLabel: pass.rarityLabel,
      playerName: pass.name,
      seasonLabel: pass.season,
    })
  })
  const legendaryPasses = allPasses.filter((pass) => isLegendaryPlusSnapshotPass(pass, rarities))
  if (legendaryPasses.length === 0) {
    throw new Error('No Legendary+ passes found in admin ownership snapshot for this username.')
  }

  const ignoredKeys = ignoredPassKeySet(current)
  const selectedPasses = legendaryPasses.filter((pass) => {
    const externalKey = usernameImportExternalKey(pass.entityId, pass.season, pass.sportRaw)
    return !ignoredKeys.has(externalKey)
  })
  const passesIgnored = legendaryPasses.length - selectedPasses.length
  if (selectedPasses.length === 0) {
    throw new Error(
      passesIgnored > 0
        ? 'All Legendary+ passes in this admin snapshot are on your ignore list.'
        : 'No Legendary+ passes found in admin ownership snapshot for this username.',
    )
  }

  const selectedSnapshotPasses = rawPasses.filter((pass) => {
    const sportRaw = rawSportFromDisplay(pass.sport)
    const externalKey = usernameImportExternalKey(pass.entityId, pass.seasonYear, sportRaw)
    if (ignoredKeys.has(externalKey)) return false
    return isLegendaryPlusSnapshotPass(
      {
        entityId: pass.entityId,
        season: pass.seasonYear,
        sportRaw,
        pair: `${pass.entityId}:${pass.seasonYear}:${sportRaw}`,
        passKind: pass.passKind,
        rarityLabel: pass.rarityLabel,
        seasonLabel: pass.season,
      },
      rarities,
    )
  })

  const cardDrafts: CardDraft[] = selectedPasses.map((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw)
    const seasonLabel = resolveUsernameImportSeasonLabel({
      sportRaw: pass.sportRaw,
      seasonYear: pass.season,
      passSeasonLabel: pass.seasonLabel,
    })
    return {
      externalKey: usernameImportExternalKey(pass.entityId, pass.season, pass.sportRaw),
      name: pass.playerName ?? passLabel(pass),
      sport,
      season: seasonLabel,
      notes: `Recovered from admin snapshot for @${username.replace(/^@/, '').trim()}`,
      rarityLabel: pass.rarityLabel,
      passKind: pass.passKind,
      avatar: pass.avatar,
    }
  })
  const { data: nextData, cardsCreated, cardsUpdated, cardIdByExternalKey } = upsertCards(current, cardDrafts)

  const earningsAttach = attachAdminSnapshotEarnings(
    nextData,
    selectedSnapshotPasses,
    cardIdByExternalKey,
  )
  const finalData = earningsAttach.data

  reportProgress?.({
    phase: 'fetching',
    current: selectedPasses.length,
    total: selectedPasses.length,
    label: 'Finished admin snapshot import',
  })

  const ownedPasses: OwnedPassSnapshot[] = allPasses.map((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw) as Sport
    const seasonLabel = resolveUsernameImportSeasonLabel({
      sportRaw: pass.sportRaw,
      seasonYear: pass.season,
      passSeasonLabel: pass.seasonLabel,
    })
    return {
      name: pass.playerName ?? passLabel(pass),
      sport,
      season: seasonLabel,
      seasonYear: pass.season,
      entityId: pass.entityId,
      rarityLabel: pass.rarityLabel,
      externalKey: usernameImportExternalKey(pass.entityId, pass.season, pass.sportRaw),
      passKind: pass.passKind,
    }
  })

  return {
    data: finalData,
    result: {
      cardsCreated,
      cardsUpdated,
      rowsImported: earningsAttach.rowsImported,
      skipped: 0,
      passesFetched: selectedPasses.length,
      passesSkipped: allPasses.length - legendaryPasses.length,
      passesIgnored,
      cachedPlayerPasses: 0,
      ownedPasses,
      cachedProfiles: [],
      errors: earningsAttach.errors,
      passesWithNoEarnings: earningsAttach.passesWithNoEarnings,
      passFetchErrors: earningsAttach.passFetchErrors,
      retryableEarningsPasses: [],
    },
  }
}

/**
 * Re-fetches daily RAX only for the given passes (typically `result.retryableEarningsPasses`
 * from a prior import). Does not re-scan the username pass list — cards must already exist.
 */
export async function retryFailedEarnings(
  current: RaxTrackerData,
  passes: EarningsBackfillPass[],
  options?: UsernameImportOptions,
): Promise<{ data: RaxTrackerData; result: UsernameImportResult }> {
  const uniquePasses = [...new Map(passes.map((pass) => [pass.externalKey, pass])).values()]
  const errors: string[] = []
  const passesWithNoEarnings: PassWithNoEarnings[] = []
  const passFetchErrors: PassFetchError[] = []
  const reportProgress = options?.onProgress
    ? createThrottledProgress(options.onProgress)
    : undefined

  const ignoredKeys = ignoredPassKeySet(current)
  const retryPasses = uniquePasses.filter((pass) => !ignoredKeys.has(pass.externalKey))
  const passesIgnored = uniquePasses.length - retryPasses.length

  if (retryPasses.length === 0) {
    return {
      data: current,
      result: {
        cardsCreated: 0,
        cardsUpdated: 0,
        rowsImported: 0,
        skipped: 0,
        passesFetched: 0,
        passesSkipped: 0,
        passesIgnored,
        cachedPlayerPasses: 0,
        ownedPasses: [],
        cachedProfiles: [],
        errors:
          uniquePasses.length === 0
            ? ['No failed earnings passes to retry.']
            : ['All retry passes are on your ignore list.'],
        passesWithNoEarnings: [],
        passFetchErrors: [],
        retryableEarningsPasses: [],
      },
    }
  }

  const cardIdByExternalKey = new Map(
    current.cards
      .filter((card) => card.externalKey)
      .map((card) => [card.externalKey as string, card.id]),
  )

  reportProgress?.({
    phase: 'earnings',
    current: 0,
    total: retryPasses.length,
    label: 'Retrying failed daily RAX…',
  })

  let backfill: DailyRaxBackfillResult | null = null
  let backfillCancelled = false
  try {
    backfill = await fetchDailyRaxRows(retryPasses, {
      signal: options?.signal,
      onProgress: ({ completed: done, total: passTotal }) =>
        reportProgress?.({
          phase: 'earnings',
          current: done,
          total: passTotal,
          label: 'Retrying failed daily RAX…',
        }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      backfillCancelled = true
      errors.push('Retry cancelled — already-cached passes stay in place.')
    } else {
      errors.push(
        `Retry failed: ${error instanceof Error ? error.message : 'unknown error'}. Try again.`,
      )
    }
  }

  const failureByKey = new Map(
    (backfill?.failures ?? []).map((failure) => [failure.externalKey, failure]),
  )
  const retryableEarningsPasses: EarningsBackfillPass[] = []
  const performanceDrafts: PerformanceDraft[] = []

  for (const pass of retryPasses) {
    const sport = mapMeowbotSport(pass.sportRaw) as Sport
    const passMeta = {
      name: pass.name,
      sport,
      season: pass.seasonLabel,
      rarityLabel: pass.rarityLabel,
      externalKey: pass.externalKey,
      passKind: pass.passKind,
    }
    const cardId = cardIdByExternalKey.get(pass.externalKey)
    const failure = failureByKey.get(pass.externalKey)

    if (failure) {
      passFetchErrors.push({ ...passMeta, message: failure.message })
      errors.push(`${pass.name}: ${failure.message}`)
      retryableEarningsPasses.push(pass)
      continue
    }

    const rows = backfill?.rowsByExternalKey.get(pass.externalKey) ?? []
    const seasonRows = filterDailyRowsToPassSeason(
      rows,
      pass.seasonYear,
      sport,
      pass.seasonLabel,
    )
    if (seasonRows.length === 0) {
      passesWithNoEarnings.push(passMeta)
      if (backfill) {
        errors.push(
          `${pass.name}: Real returned no daily RAX for this pass — add RAX manually on the Entry page (Add card & earnings).`,
        )
      } else {
        retryableEarningsPasses.push(pass)
      }
      continue
    }
    if (!cardId) {
      errors.push(`${pass.name}: card missing from collection — re-run the username import.`)
      retryableEarningsPasses.push(pass)
      continue
    }

    const meowbotPass: MeowbotPlayerPass = {
      entityId: pass.entityId,
      season: pass.seasonYear,
      sportRaw: pass.sportRaw,
      pair: `${pass.entityId}:${pass.seasonYear}:${pass.sportRaw}`,
      passKind: pass.passKind,
      rarityLabel: pass.rarityLabel,
      playerName: pass.name,
      seasonLabel: pass.seasonLabel,
    }
    performanceDrafts.push(...snapshotEarningsToDrafts(cardId, meowbotPass, sport, seasonRows))
  }

  const cardIdsToReplace = new Set(performanceDrafts.map((draft) => draft.cardId))
  const { data: finalData, rowsImported, skipped } = mergePerformances(
    current,
    performanceDrafts,
    cardIdsToReplace,
  )

  reportProgress?.({
    phase: 'earnings',
    current: retryPasses.length,
    total: retryPasses.length,
    label: 'Finished retry',
  })

  return {
    data: finalData,
    result: {
      cardsCreated: 0,
      cardsUpdated: 0,
      rowsImported,
      skipped,
      passesFetched: retryPasses.length,
      passesSkipped: 0,
      passesIgnored,
      cachedPlayerPasses: 0,
      ownedPasses: [],
      cachedProfiles: [],
      errors,
      passesWithNoEarnings,
      passFetchErrors,
      dailyRaxBackfill: {
        passes: retryPasses.length,
        cacheHits: backfill?.stats.cacheHits ?? 0,
        fetched: backfill?.stats.fetched ?? 0,
        upstreamRequests: backfill?.stats.upstreamRequests ?? 0,
        rowsReturned: backfill?.stats.rowsReturned ?? 0,
        cacheConfigured: backfill?.stats.cacheConfigured ?? false,
        cancelled: backfillCancelled,
      },
      retryableEarningsPasses,
    },
  }
}
