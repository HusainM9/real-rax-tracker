import { describe, expect, it } from 'vitest'
import type { PackAccountTemplate, PackTracker, PlannedPass } from '../types/rax'
import {
  accountsFromPackTemplates,
  applyPackTemplatesToAccounts,
  DEFAULT_PACK_RATING_INCREMENT,
  estimatePackProgress,
  formatMarkPackFinishedConfirmMessage,
  formatProjectedFinishDate,
  ICONIC_RATING_TARGET,
  normalizeRatingPerPack,
  projectedFinishDate,
  removeFinishedPlannedPass,
  summarizeAccountAcrossPacks,
} from './packTracker'

function tracker(partial: Partial<PackTracker> = {}): PackTracker {
  return {
    id: 'pack_1',
    plannedPassId: 'plan_1',
    accounts: [
      { id: 'acc_1', name: 'Main', rating: 1000, opensPacks: true },
      { id: 'acc_2', name: 'Alt', rating: 500, opensPacks: true },
    ],
    ratingPerPack: DEFAULT_PACK_RATING_INCREMENT,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...partial,
  }
}

let idSeq = 0
function nextId(prefix: string): string {
  idSeq += 1
  return `${prefix}_${idSeq}`
}

describe('normalizeRatingPerPack', () => {
  it('defaults invalid values to 10', () => {
    expect(normalizeRatingPerPack(undefined)).toBe(10)
    expect(normalizeRatingPerPack(0)).toBe(10)
    expect(normalizeRatingPerPack(-3)).toBe(10)
    expect(normalizeRatingPerPack(Number.NaN)).toBe(10)
  })

  it('floors positive values', () => {
    expect(normalizeRatingPerPack(12.7)).toBe(12)
    expect(normalizeRatingPerPack(1)).toBe(1)
  })
})

describe('estimatePackProgress', () => {
  it('sums ratings and estimates packs/days with multiple opening accounts', () => {
    const estimate = estimatePackProgress(tracker())
    expect(estimate.totalRating).toBe(1500)
    expect(estimate.remaining).toBe(ICONIC_RATING_TARGET - 1500)
    expect(estimate.ratingPerPack).toBe(10)
    expect(estimate.packsNeeded).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 10))
    expect(estimate.openingAccounts).toBe(2)
    expect(estimate.dailyGain).toBe(20)
    expect(estimate.daysRemaining).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 20))
    expect(estimate.atTarget).toBe(false)
  })

  it('uses editable ratingPerPack for packs and days', () => {
    const estimate = estimatePackProgress(tracker({ ratingPerPack: 20 }))
    expect(estimate.ratingPerPack).toBe(20)
    expect(estimate.packsNeeded).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 20))
    expect(estimate.dailyGain).toBe(40)
    expect(estimate.daysRemaining).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 40))
  })

  it('guards zero/invalid ratingPerPack by falling back to default', () => {
    const estimate = estimatePackProgress(tracker({ ratingPerPack: 0 }))
    expect(estimate.ratingPerPack).toBe(DEFAULT_PACK_RATING_INCREMENT)
    expect(estimate.packsNeeded).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 10))
  })

  it('returns null days when nothing opens packs', () => {
    const estimate = estimatePackProgress(
      tracker({
        accounts: [{ id: 'acc_1', name: 'Main', rating: 100, opensPacks: false }],
      }),
    )
    expect(estimate.daysRemaining).toBeNull()
    expect(estimate.packsNeeded).toBe(Math.ceil((ICONIC_RATING_TARGET - 100) / 10))
  })

  it('excludes non-ignored missing-ownership accounts from openers', () => {
    const estimate = estimatePackProgress(
      tracker({
        accounts: [
          {
            id: 'acc_1',
            name: 'Missing',
            rating: 1000,
            opensPacks: true,
            ownershipStatus: 'missing',
          },
          { id: 'acc_2', name: 'Owned', rating: 500, opensPacks: true, ownershipStatus: 'owned' },
        ],
      }),
    )
    expect(estimate.openingAccounts).toBe(1)
    expect(estimate.dailyGain).toBe(10)
    expect(estimate.daysRemaining).toBe(Math.ceil((ICONIC_RATING_TARGET - 1500) / 10))
  })

  it('counts ignored missing-ownership accounts when Opens packs is checked', () => {
    const estimate = estimatePackProgress(
      tracker({
        accounts: [
          {
            id: 'acc_1',
            name: 'Missing ignored',
            rating: 1000,
            opensPacks: true,
            ownershipStatus: 'missing',
            ignoredMissing: true,
          },
          { id: 'acc_2', name: 'Owned', rating: 500, opensPacks: true, ownershipStatus: 'owned' },
        ],
      }),
    )
    expect(estimate.openingAccounts).toBe(2)
    expect(estimate.dailyGain).toBe(20)
  })

  it('returns null days when only non-ignored missing accounts open packs', () => {
    const estimate = estimatePackProgress(
      tracker({
        accounts: [
          {
            id: 'acc_1',
            name: 'Missing',
            rating: 100,
            opensPacks: true,
            ownershipStatus: 'missing',
          },
        ],
      }),
    )
    expect(estimate.openingAccounts).toBe(0)
    expect(estimate.daysRemaining).toBeNull()
  })

  it('marks complete at or above target', () => {
    const estimate = estimatePackProgress(
      tracker({
        accounts: [{ id: 'acc_1', name: 'Main', rating: ICONIC_RATING_TARGET, opensPacks: true }],
      }),
    )
    expect(estimate.atTarget).toBe(true)
    expect(estimate.packsNeeded).toBe(0)
    expect(estimate.daysRemaining).toBe(0)
  })
})

