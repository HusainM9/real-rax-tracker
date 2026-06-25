import { describe, expect, it } from 'vitest'
import { analyzePotentialCard, buildPotentialMonthlyNet } from './potentialAnalysis'
import type { PlayerCard, RaxPerformance, RaxTrackerData } from '../types/rax'

function card(id: string, name: string): PlayerCard {
  return {
    id,
    name,
    sport: 'NBA',
    season: '2025-26',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(id: string, cardId: string, rax: number, claimDay: string): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned: rax,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('analyzePotentialCard', () => {
  const data: RaxTrackerData = {
    version: 1,
    settings: { proBonusEnabled: false, savedUsername: '' },
    cards: [card('c1', 'Owned A'), card('c2', 'Owned B'), card('c3', 'Owned C')],
    performances: [
      perf('p1', 'c1', 30, '2026-03-01'),
      perf('p2', 'c2', 25, '2026-03-01'),
      perf('p3', 'c3', 10, '2026-03-01'),
    ],
    potentialCards: [],
    savedCardProfiles: [],
  }

  it('reports overlap when a potential card would be third in sport', () => {
    const result = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [{ claimDay: '2026-03-01', raxEarned: 15, note: '' }],
    )

    expect(result?.guaranteedRax).toBe(0)
    expect(result?.proBonusRax).toBe(15)
    expect(result?.overlapRax).toBe(0)
    expect(result?.claimableRax).toBe(15)
  })

  it('reports pure overlap when a potential card would not reach guaranteed or pro bonus', () => {
    const result = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [{ claimDay: '2026-03-01', raxEarned: 5, note: '' }],
    )

    expect(result?.overlapRax).toBe(5)
    expect(result?.claimableRax).toBe(0)
    expect(result?.guaranteedRax).toBe(0)
    expect(result?.proBonusRax).toBe(0)
  })

  it('applies preview rarity OTD multipliers to pasted base rows', () => {
    const rows = [{ claimDay: '2026-03-01', raxEarned: 15, baseRaxEarned: 15, note: '' }]
    const base = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      rows,
    )
    const iconic = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26', simulatedRarityLabel: 'Iconic 1' },
      rows,
    )

    expect(base?.candidates[0]?.candidate.performance.raxEarned).toBe(15)
    expect(iconic?.candidates[0]?.candidate.performance.raxEarned).toBeGreaterThan(15)
  })

  it('ranks displaced existing cards by total RAX lost', () => {
    const result = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [{ claimDay: '2026-03-01', raxEarned: 28, note: '' }],
    )

    expect(result?.displacedByCard.length).toBeGreaterThan(0)
    expect(result?.displacedByCard[0]?.raxLost).toBeGreaterThanOrEqual(
      result?.displacedByCard[1]?.raxLost ?? 0,
    )
    expect(
      result?.displacedByCard.reduce((sum, row) => sum + row.raxLost, 0),
    ).toBe(result?.displacedRax)
  })

  it('breaks net claimable change down by calendar month', () => {
    const spreadData: RaxTrackerData = {
      ...data,
      performances: [
        perf('p1', 'c1', 30, '2026-03-01'),
        perf('p2', 'c2', 25, '2026-03-01'),
        perf('p3', 'c3', 10, '2026-04-15'),
        perf('p4', 'c1', 40, '2026-04-15'),
        perf('p5', 'c2', 35, '2026-04-15'),
      ],
    }

    const result = analyzePotentialCard(
      spreadData,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [
        { claimDay: '2026-04-15', raxEarned: 50, note: '' },
        { claimDay: '2026-05-20', raxEarned: 20, note: '' },
      ],
    )

    expect(result?.monthlyNet.map((row) => row.month)).toEqual(['April', 'May'])
    const april = result?.monthlyNet.find((row) => row.month === 'April')
    const may = result?.monthlyNet.find((row) => row.month === 'May')
    expect(april?.potentialGain).toBe(50)
    expect(april?.displacedLoss).toBeGreaterThan(0)
    expect(april?.netDelta).toBe((april?.potentialGain ?? 0) - (april?.displacedLoss ?? 0))
    expect(may?.potentialGain).toBe(20)
    expect(may?.displacedLoss).toBe(0)
    expect(may?.netDelta).toBe(20)

    const totalNet = (result?.monthlyNet ?? []).reduce((sum, row) => sum + row.netDelta, 0)
    expect(totalNet).toBe((result?.claimableRax ?? 0) - (result?.displacedRax ?? 0))
  })

  it('builds claim day breakdown that matches calendar ranks and net total', () => {
    const result = analyzePotentialCard(
      data,
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [{ claimDay: '2026-03-01', raxEarned: 28, note: '' }],
    )

    expect(result?.claimDayBreakdowns).toHaveLength(1)
    const day = result!.claimDayBreakdowns[0]!
    expect(day.claimDay).toBe('03-01')
    expect(day.sports[0]?.sport).toBe('NBA')
    expect(day.sports[0]?.ladder.map((entry) => entry.rankInSport)).toEqual([1, 2, 3, 4])

    const potential = day.sports[0]?.ladder.find((entry) => entry.isPotential)
    expect(potential?.statusAfter).toBe('guaranteed')
    expect(potential?.rankInSport).toBe(2)

    const displaced = day.sports[0]?.ladder.find((entry) => entry.raxDelta < 0)
    expect(displaced?.statusAfter).toBe('overlap')

    const totalFromDays = result!.claimDayBreakdowns.reduce((sum, row) => sum + row.dayNetDelta, 0)
    expect(totalFromDays).toBe((result?.claimableRax ?? 0) - (result?.displacedRax ?? 0))
    expect(result?.guaranteedRax).toBe(28)
    expect(result?.proBonusRax).toBe(0)
  })

  it('tracks guaranteed and pro bonus net gain separately', () => {
    const result = analyzePotentialCard(
      { ...data, settings: { proBonusEnabled: true, savedUsername: '' } },
      { name: 'Prospect', sport: 'NBA', season: '2025-26' },
      [{ claimDay: '2026-03-01', raxEarned: 12, note: '' }],
    )

    expect(result?.guaranteedRax).toBe(0)
    expect(result?.proBonusRax).toBe(12)
    expect(result?.claimableRax).toBe(12)
  })

  it('buildPotentialMonthlyNet returns sorted months', () => {
    const monthly = buildPotentialMonthlyNet(
      [
        {
          day: {
            claimDay: '2026-12-01',
            sports: [],
            proBonus: null,
            totalClaimableRax: 0,
            totalOverlapRax: 0,
            totalGuaranteedRax: 0,
            totalProBonusRax: 0,
          },
          candidate: {
            card: card('p', 'P'),
            performance: perf('x', 'p', 10, '2026-12-01'),
            status: 'guaranteed',
            rankInSport: 1,
          },
        },
        {
          day: {
            claimDay: '2026-01-01',
            sports: [],
            proBonus: null,
            totalClaimableRax: 0,
            totalOverlapRax: 0,
            totalGuaranteedRax: 0,
            totalProBonusRax: 0,
          },
          candidate: {
            card: card('p', 'P'),
            performance: perf('y', 'p', 5, '2026-01-01'),
            status: 'guaranteed',
            rankInSport: 1,
          },
        },
      ],
      [],
    )

    expect(monthly.map((row) => row.month)).toEqual(['January', 'December'])
  })
})
