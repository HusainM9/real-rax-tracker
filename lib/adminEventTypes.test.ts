import { describe, expect, it } from 'vitest'
import {
  filterAdminEvents,
  mergeUserSummary,
  validateAdminEventInput,
  type AdminEvent,
} from './adminEventTypes'

describe('adminEventTypes', () => {
  it('validates admin event input', () => {
    expect(
      validateAdminEventInput({
        type: 'pass_no_earnings',
        realUsername: '@TestUser',
        clientId: 'client-1',
        passName: 'Player A',
        sport: 'NBA',
        passKind: 'player',
      }),
    ).toEqual({
      type: 'pass_no_earnings',
      realUsername: 'testuser',
      clientId: 'client-1',
      passName: 'Player A',
      sport: 'NBA',
      season: undefined,
      rarityLabel: undefined,
      passKind: 'player',
      externalKey: undefined,
      message: undefined,
    })
  })

  it('filters events by type and username', () => {
    const events: AdminEvent[] = [
      {
        id: '1',
        at: '2026-01-01T00:00:00.000Z',
        type: 'pass_no_earnings',
        realUsername: 'alpha',
        clientId: 'c1',
        passName: 'Alpha',
      },
      {
        id: '2',
        at: '2026-01-02T00:00:00.000Z',
        type: 'import_complete',
        realUsername: 'bravo',
        clientId: 'c2',
      },
    ]

    expect(filterAdminEvents(events, { type: 'pass_no_earnings' })).toHaveLength(1)
    expect(filterAdminEvents(events, { username: 'brav' })).toHaveLength(1)
  })

  it('merges user summary counts', () => {
    const event: AdminEvent = {
      id: '1',
      at: '2026-01-02T00:00:00.000Z',
      type: 'pass_no_earnings',
      realUsername: 'alpha',
      clientId: 'c1',
    }

    expect(mergeUserSummary(null, event)).toEqual({
      realUsername: 'alpha',
      lastAt: '2026-01-02T00:00:00.000Z',
      importCompleteCount: 0,
      passNoEarningsCount: 1,
      passFetchErrorCount: 0,
    })
  })
})
