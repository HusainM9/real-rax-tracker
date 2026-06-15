import { createId } from './id'
import type {
  PlayerCard,
  RaxPerformance,
  RaxTrackerData,
  SavedCardEarningsRow,
  SavedCardProfile,
} from '../types/rax'

export function profileMatchKey(profile: {
  externalKey?: string
  name: string
  sport: string
  season: string
}): string {
  if (profile.externalKey) return `key:${profile.externalKey}`
  return `name:${profile.name.trim().toLowerCase()}|${profile.sport}|${profile.season.trim().toLowerCase()}`
}

export function buildSavedCardProfile(input: {
  card: PlayerCard
  performances: RaxPerformance[]
  rawJson?: string
  profileId?: string
  createdAt?: string
}): SavedCardProfile {
  const timestamp = new Date().toISOString()
  return {
    id: input.profileId ?? createId('saved'),
    externalKey: input.card.externalKey,
    name: input.card.name,
    sport: input.card.sport,
    season: input.card.season,
    notes: input.card.notes,
    rarityLabel: input.card.rarityLabel,
    passKind: input.card.passKind,
    rawJson: input.rawJson?.trim() ?? '',
    rows: input.performances
      .filter((performance) => performance.raxEarned > 0 && performance.claimDay)
      .map(
        (performance): SavedCardEarningsRow => ({
          claimDay: performance.claimDay,
          raxEarned: performance.raxEarned,
          baseRaxEarned: performance.baseRaxEarned,
          note: performance.note,
        }),
      )
      .sort((a, b) => b.claimDay.localeCompare(a.claimDay)),
    createdAt: input.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}

export function upsertSavedCardProfile(
  current: RaxTrackerData,
  profile: SavedCardProfile,
): RaxTrackerData {
  const key = profileMatchKey(profile)
  const existingIndex = current.savedCardProfiles.findIndex(
    (item) => profileMatchKey(item) === key,
  )
  const savedCardProfiles = [...current.savedCardProfiles]

  if (existingIndex >= 0) {
    savedCardProfiles[existingIndex] = {
      ...profile,
      id: savedCardProfiles[existingIndex]!.id,
      createdAt: savedCardProfiles[existingIndex]!.createdAt,
      updatedAt: new Date().toISOString(),
    }
  } else {
    savedCardProfiles.push(profile)
  }

  return { ...current, savedCardProfiles }
}

function findCardForProfile(
  cards: PlayerCard[],
  profile: SavedCardProfile,
): PlayerCard | undefined {
  if (profile.externalKey) {
    const byKey = cards.find((card) => card.externalKey === profile.externalKey)
    if (byKey) return byKey
  }

  const normalizedName = profile.name.trim().toLowerCase()
  const normalizedSeason = profile.season.trim().toLowerCase()
  return cards.find(
    (card) =>
      card.name.trim().toLowerCase() === normalizedName &&
      card.sport === profile.sport &&
      card.season.trim().toLowerCase() === normalizedSeason,
  )
}

export function restoreSavedCardProfile(
  current: RaxTrackerData,
  profileId: string,
): { data: RaxTrackerData; cardId: string; rowsRestored: number } | null {
  const profile = current.savedCardProfiles.find((item) => item.id === profileId)
  if (!profile || profile.rows.length === 0) return null

  let cards = [...current.cards]
  let cardId = findCardForProfile(cards, profile)?.id

  if (!cardId) {
    cardId = createId('card')
    cards.push({
      id: cardId,
      name: profile.name,
      sport: profile.sport,
      season: profile.season,
      notes: profile.notes,
      externalKey: profile.externalKey,
      rarityLabel: profile.rarityLabel,
      passKind: profile.passKind,
      createdAt: new Date().toISOString(),
    })
  } else {
    const index = cards.findIndex((card) => card.id === cardId)
    if (index >= 0) {
      cards[index] = {
        ...cards[index]!,
        name: profile.name || cards[index]!.name,
        sport: profile.sport,
        season: profile.season || cards[index]!.season,
        notes: profile.notes || cards[index]!.notes,
        rarityLabel: profile.rarityLabel ?? cards[index]!.rarityLabel,
        passKind: profile.passKind ?? cards[index]!.passKind,
        externalKey: profile.externalKey ?? cards[index]!.externalKey,
        simulatedRarityLabel: undefined,
      }
    }
  }

  const keptPerformances = current.performances.filter((performance) => performance.cardId !== cardId)
  const createdAt = new Date().toISOString()
  const restoredPerformances: RaxPerformance[] = profile.rows.map((row) => ({
    id: createId('perf'),
    cardId,
    claimDay: row.claimDay,
    raxEarned: row.raxEarned,
    baseRaxEarned: row.baseRaxEarned,
    note: row.note,
    createdAt,
  }))

  return {
    data: {
      ...current,
      cards,
      performances: keptPerformances.concat(restoredPerformances),
    },
    cardId,
    rowsRestored: restoredPerformances.length,
  }
}

export type RemoveCardFromCollectionOptions = {
  /** When true (default), snapshot earnings to saved profiles before deleting. */
  archiveProfile?: boolean
  removedNote?: string
}

export function formatRemoveCardConfirmMessage(card: {
  name: string
  sport: string
  season: string
}): string {
  const label = [card.name, card.sport, card.season].filter(Boolean).join(' · ')
  return (
    `Remove ${label} from your collection?\n\n` +
    'Earnings will be saved under Entry → Saved profiles so you can restore the pass later. ' +
    'Dashboard and claim totals will update immediately.'
  )
}

export function pruneSavedSellRankings(data: RaxTrackerData, cardId: string): RaxTrackerData {
  const saved = data.savedSellRankings
  if (!saved) return data

  const rows = saved.rows.filter((row) => row.cardId !== cardId)
  const skippedPlayerPasses = saved.skippedPlayerPasses.filter((row) => row.cardId !== cardId)
  if (
    rows.length === saved.rows.length &&
    skippedPlayerPasses.length === saved.skippedPlayerPasses.length
  ) {
    return data
  }

  return {
    ...data,
    savedSellRankings: {
      ...saved,
      rows,
      skippedPlayerPasses,
    },
  }
}

export function removeCardFromCollection(
  data: RaxTrackerData,
  cardId: string,
  options?: RemoveCardFromCollectionOptions,
): RaxTrackerData | null {
  const card = data.cards.find((item) => item.id === cardId)
  if (!card) return null

  const archiveProfile = options?.archiveProfile !== false
  const performances = data.performances.filter((performance) => performance.cardId === cardId)

  let next = data
  if (archiveProfile && performances.length > 0) {
    const removedNote = options?.removedNote?.trim() || 'Removed from collection'
    const notes = card.notes.trim() ? `${card.notes.trim()} · ${removedNote}` : removedNote
    const profile = buildSavedCardProfile({
      card: { ...card, notes },
      performances,
    })
    next = upsertSavedCardProfile(next, profile)
  }

  next = {
    ...next,
    cards: next.cards.filter((item) => item.id !== cardId),
    performances: next.performances.filter((performance) => performance.cardId !== cardId),
  }

  return pruneSavedSellRankings(next, cardId)
}
