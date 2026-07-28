import { describe, expect, it } from 'vitest'
import {
  catalogCandidatePassKindsForSport,
  isPlayerLikeCatalogPass,
  isUfcCatalogSport,
  looksLikeTeamPassName,
  resolveImportPassKind,
} from './passKind'

describe('looksLikeTeamPassName', () => {
  it('detects common Real team pass names', () => {
    expect(looksLikeTeamPassName('DEN Nuggets')).toBe(true)
    expect(looksLikeTeamPassName('LAL Lakers')).toBe(true)
    expect(looksLikeTeamPassName('KC Chiefs')).toBe(true)
    expect(looksLikeTeamPassName('Boise St')).toBe(true)
    expect(looksLikeTeamPassName('Team 400')).toBe(true)
  })

  it('does not treat player names as team passes', () => {
    expect(looksLikeTeamPassName('Julian Strawther')).toBe(false)
    expect(looksLikeTeamPassName('Christian Braun')).toBe(false)
    // Initials + surname must not match city-code + mascot.
    expect(looksLikeTeamPassName('DJ Giddens')).toBe(false)
    expect(looksLikeTeamPassName('CJ Stroud')).toBe(false)
    expect(looksLikeTeamPassName('AJ Brown')).toBe(false)
    expect(looksLikeTeamPassName('TJ Watt')).toBe(false)
  })
})

describe('UFC catalog pass kind helpers', () => {
  it('treats UFC fighters as player-like even when pass_kind is team', () => {
    expect(isUfcCatalogSport('UFC')).toBe(true)
    expect(isPlayerLikeCatalogPass({ passKind: 'team', sport: 'UFC' })).toBe(true)
    expect(isPlayerLikeCatalogPass({ passKind: 'team', sport: 'NBA' })).toBe(false)
    expect(isPlayerLikeCatalogPass({ passKind: 'player', sport: 'NBA' })).toBe(true)
    expect(catalogCandidatePassKindsForSport('UFC')).toEqual(['team', 'player'])
    expect(catalogCandidatePassKindsForSport('NBA')).toEqual(['player'])
  })
})

describe('resolveImportPassKind', () => {
  it('keeps explicit team passes', () => {
    expect(resolveImportPassKind({ passKind: 'team', name: 'Anyone' })).toBe('team')
  })

  it('upgrades misclassified FC team passes', () => {
    expect(
      resolveImportPassKind({ passKind: 'player', name: 'MCI', sportRaw: 'fc' }),
    ).toBe('team')
    expect(
      resolveImportPassKind({ passKind: 'player', name: 'MCI Card', sport: 'FC' }),
    ).toBe('team')
  })

  it('upgrades NBA-style team names even when Meowbot marks player', () => {
    expect(
      resolveImportPassKind({ passKind: 'player', name: 'DEN Nuggets', sportRaw: 'nba' }),
    ).toBe('team')
  })

  it('keeps player passes when the name is clearly a player', () => {
    expect(
      resolveImportPassKind({ passKind: 'player', name: 'Erling Haaland', sportRaw: 'fc' }),
    ).toBe('player')
  })

  it('does not upgrade initials-style CFB/NFL player names to team', () => {
    expect(
      resolveImportPassKind({ passKind: 'player', name: 'DJ Giddens', sportRaw: 'ncaaf' }),
    ).toBe('player')
    expect(
      resolveImportPassKind({ passKind: 'player', name: 'CJ Stroud', sportRaw: 'nfl' }),
    ).toBe('player')
  })
})
