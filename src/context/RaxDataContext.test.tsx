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
