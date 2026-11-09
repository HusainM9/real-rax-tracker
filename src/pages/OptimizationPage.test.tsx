// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CatalogImportProfile } from '../lib/catalogApi'
import { createEmptyData } from '../lib/storage'
import OptimizationPage from './OptimizationPage'

const mocks = vi.hoisted(() => ({ faces: vi.fn(), summaries: vi.fn(), bulk: vi.fn(), actualSeasons: false }))
vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({ data: fixtureData, addPlannedPass: vi.fn(), addPlannedPassFromCatalog: vi.fn() }) }))
vi.mock('../lib/catalogApi', async (original) => {
  const actual = await original<typeof import('../lib/catalogApi')>()
  return {
  ...actual,
  fetchCatalogSeasonYears: (...args: Parameters<typeof actual.fetchCatalogSeasonYears>) => mocks.actualSeasons
    ? actual.fetchCatalogSeasonYears(...args) : Promise.resolve({ seasonYears: [], storageConfigured: true }),
  fetchCatalogPassSummaries: async (options: { sport: string }) => {
    mocks.summaries(options)
    return { results: profilePool.filter(profile => profile.sport === options.sport), storageConfigured: true }
  },
  fetchCatalogImportProfilesBulk: async (keys: string[]) => {
    mocks.bulk(keys)
    return { profiles: profilePool.filter(profile => keys.includes(profile.externalKey)), storageConfigured: true }
  },
  enrichCatalogProfilesWithAvatars: mocks.faces,
  }
})
const fixtureData = createEmptyData()
const candidate: CatalogImportProfile = { externalKey: '1|2025|FC', entityId: 1, sport: 'FC', passKind: 'player', seasonYear: 2025, seasonLabel: '2025-26', name: 'Fast Player', cachedAt: '2026-10-30', rowCount: 1, totalBaseRax: 1, rows: [{ claimDay: '2025-09-01', baseRaxEarned: 1 }] }
let profilePool = [candidate]
beforeEach(() => {
  profilePool = [candidate]
  mocks.faces.mockReset()
  mocks.summaries.mockClear()
  mocks.bulk.mockClear()
})

