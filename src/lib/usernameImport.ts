import { createId } from './id'
import {
  buildPlayerExternalKey,
  createThrottledProgress,
  DEFAULT_IMPORT_CONCURRENCY,
  fetchDailyEarnings,
  fetchUserOtdPassMetadata,
  mapMeowbotSport,
  normalizeMeowbotSport,
  resolveUserPasses,
  runWithConcurrency,
  type MeowbotPlayerPass,
} from './meowbotApi'
import { playerEarningsCacheKey, upsertCachedPlayerEarnings } from './playerEarningsCache'
import { parseRealAppToolsDailyRows } from './realAppToolsImport'
import { legendaryPlusRarityFilter, passMatchesRarityFilter } from './rarityFilter'
import { passMetadataKey, seasonLabelFromPass, isCalendarYearSport } from './seasonLabel'
import type {
  CachedPlayerEarningsProfile,
  PlayerCard,
  RaxPerformance,
  RaxTrackerData,
  SavedCardEarningsRow,
  Sport,
} from '../types/rax'

export type UsernameImportProgress = {
  phase: 'resolving' | 'fetching'
  current: number
  total: number
  label: string
}

export type UsernameImportResult = {
  cardsCreated: number
  cardsUpdated: number
  rowsImported: number
  skipped: number
  passesFetched: number
  passesSkipped: number
  cachedPlayerPasses: number
  ownedPasses: OwnedPassSnapshot[]
  errors: string[]
  passesWithNoEarnings: PassWithNoEarnings[]
  passFetchErrors: PassFetchError[]
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
  reason: 'no_earnings' | 'fetch_error'
  detail: string
}

