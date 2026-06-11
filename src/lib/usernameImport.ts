import { importCatalogProfileIntoData, sportFromCatalog } from './catalogImport'
import { fetchCatalogImportProfile, type CatalogImportProfile } from './catalogApi'
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
import { computeOtdRax } from './otdRax'
import { parseRealAppToolsDailyRows } from './realAppToolsImport'
import { legendaryPlusRarityFilter, passMatchesRarityFilter } from './rarityFilter'
import { passMetadataKey, seasonLabelFromPass, isCalendarYearSport } from './seasonLabel'
import type {
  PlayerCard,
  RaxPerformance,
  RaxTrackerData,
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
  cachedProfiles: []
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

function resolvePassMeta(pass: MeowbotPlayerPass, seasonLabelByKey?: Map<string, string>): {
  sport: Sport
  seasonLabel: string
  externalKey: string
  passName: string
} {
  const sport = mapMeowbotSport(pass.sportRaw) as Sport
  const metaKey = passMetadataKey(pass.entityId, pass.season, pass.sportRaw)
  const seasonLabel = isCalendarYearSport(pass.sportRaw)
    ? String(pass.season)
    : (pass.seasonLabel ?? seasonLabelByKey?.get(metaKey) ?? seasonLabelFromPass(pass.season, pass.sportRaw)).trim()
  return {
    sport,
    seasonLabel,
    externalKey: buildPlayerExternalKey(pass.entityId, pass.season, sport),
    passName: pass.playerName ?? passLabel(pass),
  }
}

async function attachCatalogEarningsForPasses(
  current: RaxTrackerData,
  passes: MeowbotPlayerPass[],
  options?: Pick<UsernameImportOptions, 'signal' | 'onProgress'>,
): Promise<{
  data: RaxTrackerData
  rowsImported: number
  rowsUpdated: number
  passesWithNoEarnings: PassWithNoEarnings[]
  passFetchErrors: PassFetchError[]
  errors: string[]
  catalogConfigured: boolean
}> {
  const passesWithNoEarnings: PassWithNoEarnings[] = []
  const passFetchErrors: PassFetchError[] = []
  const errors: string[] = []
  let data = current
  let rowsImported = 0
  let rowsUpdated = 0
  let catalogConfigured = true
  let completed = 0
  const total = passes.length
  const reportProgress = options?.onProgress
    ? createThrottledProgress(options.onProgress)
    : undefined

  await runWithConcurrency(
    passes,
    DEFAULT_IMPORT_CONCURRENCY,
    async (pass) => {
      const { sport, seasonLabel, externalKey, passName } = resolvePassMeta(pass)
      const passMeta = {
        name: passName,
        sport,
        season: seasonLabel,
        rarityLabel: pass.rarityLabel,
        externalKey,
        passKind: pass.passKind,
      }

      try {
        const { profile, storageConfigured } = await fetchCatalogImportProfile(
          externalKey,
          options?.signal,
        )
        if (!storageConfigured) {
          catalogConfigured = false
          return
        }
        if (!profile) {
          if (pass.passKind === 'player') {
            passFetchErrors.push({
              ...passMeta,
              message: 'Pass was not found in the shared catalog.',
            })
            errors.push(`${passName}: not found in shared catalog.`)
          }
          return
        }
        if (profile.rows.length === 0) {
          if (pass.passKind === 'player') {
            passesWithNoEarnings.push(passMeta)
            errors.push(`${passName}: no daily RAX rows in shared catalog yet.`)
          }
          return
        }

        const enrichedProfile: CatalogImportProfile = {
          ...profile,
          name: profile.name.trim() || passName,
          rarityLabel: pass.rarityLabel ?? profile.rarityLabel,
          passKind: pass.passKind,
        }
        const imported = importCatalogProfileIntoData(data, enrichedProfile, {
          nowIso: nowIso(),
          createId,
        })
        data = imported.data
        rowsImported += imported.result.rowsImported
        rowsUpdated += imported.result.rowsUpdated
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load catalog earnings.'
        if (pass.passKind === 'player') {
          passFetchErrors.push({ ...passMeta, message })
        }
        errors.push(`${passName}: ${message}`)
      } finally {
        completed += 1
        reportProgress?.({
          phase: 'fetching',
          current: completed,
          total,
          label: `${passName} · catalog RAX`,
        })
      }
    },
    options?.signal,
  )

  return {
    data,
    rowsImported,
    rowsUpdated,
    passesWithNoEarnings,
    passFetchErrors,
    errors:
      !catalogConfigured && passes.length > 0
        ? [...errors, 'Shared catalog is not configured — cards were added without RAX.']
        : errors,
    catalogConfigured,
  }
}

function catalogPerformanceDrafts(
  cardId: string,
  profile: CatalogImportProfile,
): PerformanceDraft[] {
  const sport = sportFromCatalog(profile.sport)
  return profile.rows.map((row) => ({
    cardId,
    claimDay: row.claimDay,
    raxEarned: computeOtdRax(row.baseRaxEarned, sport, profile.rarityLabel, profile.passKind),
    baseRaxEarned: row.baseRaxEarned,
    note: `Meowbot catalog source ${row.claimDay}${
      row.playerBoxScoreId ? ` · box score ${row.playerBoxScoreId}` : ''
    } · OTD adjusted`,
  }))
}

async function loadCatalogPerformanceDrafts(
  externalKey: string,
  pass: MeowbotPlayerPass,
  passName: string,
  cardId: string,
  signal?: AbortSignal,
): Promise<PerformanceDraft[]> {
  const { profile, storageConfigured } = await fetchCatalogImportProfile(externalKey, signal)
  if (!storageConfigured || !profile || profile.rows.length === 0) return []

  const enrichedProfile: CatalogImportProfile = {
    ...profile,
    name: profile.name.trim() || passName,
    rarityLabel: pass.rarityLabel ?? profile.rarityLabel,
    passKind: pass.passKind,
  }
  return catalogPerformanceDrafts(cardId, enrichedProfile)
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
  const passesToFetch = uniquePasses(selectedPasses)

  if (selectedPasses.length === 0) {
    throw new Error('No Legendary+ passes found for this username.')
  }

  const entityIds = [...new Set(passesToFetch.map((pass) => pass.entityId))]
  const selectedPlayerPairs = passesToFetch
    .filter((pass) => pass.passKind === 'player')
    .map((pass) => pass.pair)
  const selectedTeamPairs = passesToFetch
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
  let fetchSkipped = 0
  const total = passesToFetch.length
  let completed = 0

  await runWithConcurrency(
    passesToFetch,
    concurrency,
    async (pass) => {
      const sport = mapMeowbotSport(pass.sportRaw) as Sport
      const externalKey = buildPlayerExternalKey(pass.entityId, pass.season, sport)
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
      const cardId = cardIdByExternalKey.get(externalKey)

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
        if (cardId && dailyRows.length > 0) {
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
        } else if (cardId && dailyRows.length === 0) {
          const catalogDrafts = await loadCatalogPerformanceDrafts(
            externalKey,
            pass,
            passName,
            cardId,
            options?.signal,
          )
          if (catalogDrafts.length > 0) {
            performanceDrafts.push(...catalogDrafts)
          } else {
            passesWithNoEarnings.push(passMeta)
            errors.push(
              `${passName}: no daily earnings from Meowbot or shared catalog — add RAX manually on the Entry page (Add card & earnings).`,
            )
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Could not fetch daily earnings.'
        if (cardId) {
          try {
            const catalogDrafts = await loadCatalogPerformanceDrafts(
              externalKey,
              pass,
              passName,
              cardId,
              options?.signal,
            )
            if (catalogDrafts.length > 0) {
              performanceDrafts.push(...catalogDrafts)
            } else {
              passFetchErrors.push({ ...passMeta, message })
              errors.push(`${passName}: ${message}`)
            }
          } catch {
            passFetchErrors.push({ ...passMeta, message })
            errors.push(`${passName}: ${message}`)
          }
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
    withCards,
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
      cachedPlayerPasses: 0,
      ownedPasses,
      cachedProfiles: [],
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
    const seasonLabel = isCalendarYearSport(pass.sportRaw)
      ? String(pass.season)
      : (pass.seasonLabel ?? seasonLabelFromPass(pass.season, pass.sportRaw)).trim()
    return {
      externalKey: buildPlayerExternalKey(pass.entityId, pass.season, sport),
      name: pass.playerName ?? passLabel(pass),
      sport,
      season: seasonLabel,
      notes: `Recovered from admin snapshot for @${username.replace(/^@/, '').trim()}`,
      rarityLabel: pass.rarityLabel,
      passKind: pass.passKind,
    }
  })
  const { data: nextData, cardsCreated, cardsUpdated } = upsertCards(current, cardDrafts)

  const catalogAttach = await attachCatalogEarningsForPasses(nextData, selectedPasses, options)
  const finalData = catalogAttach.data

  reportProgress?.({
    phase: 'fetching',
    current: selectedPasses.length,
    total: selectedPasses.length,
    label: 'Finished admin snapshot import',
  })

  const ownedPasses: OwnedPassSnapshot[] = allPasses.map((pass) => {
    const sport = mapMeowbotSport(pass.sportRaw) as Sport
    const seasonLabel = isCalendarYearSport(pass.sportRaw)
      ? String(pass.season)
      : (pass.seasonLabel ?? seasonLabelFromPass(pass.season, pass.sportRaw)).trim()
    return {
      name: pass.playerName ?? passLabel(pass),
      sport,
      season: seasonLabel,
      seasonYear: pass.season,
      entityId: pass.entityId,
      rarityLabel: pass.rarityLabel,
      externalKey: buildPlayerExternalKey(pass.entityId, pass.season, sport),
      passKind: pass.passKind,
    }
  })

  return {
    data: finalData,
    result: {
      cardsCreated,
      cardsUpdated,
      rowsImported: catalogAttach.rowsImported,
      skipped: 0,
      passesFetched: selectedPasses.length,
      passesSkipped: allPasses.length - selectedPasses.length,
      cachedPlayerPasses: 0,
      ownedPasses,
      cachedProfiles: [],
      errors: catalogAttach.errors,
      passesWithNoEarnings: catalogAttach.passesWithNoEarnings,
      passFetchErrors: catalogAttach.passFetchErrors,
    },
  }
}
