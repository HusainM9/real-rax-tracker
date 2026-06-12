import { describe, expect, it } from 'vitest'
import { validateSyncPin } from './syncPinRules'

describe('validateSyncPin', () => {
  it('accepts a valid pin', () => {
    expect(validateSyncPin('abc123')).toEqual({ ok: true, pin: 'abc123' })
  })

  it('rejects spaces', () => {
    expect(validateSyncPin('ab cd').ok).toBe(false)
    expect(validateSyncPin('abcd ').ok).toBe(false)
  })

  it('rejects too short pins', () => {
    expect(validateSyncPin('abc').ok).toBe(false)
  })

  it('rejects too long pins', () => {
    expect(validateSyncPin('1234567890123').ok).toBe(false)
  })

  it('rejects unsupported characters', () => {
    expect(validateSyncPin('abc,123').ok).toBe(false)
  })
})
