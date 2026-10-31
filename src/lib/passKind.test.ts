import { describe, expect, it } from 'vitest'
import { isPlayerPass, isTeamPass } from './passKind'

describe('passKind', () => {
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
