import { removeCardFromCollection } from './cardProfile'
import type { PlayerCard, RaxTrackerData, Sport } from '../types/rax'

export type IgnoredPassRow = {
  externalKey: string
  name: string
  sport: Sport | string
  season: string
}

export function ignoredPassKeySet(data: Pick<RaxTrackerData, 'ignoredPassKeys'>): Set<string> {
  return new Set((data.ignoredPassKeys ?? []).filter(Boolean))
}

export function isPassKeyIgnored(
  data: Pick<RaxTrackerData, 'ignoredPassKeys'>,
  externalKey: string | undefined,
): boolean {
  if (!externalKey) return false
  return ignoredPassKeySet(data).has(externalKey)
}

export function addIgnoredPassKey(data: RaxTrackerData, externalKey: string): RaxTrackerData {
  const key = externalKey.trim()
  if (!key) return data
  const existing = data.ignoredPassKeys ?? []
  if (existing.includes(key)) return data
  return {
    ...data,
    ignoredPassKeys: [...existing, key],
  }
}

export function removeIgnoredPassKey(data: RaxTrackerData, externalKey: string): RaxTrackerData {
  const key = externalKey.trim()
  if (!key) return data
  const existing = data.ignoredPassKeys ?? []
  if (!existing.includes(key)) return data
  return {
    ...data,
    ignoredPassKeys: existing.filter((item) => item !== key),
  }
}

export function formatIgnorePassConfirmMessage(card: Pick<PlayerCard, 'name' | 'sport' | 'season'>): string {
  const label = [card.name, card.sport, card.season].filter(Boolean).join(' · ')
  return (
    `Ignore ${label} on import?\n\n` +
    'Removes it from your collection and skips it on every future username import. ' +
    'You can un-ignore it later from Ignored passes.'
  )
}

/**
 * Adds the card's externalKey to the ignore list and removes the card (+ performances)
 * from the local collection. Archives earnings under Saved profiles when present.
 */
export function ignorePassOnImport(data: RaxTrackerData, cardId: string): RaxTrackerData | null {
  const card = data.cards.find((item) => item.id === cardId)
  if (!card?.externalKey) return null

  const withIgnore = addIgnoredPassKey(data, card.externalKey)
  return (
    removeCardFromCollection(withIgnore, cardId, {
      removedNote: `Ignored on import ${new Date().toISOString().slice(0, 10)}`,
    }) ?? withIgnore
  )
}

export function listIgnoredPasses(data: RaxTrackerData): IgnoredPassRow[] {
  const keys = data.ignoredPassKeys ?? []
  if (keys.length === 0) return []

  const profileByKey = new Map(
    data.savedCardProfiles
      .filter((profile) => profile.externalKey)
      .map((profile) => [profile.externalKey as string, profile]),
  )
  const cardByKey = new Map(
    data.cards
      .filter((card) => card.externalKey)
      .map((card) => [card.externalKey as string, card]),
  )

  return keys.map((externalKey) => {
    const profile = profileByKey.get(externalKey)
    const card = cardByKey.get(externalKey)
    const source = profile ?? card
    return {
      externalKey,
      name: source?.name?.trim() || externalKey,
      sport: source?.sport ?? '',
      season: source?.season ?? '',
    }
  })
}
