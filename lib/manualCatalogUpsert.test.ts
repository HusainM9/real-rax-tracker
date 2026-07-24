import { describe, expect, it } from 'vitest'
import { buildCatalogExternalKey, manualCatalogUpsertPayload } from './manualCatalogUpsert'

describe('manualCatalogUpsertPayload', () => {
  it('maps realapp.com earnings JSON into a catalog upsert payload', () => {
    const payload = manualCatalogUpsertPayload({
      entityId: 100,
      seasonYear: 2021,
      sport: 'NBA',
      passKind: 'player',
      name: 'Test Player',
      rarityLabel: 'Legendary 1',
      seasonLabel: '2020-21',
      rawJson: JSON.stringify({
        earnings: [
          { day: '2020-12-25', earnings: 42, player_box_score_id: 999 },
          { day: '2020-12-26', earnings: 18 },
        ],
      }),
    })

    expect(payload.pass).toMatchObject({
      externalKey: buildCatalogExternalKey(100, 2021, 'NBA'),
      entityId: 100,
      seasonYear: 2021,
      sport: 'NBA',
      passKind: 'player',
      name: 'Test Player',
      rarityLabel: 'Legendary 1',
      seasonLabel: '2020-21',
      hasEarnings: true,
      totalBaseRax: 60,
    })
    expect(payload.dailyEarnings).toEqual([
      {
        externalKey: '100|2021|NBA',
        claimDay: '2020-12-25',
        baseRaxEarned: 42,
        playerBoxScoreId: 999,
      },
      {
        externalKey: '100|2021|NBA',
        claimDay: '2020-12-26',
        baseRaxEarned: 18,
        playerBoxScoreId: null,
      },
    ])
    expect(payload.skipped).toBe(0)
  })

  it('accepts rows-shaped JSON from the shared catalog editor', () => {
    const payload = manualCatalogUpsertPayload({
      entityId: 200,
      seasonYear: 2025,
      sport: 'NFL',
      passKind: 'player',
      name: 'Example',
      rawJson: JSON.stringify({
        rows: [{ day: '2025-09-07', earnings: 26 }],
      }),
    })

    expect(payload.dailyEarnings).toEqual([
      {
        externalKey: '200|2025|NFL',
        claimDay: '2025-09-07',
        baseRaxEarned: 26,
        playerBoxScoreId: null,
      },
    ])
  })

  it('drops prior-season NFL days so pasted totals match Real base (not 2022+2023 merge)', () => {
    const payload = manualCatalogUpsertPayload({
      entityId: 18877,
      seasonYear: 2023,
      sport: 'NFL',
      passKind: 'player',
      name: 'Christian McCaffrey',
      seasonLabel: '2023-24',
      rawJson: JSON.stringify({
        earnings: [
          { day: '2022-09-25', earnings: 409, playerBoxScoreIds: [1] },
          { day: '2023-09-10', earnings: 300, playerBoxScoreIds: [2] },
          { day: '2024-02-11', earnings: 324, playerBoxScoreIds: [3] },
        ],
        info: { total: 624 },
      }),
    })

    expect(payload.pass.totalBaseRax).toBe(624)
    expect(payload.dailyEarnings.map((row) => row.claimDay)).toEqual([
      '2023-09-10',
      '2024-02-11',
    ])
  })
})
