import { pruneSavedSellRankings } from './cardProfile'
import type { PlayerCard, RaxTrackerData } from '../types/rax'

function cardSellExclusionKey(card: Pick<PlayerCard, 'id' | 'externalKey'>): string {
  const externalKey = card.externalKey?.trim()
  if (externalKey) return externalKey
  return `id:${card.id}`
}

function isLegacyCardIdKey(key: string): boolean {
  return key.startsWith('id:')
}

export function sellExcludedPassKeySet(
  data: Pick<RaxTrackerData, 'sellExcludedPassKeys' | 'sellExcludedCardIds'>,
): Set<string> {
  const keys = new Set<string>()
  for (const key of data.sellExcludedPassKeys ?? []) {
    const trimmed = key.trim()
    if (trimmed) keys.add(trimmed)
  }
  // Legacy card-id list — kept only until normalize migrates; still honor at runtime.
  for (const id of data.sellExcludedCardIds ?? []) {
    const trimmed = id.trim()
    if (trimmed) keys.add(`id:${trimmed}`)
  }
  return keys
}

export function isCardSellExcluded(
  data: Pick<RaxTrackerData, 'sellExcludedPassKeys' | 'sellExcludedCardIds' | 'cards'>,
  cardId: string | undefined,
): boolean {
  if (!cardId) return false
  const card = data.cards.find((item) => item.id === cardId)
  if (!card) {
    return sellExcludedPassKeySet(data).has(`id:${cardId}`)
  }
  const keys = sellExcludedPassKeySet(data)
  if (keys.has(cardSellExclusionKey(card))) return true
  if (card.externalKey?.trim() && keys.has(`id:${card.id}`)) return true
  return false
}

/** Drop sell-excluded passes from the collection for If sold / plan sell baselines. */
export function withoutSellExcludedCards(data: RaxTrackerData): RaxTrackerData {
  const keys = sellExcludedPassKeySet(data)
  if (keys.size === 0) return data
  const removedIds = new Set(
    data.cards.filter((card) => keys.has(cardSellExclusionKey(card)) || keys.has(`id:${card.id}`)).map(
      (card) => card.id,
    ),
  )
  if (removedIds.size === 0) return data
  return {
    ...data,
    cards: data.cards.filter((card) => !removedIds.has(card.id)),
    performances: data.performances.filter((performance) => !removedIds.has(performance.cardId)),
  }
}

export function addSellExcludedCardId(data: RaxTrackerData, cardId: string): RaxTrackerData {
  const id = cardId.trim()
  if (!id) return data
  const card = data.cards.find((item) => item.id === id)
  if (!card) return data
  const key = cardSellExclusionKey(card)
  const existing = data.sellExcludedPassKeys ?? []
  if (existing.includes(key) || isCardSellExcluded(data, id)) {
    // Already excluded (possibly via legacy card-id entry) — ensure key form is stored.
    if (existing.includes(key)) return data
  }
  return pruneSavedSellRankings(
    {
      ...data,
      sellExcludedPassKeys: existing.includes(key) ? existing : [...existing, key],
      // Drop legacy card-id entry for this card once migrated to a stable key.
      sellExcludedCardIds: (data.sellExcludedCardIds ?? []).filter((item) => item !== id),
    },
    id,
  )
}

export function removeSellExcludedCardId(data: RaxTrackerData, cardId: string): RaxTrackerData {
  const id = cardId.trim()
  if (!id) return data
  const card = data.cards.find((item) => item.id === id)
  const key = card ? cardSellExclusionKey(card) : `id:${id}`
  const existingKeys = data.sellExcludedPassKeys ?? []
  const existingIds = data.sellExcludedCardIds ?? []
  const nextKeys = existingKeys.filter((item) => item !== key && item !== `id:${id}`)
  const nextIds = existingIds.filter((item) => item !== id)
  if (nextKeys.length === existingKeys.length && nextIds.length === existingIds.length) {
    return data
  }
  return {
    ...data,
    sellExcludedPassKeys: nextKeys,
    sellExcludedCardIds: nextIds,
  }
}

export function toggleSellExcludedCardId(data: RaxTrackerData, cardId: string): RaxTrackerData {
  if (isCardSellExcluded(data, cardId)) {
    return removeSellExcludedCardId(data, cardId)
  }
  return addSellExcludedCardId(data, cardId)
}

export function listSellExcludedCards(data: RaxTrackerData): PlayerCard[] {
  const keys = sellExcludedPassKeySet(data)
  if (keys.size === 0) return []
  return data.cards
    .filter((card) => keys.has(cardSellExclusionKey(card)) || keys.has(`id:${card.id}`))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.sport.localeCompare(b.sport) ||
        a.season.localeCompare(b.season),
    )
}

/** Migrate legacy card-id exclusions to stable pass keys; drop unknown ids. */
export function hydrateSellExcludedPassKeys(
  rawKeys: unknown,
  legacyCardIds: unknown,
  cards: PlayerCard[],
): string[] {
  const cardById = new Map(cards.map((card) => [card.id, card]))
  const seen = new Set<string>()
  const keys: string[] = []

  const push = (key: string) => {
    const trimmed = key.trim()
    if (!trimmed || seen.has(trimmed)) return
    // Drop orphaned legacy id keys that no longer match a card.
    if (isLegacyCardIdKey(trimmed)) {
      const id = trimmed.slice(3)
      if (!cardById.has(id)) return
    }
    seen.add(trimmed)
    keys.push(trimmed)
  }

  if (Array.isArray(rawKeys)) {
    for (const entry of rawKeys) {
      if (typeof entry === 'string') push(entry)
    }
  }

  if (Array.isArray(legacyCardIds)) {
    for (const entry of legacyCardIds) {
      if (typeof entry !== 'string') continue
      const id = entry.trim()
      if (!id) continue
      const card = cardById.get(id)
      if (!card) continue
      push(cardSellExclusionKey(card))
    }
  }

  return keys
}
