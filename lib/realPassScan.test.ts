import { describe, expect, it } from 'vitest'
import { parsePlayerPair } from '../src/lib/meowbotApi'
import { normalizeRarityTier, passRarityLookupKey } from './rarityFilter'
import type { RealPass } from './realApi'
import {
  buildRealPassPayload,
  canonicalRealSport,
  normalizeRealPass,
  normalizeRealRarityLabel,
  scanRealUserPasses,
} from './realPassScan'

function realPass(overrides: Partial<RealPass> = {}): RealPass {
  return {
    id: 14112194,
    entityType: 'player',
    entityId: 551,
    sport: 'soccer',
    label: 'Anthony Gordon',
    seasonDisplay: '2025-26',
    season: 2025,
    earned: 20905,
    serialNumber: 1,
    isActive: true,
    isRefunded: false,
    boostInfo: { rarityLabel: 'Iconic 1', multiplier: '150x', level: 20 },
    ...overrides,
  }
}

describe('canonicalRealSport', () => {
  it('maps Real sport aliases onto the app slugs', () => {
    expect(canonicalRealSport('soccer')).toBe('fc')
    expect(canonicalRealSport('CFB')).toBe('ncaaf')
    expect(canonicalRealSport('ncaab')).toBe('ncaam')
    expect(canonicalRealSport(' NBA ')).toBe('nba')
  })
})

describe('normalizeRealRarityLabel', () => {
  it('title-cases the tier so the Legendary+ filter still matches', () => {
    expect(normalizeRealRarityLabel('LEGENDARY 1')).toBe('Legendary 1')
    expect(normalizeRealRarityLabel('legendary 1')).toBe('Legendary 1')
    expect(normalizeRealRarityLabel('Iconic 1')).toBe('Iconic 1')
    expect(normalizeRealRarityLabel('GENERAL')).toBe('General')
    expect(normalizeRealRarityLabel('  Mystic   2 ')).toBe('Mystic 2')
    expect(normalizeRarityTier(normalizeRealRarityLabel('LEGENDARY 1'))).toBe('Legendary')
  })

  it('leaves unknown tiers untouched', () => {
    expect(normalizeRealRarityLabel('Something 3')).toBe('Something 3')
  })
})

describe('normalizeRealPass', () => {
  it('maps a live FC player pass onto the import pass shape', () => {
    expect(normalizeRealPass(realPass())).toEqual({
      entityId: 551,
      season: 2025,
      sportRaw: 'fc',
      pair: '551:2025:fc',
      passKind: 'player',
      rarityLabel: 'Iconic 1',
      playerName: 'Anthony Gordon',
      seasonLabel: '2025-26',
      avatar: undefined,
    })
  })

  it('reads entity.avatar from the nested Real entity', () => {
    const pass = normalizeRealPass(
      realPass({
        entity: { id: 551, avatar: 'c5f7b44ab4ea35fa57df203aa18eed54' },
      }),
    )
    expect(pass?.avatar).toBe('c5f7b44ab4ea35fa57df203aa18eed54')
  })

  it('keeps team entityType instead of guessing from the label', () => {
    const pass = normalizeRealPass(
      realPass({ entityType: 'team', entityId: 1347127, label: 'Newcastle', sport: 'soccer' }),
    )
    expect(pass?.passKind).toBe('team')
  })

  it('does not misread a player whose name looks like a team', () => {
    const pass = normalizeRealPass(realPass({ entityType: 'player', label: 'CJ Stroud' }))
    expect(pass?.passKind).toBe('player')
  })

  it('normalizes all-caps rarity labels', () => {
    const pass = normalizeRealPass(realPass({ boostInfo: { rarityLabel: 'LEGENDARY 1' } }))
    expect(pass?.rarityLabel).toBe('Legendary 1')
  })

  it('round-trips its pair string through parsePlayerPair', () => {
    const pass = normalizeRealPass(realPass())
    const parsed = parsePlayerPair(pass!.pair)
    expect(parsed).not.toBeNull()
    expect(parsed?.entityId).toBe(551)
    expect(parsed?.season).toBe(2025)
    expect(parsed?.sportRaw).toBe('fc')
  })

  it('derives the season label when seasonDisplay is missing or malformed', () => {
    expect(normalizeRealPass(realPass({ sport: 'nfl', season: 2026, seasonDisplay: undefined }))
      ?.seasonLabel).toBe('2026-27')
    expect(normalizeRealPass(realPass({ sport: 'nfl', season: 2026, seasonDisplay: 'Season 2026' }))
      ?.seasonLabel).toBe('2026-27')
    expect(normalizeRealPass(realPass({ sport: 'nhl', season: 2025, seasonDisplay: undefined }))
      ?.seasonLabel).toBe('2025-26')
  })

  it('normalizes Real NHL pass-list start-years to catalog end-years', () => {
    expect(
      normalizeRealPass(
        realPass({ entityId: 8471675, sport: 'nhl', season: 2025, seasonDisplay: '2025-26' }),
      ),
    ).toMatchObject({
      entityId: 8471675,
      season: 2026,
      seasonLabel: '2025-26',
      pair: '8471675:2026:nhl',
    })
  })

  it('keeps calendar-year labels for calendar-year sports', () => {
    const pass = normalizeRealPass(
      realPass({ sport: 'mlb', season: 2026, seasonDisplay: '2026' }),
    )
    expect(pass?.seasonLabel).toBe('2026')
  })

  it('agrees with Real seasonDisplay for FC whether the label is present or derived', () => {
    // FC is start-year encoded: season 2025 is the 2025-26 season.
    expect(normalizeRealPass(realPass())?.seasonLabel).toBe('2025-26')
    expect(normalizeRealPass(realPass({ seasonDisplay: undefined }))?.seasonLabel).toBe('2025-26')
  })

  it('drops refunded passes and unusable ids', () => {
    expect(normalizeRealPass(realPass({ isRefunded: true }))).toBeNull()
    expect(normalizeRealPass(realPass({ entityId: 0 }))).toBeNull()
    expect(normalizeRealPass(realPass({ entityId: undefined }))).toBeNull()
    expect(normalizeRealPass(realPass({ season: undefined }))).toBeNull()
    expect(normalizeRealPass(realPass({ sport: '' }))).toBeNull()
  })
})

