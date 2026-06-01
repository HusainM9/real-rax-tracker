import { describe, expect, it } from 'vitest'
import {
  buildPlayerExternalKey,
  mapMeowbotSport,
  normalizeMeowbotSport,
  parsePlayerPair,
  splitPairsForOtdRequest,
} from './meowbotApi'

describe('meowbotApi sport mapping', () => {
  it('normalizes NCAA aliases', () => {
    expect(normalizeMeowbotSport('ncaab')).toBe('ncaam')
    expect(normalizeMeowbotSport('ncaa-football')).toBe('ncaaf')
    expect(normalizeMeowbotSport('cfb')).toBe('ncaaf')
  })

  it('maps sports to tracker enum', () => {
    expect(mapMeowbotSport('nba')).toBe('NBA')
    expect(mapMeowbotSport('ncaaf')).toBe('CFB')
    expect(mapMeowbotSport('ncaam')).toBe('CBB')
    expect(mapMeowbotSport('ufc')).toBe('UFC')
    expect(mapMeowbotSport('unknown-league')).toBe('Other')
  })
})

describe('parsePlayerPair', () => {
  it('parses entityId:season:sport triples', () => {
    expect(parsePlayerPair('20001984:2026:nba')).toEqual({
      entityId: 20001984,
      season: 2026,
      sportRaw: 'nba',
      pair: '20001984:2026:nba',
      passKind: 'player',
    })
  })

  it('rejects invalid pairs', () => {
    expect(parsePlayerPair('bad')).toBeNull()
    expect(parsePlayerPair('0:2026:nba')).toBeNull()
  })
})

describe('buildPlayerExternalKey', () => {
  it('builds stable keys for upsert', () => {
    expect(buildPlayerExternalKey(20001984, 2026, 'NBA')).toBe('20001984|2026|NBA')
  })
})

describe('splitPairsForOtdRequest', () => {
  it('routes UFC team pairs through playerPairs for OTD metadata', () => {
    expect(
      splitPairsForOtdRequest(['100:2026:nba'], ['2917:2023:ufc', '27:2026:nba']),
    ).toEqual({
      playerPairs: ['100:2026:nba', '2917:2023:ufc'],
      teamPairs: ['27:2026:nba'],
    })
  })
})
