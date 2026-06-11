import { computeOtdRax } from './otdRax'
import type { CatalogImportProfile } from './catalogApi'
import { SPORTS, type RaxTrackerData, type Sport } from '../types/rax'

export type CatalogProfileImportResult = {
  cardId: string
  cardCreated: boolean
  rowsImported: number
  rowsUpdated: number
}

export function sportFromCatalog(sport: string): Sport {
  return SPORTS.find((item) => item.toLowerCase() === sport.trim().toLowerCase()) ?? 'Other'
}

function performanceNote(claimDay: string, playerBoxScoreId?: number | null): string {
  return `Meowbot catalog source ${claimDay}${
    playerBoxScoreId ? ` · box score ${playerBoxScoreId}` : ''
  } · OTD adjusted`
}

export function importCatalogProfileIntoData(
  current: RaxTrackerData,
  profile: CatalogImportProfile,
  options: {
    nowIso: string
    createId: (prefix: string) => string
  },
): { data: RaxTrackerData; result: CatalogProfileImportResult } {
  const timestamp = options.nowIso
  const sport = sportFromCatalog(profile.sport)
  const existingCard = current.cards.find((card) => card.externalKey === profile.externalKey)
  const cardId = existingCard?.id ?? options.createId('card')
  const result: CatalogProfileImportResult = {
    cardId,
    cardCreated: !existingCard,
    rowsImported: 0,
    rowsUpdated: 0,
  }

  const nextCards = existingCard
    ? current.cards.map((card) =>
        card.id === existingCard.id
          ? {
              ...card,
              name: profile.name.trim() || card.name,
              sport,
              season: profile.seasonLabel.trim() || card.season,
              externalKey: profile.externalKey,
              rarityLabel: profile.rarityLabel ?? card.rarityLabel,
              passKind: profile.passKind,
            }
          : card,
      )
    : [
        ...current.cards,
        {
          id: cardId,
          name: profile.name.trim() || 'Catalog player',
          sport,
          season: profile.seasonLabel.trim(),
          notes: 'Imported from Meowbot catalog',
          externalKey: profile.externalKey,
          rarityLabel: profile.rarityLabel,
          passKind: profile.passKind,
          createdAt: timestamp,
        },
      ]

  const incomingByDay = new Map(profile.rows.map((row) => [row.claimDay, row]))
  const nextPerformances = current.performances.map((performance) => {
    if (performance.cardId !== cardId) return performance
    const incoming = incomingByDay.get(performance.claimDay)
    if (!incoming) return performance
    incomingByDay.delete(performance.claimDay)
    result.rowsUpdated += 1
    return {
      ...performance,
      raxEarned: computeOtdRax(
        incoming.baseRaxEarned,
        sport,
        profile.rarityLabel,
        profile.passKind,
      ),
      baseRaxEarned: incoming.baseRaxEarned,
      note: performanceNote(incoming.claimDay, incoming.playerBoxScoreId),
    }
  })

  const newPerformances = [...incomingByDay.values()].map((row) => {
    result.rowsImported += 1
    return {
      id: options.createId('perf'),
      cardId,
      claimDay: row.claimDay,
      raxEarned: computeOtdRax(row.baseRaxEarned, sport, profile.rarityLabel, profile.passKind),
      baseRaxEarned: row.baseRaxEarned,
      note: performanceNote(row.claimDay, row.playerBoxScoreId),
      createdAt: timestamp,
    }
  })

  return {
    data: {
      ...current,
      cards: nextCards,
      performances: [...nextPerformances, ...newPerformances],
    },
    result,
  }
}

