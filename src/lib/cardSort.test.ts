import { describe, expect, it } from 'vitest'
import { filterCardsBySport, sortCards } from './cardSort'
import type { CardRollup, PlayerCard } from '../types/rax'

function rollup(
  id: string,
  name: string,
  sport: PlayerCard['sport'],
  totalBaseRax: number,
): CardRollup {
  return {
    card: {
      id,
      name,
      sport,
      season: '2025-26',
      notes: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    totalBaseRax,
    guaranteedRax: 0,
    proBonusRax: 0,
    overlapRax: 0,
    totalClaimableRax: 0,
    guaranteedClaims: 0,
    proBonusClaims: 0,
    overlapCount: 0,
    performanceCount: 1,
  }
}

describe('cardSort', () => {
  const cards = [
    rollup('1', 'Bravo', 'NBA', 40),
    rollup('2', 'Alpha FC', 'FC', 100),
    rollup('3', 'Charlie FC', 'FC', 50),
    rollup('4', 'Delta', 'NBA', 80),
  ]

  it('filters by sport', () => {
    expect(filterCardsBySport(cards, 'FC').map((row) => row.card.name)).toEqual([
      'Alpha FC',
      'Charlie FC',
    ])
  })

  it('sorts FC cards by base rax when filtered', () => {
    const sorted = sortCards(filterCardsBySport(cards, 'FC'), 'baseRax', 'desc')
    expect(sorted.map((row) => row.card.name)).toEqual(['Alpha FC', 'Charlie FC'])
  })

  it('uses secondary sort when primary values tie', () => {
    const tied = [
      rollup('1', 'Zulu', 'FC', 50),
      rollup('2', 'Alpha', 'FC', 50),
    ]
    const sorted = sortCards(tied, 'baseRax', 'desc', 'name')
    expect(sorted.map((row) => row.card.name)).toEqual(['Zulu', 'Alpha'])
  })
})
