import { describe, expect, it } from 'vitest'
import {
  collectPlayerBoxScoreIds,
  passesPlayingOnGameDay,
  performanceRaxFromPlays,
  playingTeamIdsFromGames,
  raxEarningsFromBoxPayload,
} from './realDailyLiveRax'

describe('collectPlayerBoxScoreIds', () => {
  it('pulls scorer box ids off a Real day-game payload', () => {
    const ids = collectPlayerBoxScoreIds({
      id: 61788,
      scorers: {
        goals: {
          away: [{ name: 'Malen', playerId: 732855, playerBoxScoreId: 2055171258 }],
          home: [],
        },
      },
    })
    expect(ids.get(732855)).toBe(2055171258)
  })
})

describe('raxEarningsFromBoxPayload', () => {
  it('reads live unconfirmed raxEarnings from the player box score', () => {
    expect(raxEarningsFromBoxPayload({ advancedStats: { raxEarnings: 16 } })).toBe(16)
    expect(raxEarningsFromBoxPayload({ advancedStats: { raxEarnings: 0 } })).toBe(0)
  })
})

describe('performanceRaxFromPlays', () => {
  it('sums today’s play values as a live fallback', () => {
    expect(
      performanceRaxFromPlays(
        [
          { day: '2026-09-14', value: '3.16' },
          { day: '2026-09-14', value: '2.42' },
          { day: '2026-09-13', value: '99' },
        ],
        '2026-09-14',
      ),
    ).toBe(6)
  })
})

describe('passesPlayingOnGameDay', () => {
  it('keeps owned players whose club is on today’s slate', () => {
    const playing = playingTeamIdsFromGames([
      { homeTeamId: 1347167, awayTeamId: 1347174 },
    ])
    const kept = passesPlayingOnGameDay(
      [
        { externalKey: 'a', entityId: 1, sportRaw: 'soccer', seasonYear: 2026, passKind: 'player', teamId: 1347167 },
        { externalKey: 'b', entityId: 2, sportRaw: 'soccer', seasonYear: 2026, passKind: 'player', teamId: 12 },
      ],
      playing,
    )
    expect(kept.map((pass) => pass.entityId)).toEqual([1])
  })
})
