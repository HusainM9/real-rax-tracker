import { describe, expect, it } from 'vitest'
import { cachedProfilesToCatalogPayload } from './meowbotCatalogProfiles'

describe('cachedProfilesToCatalogPayload', () => {
  it('maps local cached earnings profiles into catalog upsert payloads', () => {
    const payload = cachedProfilesToCatalogPayload([
      {
        cacheKey: 'player|NBA|2026|100',
        entityId: 100,
        sport: 'NBA',
        season: '2025-26',
        seasonYear: 2026,
        passKind: 'player',
        name: 'Test Player',
        rarityLabel: 'Legendary 1',
        externalKey: '100|2026|NBA',
        rows: [
          {
            claimDay: '2025-08-22',
            raxEarned: 26,
            baseRaxEarned: 26,
            note: 'cached',
          },
        ],
        source: 'username_import',
        updatedAt: '2026-06-11T00:00:00.000Z',
      },
    ])

    expect(payload).toEqual({
      passes: [
        {
          externalKey: '100|2026|NBA',
          entityId: 100,
          passKind: 'player',
          sport: 'NBA',
          seasonYear: 2026,
          seasonLabel: '2025-26',
          name: 'Test Player',
          rarityLabel: 'Legendary 1',
          totalBaseRax: 26,
          sourceUpdatedAt: '2026-06-11T00:00:00.000Z',
        },
      ],
      dailyEarnings: [
        {
          externalKey: '100|2026|NBA',
          claimDay: '2025-08-22',
          baseRaxEarned: 26,
        },
      ],
      skipped: 0,
    })
  })
})

