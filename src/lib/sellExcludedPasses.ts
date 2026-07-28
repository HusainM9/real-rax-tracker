import { pruneSavedSellRankings } from './cardProfile'
import type { PlayerCard, RaxTrackerData } from '../types/rax'

export function sellExcludedCardIdSet(
  data: Pick<RaxTrackerData, 'sellExcludedCardIds'>,
): Set<string> {
  return new Set((data.sellExcludedCardIds ?? []).filter(Boolean))
}

export function isCardSellExcluded(
  data: Pick<RaxTrackerData, 'sellExcludedCardIds'>,
  cardId: string | undefined,
): boolean {
  if (!cardId) return false
  return sellExcludedCardIdSet(data).has(cardId)
}

/** Drop sell-excluded passes from the collection for If sold / plan sell baselines. */
export function withoutSellExcludedCards(data: RaxTrackerData): RaxTrackerData {
  const ids = data.sellExcludedCardIds ?? []
  if (ids.length === 0) return data
  const removed = new Set(ids)
  return {
    ...data,
    cards: data.cards.filter((card) => !removed.has(card.id)),
    performances: data.performances.filter((performance) => !removed.has(performance.cardId)),
  }
}

export function addSellExcludedCardId(data: RaxTrackerData, cardId: string): RaxTrackerData {
  const id = cardId.trim()
  if (!id || !data.cards.some((card) => card.id === id)) return data
  const existing = data.sellExcludedCardIds ?? []
  if (existing.includes(id)) return data
  return pruneSavedSellRankings(
    {
      ...data,
      sellExcludedCardIds: [...existing, id],
    },
    id,
  )
}

export function removeSellExcludedCardId(data: RaxTrackerData, cardId: string): RaxTrackerData {
  const id = cardId.trim()
  if (!id) return data
  const existing = data.sellExcludedCardIds ?? []
  if (!existing.includes(id)) return data
  return {
    ...data,
    sellExcludedCardIds: existing.filter((item) => item !== id),
  }
}

export function toggleSellExcludedCardId(data: RaxTrackerData, cardId: string): RaxTrackerData {
  if (isCardSellExcluded(data, cardId)) {
    return removeSellExcludedCardId(data, cardId)
  }
  return addSellExcludedCardId(data, cardId)
}

export function listSellExcludedCards(data: RaxTrackerData): PlayerCard[] {
  const excluded = sellExcludedCardIdSet(data)
  if (excluded.size === 0) return []
  return data.cards
    .filter((card) => excluded.has(card.id))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.sport.localeCompare(b.sport) ||
        a.season.localeCompare(b.season),
    )
}
