// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RaxDataProvider, useRaxData } from './RaxDataContext'
import { AccountDataConflictError } from '../lib/accountData'
import { createEmptyData } from '../lib/storage'
import type { RaxDataContextValue } from './raxDataContextTypes'

const mocks = vi.hoisted(() => ({ username: 'alice', refresh: vi.fn(), load: vi.fn(), save: vi.fn(), local: vi.fn(), persist: vi.fn() }))
vi.mock('./AccountAuthContext', () => ({ useAccountAuth: () => ({ username: mocks.username, devBypass: false, refresh: mocks.refresh }) }))
vi.mock('../lib/accountData', async (original) => ({ ...await original<typeof import('../lib/accountData')>(), loadAccountData: mocks.load, saveAccountData: mocks.save }))
vi.mock('../lib/trackerPersistence', () => ({ loadPersistedTrackerData: mocks.local, persistTrackerData: mocks.persist, storageWarningMessage: () => '' }))

const dataFor = (name: string) => ({ ...createEmptyData(), cards: [{ id: name, name, sport: 'NBA' as const, season: '2026-27', notes: '', createdAt: '2026-10-30' }] })
const loaded = (name: string, revision = 'revision0') => ({ data: dataFor(name), meta: { updatedAt: revision }, storageConfigured: true })
let latest: RaxDataContextValue
function Probe() { latest = useRaxData(); return <p>{latest.data.cards[0]?.name}</p> }
let root: Root
let container: HTMLDivElement
const render = async () => { await act(async () => root.render(<RaxDataProvider><Probe /></RaxDataProvider>)) }
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1100) }) }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  vi.useFakeTimers()
  mocks.username = 'alice'
  mocks.load.mockResolvedValue(loaded('alice'))
  mocks.save.mockResolvedValue({ meta: { updatedAt: 'revision1' } })
  mocks.local.mockImplementation(async (scope?: { accountUsername: string }) => ({ data: dataFor(scope?.accountUsername || 'other-account-legacy'), source: 'local' }))
  mocks.persist.mockResolvedValue({ ok: true, idbSaved: true, localSaved: true, byteSize: 1, compacted: false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers() })

