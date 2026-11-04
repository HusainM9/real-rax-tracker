// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createEmptyData } from '../lib/storage'
import type { RaxTrackerData } from '../types/rax'
import PlanPacksPage from './PlanPacksPage'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), update: vi.fn(), account: vi.fn(), apply: vi.fn(() => ({ updatedAccounts: 1, missingPasses: 0 })) }))
let data: RaxTrackerData
vi.mock('../lib/packRatingsImport', () => ({ fetchPackRatings: mocks.fetch }))
vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({ data, applyPackRatingsFromImport: mocks.apply, updatePackTracker: mocks.update, updatePackTrackerAccount: mocks.account }) }))
let container: HTMLDivElement, root: Root
const render = async () => { await act(async () => root.render(<MemoryRouter><PlanPacksPage /></MemoryRouter>)) }
const expandPlayer = async () => { await act(async () => container.querySelector<HTMLButtonElement>('.pack-tracker-row .collapsible-toggle')!.click()) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  data = { ...createEmptyData(),
    plannedPasses: [{ id: 'plan1', externalKey: '1|2027|NBA', name: 'Player', sport: 'NBA', season: '2026-27', passKind: 'player', simulatedRarityLabel: 'Iconic 1', totalBaseRax: 1, rowCount: 1, notes: '', source: 'catalog', progress: 'future', addedAt: '2026-10-30' }],
    packTrackers: [{ id: 'tracker1', plannedPassId: 'plan1', accounts: [{ id: 'a1', name: 'gordon', username: 'gordon', rating: 10, opensPacks: true }], ratingPerPack: 10, createdAt: '2026-10-30', updatedAt: '2026-10-30' }],
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

it('keeps explicit refresh, target and editing controls in the compact layout without account avatars', async () => {
  mocks.fetch.mockResolvedValue({ username: 'gordon', passes: [], passCount: 0, fetchedAt: '2026-10-30T17:00:00Z', source: 'cache' })
  await render()
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(container.querySelector('[aria-label="Today’s openings for Player"]')).not.toBeNull()
  expect(container.querySelector('.pack-sync-account-avatar')).toBeNull()
  await expandPlayer()
  const target = container.querySelector<HTMLSelectElement>('select[aria-label="Rating target for Player"]')!
  await act(async () => { target.value = '380'; target.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(mocks.update).toHaveBeenCalledWith('tracker1', { ratingTarget: 380 })
  const settings = container.querySelector<HTMLDetailsElement>('.pack-player-settings')!
  expect(settings).not.toBeNull(); expect(settings.open).toBe(false)
  expect(settings.querySelector('input[aria-label="Rating per pack for Player"]')).not.toBeNull()
  const edit = container.querySelector<HTMLDetailsElement>('.pack-account-edit')!
  expect(edit.open).toBe(false)
  expect(edit.querySelector('input[aria-label="Real username for gordon on Player"]')).not.toBeNull()
  expect(edit.querySelector('button[aria-label="Remove gordon from Player"]')).not.toBeNull()
  const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Always refresh ratings from Real"]')!
  await act(async () => checkbox.click())
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Sync @gordon"]')!.click())
  expect(mocks.fetch).toHaveBeenCalledWith('gordon', undefined, { forceRefresh: true })
  expect(container.querySelector('time[datetime="2026-10-30T17:00:00Z"]')).not.toBeNull()
  expect(container.textContent).toContain('Recent scan')
  expect(mocks.apply).toHaveBeenCalledWith('gordon', {}, expect.objectContaining({ scan: expect.objectContaining({ fetchedAt: '2026-10-30T17:00:00Z' }) }))
})

it('imports every tracked player with one shared sync per distinct username and blocks overlapping bulk clicks', async () => {
  data.plannedPasses!.push({ ...data.plannedPasses![0]!, id: 'plan2', externalKey: '2|2027|NHL', name: 'NHL player', sport: 'NHL' })
  data.packTrackers!.push({ ...data.packTrackers![0]!, id: 'tracker2', plannedPassId: 'plan2', accounts: [{ id: 'b1', username: 'GORDON', name: 'Main', rating: 0, opensPacks: true }, { id: 'b2', username: 'alt', name: 'Alt', rating: 0, opensPacks: true }] })
  let finish!: () => void
  const wait = new Promise<void>(resolve => { finish = resolve })
  mocks.fetch.mockImplementation(async (username: string) => { await wait; return { username, passes: [], passCount: 0, fetchedAt: '2026-10-31T15:00:00Z', source: 'cache' } })
  await render()
  const toolbar = container.querySelector('.pack-tracker-list-actions')!
  const bulk = toolbar.querySelector<HTMLButtonElement>('button[aria-label="Import all tracked player ratings"]')!
  expect(bulk).not.toBeNull()
  expect(toolbar.textContent).toContain('Track all')
  await act(async () => bulk.click())
  expect(bulk.disabled).toBe(true)
  await act(async () => bulk.click())
  expect(mocks.fetch).toHaveBeenCalledTimes(2)
  expect(mocks.fetch.mock.calls.map(call => call[0].toLowerCase()).sort()).toEqual(['alt', 'gordon'])
  await act(async () => finish())
  expect(mocks.apply).toHaveBeenCalledTimes(2)
  expect(container.querySelector('.pack-board-import-status')!.textContent).toContain('Synced 2/2 accounts')
  expect(bulk.disabled).toBe(false)
})

it('retains weekly date logging and extra account estimates behind the settings disclosure', async () => {
  data.packTrackers![0]!.weeklyPacksOnly = true
  await render(); await expandPlayer()
  const settings = container.querySelector('.pack-player-settings')!
  expect(settings.querySelector('input[aria-label="Extra weekly accounts for Player"]')).not.toBeNull()
  expect(settings.querySelector('input[aria-label="Weekly pack open date for Player"]')).not.toBeNull()
  expect(settings.textContent).toContain('Add open date')
  expect(settings.textContent).toContain('Use daily packs')
})

it('checks all five linked accounts and reports an already-current scan separately from updates', async () => {
  data.packTrackers![0]!.accounts = ['main', 'alt1', 'alt2', 'alt3', 'alt4'].map((username, i) =>
    ({ id: `a${i}`, username, name: username, rating: 10, opensPacks: true }))
  mocks.fetch.mockImplementation(async (username: string) => ({ username, passCount: 1,
    passes: [{ externalKey: '1|2027|NBA', rating: 100 }], fetchedAt: '2026-11-05T12:00:00Z', source: 'cache' }))
  mocks.apply.mockImplementation((username?: string) => username === 'alt4'
    ? { updatedAccounts: 0, missingPasses: 0, unchangedAccounts: 1 }
    : { updatedAccounts: 1, missingPasses: 0, unchangedAccounts: 0 })
  await render(); await expandPlayer()
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.pack-tracker-row button')).find(item => item.textContent?.trim() === 'Import all')!
  expect(button).toBeDefined()
  await act(async () => button.click())
  expect(mocks.fetch).toHaveBeenCalledTimes(5)
  expect(mocks.fetch.mock.calls.map(call => call[0]).sort()).toEqual(['alt1', 'alt2', 'alt3', 'alt4', 'main'])
  expect(mocks.apply).toHaveBeenCalledTimes(5)
  expect(container.querySelector('.pack-tracker-row .import-status')?.textContent).toContain('Checked 5/5 accounts')
  expect(container.querySelector('.pack-tracker-row .import-status')?.textContent).toContain('4 updated')
  expect(container.querySelector('.pack-tracker-row .import-status')?.textContent).toContain('1 already current')
})
