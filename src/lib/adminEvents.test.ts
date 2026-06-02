import { describe, expect, it } from 'vitest'
import {
  buildImportAdminEvents,
  getAdminClientId,
} from './adminEvents'
import type { UsernameImportResult } from './usernameImport'

function emptyResult(overrides: Partial<UsernameImportResult> = {}): UsernameImportResult {
  return {
    cardsCreated: 0,
    cardsUpdated: 0,
    rowsImported: 0,
    skipped: 0,
    passesFetched: 0,
    passesSkipped: 0,
    errors: [],
    passesWithNoEarnings: [],
    passFetchErrors: [],
    ...overrides,
  }
}

describe('adminEvents', () => {
  it('builds player-only no-earnings and fetch-error events', () => {
    const events = buildImportAdminEvents(
      '@TestUser',
      emptyResult({
        rowsImported: 10,
        passesFetched: 3,
        passesWithNoEarnings: [
          {
            name: 'Player A',
            sport: 'NBA',
            season: '2024-25',
            externalKey: '1|2024|NBA',
            passKind: 'player',
          },
          {
            name: 'DEN Nuggets',
            sport: 'NBA',
            season: '2024-25',
            externalKey: '2|2024|NBA',
            passKind: 'team',
          },
        ],
        passFetchErrors: [
          {
            name: 'Player B',
            sport: 'NFL',
            season: '2025-26',
            externalKey: '3|2025|NFL',
            passKind: 'player',
            message: 'Network error',
          },
        ],
      }),
    )

    expect(events[0]?.type).toBe('import_complete')
    expect(events.filter((event) => event.type === 'pass_no_earnings')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'pass_fetch_error')).toHaveLength(1)
    expect(events.every((event) => event.realUsername === 'testuser')).toBe(true)
  })

  it('returns a stable client id in localStorage', () => {
    localStorage.clear()
    const first = getAdminClientId()
    const second = getAdminClientId()
    expect(first).toBe(second)
  })
})
