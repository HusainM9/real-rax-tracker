import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyData } from './storage'
import { importFromUsername } from './usernameImport'

const mocks = vi.hoisted(() => ({ backfill: vi.fn() }))
vi.mock('./importPassProvider', () => ({ resolveImportUserPasses: async () => ({
  playerPasses: [{ entityId: 100, season: 2026, sportRaw: 'nba', pair: '100:2026:nba', passKind: 'player', playerName: 'Owned player', seasonLabel: '2026-27', rarityLabel: 'Legendary 1', avatar: 'face' }],
  teamPasses: [], rarities: {}, metadataAuthoritative: true, dailyEarningsAvailable: false, earningsBackfillAvailable: true,
}) }))
vi.mock('./realEarningsImport', () => ({ fetchDailyRaxRows: mocks.backfill }))

const previous = {
  ...createEmptyData(),
  cards: [
    { id: 'old', name: 'Owned player', sport: 'NBA' as const, season: '2026-27', externalKey: '100|2026|NBA', rarityLabel: 'Legendary 1', passKind: 'player' as const, notes: '', createdAt: '2026-10-30' },
    { id: 'removed', name: 'Not owned anymore', sport: 'NBA' as const, season: '2026-27', externalKey: '200|2026|NBA', notes: '', createdAt: '2026-10-30' },
  ],
  performances: [
    { id: 'old-row', cardId: 'old', claimDay: '2026-10-14', raxEarned: 50, baseRaxEarned: 2, note: '', createdAt: '2026-10-30' },
    { id: 'removed-row', cardId: 'removed', claimDay: '2026-10-14', raxEarned: 10, note: '', createdAt: '2026-10-30' },
  ],
}
const response = () => ({ rowsByExternalKey: new Map(), sourceByExternalKey: new Map(), failures: [], stats: { cacheHits: 0, fetched: 0, upstreamRequests: 0, rowsReturned: 0, cacheConfigured: true } })

describe('Real re-import recovery', () => {
  beforeEach(() => mocks.backfill.mockReset())
  it('keeps prior rows after a confirmed Real 500 and excludes that failed pass from retries', async () => {
    mocks.backfill.mockResolvedValue({ ...response(), failures: [{ externalKey: '100|2026|NBA', name: 'Owned player', kind: 'upstream', message: 'Stopped after 500', upstreamStatus: 500, retryable: false }] })
    const imported = await importFromUsername(previous, 'gordon')
    expect(imported.data.performances).toHaveLength(1)
    expect(imported.data.performances[0]?.raxEarned).toBe(50)
    expect(imported.result.retryableEarningsPasses).toEqual([])
    expect(imported.result.passFetchErrors[0]).toMatchObject({ upstreamStatus: 500, retryable: false })
  })
  it('retains earnings for a failed still-owned pass, remaps IDs, and drops no-longer-owned passes', async () => {
    const result = response()
    mocks.backfill.mockResolvedValue({ ...result, failures: [{ externalKey: '100|2026|NBA', name: 'Owned player', kind: 'network', message: 'Temporary failure' }] })
    const imported = await importFromUsername(previous, 'gordon')
    expect(imported.data.cards).toHaveLength(1)
    expect(imported.data.performances).toHaveLength(1)
    expect(imported.data.performances[0]).toMatchObject({ id: 'old-row', cardId: imported.data.cards[0]!.id, raxEarned: 50 })
    expect(imported.result.retryableEarningsPasses).toHaveLength(1)
    expect(previous.performances[0]!.cardId).toBe('old')
  })
  it('does not preserve obsolete earnings when a successful response confirms an empty series', async () => {
    mocks.backfill.mockResolvedValue({ ...response(), rowsByExternalKey: new Map([['100|2026|NBA', []]]) })
    const imported = await importFromUsername(previous, 'gordon')
    expect(imported.data.performances).toEqual([])
    expect(imported.result.passesWithNoEarnings).toHaveLength(1)
    expect(imported.result.errors.join(' ')).not.toMatch(/manually|Entry page|Add card & earnings/i)
  })
})
