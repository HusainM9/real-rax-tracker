import { describe, expect, it } from 'vitest'
import {
  computeDailyEarnedRax,
  filterCurrentSeasonPasses,
  isPassCurrentlyPlaying,
  realDailyGameDay,
  realDailyPayoutDay,
  resolveSeasonDailyRarityMultiplier,
  summarizeSeasonDailyAccount,
  summarizeTodayPass,
  type SeasonDailyPassInput,
} from './seasonDailyEarnings'

function pass(overrides: Partial<SeasonDailyPassInput> = {}): SeasonDailyPassInput {
  return {
    entityId: 1,
    seasonYear: 2026,
    sportRaw: 'mlb',
    sport: 'MLB',
    passKind: 'player',
    name: 'Star',
    seasonLabel: '2026',
    rarityLabel: 'Iconic 1',
    externalKey: '1|2026|MLB',
    ...overrides,
  }
}

describe('computeDailyEarnedRax', () => {
  it('uses today’s performance × (rarity + boost), not OTD caps or season history', () => {
    // Rare 1 = 4x; 1000 performance would cap at 2000 for OTD.
    expect(computeDailyEarnedRax(1000, 4)).toBe(4000)
    // Iconic 1 150x + 15x booster → 165x
    expect(computeDailyEarnedRax(10, 150, 15)).toBe(1650)
    expect(computeDailyEarnedRax(10, 150, 1)).toBe(1500)
  })
})

describe('isPassCurrentlyPlaying', () => {
  it('keeps current-season MLB and NFL, drops a finished NBA season', () => {
    const today = '2026-09-14'
    expect(isPassCurrentlyPlaying(pass({ sportRaw: 'mlb', sport: 'MLB', seasonYear: 2026, seasonLabel: '2026' }), today)).toBe(
      true,
    )
    expect(
      isPassCurrentlyPlaying(
        pass({
          sportRaw: 'nfl',
          sport: 'NFL',
          seasonYear: 2026,
          seasonLabel: '2026-27',
        }),
        today,
      ),
    ).toBe(true)
    expect(
      isPassCurrentlyPlaying(
        pass({
          sportRaw: 'nba',
          sport: 'NBA',
          seasonYear: 2026,
          seasonLabel: '2025-26',
        }),
        today,
      ),
    ).toBe(false)
  })

  it('does not treat Real isActive as currently playing when the season window has closed', () => {
    expect(
      isPassCurrentlyPlaying(
        pass({ isActive: true, sportRaw: 'nba', sport: 'NBA', seasonYear: 2026, seasonLabel: '2025-26' }),
        '2026-09-14',
      ),
    ).toBe(false)
  })

  it('keeps the current FC season window, not last year’s latest card', () => {
    const today = '2026-09-14'
    expect(
      isPassCurrentlyPlaying(
        pass({ sportRaw: 'fc', sport: 'FC', seasonYear: 2026, seasonLabel: '2026-27' }),
        today,
      ),
    ).toBe(true)
    expect(
      isPassCurrentlyPlaying(
        pass({ sportRaw: 'fc', sport: 'FC', seasonYear: 2025, seasonLabel: '2025-26' }),
        today,
      ),
    ).toBe(false)
  })

  it('keeps the latest FC season when that is the only FC season in the collection', () => {
    const result = filterCurrentSeasonPasses(
      [
        pass({
          entityId: 3,
          sportRaw: 'fc',
          sport: 'FC',
          seasonYear: 2025,
          seasonLabel: '2025-26',
          externalKey: '3|2025|FC',
        }),
      ],
      '2026-09-14',
    )
    expect(result.current.map((item) => item.entityId)).toEqual([3])
  })
})

describe('resolveSeasonDailyRarityMultiplier', () => {
  it('prefers Real boostInfo.multiplier when present', () => {
    expect(resolveSeasonDailyRarityMultiplier(pass({ rarityMultiplierLabel: '153x', rarityLabel: 'Iconic 1' }))).toBe(
      153,
    )
    expect(resolveSeasonDailyRarityMultiplier(pass({ rarityLabel: 'Iconic 1' }))).toBe(150)
  })
})

