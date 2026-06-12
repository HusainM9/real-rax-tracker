import { describe, expect, it } from 'vitest'
import { hashSyncPassphrase } from './syncPassphrase'
import { validateTrackerProfileData } from './trackerProfileStore'

describe('hashSyncPassphrase', () => {
  it('is stable for the same username and passphrase', async () => {
    const first = await hashSyncPassphrase('PlayerOne', 'secret-pin')
    const second = await hashSyncPassphrase('@playerone', 'secret-pin')
    expect(first).toBe(second)
  })

  it('changes when the passphrase changes', async () => {
    const first = await hashSyncPassphrase('playerone', 'one')
    const second = await hashSyncPassphrase('playerone', 'two')
    expect(first).not.toBe(second)
  })
})

describe('validateTrackerProfileData', () => {
  it('accepts tracker-shaped payloads', () => {
    expect(
      validateTrackerProfileData({
        cards: [],
        performances: [],
      }),
    ).toBe(true)
  })

  it('rejects malformed payloads', () => {
    expect(validateTrackerProfileData(null)).toBe(false)
    expect(validateTrackerProfileData({ cards: [] })).toBe(false)
  })
})
