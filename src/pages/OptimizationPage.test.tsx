import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { createEmptyData } from '../lib/storage'
import OptimizationPage from './OptimizationPage'

const mocks = vi.hoisted(() => ({ faces: vi.fn() }))
vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({ data: fixtureData, addPlannedPass: vi.fn(), addPlannedPassFromCatalog: vi.fn() }) }))
vi.mock('../lib/catalogApi', async (original) => ({
  ...await original<typeof import('../lib/catalogApi')>(),
  fetchCatalogSeasonYears: async () => ({ seasonYears: [], storageConfigured: true }),
  fetchCatalogPassSummaries: async () => ({ results: [candidate], storageConfigured: true }),
  fetchCatalogImportProfilesBulk: async () => ({ profiles: [candidate], storageConfigured: true }),
  enrichCatalogProfilesWithAvatars: mocks.faces,
}))
const fixtureData = createEmptyData()
const candidate = { externalKey: '1|2025|FC', entityId: 1, sport: 'FC', passKind: 'player', seasonYear: 2025, seasonLabel: '2025-26', name: 'Fast Player', cachedAt: '2026-10-30', rowCount: 1, totalBaseRax: 1, rows: [{ claimDay: '2025-09-01', baseRaxEarned: 1 }] }

it('shows numerical rankings without waiting for optional player faces', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  let finishFaces!: (rows: Array<{ externalKey: string; avatar: string }>) => void
  mocks.faces.mockImplementation(() => new Promise((resolve) => { finishFaces = resolve }))
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter><OptimizationPage /></MemoryRouter>))
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Rank OTD Net')!
    expect(button).toBeTruthy()
    await act(async () => { button.click(); await vi.advanceTimersByTimeAsync(500) })
    expect(container.textContent).toContain('Ranked 1 pass')
    expect(button.disabled).toBe(false)
    const resultsToggle = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('Ranking results'))!
    await act(async () => resultsToggle.click())
    expect(container.textContent).toContain('Fast Player')
    await act(async () => finishFaces([{ ...candidate, avatar: 'players/test-face.png' }]))
    expect(container.querySelector('img')?.getAttribute('src')).toContain('test-face.png')
    expect(mocks.faces).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    vi.useRealTimers()
  }
})