export function getFailedPlayerPasses(result: UsernameImportResult): FailedPlayerPassImport[] {
  const failed: FailedPlayerPassImport[] = []

  for (const pass of result.passesWithNoEarnings) {
    if (pass.passKind !== 'player') continue
    failed.push({
      name: pass.name,
      sport: pass.sport,
      season: pass.season,
      rarityLabel: pass.rarityLabel,
      reason: 'no_earnings',
      detail:
        'No daily earnings returned from import. The card was still added — add RAX manually on the Entry page (Add card & earnings: select this card, paste JSON or add day by day).',
    })
  }

  for (const pass of result.passFetchErrors) {
    if (pass.passKind !== 'player') continue
    failed.push({
      name: pass.name,
      sport: pass.sport,
      season: pass.season,
      rarityLabel: pass.rarityLabel,
      reason: 'fetch_error',
      detail: pass.message,
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
  'name' | 'sport' | 'season' | 'notes' | 'externalKey' | 'rarityLabel' | 'passKind'
>

type PerformanceDraft = Pick<
  RaxPerformance,
  'cardId' | 'claimDay' | 'raxEarned' | 'baseRaxEarned' | 'note'
>

export type UsernameImportOptions = {
  signal?: AbortSignal
  onProgress?: (progress: UsernameImportProgress) => void
  concurrency?: number
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
}

type OwnershipSnapshotPayload = {
  source?: string
  username?: string
  importedAt?: string
  updatedAt?: string
  passes?: OwnershipSnapshotPass[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function passLabel(pass: MeowbotPlayerPass): string {
  if (pass.playerName) return pass.playerName
  return pass.passKind === 'team' ? `Team ${pass.entityId}` : `Player ${pass.entityId}`
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
  if (isCalendarYearSport(pass.sportRaw)) {
    return String(pass.season)
  }

  return (
    seasonLabelByKey.get(metaKey) ??
    pass.seasonLabel ??
    seasonLabelFromPass(pass.season, pass.sportRaw)
  ).trim()
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

function isLegendaryPlus(rarityLabel?: string): boolean {
  if (!rarityLabel) return false
  const normalized = rarityLabel.trim().toLowerCase()
  return (
    normalized.startsWith('legendary') ||
    normalized.startsWith('mystic') ||
    normalized.startsWith('iconic')
  )
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
): Promise<OwnershipSnapshotPayload> {
  const response = await fetch('/api/import/ownership', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
    signal,
  })
  const text = await response.text()
  let body: unknown = null
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  if (!body) {
    throw new Error(`Ownership import returned non-JSON response (${response.status}).`)
  }
  if (!response.ok) {
    const errorMessage =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Ownership import failed (${response.status}).`
    throw new Error(errorMessage)
  }
  return body as OwnershipSnapshotPayload
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
  const resolved = await resolveUserPasses(username, options?.signal)

  const allPasses = [...resolved.playerPasses, ...resolved.teamPasses]
  const selectedPasses = allPasses.filter((pass) =>
    passMatchesRarityFilter(
      pass,
      resolved.rarities,
      pass.rarityLabel,
      legendaryPlusRarityFilter(),
    ),
  )
  const passesSkipped = allPasses.length - selectedPasses.length
  const selectedPassKeys = new Set(selectedPasses.map((pass) => `${pass.passKind}|${pass.pair}`))
  const cacheCandidatePasses = resolved.playerPasses
  const passesToFetch = uniquePasses([...selectedPasses, ...cacheCandidatePasses])

  if (selectedPasses.length === 0) {
    throw new Error('No Legendary+ passes found for this username.')
  }

  const entityIds = [...new Set(passesToFetch.map((pass) => pass.entityId))]
  const selectedPlayerPairs = passesToFetch
    .filter((pass) => pass.passKind === 'player')
    .map((pass) => pass.pair)
  const selectedTeamPairs = selectedPasses
    .filter((pass) => pass.passKind === 'team')
    .map((pass) => pass.pair)

  reportProgress?.({
    phase: 'resolving',
    current: 1,
    total: 1,
    label: 'Loading pass metadata…',
  })

  const otdPassRows = await fetchUserOtdPassMetadata(
    entityIds,
    selectedPlayerPairs,
    selectedTeamPairs,
    options?.signal,
  )
  const seasonLabelByKey = new Map(
    otdPassRows.map((row) => [
      passMetadataKey(row.entityId, row.season, row.sport),
      row.seasonLabel,
    ]),
  )
  const nameByKey = new Map(
    otdPassRows.map((row) => [passMetadataKey(row.entityId, row.season, row.sport), row.name]),
  )

  const cardDrafts: CardDraft[] = selectedPasses.map((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw)
    const externalKey = buildPlayerExternalKey(pass.entityId, pass.season, sport)
    const rarityNote = pass.rarityLabel ? ` · ${pass.rarityLabel}` : ''
    const metaKey = passMetadataKey(pass.entityId, pass.season, pass.sportRaw)
    const seasonLabel = resolvePassSeasonLabel(pass, seasonLabelByKey, metaKey)
    return {
      externalKey,
      name: nameByKey.get(metaKey) ?? passLabel(pass),
      sport,
      season: seasonLabel.trim(),
      notes: `Imported from @${username.replace(/^@/, '')}${rarityNote}`,
      rarityLabel: pass.rarityLabel,
      passKind: pass.passKind,
    }
  })

  const { data: withCards, cardsCreated, cardsUpdated, cardIdByExternalKey } = upsertCards(
    current,
    cardDrafts,
  )

  const cardIdsToReplace = new Set(cardIdByExternalKey.values())
  const performanceDrafts: PerformanceDraft[] = []
  const cachedProfiles: CachedPlayerEarningsProfile[] = []
  let fetchSkipped = 0
  const total = passesToFetch.length
  let completed = 0

  await runWithConcurrency(
    passesToFetch,
    concurrency,
    async (pass) => {
      const sport = mapMeowbotSport(pass.sportRaw) as Sport
      const externalKey = buildPlayerExternalKey(pass.entityId, pass.season, sport)
      const isSelectedPass = selectedPassKeys.has(`${pass.passKind}|${pass.pair}`)
      const label = passLabel(pass)
      const metaKey = passMetadataKey(pass.entityId, pass.season, pass.sportRaw)
      const seasonLabel = resolvePassSeasonLabel(pass, seasonLabelByKey, metaKey)
      const passName = nameByKey.get(metaKey) ?? label
      const passMeta = {
        name: passName,
        sport,
        season: seasonLabel.trim(),
        rarityLabel: pass.rarityLabel,
        externalKey,
        passKind: pass.passKind,
      }

      try {
        const dailyRows = await fetchDailyEarnings(
          {
            entityId: pass.entityId,
            season: pass.season,
            sport: pass.sportRaw,
            seasonLabel,
            passKind: pass.passKind,
          },
          options?.signal,
        )
        const cardId = cardIdByExternalKey.get(externalKey)
        if (dailyRows.length > 0) {
          const cached = parseRealAppToolsDailyRows(dailyRows)
          if (pass.passKind === 'player' && cached.rows.length > 0) {
            cachedProfiles.push({
              cacheKey: playerEarningsCacheKey({
                passKind: pass.passKind,
                sport,
                seasonYear: pass.season,
                entityId: pass.entityId,
              }),
              entityId: pass.entityId,
              sport,
              season: seasonLabel.trim(),
              seasonYear: pass.season,
              passKind: pass.passKind,
              name: passName,
              rarityLabel: pass.rarityLabel,
              externalKey,
              rows: cached.rows.map(
                (row): SavedCardEarningsRow => ({
                  claimDay: row.claimDay,
                  raxEarned: row.baseRaxEarned ?? row.raxEarned,
                  baseRaxEarned: row.baseRaxEarned ?? row.raxEarned,
                  note: row.note,
                }),
              ),
              source: 'username_import',
              updatedAt: nowIso(),
            })
          }
        }
        if (isSelectedPass && cardId && dailyRows.length > 0) {
          const parsed = parseRealAppToolsDailyRows(dailyRows, {
            sport: normalizeMeowbotSport(pass.sportRaw),
            rarityLabel: pass.rarityLabel,
            applyOtdMultiplier: true,
            passKind: pass.passKind,
          })
          fetchSkipped += parsed.skipped
          for (const entry of parsed.rows) {
            performanceDrafts.push({
              cardId,
              claimDay: entry.claimDay,
              raxEarned: entry.raxEarned,
              baseRaxEarned: entry.baseRaxEarned,
              note: entry.note,
            })
          }
        } else if (isSelectedPass && cardId && dailyRows.length === 0) {
          passesWithNoEarnings.push(passMeta)
          errors.push(
            `${passName}: no daily earnings returned — add RAX manually on the Entry page (Add card & earnings).`,
          )
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not fetch daily earnings.'
        if (isSelectedPass) {
          passFetchErrors.push({ ...passMeta, message })
          errors.push(`${passName}: ${message}`)
        }
      } finally {
        completed += 1
        reportProgress?.({
          phase: 'fetching',
          current: completed,
          total,
          label: passName,
        })
      }
    },
    options?.signal,
  )

  const { data: finalData, rowsImported, skipped } = mergePerformances(
    upsertCachedPlayerEarnings(withCards, cachedProfiles),
    performanceDrafts,
    cardIdsToReplace,
  )
  const ownedPasses: OwnedPassSnapshot[] = allPasses.map((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw) as Sport
    const externalKey = buildPlayerExternalKey(pass.entityId, pass.season, sport)
    const metaKey = passMetadataKey(pass.entityId, pass.season, pass.sportRaw)
    const seasonLabel = resolvePassSeasonLabel(pass, seasonLabelByKey, metaKey)
    return {
      name: nameByKey.get(metaKey) ?? passLabel(pass),
      sport,
      season: seasonLabel.trim(),
      seasonYear: pass.season,
      entityId: pass.entityId,
      rarityLabel: pass.rarityLabel,
      externalKey,
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
      cachedPlayerPasses: cachedProfiles.length,
      ownedPasses,
      errors,
      passesWithNoEarnings,
      passFetchErrors,
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
  const allPasses: MeowbotPlayerPass[] = rawPasses.map((pass) => {
    const sportRaw = rawSportFromDisplay(pass.sport)
    return {
      entityId: pass.entityId,
      season: pass.seasonYear,
      sportRaw,
      pair: `${pass.entityId}:${pass.seasonYear}:${sportRaw}`,
      passKind: pass.passKind,
      rarityLabel: pass.rarityLabel,
      playerName: pass.name,
      seasonLabel: pass.season,
    }
  })
  const selectedPasses = allPasses.filter((pass) => isLegendaryPlus(pass.rarityLabel))
  if (selectedPasses.length === 0) {
    throw new Error('No Legendary+ passes found in admin ownership snapshot for this username.')
  }

  const cardDrafts: CardDraft[] = selectedPasses.map((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw)
    return {
      externalKey: buildPlayerExternalKey(pass.entityId, pass.season, sport),
      name: pass.playerName ?? passLabel(pass),
      sport,
      season: (pass.seasonLabel ?? seasonLabelFromPass(pass.season, pass.sportRaw)).trim(),
      notes: `Recovered from admin snapshot for @${username.replace(/^@/, '').trim()}`,
      rarityLabel: pass.rarityLabel,
      passKind: pass.passKind,
    }
  })
  const { data: nextData, cardsCreated, cardsUpdated } = upsertCards(current, cardDrafts)

  reportProgress?.({
    phase: 'fetching',
    current: selectedPasses.length,
    total: selectedPasses.length,
    label: 'Imported pass list from admin snapshot',
  })

  const ownedPasses: OwnedPassSnapshot[] = allPasses.map((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw) as Sport
    return {
      name: pass.playerName ?? passLabel(pass),
      sport,
      season: (pass.seasonLabel ?? seasonLabelFromPass(pass.season, pass.sportRaw)).trim(),
      seasonYear: pass.season,
      entityId: pass.entityId,
      rarityLabel: pass.rarityLabel,
      externalKey: buildPlayerExternalKey(pass.entityId, pass.season, sport),
      passKind: pass.passKind,
    }
  })

  return {
    data: nextData,
    result: {
      cardsCreated,
      cardsUpdated,
      rowsImported: 0,
      skipped: 0,
      passesFetched: selectedPasses.length,
      passesSkipped: allPasses.length - selectedPasses.length,
      cachedPlayerPasses: 0,
      ownedPasses,
      errors: [],
      passesWithNoEarnings: [],
      passFetchErrors: [],
    },
  }
}
