import { describe, expect, it } from 'vitest'
import {
  GORDON_ACCOUNT_USERNAME,
  canUseGordonTools,
  isGordonAccountUsername,
} from './gordonAccess'

describe('isGordonAccountUsername', () => {
  it('matches @gordon regardless of prefix or case', () => {
    expect(isGordonAccountUsername('gordon')).toBe(true)
    expect(isGordonAccountUsername('@Gordon')).toBe(true)
    expect(isGordonAccountUsername(' Gordon ')).toBe(true)
    expect(GORDON_ACCOUNT_USERNAME).toBe('gordon')
  })

  it('rejects other accounts, empty values, and admin-looking names', () => {
    expect(isGordonAccountUsername('alice')).toBe(false)
    expect(isGordonAccountUsername('gordons')).toBe(false)
    expect(isGordonAccountUsername('admin')).toBe(false)
    expect(isGordonAccountUsername('')).toBe(false)
    expect(isGordonAccountUsername(null)).toBe(false)
    expect(isGordonAccountUsername(undefined)).toBe(false)
  })
})

describe('canUseGordonTools', () => {
  it('allows @gordon without local bypass', () => {
    expect(canUseGordonTools('gordon')).toBe(true)
    expect(canUseGordonTools('@Gordon', false)).toBe(true)
  })

  it('allows localhost local-browser data so the tools can be simulated', () => {
    expect(canUseGordonTools('dev', true)).toBe(true)
    expect(canUseGordonTools(null, true)).toBe(true)
  })

  it('does not treat a registered dev/alice account as Gordon in production', () => {
    expect(canUseGordonTools('dev')).toBe(false)
    expect(canUseGordonTools('alice')).toBe(false)
    expect(canUseGordonTools('alice', false)).toBe(false)
  })
})
