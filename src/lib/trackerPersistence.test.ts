import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyData } from './storage'
import { loadPersistedTrackerData, persistTrackerData, storageWarningMessage } from './trackerPersistence'

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

describe('account-scoped persistence', () => {
  it('isolates signed-in caches while preserving unassigned legacy data', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const legacy = { ...createEmptyData(), settings: { proBonusEnabled: true, savedUsername: 'legacy' } }
    await persistTrackerData(legacy)
    const alice = { ...legacy, settings: { ...legacy.settings, savedUsername: 'alice' } }
    await persistTrackerData(alice, { accountUsername: 'Alice' })
    expect((await loadPersistedTrackerData({ accountUsername: 'alice' })).data.settings.savedUsername).toBe('alice')
    expect((await loadPersistedTrackerData({ accountUsername: 'bob' })).data.cards).toEqual([])
    expect((await loadPersistedTrackerData({ accountUsername: 'bob' })).data.settings.savedUsername).toBe('')
    expect((await loadPersistedTrackerData()).data.settings.savedUsername).toBe('legacy')
  })
})

describe('trackerPersistence', () => {
  it('warns when neither storage backend saved', () => {
    const message = storageWarningMessage({
      ok: false,
      byteSize: 6_000_000,
      compacted: true,
      idbSaved: false,
      localSaved: false,
      reason: 'quota',
    })
    expect(message).toContain('storage is full')
    expect(message).toContain('account')
  })

  it('does not warn when IndexedDB save succeeds without localStorage', () => {
    expect(
      storageWarningMessage({
        ok: true,
        byteSize: 5_500_000,
        compacted: true,
        idbSaved: true,
        localSaved: false,
      }),
    ).toBe('')
  })

  it('returns empty message when IndexedDB save succeeds', () => {
    expect(
      storageWarningMessage({
        ok: true,
        byteSize: 1000,
        compacted: false,
        idbSaved: true,
        localSaved: true,
      }),
    ).toBe('')
  })
})

describe('createEmptyData', () => {
  it('starts empty', () => {
    expect(createEmptyData().cards).toHaveLength(0)
    expect(createEmptyData().ignoredPassKeys).toEqual([])
    expect(createEmptyData().packAccountTemplates).toEqual([])
    expect(createEmptyData().planSoldCardIds).toEqual([])
    expect(createEmptyData().sellExcludedPassKeys).toEqual([])
    expect(createEmptyData().sellExcludedCardIds).toEqual([])
  })
})
