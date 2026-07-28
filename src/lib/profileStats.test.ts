import { describe, expect, it } from 'vitest'
import { createEmptyData } from './storage'
import { buildProfileSnapshot } from './profileStats'
import type { RaxTrackerData } from '../types/rax'

function sampleData(): RaxTrackerData {
  const base = createEmptyData()
  return {
    ...base,
    cards: [
      {
        id: 'c1',
        name: 'Star One',
        sport: 'NBA',
        season: '2025-26',
        notes: '',
        rarityLabel: 'Iconic 1',
        passKind: 'player',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'c2',
        name: 'Depth Two',
        sport: 'NBA',
        season: '2025-26',
        notes: '',
        rarityLabel: 'Legendary 2',
        passKind: 'player',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'c3',
        name: 'Pitch Ace',
        sport: 'MLB',
        season: '2026',
        notes: '',
        rarityLabel: 'Mystic 1',
        passKind: 'player',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    performances: [
      {
        id: 'p1',
        cardId: 'c1',
        claimDay: '01-15',
        raxEarned: 40,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'p2',
        cardId: 'c2',
        claimDay: '01-15',
        raxEarned: 10,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'p3',
        cardId: 'c3',
        claimDay: '04-01',
        raxEarned: 25,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

describe('buildProfileSnapshot', () => {
  it('builds a titled snapshot with sports and rarities', () => {
    const snapshot = buildProfileSnapshot(sampleData(), '@Gordon')
    expect(snapshot.username).toBe('gordon')
    expect(snapshot.cardCount).toBe(3)
    expect(snapshot.claimableRax).toBeGreaterThan(0)
    expect(snapshot.sports.some((row) => row.sport === 'NBA')).toBe(true)
    expect(snapshot.rarities.some((row) => row.label === 'Iconic')).toBe(true)
    expect(snapshot.title.length).toBeGreaterThan(0)
    expect(snapshot.topCards[0]?.name).toBeTruthy()
  })

  it('handles an empty collection', () => {
    const snapshot = buildProfileSnapshot(createEmptyData(), 'newbie')
    expect(snapshot.title).toBe('Blank slate')
    expect(snapshot.efficiencyPct).toBe(0)
    expect(snapshot.sports).toEqual([])
  })
})