describe('buildRealPassPayload', () => {
  it('splits players from teams and keys rarities for the rarity filter', () => {
    const payload = buildRealPassPayload([
      realPass(),
      realPass({ id: 2, entityType: 'team', entityId: 900, sport: 'nba', season: 2026, label: 'LAL Lakers', seasonDisplay: '2025-26', boostInfo: { rarityLabel: 'Legendary 2' } }),
    ])

    expect(payload.playerPasses).toHaveLength(1)
    expect(payload.teamPasses).toHaveLength(1)
    expect(payload.teamPasses[0]?.passKind).toBe('team')
    expect(payload.rarities).toEqual({
      '551-2025-fc': ['Iconic 1'],
      '900-2026-nba': ['Legendary 2'],
    })
    expect(payload.rarities[passRarityLookupKey(payload.playerPasses[0]!)]).toEqual(['Iconic 1'])
  })

  it('collapses multiple owned copies into one pass keeping every rarity label', () => {
    const payload = buildRealPassPayload([
      realPass({ id: 1, serialNumber: 1, boostInfo: { rarityLabel: 'General' } }),
      realPass({ id: 2, serialNumber: 2, boostInfo: { rarityLabel: 'Iconic 1' } }),
      realPass({ id: 3, serialNumber: 3, boostInfo: { rarityLabel: 'Legendary 4' } }),
    ])

    expect(payload.playerPasses).toHaveLength(1)
    expect(payload.playerPasses[0]?.rarityLabel).toBe('Iconic 1')
    expect(payload.rarities['551-2025-fc']).toEqual(['General', 'Iconic 1', 'Legendary 4'])
  })

  it('ignores refunded copies', () => {
    const payload = buildRealPassPayload([
      realPass({ id: 1, isRefunded: true, boostInfo: { rarityLabel: 'Iconic 1' } }),
      realPass({ id: 2, boostInfo: { rarityLabel: 'Legendary 1' } }),
    ])

    expect(payload.playerPasses).toHaveLength(1)
    expect(payload.rarities['551-2025-fc']).toEqual(['Legendary 1'])
  })
})

describe('scanRealUserPasses', () => {
  it('fetches the whole collection with one unfiltered request', async () => {
    const queries: unknown[] = []
    const result = await scanRealUserPasses('BJ0mBPlv', async (query) => {
      queries.push(query)
      return [realPass()]
    })

    expect(queries).toEqual([{ userId: 'BJ0mBPlv' }])
    expect(result.strategy).toBe('single')
    expect(result.requests).toBe(1)
    expect(result.passes).toHaveLength(1)
  })

  it('uses the parameterised form for targeted refreshes', async () => {
    const queries: Array<Record<string, unknown>> = []
    const result = await scanRealUserPasses(
      'BJ0mBPlv',
      async (query) => {
        queries.push(query as Record<string, unknown>)
        return [realPass({ sport: String(query.sport ?? 'soccer') })]
      },
      {
        targets: [
          { sport: 'soccer', season: 2025, entityType: 'player' },
          { sport: 'nba', season: 2026, entityType: 'team' },
        ],
        concurrency: 2,
      },
    )

    expect(queries).toHaveLength(2)
    expect(queries.every((query) => query.userId === 'BJ0mBPlv')).toBe(true)
    expect(result.strategy).toBe('targeted')
    expect(result.requests).toBe(2)
    expect(result.passes).toHaveLength(2)
  })
})
