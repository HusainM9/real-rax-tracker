import { describe, expect, it } from 'vitest'
import { parseRealAppToolsRows } from './realAppToolsImport'

describe('parseRealAppToolsRows', () => {
  it('imports realapp.tools rows using their source claim dates', () => {
    const result = parseRealAppToolsRows(
      JSON.stringify({
        rows: [
          {
            day: '2025-08-22',
            earnings: 26,
            player_box_score_id: 1976890479,
          },
        ],
      }),
    )

    expect(result.rows).toEqual([
      {
        claimDay: '2025-08-22',
        raxEarned: 26,
        baseRaxEarned: 26,
        note: 'realapp.tools source 2025-08-22 · box score 1976890479',
      },
    ])
    expect(result.skipped).toBe(0)
  })

  it('skips invalid or zero-earning rows', () => {
    const result = parseRealAppToolsRows(
      JSON.stringify({
        rows: [
          { day: '2025-08-22', earnings: 0 },
          { day: 'bad-date', earnings: 12 },
          { day: '2025-09-13', earnings: 14 },
        ],
      }),
    )

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.claimDay).toBe('2025-09-13')
    expect(result.skipped).toBe(2)
  })

  it('imports realapp.com userpassearnings responses with an earnings array', () => {
    const result = parseRealAppToolsRows(
      JSON.stringify({
        earnings: [
          {
            day: '2025-08-22',
            earnings: 26,
            playerBoxScoreIds: [1976890479],
            dayDisplay: 'Aug 22',
          },
          {
            day: '2025-08-23T00:00:00.000Z',
            earnings: 18,
            playerBoxScoreIds: [1976890480],
          },
        ],
        info: { entityLabel: 'Test Player' },
      }),
      {
        sport: 'NBA',
        rarityLabel: 'Legendary',
        applyOtdMultiplier: true,
        passKind: 'player',
      },
    )

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      claimDay: '2025-08-22',
      baseRaxEarned: 26,
      note: 'realapp.com source 2025-08-22 · box score 1976890479 · OTD adjusted',
    })
    expect(result.rows[1]?.claimDay).toBe('2025-08-23')
    expect(result.rows[0]?.raxEarned).toBeGreaterThan(26)
    expect(result.skipped).toBe(0)
  })
})
