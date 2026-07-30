import { describe, expect, it } from 'vitest'
import { createEmptyData } from './storage'
import { storageWarningMessage } from './trackerPersistence'

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
