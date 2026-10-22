import { describe, expect, it } from 'vitest'
import type { RealPassImportResult } from './realPassImport'
import { realOwnedMarketplacePlayers } from './marketplaceOwnedPlayers'

const payload: RealPassImportResult = {
  playerPasses: [
    { entityId: 22, playerName: 'Player B', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Epic 2' },
    { entityId: 11, playerName: 'Player A', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Rare 4' },
    { entityId: 11, playerName: 'Player A copy', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Legendary 1' },
    { entityId: 33, playerName: 'Old player', season: 2025, sportRaw: 'nfl', pair: '', passKind: 'player' },
    { entityId: 55, playerName: 'College player', season: 2026, sportRaw: 'ncaaf', pair: '', passKind: 'player' },
  ],
  teamPasses: [
    { entityId: 44, playerName: 'NFL team', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'team' },
  ],
  rarities: {},
}

describe('realOwnedMarketplacePlayers', () => {
  it('returns deduped Real player passes for the requested sport and season', () => {
    expect(realOwnedMarketplacePlayers(payload, 'nfl', 2026)).toEqual([
      { entityId: 11, name: 'Player A copy', rarityLabel: 'Legendary 1' },
      { entityId: 22, name: 'Player B', rarityLabel: 'Epic 2' },
    ])
  })

  it('maps the display sport aliases used by the marketplace form', () => {
    expect(realOwnedMarketplacePlayers(payload, 'cfb', 2026)).toEqual([
      { entityId: 55, name: 'College player' },
    ])
  })

  it('loads UFC fighters even though Real returns them as team passes', () => {
    const withFighter: RealPassImportResult = {
      ...payload,
      teamPasses: [
        ...payload.teamPasses,
        {
          entityId: 3072,
          playerName: 'Jalin Turner',
          season: 2023,
          sportRaw: 'ufc',
          pair: '',
          passKind: 'team',
          rarityLabel: 'Legendary 2',
        },
      ],
    }

    expect(realOwnedMarketplacePlayers(withFighter, 'ufc', 2023)).toEqual([
      { entityId: 3072, name: 'Jalin Turner', rarityLabel: 'Legendary 2' },
    ])
  })

  it('sorts higher rarity tiers and levels first, then uses player name', () => {
    const sorted = realOwnedMarketplacePlayers({
      ...payload,
      playerPasses: [
        { entityId: 1, playerName: 'Zed Rare', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Rare 10' },
        { entityId: 2, playerName: 'Alpha Iconic', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Iconic 1' },
        { entityId: 3, playerName: 'Bravo Mystic', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Mystic 2' },
        { entityId: 4, playerName: 'Charlie Mystic', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Mystic 8' },
        { entityId: 5, playerName: 'Beta Epic', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Epic 2' },
        { entityId: 6, playerName: 'Alpha Epic', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Epic 2' },
        { entityId: 7, playerName: 'Unknown', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player' },
        { entityId: 8, playerName: 'Common player', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Common' },
        { entityId: 9, playerName: 'Uncommon player', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Uncommon' },
      ],
      teamPasses: [],
    }, 'nfl', 2026)

    expect(sorted.map((player) => player.name)).toEqual([
      'Alpha Iconic',
      'Charlie Mystic',
      'Bravo Mystic',
      'Alpha Epic',
      'Beta Epic',
      'Zed Rare',
      'Uncommon player',
      'Common player',
      'Unknown',
    ])
  })

  it('uses a deterministic entity id tie-break when names and rarities match', () => {
    const samePlayers = realOwnedMarketplacePlayers({
      playerPasses: [
        { entityId: 9, playerName: 'Same', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Epic 1' },
        { entityId: 3, playerName: 'Same', season: 2026, sportRaw: 'nfl', pair: '', passKind: 'player', rarityLabel: 'Epic 1' },
      ],
      teamPasses: [],
      rarities: {},
    }, 'nfl', 2026)

    expect(samePlayers.map((player) => player.entityId)).toEqual([3, 9])
  })
})
