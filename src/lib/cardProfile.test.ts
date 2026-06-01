import { describe, expect, it } from 'vitest'
import {
  buildSavedCardProfile,
  profileMatchKey,
  restoreSavedCardProfile,
  upsertSavedCardProfile,
} from './cardProfile'
import { createEmptyData } from './storage'
import type { PlayerCard, RaxPerformance } from '../types/rax'

const card: PlayerCard = {
  id: 'card-1',
  name: 'Patrick Mahomes',
  sport: 'NFL',
  season: '2023',
  notes: 'Imported from @user · Legendary 5',
  externalKey: 'player:123:2023:NFL',
  rarityLabel: 'Legendary 5',
  passKind: 'player',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const performances: RaxPerformance[] = [
  {
    id: 'perf-1',
    cardId: 'card-1',
    claimDay: '2024-01-21',
    raxEarned: 105,
    baseRaxEarned: 42,
    note: 'realapp.com source 2024-01-21',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

describe('cardProfile', () => {
  it('upserts profiles by external key', () => {
    const profile = buildSavedCardProfile({ card, performances, rawJson: '{"earnings":[]}' })
    const first = upsertSavedCardProfile(createEmptyData(), profile)
    expect(first.savedCardProfiles).toHaveLength(1)

    const updatedProfile = buildSavedCardProfile({
      card,
      performances: [
        ...performances,
        {
          ...performances[0]!,
          id: 'perf-2',
          claimDay: '2024-01-15',
          raxEarned: 152,
          baseRaxEarned: 61,
        },
      ],
    })
    const second = upsertSavedCardProfile(first, {
      ...updatedProfile,
      id: profile.id,
      createdAt: profile.createdAt,
    })
    expect(second.savedCardProfiles).toHaveLength(1)
    expect(second.savedCardProfiles[0]?.rows).toHaveLength(2)
  })

  it('restores earnings onto a re-imported card matched by external key', () => {
    const profile = buildSavedCardProfile({ card, performances })
    const saved = upsertSavedCardProfile(createEmptyData(), profile)
    const reimportedCard: PlayerCard = {
      ...card,
      id: 'card-reimported',
      notes: 'Imported from @user · Legendary 5',
    }
    const afterImport = {
      ...saved,
      cards: [reimportedCard],
      performances: [],
    }

    const restored = restoreSavedCardProfile(afterImport, profile.id)
    expect(restored?.cardId).toBe('card-reimported')
    expect(restored?.rowsRestored).toBe(1)
    expect(restored?.data.performances[0]?.cardId).toBe('card-reimported')
    expect(restored?.data.performances[0]?.raxEarned).toBe(105)
  })

  it('creates a new card when no match exists', () => {
    const profile = buildSavedCardProfile({
      card: { ...card, externalKey: undefined },
      performances,
    })
    const saved = upsertSavedCardProfile(createEmptyData(), profile)
    const restored = restoreSavedCardProfile(saved, profile.id)

    expect(restored?.data.cards).toHaveLength(1)
    expect(restored?.data.cards[0]?.name).toBe('Patrick Mahomes')
    expect(restored?.data.performances).toHaveLength(1)
  })

  it('matches manual cards by name sport and season', () => {
    expect(profileMatchKey(card)).toBe('key:player:123:2023:NFL')
    expect(
      profileMatchKey({
        name: 'Patrick Mahomes',
        sport: 'NFL',
        season: '2023',
      }),
    ).toBe('name:patrick mahomes|NFL|2023')
  })
})