describe('account data safety', () => {
  it('returns all five applied account counts even when React batches the imports', async () => {
    await render()
    const users = ['main', 'alt1', 'alt2', 'alt3', 'alt4']
    await act(async () => latest.importJson(JSON.stringify({ ...createEmptyData(),
      plannedPasses: [{ id: 'p', externalKey: '1|2027|NHL', name: 'Player', sport: 'NHL', season: '2026-27', passKind: 'player', simulatedRarityLabel: 'Iconic 1', totalBaseRax: 1, rowCount: 1, source: 'catalog', progress: 'not-started', addedAt: '2026-11-05' }],
      packTrackers: [{ id: 't', plannedPassId: 'p', accounts: users.map((username, i) => ({ id: `a${i}`, username, name: username, rating: 10, opensPacks: true })) }],
    })))
    const counts: number[] = []
    await act(async () => {
      users.forEach((username, i) => counts.push(latest.applyPackRatingsFromImport(username,
        { '1|2027|NHL': { rating: 100 + i } },
        { plannedPassId: 'p', accountId: `a${i}`, scan: { fetchedAt: '2026-11-05T12:00:00Z' } },
      ).updatedAccounts))
    })
    expect(counts).toEqual([1, 1, 1, 1, 1])
    expect(latest.data.packTrackers![0]!.accounts.map(account => account.rating)).toEqual([100, 101, 102, 103, 104])
    const beforeRepeat = latest.data
    let repeat: ReturnType<RaxDataContextValue['applyPackRatingsFromImport']> | undefined
    await act(async () => { repeat = latest.applyPackRatingsFromImport('main', { '1|2027|NHL': { rating: 999 } },
      { scan: { fetchedAt: '2026-11-05T12:00:00Z' } }) })
    expect(repeat).toMatchObject({ updatedAccounts: 0, unchangedAccounts: 1 })
    expect(latest.data.packTrackers![0]!.accounts[0]!.rating).toBe(100)
    expect(latest.data).toBe(beforeRepeat)
  })

  it('reconciles disjoint cloud changes once while keeping imports made during the conflict read', async () => {
    await render()
    let finishRead!: (value: ReturnType<typeof loaded>) => void
    mocks.save.mockRejectedValueOnce(new AccountDataConflictError('remote-revision'))
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    await act(async () => latest.setSettings({ savedUsername: 'local import' }))
    await tick()
    expect(mocks.load).toHaveBeenCalledTimes(2)
    await act(async () => latest.setSettings({ proBonusEnabled: false }))
    const remote = loaded('alice', 'remote-revision')
    remote.data.cards.push({ ...remote.data.cards[0]!, id: 'remote-card', name: 'Cloud addition' })
    await act(async () => finishRead(remote))
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1]?.[1]).toEqual({ ifUnmodifiedSince: 'remote-revision' })
    expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({ settings: { savedUsername: 'local import', proBonusEnabled: false } })
    expect(latest.data.cards.map(card => card.id)).toEqual(['alice', 'remote-card'])
    expect(latest.data.settings.savedUsername).toBe('local import')
    expect(latest.storageWarning).toBeNull()
    await tick()
    expect(mocks.save).toHaveBeenCalledTimes(2)
  })

  it('keeps both copies protected when a freshly loaded cloud change overlaps the local edit', async () => {
    await render()
    const remote = loaded('alice', 'remote-revision')
    remote.data.settings.savedUsername = 'different cloud edit'
    mocks.load.mockResolvedValueOnce(remote)
    mocks.save.mockRejectedValueOnce(new AccountDataConflictError('remote-revision'))
    await act(async () => latest.setSettings({ savedUsername: 'local edit' }))
    await tick()
    expect(mocks.load).toHaveBeenCalledTimes(2)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(latest.data.settings.savedUsername).toBe('local edit')
    expect(latest.storageWarning).toMatch(/paused|another device/i)
  })

  it('stops after one reconciliation if the conditional save conflicts again', async () => {
    await render()
    const remote = loaded('alice', 'remote-revision')
    remote.data.cards.push({ ...remote.data.cards[0]!, id: 'remote-card' })
    mocks.load.mockResolvedValueOnce(remote)
    mocks.save.mockRejectedValue(new AccountDataConflictError('racing-revision'))
    await act(async () => latest.setSettings({ savedUsername: 'local edit' }))
    await tick()
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.load).toHaveBeenCalledTimes(2)
    expect(latest.storageWarning).toMatch(/paused/i)
    expect(latest.data.settings.savedUsername).toBe('local edit')
    await tick()
    expect(mocks.save).toHaveBeenCalledTimes(2)
  })

  it('does not start reconciliation on network errors', async () => {
    await render()
    mocks.save.mockRejectedValueOnce(new Error('Connection lost'))
    await act(async () => latest.setSettings({ savedUsername: 'local edit' }))
    await tick()
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(latest.storageWarning).toMatch(/paused/i)
  })

  it('ignores an old-account conflict read completed after switching accounts', async () => {
    await render()
    let finishRead!: (value: ReturnType<typeof loaded>) => void
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    mocks.save.mockRejectedValueOnce(new AccountDataConflictError('remote-revision'))
    await act(async () => latest.setSettings({ savedUsername: 'alice edit' }))
    await tick()
    mocks.username = 'bob'; mocks.load.mockResolvedValueOnce(loaded('bob', 'bob-revision'))
    await render()
    await act(async () => finishRead(loaded('alice', 'remote-revision')))
    expect(latest.data.cards[0]?.name).toBe('bob')
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('persists pack targets and records only fresh imported evidence for the matching account', async () => {
    await render()
    await act(async () => latest.importJson(JSON.stringify({ ...createEmptyData(),
      plannedPasses: [{ id: 'p', externalKey: '1|2026|NBA', name: 'Player', sport: 'NBA', season: '2026-27', passKind: 'player', simulatedRarityLabel: 'Iconic 1', totalBaseRax: 1, rowCount: 1, source: 'catalog', progress: 'not-started', addedAt: '2026-10-30' }],
      packTrackers: [{ id: 't', plannedPassId: 'p', accounts: [
        { id: 'a', username: 'main', name: 'Main', rating: 100, opensPacks: true },
        { id: 'b', username: 'alt', name: 'Alt', rating: 10, opensPacks: true },
      ] }],
    })))
    await act(async () => latest.updatePackTracker('t', { ratingTarget: 380 }))
    expect(latest.data.packTrackers![0]!.ratingTarget).toBe(380)
    const scan = (fetchedAt: string) => ({ fetchedAt, startedAt: fetchedAt })
    await act(async () => latest.applyPackRatingsFromImport('main', { '1|2026|NBA': { rating: 100 } }, { scan: scan('2026-10-30T14:00:00Z') }))
    await act(async () => latest.applyPackRatingsFromImport('main', { '1|2026|NBA': { rating: 110 } }, { scan: scan('2026-10-30T14:00:00Z') }))
    expect(latest.data.packTrackers![0]!.accounts[0]!.rating).toBe(100)
    expect(latest.data.packTrackers![0]!.accounts[0]!.packObservation?.comparisons).toBe(0)
    await act(async () => latest.applyPackRatingsFromImport('main', { '1|2026|NBA': { rating: 110 } }, { scan: scan('2026-10-30T15:00:00Z') }))
    const account = latest.data.packTrackers![0]!.accounts[0]!
    expect(account.packObservation?.likelyOpenedAt).toBe('2026-10-30T15:00:00Z')
    expect(account.realProfile).toBeUndefined()
    await act(async () => latest.updatePackTrackerAccount('t', 'b', { rating: 120 }))
    expect(latest.data.packTrackers![0]!.accounts[1]!.packObservation).toBeUndefined()
    await act(async () => latest.applyPackRatingsFromImport('wrong', { '1|2026|NBA': { rating: 999 } }, { accountId: 'a', scan: scan('2026-10-30T16:00:00Z') }))
    expect(latest.data.packTrackers![0]!.accounts[0]!.rating).toBe(110)
    await act(async () => latest.applyPackRatingsFromImport('main', {}, { scan: scan('2026-10-30T13:00:00Z') }))
    expect(latest.data.packTrackers![0]!.accounts[0]!.ownershipStatus).toBe('owned')
    await act(async () => latest.applyPackRatingsFromImport('main', {}, { scan: scan('2026-10-30T17:00:00Z') }))
    await act(async () => latest.applyPackRatingsFromImport('main', { '1|2026|NBA': { rating: 120 } }, { scan: scan('2026-10-30T16:00:00Z') }))
    expect(latest.data.packTrackers![0]!.accounts[0]!.ownershipStatus).toBe('missing')
    expect(latest.data.packTrackers![0]!.accounts[0]!.packObservation).toEqual(account.packObservation)
    expect(latest.data.plannedPasses).toHaveLength(1)
  })
  it('uses only the current account cache after bootstrap failure and pauses cloud writes', async () => {
    mocks.load.mockRejectedValue(new Error('Offline'))
    await render()
    expect(latest.data.cards[0]?.name).toBe('alice')
    expect(mocks.local).toHaveBeenCalledWith({ accountUsername: 'alice' })
    await act(async () => latest.setSettings({ savedUsername: 'local edit' }))
    await tick()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(latest.storageWarning).toMatch(/paused|unavailable|offline/i)
  })

  it('does not automatically overwrite a conflicting server revision', async () => {
    mocks.save.mockRejectedValue(new AccountDataConflictError('other-device-revision'))
    await render()
    await act(async () => latest.setSettings({ savedUsername: 'first edit' }))
    await tick()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(latest.storageWarning).toMatch(/paused|another device/i)
    await act(async () => latest.setSettings({ savedUsername: 'second edit' }))
    await tick()
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it('clears the previous account immediately on a switch and ignores old completions', async () => {
    await render()
    let resolveBob!: (value: ReturnType<typeof loaded>) => void
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => { resolveBob = resolve }))
    mocks.username = 'bob'
    await render()
    expect(latest.data.cards).toEqual([])
    await act(async () => resolveBob(loaded('bob')))
    expect(latest.data.cards[0]?.name).toBe('bob')
    await tick()
    expect(mocks.persist.mock.calls.at(-1)?.[1]).toEqual({ accountUsername: 'bob' })
  })

  it('serializes saves and uses the successful predecessor revision', async () => {
    await render()
    let finishFirst!: (value: { meta: { updatedAt: string } }) => void
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
    await act(async () => latest.setSettings({ savedUsername: 'first' }))
    await tick()
    await act(async () => latest.setSettings({ savedUsername: 'second' }))
    await tick()
    expect(mocks.save).toHaveBeenCalledTimes(1)
    await act(async () => finishFirst({ meta: { updatedAt: 'revision-first' } }))
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1]?.[1]).toEqual({ ifUnmodifiedSince: 'revision-first' })
  })

  it('ignores a pending save completed after switching accounts', async () => {
    await render()
    let finishOld!: (value: { meta: { updatedAt: string } }) => void
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    await act(async () => latest.setSettings({ savedUsername: 'alice edit' }))
    await tick()
    mocks.username = 'bob'
    mocks.load.mockResolvedValue(loaded('bob', 'bob-revision'))
    await render()
    await act(async () => finishOld({ meta: { updatedAt: 'stale-alice-revision' } }))
    await act(async () => latest.setSettings({ savedUsername: 'bob edit' }))
    await tick()
    expect(latest.data.cards[0]?.name).toBe('bob')
    expect(mocks.save.mock.calls.at(-1)?.[1]).toEqual({ ifUnmodifiedSince: 'bob-revision' })
  })
})
