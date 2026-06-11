import { describe, expect, it } from 'vitest'
import { normalizeGlobalMeowbotCatalog } from './meowbotGlobalCatalog'

describe('normalizeGlobalMeowbotCatalog', () => {
  it('normalizes player and team catalog exports with nested earnings rows', () => {
    const normalized = normalizeGlobalMeowbotCatalog({
      players: [
        {
          entityId: 100,
          season: 2026,
          sport: 'nba',
          playerName: 'Test Player',
          rarityLabel: 'Legendary 1',
          rows: [{ day: '2025-08-22T00:00:00Z', earnings: 26, player_box_score_id: 123 }],
        },
      ],
      teams: [
        {
          entity_id: 200,
          season_year: 2026,
          sport: 'nfl',
          team_name: 'Test Team',
          pass_kind: 'team',
          daily_earnings: [{ claim_day: '2025-09-01', base_rax_earned: 18 }],
        },
      ],
    })

    expect(normalized.passes).toEqual([
      {
        externalKey: '100|2026|NBA',
        entityId: 100,
        passKind: 'player',
        sport: 'NBA',
        seasonYear: 2026,
        seasonLabel: '2025-26',
        name: 'Test Player',
        rarityLabel: 'Legendary 1',
        sourceUpdatedAt: undefined,
      },
      {
        externalKey: '200|2026|NFL',
        entityId: 200,
        passKind: 'team',
        sport: 'NFL',
        seasonYear: 2026,
        seasonLabel: '2025-26',
        name: 'Test Team',
        rarityLabel: undefined,
        sourceUpdatedAt: undefined,
      },
    ])
    expect(normalized.dailyEarnings).toEqual([
      {
        externalKey: '100|2026|NBA',
        claimDay: '2025-08-22',
        baseRaxEarned: 26,
        playerBoxScoreId: 123,
      },
      {
        externalKey: '200|2026|NFL',
        claimDay: '2025-09-01',
        baseRaxEarned: 18,
        playerBoxScoreId: null,
      },
    ])
    expect(normalized.skipped).toBe(0)
  })
})

