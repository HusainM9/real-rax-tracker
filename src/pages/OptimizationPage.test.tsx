// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { createEmptyData } from '../lib/storage'
import OptimizationPage from './OptimizationPage'

const mocks = vi.hoisted(() => ({ faces: vi.fn(), actualSeasons: false }))
vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({ data: fixtureData, addPlannedPass: vi.fn(), addPlannedPassFromCatalog: vi.fn() }) }))
vi.mock('../lib/catalogApi', async (original) => {
  const actual = await original<typeof import('../lib/catalogApi')>()
  return {
  ...actual,
  fetchCatalogSeasonYears: (...args: Parameters<typeof actual.fetchCatalogSeasonYears>) => mocks.actualSeasons
    ? actual.fetchCatalogSeasonYears(...args) : Promise.resolve({ seasonYears: [], storageConfigured: true }),
  fetchCatalogPassSummaries: async () => ({ results: [candidate], storageConfigured: true }),
  fetchCatalogImportProfilesBulk: async () => ({ profiles: [candidate], storageConfigured: true }),
  enrichCatalogProfilesWithAvatars: mocks.faces,
  }
})
const fixtureData = createEmptyData()
const candidate = { externalKey: '1|2025|FC', entityId: 1, sport: 'FC', passKind: 'player', seasonYear: 2025, seasonLabel: '2025-26', name: 'Fast Player', cachedAt: '2026-10-30', rowCount: 1, totalBaseRax: 1, rows: [{ claimDay: '2025-09-01', baseRaxEarned: 1 }] }

it('enables the ranking season picker on a sport revisit without another request or stale sport options', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.actualSeasons = true
  let finishCfb!: (response: Response) => void
  const sportsRequested: string[] = []
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input, 'https://tracker.example.test')
    if (url.pathname !== '/api/catalog/season-years') throw new Error('Unexpected API request')
    const sport = url.searchParams.get('sport')!
    sportsRequested.push(sport)
    if (sport === 'CFB') return new Promise<Response>(resolve => { finishCfb = resolve })
    return Response.json({ seasonYears: [{ seasonYear: sport === 'NHL' ? 2027 : 2026, seasonLabel: '2026-27' }], storageConfigured: true })
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  const pickSport = async (sport: string) => {
    await act(async () => container.querySelector<HTMLButtonElement>('.rank-catalog-controls [aria-label="Sport"]')!.click())
    const option = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.trim().endsWith(sport))!
    await act(async () => option.click())
  }
  const season = () => container.querySelector<HTMLButtonElement>('.rank-catalog-controls [aria-label="Season"]')!
  try {
    await act(async () => root.render(<MemoryRouter><OptimizationPage /></MemoryRouter>))
    await pickSport('CFB')
    expect(season().disabled).toBe(true)
    await pickSport('NHL')
    expect(season().disabled).toBe(false)
    await act(async () => finishCfb(Response.json({ seasonYears: [
      { seasonYear: 2026, seasonLabel: '2026-27' }, { seasonYear: 2025, seasonLabel: '2025-26' },
    ], storageConfigured: true })))
    await act(async () => season().click())
    expect([...container.querySelectorAll('[role="option"]')].some(option => option.textContent?.includes('2025-26'))).toBe(false)
    await act(async () => season().click())
    await pickSport('CFB')
    expect(season().disabled).toBe(false)
    expect(sportsRequested.filter(sport => sport === 'CFB')).toHaveLength(1)
    await act(async () => season().click())
    const oldSeason = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent?.includes('2025-26'))!
    expect(oldSeason).toBeDefined()
    await act(async () => oldSeason.click())
    expect(season().textContent).toContain('2025-26')
  } finally {
    await act(async () => root.unmount())
    mocks.actualSeasons = false
    vi.unstubAllGlobals()
  }
})

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
