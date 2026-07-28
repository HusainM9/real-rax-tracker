import { describe, expect, it } from 'vitest'
import {
  addIgnoredPassKey,
  ignorePassOnImport,
  listIgnoredPasses,
  removeIgnoredPassKey,
} from './ignoredPasses'
import { createEmptyData, normalizeData } from './storage'

describe('ignoredPasses', () => {
  it('adds and removes ignore keys without duplicates', () => {
    let data = addIgnoredPassKey(createEmptyData(), '100|2026|NBA')
    data = addIgnoredPassKey(data, '100|2026|NBA')
    expect(data.ignoredPassKeys).toEqual(['100|2026|NBA'])

    data = removeIgnoredPassKey(data, '100|2026|NBA')
    expect(data.ignoredPassKeys).toEqual([])
  })

  it('ignorePassOnImport stores the key and removes the card + performances', () => {
    const baseline = createEmptyData()
    const withCard = {
      ...baseline,
      cards: [
        {
          id: 'card-1',
          name: 'Test Player',
          sport: 'NBA' as const,
          season: '2025-26',
          notes: '',
          externalKey: '100|2026|NBA',
          rarityLabel: 'Legendary 1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      performances: [
        {
          id: 'perf-1',
          cardId: 'card-1',
          claimDay: '2025-08-22',
          raxEarned: 100,
          note: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }

    const next = ignorePassOnImport(withCard, 'card-1')
    expect(next).not.toBeNull()
    expect(next!.ignoredPassKeys).toEqual(['100|2026|NBA'])
    expect(next!.cards).toHaveLength(0)
    expect(next!.performances).toHaveLength(0)
    expect(next!.savedCardProfiles).toHaveLength(1)
    expect(next!.savedCardProfiles[0]?.externalKey).toBe('100|2026|NBA')
  })

  it('lists ignored passes with names from saved profiles', () => {
    const data = {
      ...createEmptyData(),
      ignoredPassKeys: ['100|2026|NBA', '200|2026|UFC'],
      savedCardProfiles: [
        {
          id: 'saved-1',
          externalKey: '100|2026|NBA',
          name: 'Test Player',
          sport: 'NBA' as const,
          season: '2025-26',
          notes: '',
          rawJson: '',
          rows: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }

    expect(listIgnoredPasses(data)).toEqual([
      {
        externalKey: '100|2026|NBA',
        name: 'Test Player',
        sport: 'NBA',
        season: '2025-26',
      },
      {
        externalKey: '200|2026|UFC',
        name: '200|2026|UFC',
        sport: '',
        season: '',
      },
    ])
  })
})

describe('normalizeData ignoredPassKeys migration', () => {
  it('defaults missing ignoredPassKeys to an empty array', () => {
    const normalized = normalizeData({
      version: 1,
      settings: { proBonusEnabled: true, savedUsername: '' },
      cards: [],
      performances: [],
      potentialCards: [],
      savedCardProfiles: [],
    })
    expect(normalized.ignoredPassKeys).toEqual([])
  })

  it('hydrates and dedupes ignoredPassKeys from JSON', () => {
    const normalized = normalizeData({
      ...createEmptyData(),
      ignoredPassKeys: ['100|2026|NBA', ' 100|2026|NBA ', '', '200|2026|UFC', 12],
    })
    expect(normalized.ignoredPassKeys).toEqual(['100|2026|NBA', '200|2026|UFC'])
  })
})
