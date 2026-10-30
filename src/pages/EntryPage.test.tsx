import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyData } from '../lib/storage'
import EntryPage from './EntryPage'
import { RequestSafetyError } from '../../lib/httpFailurePolicy'

const mocks = vi.hoisted(() => ({ import: vi.fn(), retry: vi.fn(), settings: vi.fn() }))
vi.mock('../context/AccountAuthContext', () => ({ useAccountAuth: () => ({ username: 'gordon' }) }))
vi.mock('../context/RaxDataContext', () => ({ useRaxData: () => ({ data: createEmptyData(), importFromUsername: mocks.import, retryFailedEarnings: mocks.retry, setSettings: mocks.settings }) }))
vi.mock('../lib/adminEvents', () => ({ reportImportAdminEvents: async () => undefined }))
vi.mock('../lib/importShutdown', () => ({ usernameImportDisabled: () => false, realProviderImportEnabled: () => true, realappToolsShutdownLabel: () => '' }))

let container: HTMLDivElement
let root: Root
const result = {
  cardsCreated: 1, cardsUpdated: 0, rowsImported: 1, skipped: 0, passesFetched: 1, passesSkipped: 0,
  passesIgnored: 0, cachedPlayerPasses: 0, ownedPasses: [], cachedProfiles: [], errors: [],
  passesWithNoEarnings: [], passFetchErrors: [], retryableEarningsPasses: [],
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  mocks.import.mockResolvedValue(result)
  mocks.retry.mockResolvedValue(result)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function render() { await act(async () => root.render(<MemoryRouter><EntryPage /></MemoryRouter>)) }

describe('import-only collection tools', () => {
  it('defers a pending admission without permanently treating it as a confirmed failure', async () => {
    mocks.import.mockRejectedValue(new RequestSafetyError('Another request is pending. No request sent.', 'request_pending', undefined, true))
    await render()
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    expect(container.textContent).toContain('No request sent')
    expect(container.textContent).not.toMatch(/operator review/i)
    expect(mocks.import).toHaveBeenCalledTimes(1)
  })
  it('pauses the form after a terminal incident without inviting another import', async () => {
    mocks.import.mockRejectedValue(new RequestSafetyError('Request outcome uncertain. Reference: incident-example.', 'request_outcome_unknown'))
    await render()
    const submit = () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await act(async () => { submit() })
    expect(container.textContent).toContain('incident-example')
    expect(container.textContent).toMatch(/operator review/i)
    const importButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(importButton.disabled).toBe(true)
    await act(async () => { submit() })
    expect(mocks.import).toHaveBeenCalledTimes(1)
    expect(mocks.retry).not.toHaveBeenCalled()
  })
  it('allows a corrected submission after a non-terminal validation error', async () => {
    mocks.import.mockRejectedValueOnce(new Error('Username not found.')).mockResolvedValueOnce(result)
    await render()
    const submit = () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await act(async () => { submit() })
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
    await act(async () => { submit() })
    expect(mocks.import).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Imported 1 RAX rows')
  })
  it('shows a partial terminal backfill as paused instead of a successful retryable import', async () => {
    mocks.import.mockResolvedValue({ ...result, passFetchErrors: [{ externalKey: 'owned', name: 'Player', sport: 'NBA', season: '2026-27', passKind: 'player', message: 'Stopped after HTTP 503. Reference: partial-incident.', upstreamStatus: 503, retryable: false }] })
    await render()
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    expect(container.textContent).toMatch(/operator review/i)
    expect(container.textContent).toContain('partial-incident')
    expect(container.textContent).not.toMatch(/No retryable earnings failures/)
  })
  it('keeps username import and removes manual entry, saved profiles and editable tables', async () => {
    await render()
    const headings = [...container.querySelectorAll('h1,h2,h3,summary')].map((element) => element.textContent).join(' ')
    expect(headings).not.toMatch(/Quick add|Manual add|Saved earnings profiles|Player cards|RAX entries/i)
    expect(container.querySelector('input[placeholder="yourname"]')).not.toBeNull()
    expect(mocks.import).not.toHaveBeenCalled()
    expect(mocks.settings).not.toHaveBeenCalled()
  })

  it('imports and retries failed earnings without referring users to removed controls', async () => {
    const failed = { externalKey: '1|2026|NBA', entityId: 1, passKind: 'player', sportRaw: 'nba', seasonYear: 2026, seasonLabel: '2026-27', name: 'Player' }
    mocks.import.mockResolvedValue({ ...result, retryableEarningsPasses: [failed], passFetchErrors: [{ name: 'Player', externalKey: failed.externalKey, sport: 'NBA', season: '2026-27', passKind: 'player', message: 'Temporary failure' }] })
    await render()
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(mocks.import).toHaveBeenCalledWith('gordon', expect.objectContaining({ includeRare: false, includeEpic: false }))
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent?.startsWith('Retry failed earnings'))!
    expect(retry).toBeDefined()
    await act(async () => retry.click())
    expect(mocks.retry).toHaveBeenCalled()
    expect(container.textContent).not.toMatch(/manual add|paste JSON|Quick add/i)
  })
})
