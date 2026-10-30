import { beforeEach, expect, it, vi } from 'vitest'
import { RequestSafetyError } from '../../lib/httpFailurePolicy'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../admin/_helpers', () => ({ requireAppSession: async () => null }))
vi.mock('../../lib/meowbotCatalogStore', () => ({ searchCatalogPasses: mocks.read, getCatalogImportProfile: mocks.read, listCatalogSeasonYears: mocks.read }))
import search from './search'
import profile from './import'
import seasons from './season-years'
beforeEach(() => { mocks.read.mockReset() })

for (const [name, handler, query] of [['search', search, '?q=player'], ['import', profile, '?externalKey=1|2026|NBA'], ['seasons', seasons, '?sport=NBA']] as const) {
  it(`${name} preserves terminal upstream status instead of turning it into an unstructured hosting error`, async () => {
    mocks.read.mockRejectedValue(new RequestSafetyError('Failed upstream', 'upstream_5xx', 503))
    const response = await handler(new Request(`https://offline.invalid/api/catalog/${name}${query}`)).catch((error: unknown) => error)
    expect(response).toBeInstanceOf(Response)
    const payload = await (response as Response).json()
    expect(payload).toMatchObject({ upstreamStatus: 503, retryable: false })
  })
  it(`${name} distinguishes a pending admission without inventing a 5xx`, async () => {
    mocks.read.mockRejectedValue(new RequestSafetyError('Pending', 'request_pending', undefined, true))
    const response = await handler(new Request(`https://offline.invalid/api/catalog/${name}${query}`)).catch((error: unknown) => error)
    expect(response).toBeInstanceOf(Response)
    expect((response as Response).status).toBe(423)
    expect(await (response as Response).json()).toMatchObject({ pending: true, retryable: false })
  })
}
