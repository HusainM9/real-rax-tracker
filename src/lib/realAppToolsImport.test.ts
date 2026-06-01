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
})