describe('projectedFinishDate', () => {
  it('adds days onto the from date', () => {
    const from = new Date(2026, 6, 28) // Jul 28 local
    expect(projectedFinishDate(0, from)?.toDateString()).toBe(from.toDateString())
    expect(projectedFinishDate(3, from)?.toDateString()).toBe(new Date(2026, 6, 31).toDateString())
    expect(projectedFinishDate(null, from)).toBeNull()
  })

  it('formats readable finish labels', () => {
    const from = new Date(2026, 6, 28)
    expect(formatProjectedFinishDate(0, from)).toBe('Done')
    expect(formatProjectedFinishDate(null, from)).toBe('—')
    expect(formatProjectedFinishDate(2, from)).toMatch(/Jul/)
  })
})

describe('pack account templates', () => {
  const templates: PackAccountTemplate[] = [
    { id: 't1', name: 'Main', username: 'gordon', opensPacks: true },
    { id: 't2', name: 'Alt', username: 'altuser', opensPacks: false },
  ]

  it('seeds accounts from templates at rating 0', () => {
    idSeq = 0
    const accounts = accountsFromPackTemplates(templates, nextId)
    expect(accounts).toEqual([
      {
        id: 'pacc_1',
        name: 'Main',
        username: 'gordon',
        rating: 0,
        opensPacks: true,
      },
      {
        id: 'pacc_2',
        name: 'Alt',
        username: 'altuser',
        rating: 0,
        opensPacks: false,
      },
    ])
  })

  it('adds missing accounts and updates name/opensPacks without wiping rating', () => {
    idSeq = 0
    const result = applyPackTemplatesToAccounts(
      [
        {
          id: 'acc_1',
          name: 'Old Main',
          username: 'Gordon',
          rating: 2200,
          opensPacks: false,
          rarityLabel: 'Legendary',
          lastImportedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      templates,
      nextId,
    )

    expect(result.added).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.accounts).toEqual([
      {
        id: 'acc_1',
        name: 'Main',
        username: 'gordon',
        rating: 2200,
        opensPacks: true,
        rarityLabel: 'Legendary',
        lastImportedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'pacc_1',
        name: 'Alt',
        username: 'altuser',
        rating: 0,
        opensPacks: false,
      },
    ])
  })

  it('skips templates without a username when applying', () => {
    idSeq = 0
    const result = applyPackTemplatesToAccounts(
      [],
      [{ id: 't3', name: 'No user', username: '', opensPacks: true }],
      nextId,
    )
    expect(result.added).toBe(0)
    expect(result.accounts).toEqual([])
  })
})

describe('summarizeAccountAcrossPacks', () => {
  it('returns matching account rows sorted by soonest finish', () => {
    const plannedPasses: PlannedPass[] = [
      {
        id: 'pp1',
        externalKey: 'a',
        name: 'Alpha',
        sport: 'NBA',
        season: '2026',
        passKind: 'player',
        simulatedRarityLabel: 'Legendary',
        totalBaseRax: 0,
        rowCount: 0,
        notes: '',
        source: 'manual',
        progress: 'on-the-way',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'pp2',
        externalKey: 'b',
        name: 'Beta',
        sport: 'NFL',
        season: '2025',
        passKind: 'player',
        simulatedRarityLabel: 'Legendary',
        totalBaseRax: 0,
        rowCount: 0,
        notes: '',
        source: 'manual',
        progress: 'on-the-way',
        addedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    const packTrackers: PackTracker[] = [
      {
        id: 't1',
        plannedPassId: 'pp1',
        accounts: [
          { id: 'a1', name: 'Main', username: 'Gordon', rating: 3000, opensPacks: true },
          { id: 'a2', name: 'Other', username: 'other', rating: 100, opensPacks: true },
        ],
        ratingPerPack: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 't2',
        plannedPassId: 'pp2',
        accounts: [
          { id: 'b1', name: 'Main', username: 'gordon', rating: 3370, opensPacks: true },
        ],
        ratingPerPack: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]

    const rows = summarizeAccountAcrossPacks('gordon', plannedPasses, packTrackers)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.passName).toBe('Beta')
    expect(rows[0]?.accountRating).toBe(3370)
    expect(rows[0]?.daysRemaining).toBe(1)
    expect(rows[1]?.passName).toBe('Alpha')
    expect(rows[1]?.accountRating).toBe(3000)
    expect(rows[1]?.trackerTotal).toBe(3100)
  })

  it('returns empty when username is blank', () => {
    expect(summarizeAccountAcrossPacks('', [], [])).toEqual([])
  })
})

describe('removeFinishedPlannedPass', () => {
  const plannedPasses: PlannedPass[] = [
    {
      id: 'pp1',
      externalKey: 'a',
      name: 'Alpha',
      sport: 'NBA',
      season: '2026',
      passKind: 'player',
      simulatedRarityLabel: 'Legendary',
      totalBaseRax: 0,
      rowCount: 0,
      notes: '',
      source: 'manual',
      progress: 'on-the-way',
      addedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'pp2',
      externalKey: 'b',
      name: 'Beta',
      sport: 'NFL',
      season: '2025',
      passKind: 'player',
      simulatedRarityLabel: 'Legendary',
      totalBaseRax: 0,
      rowCount: 0,
      notes: '',
      source: 'manual',
      progress: 'nearly-finished',
      addedAt: '2026-01-01T00:00:00.000Z',
    },
  ]

  const packTrackers: PackTracker[] = [
    {
      id: 't1',
      plannedPassId: 'pp1',
      accounts: [{ id: 'a1', name: 'Main', rating: 1000, opensPacks: true }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2',
      plannedPassId: 'pp2',
      accounts: [{ id: 'b1', name: 'Main', rating: 2000, opensPacks: true }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]

  it('removes the planned pass and its pack tracker by plannedPassId', () => {
    const result = removeFinishedPlannedPass(plannedPasses, packTrackers, 'pp1')
    expect(result.plannedPasses.map((pass) => pass.id)).toEqual(['pp2'])
    expect(result.packTrackers.map((tracker) => tracker.id)).toEqual(['t2'])
  })

  it('leaves trackers alone when only the plan entry is missing', () => {
    const result = removeFinishedPlannedPass(plannedPasses, packTrackers, 'missing')
    expect(result.plannedPasses).toEqual(plannedPasses)
    expect(result.packTrackers).toEqual(packTrackers)
  })
})

describe('formatMarkPackFinishedConfirmMessage', () => {
  it('includes the pass name', () => {
    expect(formatMarkPackFinishedConfirmMessage('Gordon')).toContain('Gordon')
    expect(formatMarkPackFinishedConfirmMessage('')).toContain('this pass')
  })
})
