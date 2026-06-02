import { describe, expect, it } from 'vitest'
import { analyzeRemovedCard, computeSaleComparison, rankAllRemovedCards, rankAllRemovedCardsAsync } from './removeCardAnalysis'
import { isTeamPass } from './passKind'
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

describe('rankAllRemovedCards', () => {
  it('ranks cards with earnings by net claimable delta', () => {
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

    const { rankings, skippedWithoutEarnings, skippedPlayerPasses } = rankAllRemovedCards(data)
    expect(skippedWithoutEarnings).toBe(0)
    expect(skippedPlayerPasses).toEqual([])
    expect(rankings.map((row) => row.analysis.card.name)).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect(rankings.map((row) => row.sortNet)).toEqual([0, -20, -40])
  })

  it('skips team passes and cards without earnings', () => {
    const data = {
      ...createEmptyData(),
      settings: { proBonusEnabled: false, savedUsername: '' },
      cards: [
        card('a', 'Alpha'),
        card('b', 'Bravo'),
        card('c', 'Charlie'),
        { ...card('empty', 'Empty'), passKind: 'player' as const },
        { ...card('team', 'DEN Nuggets'), passKind: undefined },
      ],
      performances: [
        perf('p1', 'a', '2025-01-15', 100),
        perf('p2', 'b', '2025-01-15', 80),
        perf('p3', 'c', '2025-01-15', 60),
      ],
    }

    const { rankings, skippedWithoutEarnings, skippedTeamPasses, skippedPlayerPasses } =
      rankAllRemovedCards(data)
    expect(skippedTeamPasses).toBe(1)
    expect(skippedWithoutEarnings).toBe(1)
    expect(skippedPlayerPasses).toEqual([
      expect.objectContaining({
        cardId: 'empty',
        name: 'Empty',
        reason: 'no_earnings',
      }),
    ])
    expect(rankings).toHaveLength(3)
    expect(rankings.some((row) => isTeamPass(row.analysis.card))).toBe(false)

    const bulkAlpha = rankings.find((row) => row.analysis.card.id === 'a')
    const singleAlpha = analyzeRemovedCard(data, 'a')
    expect(bulkAlpha?.analysis).toEqual(singleAlpha)
  })

  it('async ranking matches sync ranking', async () => {
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

    const sync = rankAllRemovedCards(data)
    const asyncResult = await rankAllRemovedCardsAsync(data, { batchSize: 1 })
    expect(asyncResult.rankings.map((row) => row.analysis.card.id)).toEqual(
      sync.rankings.map((row) => row.analysis.card.id),
    )
    expect(asyncResult.skippedPlayerPasses).toEqual(sync.skippedPlayerPasses)
  })
})
