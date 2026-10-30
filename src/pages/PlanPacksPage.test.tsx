import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { createEmptyData } from '../lib/storage'
import PlanPacksPage from './PlanPacksPage'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), apply: vi.fn(() => ({ updatedAccounts: 1, missingPasses: 0 })) }))
vi.mock('../lib/packRatingsImport', () => ({ fetchPackRatings: mocks.fetch }))
vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({
  data: {
    ...createEmptyData(),
    plannedPasses: [{ id: 'plan1', externalKey: '1|2026|NBA', name: 'Player', sport: 'NBA', season: '2026-27', passKind: 'player', simulatedRarityLabel: 'Iconic 1', totalBaseRax: 1, rowCount: 1, notes: '', source: 'catalog', progress: 'not-started', addedAt: '2026-10-30' }],
    packTrackers: [{ id: 'tracker1', plannedPassId: 'plan1', accounts: [{ id: 'a1', name: 'gordon', username: 'gordon', rating: 10, opensPacks: true }], ratingPerPack: 10, createdAt: '2026-10-30', updatedAt: '2026-10-30' }],
  },
  applyPackRatingsFromImport: mocks.apply,
}) }))

const container = document.createElement('div')
const root = createRoot(container)
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('shows original scan freshness and forwards the explicit force-refresh choice', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  document.body.append(container)
  mocks.fetch.mockResolvedValue({ username: 'gordon', passes: [], passCount: 0, fetchedAt: '2026-10-30T17:00:00Z', source: 'cache' })
  await act(async () => root.render(<MemoryRouter><PlanPacksPage /></MemoryRouter>))
  const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Always refresh ratings from Real"]')
  expect(checkbox).not.toBeNull()
  await act(async () => checkbox!.click())
  const sync = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Sync @gordon')!
  await act(async () => sync.click())
  expect(mocks.fetch).toHaveBeenCalledWith('gordon', undefined, { forceRefresh: true })
  expect(container.querySelector('time[datetime="2026-10-30T17:00:00Z"]')).not.toBeNull()
  expect(container.textContent).toContain('Recent scan')
})
