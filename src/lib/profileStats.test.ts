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
    expect(snapshot.rarities.map((row) => row.label)).toEqual([
      'Iconic',
      'Mystic',
      'Legendary',
    ])
    expect(snapshot.title.length).toBeGreaterThan(0)
    expect(snapshot.topCards[0]?.name).toBeTruthy()
  })

  it('includes every sport with cards, not a top-N slice', () => {
    const base = sampleData()
    const sports = ['NBA', 'MLB', 'NFL', 'NHL', 'Golf', 'FC', 'CFB', 'CBB', 'UFC'] as const
    const data: RaxTrackerData = {
      ...base,
      cards: sports.map((sport, index) => ({
        id: `c${index}`,
        name: `Pass ${sport}`,
        sport,
        season: '2025',
        notes: '',
        rarityLabel: 'Legendary 1',
        passKind: 'player' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
      performances: sports.map((_, index) => ({
        id: `p${index}`,
        cardId: `c${index}`,
        claimDay: '01-15',
        // Descending RAX so sort order is stable; NBA still last by claimable.
        raxEarned: sports.length - index,
        note: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    }
    const snapshot = buildProfileSnapshot(data, 'nine-sports')
    expect(snapshot.sports).toHaveLength(9)
    expect(snapshot.sports.map((row) => row.sport).sort()).toEqual([...sports].sort())
  })

  it('handles an empty collection', () => {
    const snapshot = buildProfileSnapshot(createEmptyData(), 'newbie')
    expect(snapshot.title).toBe('Blank slate')
    expect(snapshot.efficiencyPct).toBe(0)
    expect(snapshot.sports).toEqual([])
  })
})
