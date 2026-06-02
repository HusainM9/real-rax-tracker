import { describe, expect, it } from 'vitest'
import { filterSellRankRows, sortSellRankRows } from './sellRankings'
import type { SavedSellRankRow } from '../types/rax'

function row(overrides: Partial<SavedSellRankRow> & Pick<SavedSellRankRow, 'cardId' | 'name'>): SavedSellRankRow {
  return {
    sport: 'NBA',
    season: '2024-25',
    claimableNow: 0,
    lostClaimableRax: 0,
    freedClaimableRax: 0,
    netClaimableDelta: 0,
    ...overrides,
  }
}

describe('sellRankings', () => {
  const sample = [
    row({
      cardId: 'a',
      name: 'Alpha',
      sport: 'NBA',
      rarityLabel: 'Legendary 1',
      freedClaimableRax: 60,
      netClaimableDelta: -40,
    }),
    row({
      cardId: 'b',
      name: 'Bravo',
      sport: 'NFL',
      rarityLabel: 'Mystic 1',
      freedClaimableRax: 10,
      netClaimableDelta: 0,
    }),
    row({
      cardId: 'c',
      name: 'Charlie',
      sport: 'NBA',
      freedClaimableRax: 0,
      netClaimableDelta: 0,
    }),
  ]

  it('filters by sport and rarity', () => {
    expect(filterSellRankRows(sample, 'NBA', 'All').map((item) => item.name)).toEqual([
      'Alpha',
      'Charlie',
    ])
    expect(filterSellRankRows(sample, 'All', 'Legendary+').map((item) => item.name)).toEqual([
      'Alpha',
      'Bravo',
    ])
  })

  it('filters by search query', () => {
    expect(filterSellRankRows(sample, 'All', 'All', 'alpha').map((item) => item.name)).toEqual([
      'Alpha',
    ])
    expect(filterSellRankRows(sample, 'All', 'All', 'mystic').map((item) => item.name)).toEqual([
      'Bravo',
    ])
  })

  it('sorts by freed on others descending', () => {
    expect(
      sortSellRankRows(sample, 'freedOnOthers', 'desc').map((item) => item.name),
    ).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})