describe('realDailyGameDay', () => {
  it('stays on the current ET game day after the 7am drop', () => {
    expect(realDailyGameDay(new Date('2026-09-14T20:00:00.000Z'))).toBe('2026-09-14')
  })

  it('keeps yesterday until 7am ET, then switches to the next game day', () => {
    expect(realDailyGameDay(new Date('2026-09-15T10:59:00.000Z'))).toBe('2026-09-14')
    expect(realDailyGameDay(new Date('2026-09-15T11:00:00.000Z'))).toBe('2026-09-15')
    expect(realDailyPayoutDay('2026-09-14')).toBe('2026-09-15')
  })
})

describe('summarizeTodayPass', () => {
  it('only uses the current day’s performance', () => {
    const summary = summarizeTodayPass(
      pass({ boosterMultiplierLabel: '15x' }),
      [
        { claimDay: '2026-09-13', baseRaxEarned: 99 },
        { claimDay: '2026-09-14', baseRaxEarned: 10 },
      ],
      '2026-09-14',
    )
    expect(summary?.performanceRax).toBe(10)
    expect(summary?.rarityMultiplier).toBe(150)
    expect(summary?.boostMultiplier).toBe(15)
    expect(summary?.totalMultiplier).toBe(165)
    expect(summary?.earnedRax).toBe(1650)
  })

  it('returns null when the pass has no performance today', () => {
    expect(
      summarizeTodayPass(pass(), [{ claimDay: '2026-09-13', baseRaxEarned: 10 }], '2026-09-14'),
    ).toBeNull()
  })

  it('ignores yesterday’s already-paid games on the current game day', () => {
    expect(
      summarizeTodayPass(
        pass({
          sportRaw: 'fc',
          sport: 'FC',
          seasonYear: 2026,
          seasonLabel: '2026-27',
          externalKey: '1|2026|FC',
        }),
        [{ claimDay: '2026-09-13T07:00:00.000Z', baseRaxEarned: 10 }],
        '2026-09-14',
      ),
    ).toBeNull()
  })
})

describe('filterCurrentSeasonPasses', () => {
  it('drops finished seasons including last year’s FC cards', () => {
    const result = filterCurrentSeasonPasses(
      [
        pass({ entityId: 1, sportRaw: 'mlb', sport: 'MLB', seasonYear: 2026, seasonLabel: '2026' }),
        pass({
          entityId: 2,
          sportRaw: 'nba',
          sport: 'NBA',
          seasonYear: 2026,
          seasonLabel: '2025-26',
          externalKey: '2|2026|NBA',
        }),
        pass({
          entityId: 3,
          sportRaw: 'fc',
          sport: 'FC',
          seasonYear: 2025,
          seasonLabel: '2025-26',
          externalKey: '3|2025|FC',
        }),
        pass({
          entityId: 4,
          sportRaw: 'fc',
          sport: 'FC',
          seasonYear: 2026,
          seasonLabel: '2026-27',
          externalKey: '4|2026|FC',
        }),
      ],
      '2026-09-14',
    )
    expect(result.current.map((item) => item.entityId).sort()).toEqual([1, 4])
    expect(result.skipped).toBe(2)
  })
})

describe('summarizeSeasonDailyAccount', () => {
  it('sums only today’s playing passes', () => {
    const first = summarizeTodayPass(pass(), [{ claimDay: '2026-09-14', baseRaxEarned: 10 }], '2026-09-14')
    const second = summarizeTodayPass(
      pass({ entityId: 2, name: 'Other', externalKey: '2|2026|MLB', rarityLabel: 'Legendary 1' }),
      [{ claimDay: '2026-09-14', baseRaxEarned: 4 }],
      '2026-09-14',
    )
    const account = summarizeSeasonDailyAccount(
      'gordon',
      '2026-09-14',
      [first!, second!],
      40,
      12,
    )
    expect(account.claimDay).toBe('2026-09-14')
    expect(account.earnedRax).toBe(first!.earnedRax + second!.earnedRax)
    expect(account.ownedPassCount).toBe(40)
    expect(account.currentPassCount).toBe(2)
  })
})