it('keeps every analyzed OTD result and filters a sport below the overall top fifty without another ranking request', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  profilePool = Array.from({ length: 60 }, (_, index) => {
    const sport = index < 55 ? 'NFL' : 'CFB'
    const amount = 1000 - index * 10
    return { ...candidate, externalKey: `${index + 1}|2026|${sport}`, entityId: index + 1,
      name: `${sport} player ${index + 1}`, sport, seasonYear: 2026, seasonLabel: '2026-27',
      avatar: `players/fixture-${index}.png`, totalBaseRax: amount,
      rows: [{ claimDay: '2026-09-01', baseRaxEarned: amount }] }
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  const clickText = async (text: string, scope: ParentNode = container) => {
    const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text)!
    expect(button).toBeDefined()
    await act(async () => button.click())
  }
  try {
    await act(async () => root.render(<MemoryRouter><OptimizationPage /></MemoryRouter>))
    await act(async () => container.querySelector<HTMLButtonElement>('.rank-catalog-controls [aria-label="Sport"]')!.click())
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent?.includes('All sports (slow)'))!.click())
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Rank OTD Net')!.click(); await vi.advanceTimersByTimeAsync(20_000) })
    expect(container.textContent).toContain('Ranked 60 passes')
    const toggle = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Ranking results'))!
    await act(async () => toggle.click())
    const results = toggle.closest('section')!
    expect(results.textContent).toContain('60 passes')
    expect(results.querySelectorAll('tbody tr')).toHaveLength(25)
    const summaryReads = mocks.summaries.mock.calls.length
    const bulkReads = mocks.bulk.mock.calls.length
    await clickText('Next', results)
    await act(async () => results.querySelector<HTMLButtonElement>('[aria-label="Filter ranking by sport"]')!.click())
    await act(async () => [...results.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent?.includes('CFB'))!.click())
    expect(results.querySelectorAll('tbody tr')).toHaveLength(5)
    expect(results.textContent).toContain('CFB player 60')
    expect(results.querySelector('tbody tr td:nth-child(2)')?.textContent).toBe('56')
    expect(results.textContent).toContain('5 of 60')
    expect(mocks.summaries).toHaveBeenCalledTimes(summaryReads)
    expect(mocks.bulk).toHaveBeenCalledTimes(bulkReads)
    expect([...results.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Claim all (5)')).toBe(true)
    await clickText('Clear', results)
    expect([...results.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].every(input => !input.checked)).toBe(true)
    await act(async () => results.querySelector<HTMLButtonElement>('[aria-label="Filter ranking by sport"]')!.click())
    await act(async () => [...results.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent?.includes('All sports'))!.click())
    expect(results.querySelectorAll('tbody tr')).toHaveLength(25)
    expect(results.textContent).toContain('Page 1 of 3')
    expect([...results.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].every(input => input.checked)).toBe(true)
    await act(async () => results.querySelector<HTMLButtonElement>('[aria-label="Filter ranking by sport"]')!.click())
    await act(async () => [...results.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent?.includes('CFB'))!.click())
    expect([...results.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].every(input => !input.checked)).toBe(true)
    await clickText('Select all', results)
    await act(async () => { [...results.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Claim selected (5)')!.click(); await vi.advanceTimersByTimeAsync(20_000) })
    expect(container.textContent).toContain('Recalculated 55 passes')
    expect(results.querySelectorAll('tbody tr')).toHaveLength(25)
    expect(results.textContent).toContain('55 passes')
    expect(results.textContent).toContain('NFL player 1')
    expect(mocks.summaries).toHaveBeenCalledTimes(summaryReads)
    expect(mocks.bulk).toHaveBeenCalledTimes(bulkReads)
  } finally { await act(async () => root.unmount()); vi.useRealTimers() }
})

it('hydrates only a ranking page and preserves cleared selections when optional faces arrive', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  profilePool = Array.from({ length: 60 }, (_, index) => ({
    ...candidate, externalKey: `${index + 1}|2025|FC`, entityId: index + 1,
    name: `Face player ${index + 1}`, totalBaseRax: 1000 - index,
    rows: [{ claimDay: '2025-09-01', baseRaxEarned: 1000 - index }],
  }))
  let finishFaces!: (profiles: CatalogImportProfile[]) => void
  mocks.faces.mockImplementation(() => new Promise(resolve => { finishFaces = resolve }))
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter><OptimizationPage /></MemoryRouter>))
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Rank OTD Net')!.click(); await vi.advanceTimersByTimeAsync(20_000) })
    const requested = mocks.faces.mock.calls[0][0] as CatalogImportProfile[]
    expect(requested).toHaveLength(25)
    expect(requested.map(profile => profile.name)).not.toContain('Face player 60')
    const toggle = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Ranking results'))!
    await act(async () => toggle.click())
    const results = toggle.closest('section')!
    await act(async () => [...results.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Clear')!.click())
    const bundleToggle = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Recommended bundle'))!
    await act(async () => bundleToggle.click())
    const bundle = bundleToggle.closest('section')!
    await act(async () => [...bundle.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Clear')!.click())
    await act(async () => finishFaces(requested.map(profile => ({ ...profile, avatar: 'players/fixture-face.png' }))))
    expect(results.querySelectorAll('tbody tr')).toHaveLength(25)
    expect([...results.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')].every(input => !input.checked)).toBe(true)
    expect(results.querySelector('img')?.getAttribute('src')).toContain('fixture-face.png')
    expect([...bundle.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => !input.checked)).toBe(true)
  } finally { await act(async () => root.unmount()); vi.useRealTimers() }
})

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
