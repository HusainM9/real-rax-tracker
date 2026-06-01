import { describe, expect, it } from 'vitest'
import { analyzeRemovedCard, computeSaleComparison } from './removeCardAnalysis'
import { createEmptyData } from './storage'
import type { PlayerCard, RaxPerformance } from '../types/rax'

function card(id: string, name: string, sport: 'NBA' = 'NBA'): PlayerCard {
  return {
    id,
    name,
    sport,
    season: '2024',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function perf(id: string, cardId: string, claimDay: string, raxEarned: number): RaxPerformance {
  return {
    id,
    cardId,
    claimDay,
    raxEarned,
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('analyzeRemovedCard', () => {
  it('frees overlap claims on other cards when a guaranteed blocker is removed', () => {
    const data = {
      ...createEmptyData(),
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('a', 'Alpha'), card('b', 'Bravo'), card('c', 'Charlie')],
      performances: [
        perf('p1', 'a', '2025-01-15', 100),
        perf('p2', 'b', '2025-01-15', 80),
        perf('p3', 'c', '2025-01-15', 60),
      ],
    }

    const result = analyzeRemovedCard(data, 'a')
    expect(result?.lostClaimableRax).toBe(100)
    expect(result?.freedClaimableRax).toBe(60)
    expect(result?.netClaimableDelta).toBe(-40)
    expect(result?.gains.map((gain) => gain.candidate.card.name)).toEqual(['Charlie'])
  })

  it('does not change other cards when removing a pure overlap card', () => {
    const data = {
      ...createEmptyData(),
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('a', 'Alpha'), card('b', 'Bravo'), card('c', 'Charlie')],
      performances: [
        perf('p1', 'a', '2025-01-15', 100),
        perf('p2', 'b', '2025-01-15', 80),
        perf('p3', 'c', '2025-01-15', 60),
      ],
    }

    const result = analyzeRemovedCard(data, 'c')
    expect(result?.lostClaimableRax).toBe(0)
    expect(result?.freedClaimableRax).toBe(0)
    expect(result?.netClaimableDelta).toBe(0)
  })

  it('promotes the next card when the second guaranteed slot is removed', () => {
    const data = {
      ...createEmptyData(),
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('a', 'Alpha'), card('b', 'Bravo'), card('c', 'Charlie')],
      performances: [
        perf('p1', 'a', '2025-01-15', 100),
        perf('p2', 'b', '2025-01-15', 80),
        perf('p3', 'c', '2025-01-15', 60),
      ],
    }

    const result = analyzeRemovedCard(data, 'b')
    expect(result?.lostClaimableRax).toBe(80)
    expect(result?.freedClaimableRax).toBe(60)
    expect(result?.netClaimableDelta).toBe(-20)
  })
})

describe('computeSaleComparison', () => {
  it('combines sale price with net claimable delta', () => {
    const data = {
      ...createEmptyData(),
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [card('a', 'Alpha'), card('b', 'Bravo'), card('c', 'Charlie')],
      performances: [
        perf('p1', 'a', '2025-01-15', 100),
        perf('p2', 'b', '2025-01-15', 80),
        perf('p3', 'c', '2025-01-15', 60),
      ],
    }

    const analysis = analyzeRemovedCard(data, 'a')
    expect(analysis).not.toBeNull()
    const comparison = computeSaleComparison(analysis!, 35000)
    expect(comparison.netVsKeeping).toBe(34960)
    expect(comparison.breakEvenSalePrice).toBe(40)
  })
})
