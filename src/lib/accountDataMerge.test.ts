import { describe, expect, it } from 'vitest'
import { mergeAccountData } from './accountDataMerge'
import { createEmptyData } from './storage'

const base = () => ({ ...createEmptyData(), cards: [
  { id: 'one', name: 'One', sport: 'NHL' as const, season: '2026-27', notes: '', createdAt: '2026-11-05' },
  { id: 'two', name: 'Two', sport: 'NHL' as const, season: '2026-27', notes: '', createdAt: '2026-11-05' },
] })

describe('conservative account reconciliation', () => {
  it('combines independent fields and entries, preserving the local-only caches', () => {
    const original = base(), local = structuredClone(original), remote = structuredClone(original)
    local.settings.savedUsername = 'local'
    local.cards[0]!.notes = 'local note'
    remote.cards[1]!.notes = 'remote note'
    remote.cards.push({ ...remote.cards[0]!, id: 'three', name: 'Three' })
    const result = mergeAccountData(original, local, remote)
    expect(result.ok).toBe(true)
    if (!result.ok) throw Error('Expected independent changes to merge')
    expect(result.data.settings.savedUsername).toBe('local')
    expect(result.data.cards.map(card => [card.id, card.notes])).toEqual([['one', 'local note'], ['two', 'remote note'], ['three', '']])
    expect(result.data.cachedPlayerEarnings).toBe(local.cachedPlayerEarnings)
    expect(local.cards).toHaveLength(2)
    expect(remote.cards[0]!.notes).toBe('')
  })

  it('accepts unchanged, identical and non-overlapping deletes, without resurrecting removed entries', () => {
    const original = base(), local = structuredClone(original), remote = structuredClone(original)
    local.cards = local.cards.filter(card => card.id !== 'one')
    remote.cards[1]!.notes = 'remote edit'
    const result = mergeAccountData(original, local, remote)
    expect(result.ok && result.data.cards.map(card => card.id)).toEqual(['two'])
    expect(mergeAccountData(original, local, local).ok).toBe(true)
  })

  it('rejects same-field edits, delete-versus-edit, duplicate IDs and conflicting primitive arrays', () => {
    const original = base(), local = structuredClone(original), remote = structuredClone(original)
    local.cards[0]!.notes = 'local'; remote.cards[0]!.notes = 'remote'
    expect(mergeAccountData(original, local, remote).ok).toBe(false)
    local.cards.shift()
    expect(mergeAccountData(original, local, remote).ok).toBe(false)
    local.cards = [{ ...original.cards[0]!, notes: 'one' }, { ...original.cards[0]!, notes: 'duplicate' }]
    expect(mergeAccountData(original, local, remote).ok).toBe(false)
    local.cards = original.cards
    remote.cards = original.cards
    local.ignoredPassKeys = ['local']; remote.ignoredPassKeys = ['remote']
    expect(mergeAccountData(original, local, remote).ok).toBe(false)
  })

  it('merges distinct pack accounts while keeping the latest tracker timestamp', () => {
    const original = { ...base(), packTrackers: [{ id: 't', plannedPassId: 'p', accounts: [
      { id: 'a', name: 'A', username: 'a', rating: 0, opensPacks: true },
      { id: 'b', name: 'B', username: 'b', rating: 0, opensPacks: true },
    ], ratingPerPack: 10, createdAt: '2026-11-05', updatedAt: '2026-11-05T10:00:00Z' }] }
    const local = structuredClone(original), remote = structuredClone(original)
    local.packTrackers[0]!.accounts[0]!.rating = 100
    local.packTrackers[0]!.updatedAt = '2026-11-05T12:00:00Z'
    remote.packTrackers[0]!.accounts[1]!.rating = 200
    remote.packTrackers[0]!.updatedAt = '2026-11-05T11:00:00Z'
    const result = mergeAccountData(original, local, remote)
    expect(result.ok && result.data.packTrackers![0]!.accounts.map(account => account.rating)).toEqual([100, 200])
    expect(result.ok && result.data.packTrackers![0]!.updatedAt).toBe('2026-11-05T12:00:00Z')
    remote.packTrackers[0]!.accounts[0]!.rating = 300
    expect(mergeAccountData(original, local, remote).ok).toBe(false)
  })

  it('preserves one-sided reordering and refuses two conflicting reorderings', () => {
    const original = base()
    original.cards.push({ ...original.cards[0]!, id: 'three' })
    const local = structuredClone(original), remote = structuredClone(original)
    local.cards.reverse(); remote.cards[0]!.notes = 'remote'
    const result = mergeAccountData(original, local, remote)
    expect(result.ok && result.data.cards.map(card => card.id)).toEqual(['three', 'two', 'one'])
    remote.cards = [remote.cards[1]!, remote.cards[0]!, remote.cards[2]!]
    expect(mergeAccountData(original, local, remote).ok).toBe(false)
  })
})
