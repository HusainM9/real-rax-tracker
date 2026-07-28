import { describe, expect, it } from 'vitest'
import { isPlayerPass, isTeamPass, looksLikeTeamPassName } from './passKind'

describe('passKind', () => {
  it('detects common Real team pass names', () => {
    expect(looksLikeTeamPassName('DEN Nuggets')).toBe(true)
    expect(looksLikeTeamPassName('LAL Lakers')).toBe(true)
    expect(looksLikeTeamPassName('Boise St')).toBe(true)
    expect(looksLikeTeamPassName('Team 400')).toBe(true)
  })

  it('does not treat player names as team passes', () => {
    expect(looksLikeTeamPassName('Julian Strawther')).toBe(false)
    expect(looksLikeTeamPassName('Bruce Brown')).toBe(false)
    expect(looksLikeTeamPassName('Christian Braun')).toBe(false)
    expect(looksLikeTeamPassName('DJ Giddens')).toBe(false)
    expect(looksLikeTeamPassName('CJ Stroud')).toBe(false)
  })

  it('respects explicit passKind over name heuristics', () => {
    expect(isTeamPass({ name: 'Julian Strawther', passKind: 'team' })).toBe(true)
    expect(isPlayerPass({ name: 'DEN Nuggets', passKind: 'player' })).toBe(true)
  })

  it('treats UFC team passKind as player when sport is UFC', () => {
    expect(isTeamPass({ name: 'Anderson Silva', passKind: 'team', sport: 'UFC' })).toBe(false)
    expect(isPlayerPass({ name: 'Anderson Silva', passKind: 'team', sport: 'UFC' })).toBe(true)
  })

  it('infers team passes when passKind is missing', () => {
    expect(isTeamPass({ name: 'DEN Nuggets' })).toBe(true)
    expect(isPlayerPass({ name: 'Carson Wentz' })).toBe(true)
  })
})
