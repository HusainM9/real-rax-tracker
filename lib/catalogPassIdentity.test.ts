import { describe, expect, it } from 'vitest'
import {
  catalogPassIdentityKey,
  catalogPassIdentityKeyFromOwnedCard,
  dedupeCatalogPassSummaries,
} from './catalogPassIdentity'

describe('catalogPassIdentity', () => {
  it('treats duplicate CBB rows with different external keys as one player', () => {
    const keyA = catalogPassIdentityKey({
      passKind: 'player',
      sport: 'CBB',
      seasonYear: 2025,
      seasonLabel: '2024-25',
      name: 'Maxime Raynaud',
      entityId: 111,
      externalKey: '111|2025|CBB',
    })
    const keyB = catalogPassIdentityKey({
      passKind: 'player',
      sport: 'CBB',
      seasonYear: 2025,
      seasonLabel: '2024-25',
      name: 'Maxime Raynaud',
      entityId: 222,
      externalKey: '222|2025|CBB',
    })
    expect(keyA).toBe(keyB)
  })

  it('keeps the highest base rax duplicate', () => {
    const { items, duplicatesRemoved } = dedupeCatalogPassSummaries([
      {
        passKind: 'player' as const,
        sport: 'CBB',
        seasonYear: 2025,
        seasonLabel: '2024-25',
        name: 'Dalton Knecht',
        entityId: 1,
        externalKey: '1|2025|CBB',
        totalBaseRax: 300,
        rowCount: 80,
      },
      {
        passKind: 'player' as const,
        sport: 'CBB',
        seasonYear: 2025,
        seasonLabel: '2024-25',
        name: 'Dalton Knecht',
        entityId: 2,
        externalKey: '2|2025|CBB',
        totalBaseRax: 343,
        rowCount: 80,
      },
    ])

    expect(duplicatesRemoved).toBe(1)
    expect(items).toHaveLength(1)
    expect(items[0]?.externalKey).toBe('2|2025|CBB')
  })

  it('matches owned cards to catalog passes by name and season', () => {
    const ownedKey = catalogPassIdentityKeyFromOwnedCard({
      passKind: 'player',
      sport: 'CBB',
      season: '2024-25',
      name: 'Maxime Raynaud',
      externalKey: '999|2025|CBB',
    })
    const catalogKey = catalogPassIdentityKey({
      passKind: 'player',
      sport: 'CBB',
      seasonYear: 2025,
      seasonLabel: '2024-25',
      name: 'Maxime Raynaud',
      entityId: 111,
      externalKey: '111|2025|CBB',
    })
    expect(ownedKey).toBe(catalogKey)
  })

  it('matches NFL owned cards when season is stored as end year instead of label', () => {
    const ownedKey = catalogPassIdentityKeyFromOwnedCard({
      passKind: 'player',
      sport: 'NFL',
      season: '2024',
      name: 'Ceedee Lamb',
      externalKey: '12345|2024|NFL',
    })
    const catalogKey = catalogPassIdentityKey({
      passKind: 'player',
      sport: 'NFL',
      seasonYear: 2024,
      seasonLabel: '2023-24',
      name: 'Ceedee Lamb',
      entityId: 12345,
      externalKey: '12345|2024|NFL',
    })
    expect(ownedKey).toBe(catalogKey)
  })

  it('normalizes en-dash season labels for identity matching', () => {
    const hyphenKey = catalogPassIdentityKey({
      passKind: 'player',
      sport: 'NFL',
      seasonYear: 2024,
      seasonLabel: '2023-24',
      name: 'CeeDee Lamb',
      externalKey: '846|2024|NFL',
    })
    const enDashKey = catalogPassIdentityKeyFromOwnedCard({
      passKind: 'player',
      sport: 'NFL',
      season: '2023–24',
      name: 'CeeDee Lamb',
      externalKey: '846|2024|NFL',
    })
    expect(hyphenKey).toBe(enDashKey)
  })
})
