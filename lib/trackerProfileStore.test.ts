import { describe, expect, it } from 'vitest'
import { hashSyncPassphrase, matchesSyncPassphrase } from './syncPassphrase'
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

  it('matches hashes created under an alternate pepper', async () => {
    const previous = process.env.AUTH_SESSION_SECRET
    const previousBasic = process.env.BASIC_AUTH_PASSWORD
    const previousTracker = process.env.TRACKER_SYNC_SECRET
    process.env.TRACKER_SYNC_SECRET = ''
    process.env.AUTH_SESSION_SECRET = 'new-secret'
    process.env.BASIC_AUTH_PASSWORD = 'old-secret'

    const storedHash = await hashSyncPassphrase('gordon', 'mypass', 'old-secret')
    await expect(matchesSyncPassphrase('gordon', 'mypass', storedHash)).resolves.toBe(true)
    await expect(matchesSyncPassphrase('gordon', 'nope', storedHash)).resolves.toBe(false)

    process.env.AUTH_SESSION_SECRET = previous
    process.env.BASIC_AUTH_PASSWORD = previousBasic
    process.env.TRACKER_SYNC_SECRET = previousTracker
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
