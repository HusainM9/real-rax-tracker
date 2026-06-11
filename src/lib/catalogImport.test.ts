import { describe, expect, it } from 'vitest'
import { createEmptyData } from './storage'
import { importCatalogProfileIntoData } from './catalogImport'
import type { CatalogImportProfile } from './catalogApi'

let idCounter = 0

function idFactory(prefix: string): string {
  idCounter += 1
  return `${prefix}_${idCounter}`
}

const baseProfile: CatalogImportProfile = {
  externalKey: '100|2026|NBA',
  entityId: 100,
  passKind: 'player',
  sport: 'NBA',
  seasonYear: 2026,
  seasonLabel: '2025-26',
  name: 'Test Player',
  rarityLabel: 'Legendary 1',
  cachedAt: '2026-06-11T00:00:00.000Z',
  rowCount: 1,
  totalBaseRax: 26,
  latestClaimDay: '2025-08-22',
  rows: [{ claimDay: '2025-08-22', baseRaxEarned: 26, playerBoxScoreId: 123 }],
}

describe('importCatalogProfileIntoData', () => {
  it('creates a card and keeps repeated imports duplicate-safe by claim day', () => {
    idCounter = 0

    const first = importCatalogProfileIntoData(createEmptyData(), baseProfile, {
      nowIso: '2026-06-11T00:00:00.000Z',
      createId: idFactory,
    })

    expect(first.result).toEqual({
      cardId: 'card_1',
      cardCreated: true,
      rowsImported: 1,
      rowsUpdated: 0,
    })
    expect(first.data.cards[0]?.externalKey).toBe('100|2026|NBA')
    expect(first.data.performances).toHaveLength(1)
    expect(first.data.performances[0]?.raxEarned).toBe(650)

    const second = importCatalogProfileIntoData(
      first.data,
      {
        ...baseProfile,
        rowCount: 2,
        rows: [
          { claimDay: '2025-08-22', baseRaxEarned: 30, playerBoxScoreId: 456 },
          { claimDay: '2025-08-23', baseRaxEarned: 10 },
        ],
      },
      {
        nowIso: '2026-06-11T00:05:00.000Z',
        createId: idFactory,
      },
    )

    expect(second.result).toEqual({
      cardId: 'card_1',
      cardCreated: false,
      rowsImported: 1,
      rowsUpdated: 1,
    })
    expect(second.data.cards).toHaveLength(1)
    expect(second.data.performances).toHaveLength(2)
    expect(second.data.performances.find((row) => row.claimDay === '2025-08-22')?.baseRaxEarned).toBe(
      30,
    )
  })
})

