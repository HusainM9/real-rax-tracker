import { describe, expect, it } from 'vitest'
import { filterCardsByRarityPreset, filterCardsBySearch, filterCardsBySport, filterCardsByTeamPass, sortCards } from './cardSort'
import type { CardRollup, PlayerCard } from '../types/rax'

function rollup(
  id: string,
  name: string,
  sport: PlayerCard['sport'],
  totalBaseRax: number,
  rarityLabel?: string,
): CardRollup {
  return {
    card: {
      id,
      name,
      sport,
      season: '2025-26',
      notes: '',
      rarityLabel,
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

  it('filters by rarity tier', () => {
    const mixed = [
      rollup('1', 'Common card', 'NBA', 10, 'Common'),
      rollup('2', 'Iconic card', 'NBA', 10, 'Iconic'),
      rollup('3', 'Mystic card', 'NBA', 10, 'Mystic'),
      rollup('4', 'No rarity', 'NBA', 10),
    ]
    const filtered = filterCardsByRarityPreset(mixed, 'Legendary+')
    expect(filtered.map((row) => row.card.name)).toEqual(['Iconic card', 'Mystic card'])
  })

  it('filters unknown rarity preset', () => {
    const mixed = [
      rollup('1', 'Iconic card', 'NBA', 10, 'Iconic'),
      rollup('2', 'No rarity', 'NBA', 10),
    ]
    const filtered = filterCardsByRarityPreset(mixed, 'Unknown')
    expect(filtered.map((row) => row.card.name)).toEqual(['No rarity'])
  })

  it('filters cards by search query', () => {
    const filtered = filterCardsBySearch(cards, 'alpha')
    expect(filtered.map((row) => row.card.name)).toEqual(['Alpha FC'])
  })

  it('can hide team passes', () => {
    const mixed = [
      { ...rollup('1', 'LeBron James', 'NBA', 10, 'Legendary 1'), card: { ...rollup('1', 'LeBron James', 'NBA', 10, 'Legendary 1').card, passKind: 'player' as const } },
      { ...rollup('2', 'LAL Lakers', 'NBA', 10, 'Legendary 1'), card: { ...rollup('2', 'LAL Lakers', 'NBA', 10, 'Legendary 1').card, passKind: 'team' as const } },
    ]
    expect(filterCardsByTeamPass(mixed, false).map((row) => row.card.name)).toEqual(['LeBron James'])
    expect(filterCardsByTeamPass(mixed, true)).toHaveLength(2)
  })
})
