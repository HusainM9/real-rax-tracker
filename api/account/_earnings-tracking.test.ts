// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Archived history-transfer logic; the actual endpoint is covered as retired separately.
vi.mock('../../lib/earningsFeature', async (original) => ({ ...await original<typeof import('../../lib/earningsFeature')>(), DAILY_EARNINGS_FEATURE_ENABLED: true }))
import { gunzipBase64ToJson } from '../../lib/cloudSyncCompression'
const mocks = vi.hoisted(() => ({ access: vi.fn(), tracked: vi.fn(), snapshots: vi.fn() }))
vi.mock('../../lib/earningsAuth', () => ({ requireEarningsSession: mocks.access }))
vi.mock('../../lib/publicEarningsStore', () => ({ syncTrackedEarningsUsernames: mocks.tracked, listPublicEarningsSnapshots: mocks.snapshots }))
vi.mock('../../lib/realApi', () => ({ normalizeRealUsernameInput: (name: string) => name.replace(/^@/, '').trim().toLowerCase() }))
import handler from './earnings-tracking'

const rows = [{ username: 'alpha', day: '2026-10-30', dailyTotal: 42, earnings: [] }]
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue(null)
  mocks.tracked.mockImplementation(async (usernames: string[]) => usernames)
  mocks.snapshots.mockResolvedValue(rows)
})
const request = (body: unknown) => new Request('https://example.test/api/account/earnings-tracking', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('long earnings history transfer', () => {
  it('compresses expanded history when requested and retains legacy response support', async () => {
    const response = await handler(request({ usernames: ['@Alpha'], compressed: true }))
    const data = await response.json()
    expect(mocks.snapshots).toHaveBeenCalledWith(['alpha'], 365)
    expect(data.historyLimitPerAccount).toBe(365)
    expect(data.snapshots).toBeUndefined()
    expect(await gunzipBase64ToJson(data.snapshotsPayload)).toEqual(rows)
    const legacy = await (await handler(request({ usernames: ['alpha'] }))).json()
    expect(legacy.snapshots).toEqual(rows)
  })
  it('retains access protection and bounds history for large account sets', async () => {
    mocks.access.mockResolvedValueOnce(Response.json({ error: 'Denied' }, { status: 401 }))
    expect((await handler(request({ usernames: ['alpha'] }))).status).toBe(401)
    expect(mocks.snapshots).not.toHaveBeenCalled()
    const data = await (await handler(request({ usernames: Array.from({ length: 50 }, (_, index) => `account${index}`) }))).json()
    expect(data.historyLimitPerAccount).toBe(120)
  })
})
