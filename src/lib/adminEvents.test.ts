// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildImportAdminEvents,
  getAdminClientId,
  postAdminEvents,
} from './adminEvents'
import type { UsernameImportResult } from './usernameImport'
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./safeImportFetch', () => ({ safeFetch: mocks.fetch }))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

function emptyResult(overrides: Partial<UsernameImportResult> = {}): UsernameImportResult {
  return {
    cardsCreated: 0,
    cardsUpdated: 0,
    rowsImported: 0,
    skipped: 0,
    passesFetched: 0,
    passesSkipped: 0,
    passesIgnored: 0,
    cachedPlayerPasses: 0,
    ownedPasses: [],
    cachedProfiles: [],
    errors: [],
    passesWithNoEarnings: [],
    passFetchErrors: [],
    retryableEarningsPasses: [],
    ...overrides,
  }
}

describe('adminEvents', () => {
  it('preserves large activity reports by sending accepted batches without provider calls', async () => {
    vi.stubEnv('DEV', false); mocks.fetch.mockResolvedValue(Response.json({}, { status: 202 }))
    const event = { type: 'pass_fetch_error' as const, realUsername: 'sample', clientId: 'sample' }
    await postAdminEvents(Array.from({ length: 101 }, () => event))
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(mocks.fetch.mock.calls.map(call => JSON.parse(call[1].body).events.length)).toEqual([50, 50, 1])
    expect(mocks.fetch.mock.calls.every(call => call[0] === '/api/admin/events')).toBe(true)
  })
  it('stops the reporting operation after a failed batch without retrying it', async () => {
    vi.stubEnv('DEV', false); mocks.fetch.mockResolvedValue(Response.json({}, { status: 503 }))
    await postAdminEvents(Array.from({ length: 101 }, () => ({ type: 'pass_fetch_error' as const, realUsername: 'sample', clientId: 'sample' })))
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('retains team-pass failures without copying raw exception messages', () => {
    const events = buildImportAdminEvents('sample', emptyResult({ passFetchErrors: [{ name: 'Sample team', sport: 'NBA', season: '2026-27', externalKey: '1|2027|NBA|team', passKind: 'team', message: 'token=secret private-body' }] }))
    expect(events.filter(event => event.type === 'pass_fetch_error')).toHaveLength(1)
    expect(JSON.stringify(events)).not.toMatch(/secret|private-body/)
  })
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
