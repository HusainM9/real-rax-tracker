import { describe, expect, it } from 'vitest'
import { computeClaimDayResults, computeYearRollup } from './claimOptimizer'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(id: string, name: string, sport: PlayerCard['sport']): PlayerCard {
  return {
    id,
    name,
    sport,
    season: '2023',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(id: string, cardId: string, raxEarned: number, claimDay = '2026-02-10'): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function data(proBonusEnabled = true): RaxTrackerData {
  return {
    version: 1,
    settings: { proBonusEnabled, savedUsername: '' },
    cards: [
      card('c1', 'Alpha', 'NBA'),
      card('c2', 'Bravo', 'NBA'),
      card('c3', 'Charlie', 'NBA'),
      card('c4', 'Delta', 'NFL'),
      card('c5', 'Echo', 'NFL'),
      card('c6', 'Foxtrot', 'NFL'),
    ],
    performances: [
      perf('p1', 'c1', 10),
      perf('p2', 'c2', 40),
      perf('p3', 'c3', 25),
      perf('p4', 'c4', 18),
      perf('p5', 'c5', 8),
      perf('p6', 'c6', 30),
    ],
    potentialCards: [],
    savedCardProfiles: [],
  }
}

describe('computeClaimDayResults', () => {
  it('selects the top two performances per sport', () => {
    const [day] = computeClaimDayResults(data(false))
    expect(day?.claimDay).toBe('02-10')
    expect(day?.totalGuaranteedRax).toBe(113)
    expect(day?.totalOverlapRax).toBe(18)

    const nba = day?.sports.find((sport) => sport.sport === 'NBA')
    expect(nba?.guaranteed.map((candidate) => candidate.card.name)).toEqual(['Bravo', 'Charlie'])
    expect(nba?.overlaps.map((candidate) => candidate.card.name)).toEqual(['Alpha'])
  })

  it('uses the best remaining overlap as the Pro bonus', () => {
    const [day] = computeClaimDayResults(data(true))
    expect(day?.proBonus?.card.name).toBe('Alpha')
    expect(day?.totalProBonusRax).toBe(10)
    expect(day?.totalClaimableRax).toBe(123)
    expect(day?.totalOverlapRax).toBe(8)
  })

  it('merges performances from different years on the same OTD day', () => {
    const crossYear: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [
        card('c1', 'Alpha', 'NBA'),
        card('c2', 'Bravo', 'NBA'),
        card('c3', 'Charlie', 'NBA'),
      ],
      performances: [
        perf('p1', 'c1', 90, '2025-03-01'),
        perf('p2', 'c2', 80, '2026-03-01'),
        perf('p3', 'c3', 70, '2024-03-01'),
      ],
      potentialCards: [],
    savedCardProfiles: [],
    }

    const [day] = computeClaimDayResults(crossYear)
    expect(day?.claimDay).toBe('03-01')
    expect(day?.totalClaimableRax).toBe(170)
    expect(day?.totalOverlapRax).toBe(70)
    const nba = day?.sports.find((sport) => sport.sport === 'NBA')
    expect(nba?.guaranteed.map((candidate) => candidate.card.name)).toEqual(['Alpha', 'Bravo'])
    expect(nba?.overlaps.map((candidate) => candidate.card.name)).toEqual(['Charlie'])
  })

  it('keeps only the best performance per card on the same OTD day', () => {
    const duplicateCard: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('c1', 'Alpha', 'NBA'), card('c2', 'Bravo', 'NBA')],
      performances: [
        perf('p1', 'c1', 50, '2025-04-10'),
        perf('p2', 'c1', 120, '2026-04-10'),
        perf('p3', 'c2', 80, '2026-04-10'),
      ],
      potentialCards: [],
    savedCardProfiles: [],
    }

    const [day] = computeClaimDayResults(duplicateCard)
    const nba = day?.sports.find((sport) => sport.sport === 'NBA')
    expect(nba?.guaranteed.map((candidate) => candidate.performance.raxEarned)).toEqual([120, 80])
  })

  it('combines UFC fights on the same OTD day into one claim', () => {
    const ufcSameDay: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('c1', 'Sakuraba', 'UFC'), card('c2', 'Silva', 'UFC')],
      performances: [
        { ...perf('p1', 'c1', 50, '2000-05-01'), baseRaxEarned: 50 },
        { ...perf('p2', 'c1', 120, '2001-05-01'), baseRaxEarned: 120 },
        { ...perf('p3', 'c1', 30, '2001-05-01'), baseRaxEarned: 30 },
        { ...perf('p4', 'c2', 80, '2023-05-01'), baseRaxEarned: 80 },
      ],
      potentialCards: [],
      savedCardProfiles: [],
    }

    const [day] = computeClaimDayResults(ufcSameDay)
    const ufc = day?.sports.find((sport) => sport.sport === 'UFC')
    expect(ufc?.guaranteed.map((candidate) => candidate.card.name)).toEqual(['Sakuraba', 'Silva'])
    expect(ufc?.guaranteed.map((candidate) => candidate.performance.raxEarned)).toEqual([200, 80])
    expect(ufc?.overlaps).toEqual([])

    const rollup = computeYearRollup(ufcSameDay, [day!])
    const sakuraba = rollup.cards.find((row) => row.card.id === 'c1')
    expect(sakuraba?.guaranteedClaims).toBe(1)
    expect(sakuraba?.guaranteedRax).toBe(200)
    expect(sakuraba?.performanceCount).toBe(3)
  })
})

describe('computeYearRollup', () => {
  it('rolls totals up by card and sport', () => {
    const results = computeClaimDayResults(data(true))
    const rollup = computeYearRollup(data(true), results)

    expect(rollup.totalClaimableRax).toBe(123)
    expect(rollup.totalOverlapRax).toBe(8)
    expect(rollup.cards[0]?.card.name).toBe('Bravo')
    expect(rollup.cards.find((row) => row.card.id === 'c5')?.totalBaseRax).toBe(8)
    expect(rollup.cards.find((row) => row.card.id === 'c5')?.totalClaimableRax).toBe(0)
    expect(rollup.sports.find((sport) => sport.sport === 'NBA')?.totalClaimableRax).toBe(75)
  })

  it('sums raw base rax for OTD-adjusted performances', () => {
    const imported: RaxTrackerData = {
      version: 1,
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [
        {
          ...card('c1', 'Star', 'NBA'),
          rarityLabel: 'Mystic 10',
          passKind: 'player',
        },
      ],
      performances: [
        {
          ...perf('p1', 'c1', 105, '2026-02-10'),
          baseRaxEarned: 1,
        },
        {
          ...perf('p2', 'c1', 210, '2026-03-01'),
          baseRaxEarned: 2,
        },
      ],
      potentialCards: [],
    savedCardProfiles: [],
    }

    const rollup = computeYearRollup(imported, computeClaimDayResults(imported))
    expect(rollup.cards[0]?.totalBaseRax).toBe(3)
    expect(rollup.cards[0]?.totalClaimableRax).toBe(315)
  })
})
