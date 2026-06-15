import { computeOtdRax } from './otdRax'
import { getBaseRaxEarned, RARITY_PREVIEW_OPTIONS, sportToMeowbotSlug } from './effectiveRax'
import type { PlayerCard, RaxTrackerData } from '../types/rax'

export const CARD_RARITY_OPTIONS = RARITY_PREVIEW_OPTIONS.filter(
  (option): option is (typeof RARITY_PREVIEW_OPTIONS)[number] & string => option.length > 0,
)

export function rarityOptionsForCard(card: PlayerCard): string[] {
  const current = card.rarityLabel?.trim()
  if (!current) return [...CARD_RARITY_OPTIONS]
  if ((CARD_RARITY_OPTIONS as readonly string[]).includes(current)) return [...CARD_RARITY_OPTIONS]
  return [current, ...CARD_RARITY_OPTIONS]
}

export function applyCardRarityChange(
  data: RaxTrackerData,
  cardId: string,
  targetRarity: string,
): RaxTrackerData | null {
  const card = data.cards.find((item) => item.id === cardId)
  if (!card) return null

  const nextRarity = targetRarity.trim() || undefined
  if (card.rarityLabel === nextRarity && !card.simulatedRarityLabel) return data

  if (!nextRarity) {
    return {
      ...data,
      cards: data.cards.map((item) =>
        item.id === cardId
          ? { ...item, rarityLabel: undefined, simulatedRarityLabel: undefined }
          : item,
      ),
    }
  }

  const sportSlug = sportToMeowbotSlug(card.sport)
  const passKind = card.passKind ?? 'player'

  const nextPerformances = data.performances.map((performance) => {
    if (performance.cardId !== cardId) return performance
    const base = getBaseRaxEarned(performance, card)
    return {
      ...performance,
      baseRaxEarned: base,
      raxEarned: computeOtdRax(base, sportSlug, nextRarity, passKind),
    }
  })

  const nextCards = data.cards.map((item) =>
    item.id === cardId
      ? { ...item, rarityLabel: nextRarity, simulatedRarityLabel: undefined }
      : item,
  )

  return { ...data, cards: nextCards, performances: nextPerformances }
}

export function formatCardRarityChangeMessage(
  cardName: string,
  fromRarity: string | undefined,
  toRarity: string | undefined,
): string {
  const fromLabel = fromRarity?.trim() || 'Unknown'
  const toLabel = toRarity?.trim() || 'Unknown'
  return `Change ${cardName || 'this card'} from ${fromLabel} to ${toLabel}?`
}
