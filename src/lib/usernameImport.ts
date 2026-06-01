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
import { parseRealAppToolsDailyRows } from './realAppToolsImport'
import { legendaryPlusRarityFilter, passMatchesRarityFilter } from './rarityFilter'
import { passMetadataKey, seasonLabelFromPass, isGolfSport } from './seasonLabel'
import type { PlayerCard, RaxPerformance, RaxTrackerData, Sport } from '../types/rax'

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
  errors: string[]
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

function nowIso(): string {
  return new Date().toISOString()
}

function passLabel(pass: MeowbotPlayerPass): string {
  if (pass.playerName) return pass.playerName
  return pass.passKind === 'team' ? `Team ${pass.entityId}` : `Player ${pass.entityId}`
}

function resolvePassSeasonLabel(
  pass: MeowbotPlayerPass,
  seasonLabelByKey: Map<string, string>,
  metaKey: string,
): string {
  if (isGolfSport(pass.sportRaw)) {
    return String(pass.season)
  }

  return (
    seasonLabelByKey.get(metaKey) ??
    pass.seasonLabel ??
    seasonLabelFromPass(pass.season, pass.sportRaw)
  ).trim()
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

export async function importFromUsername(
  current: RaxTrackerData,
  username: string,
  options?: UsernameImportOptions,
): Promise<{ data: RaxTrackerData; result: UsernameImportResult }> {
  const errors: string[] = []
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

  if (selectedPasses.length === 0) {
    throw new Error('No Legendary+ passes found for this username.')
  }

  const entityIds = [...new Set(selectedPasses.map((pass) => pass.entityId))]
  const selectedPlayerPairs = selectedPasses
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
  let fetchSkipped = 0
  const total = selectedPasses.length
  let completed = 0

  await runWithConcurrency(
    selectedPasses,
    concurrency,
    async (pass) => {
      const sport = mapMeowbotSport(pass.sportRaw) as Sport
      const externalKey = buildPlayerExternalKey(pass.entityId, pass.season, sport)
      const label = passLabel(pass)
      const metaKey = passMetadataKey(pass.entityId, pass.season, pass.sportRaw)
      const seasonLabel = resolvePassSeasonLabel(pass, seasonLabelByKey, metaKey)

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
          errors.push(`${label}: no daily earnings returned (check season/sport mapping).`)
        }
      } catch (error) {
        errors.push(
          `${label}: ${error instanceof Error ? error.message : 'Could not fetch daily earnings.'}`,
        )
      } finally {
        completed += 1
        reportProgress?.({
          phase: 'fetching',
          current: completed,
          total,
          label,
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

  return {
    data: finalData,
    result: {
      cardsCreated,
      cardsUpdated,
      rowsImported,
      skipped: skipped + fetchSkipped,
      passesFetched: selectedPasses.length,
      passesSkipped,
      errors,
    },
  }
}
