import { describe, expect, it } from 'vitest'
import { normalizeData, createEmptyData } from './storage'
import { estimatePackProgress } from './packTracker'
import { packDay, observePackRating, openingStatus, safeAccountAvatarUrl } from './dailyPacks'

const reading = (rating: number, fetchedAt = '2026-10-30T15:00:00Z', username = 'main') => ({
  rating, fetchedAt, startedAt: fetchedAt, username,
})

describe('pack opening evidence without extra requests', () => {
  it('uses 7am New York time across daylight saving transitions', () => {
    expect(packDay(new Date('2026-10-30T10:59:59Z'))).toBe('2026-10-29')
    expect(packDay(new Date('2026-10-30T11:00:00Z'))).toBe('2026-10-30')
    expect(packDay(new Date('2026-11-01T11:59:59Z'))).toBe('2026-10-31')
    expect(packDay(new Date('2026-11-01T12:00:00Z'))).toBe('2026-11-01')
    expect(packDay(new Date('2027-03-14T11:00:00Z'))).toBe('2027-03-14')
  })

  it('requires distinct scans, keeps accounts separate and latches positive evidence for the day', () => {
    const first = observePackRating(undefined, reading(100))!
    expect(openingStatus(first, 'main', new Date(first.lastCheckedAt))).toBe('unknown')
    expect(observePackRating(first, reading(100))).toBe(first)
    const equal = observePackRating(first, reading(100, '2026-10-30T16:00:00Z'))!
    expect(openingStatus(equal, 'main', new Date(equal.lastCheckedAt))).toBe('not-detected')
    const gained = observePackRating(equal, reading(110, '2026-10-30T17:00:00Z'))!
    const lower = observePackRating(gained, reading(90, '2026-10-30T18:00:00Z'))!
    expect(openingStatus(lower, 'main', new Date(lower.lastCheckedAt))).toBe('likely-opened')
    expect(openingStatus(lower, 'alt', new Date(lower.lastCheckedAt))).toBe('unknown')
    expect(openingStatus(lower, 'main', new Date('2026-10-31T11:00:00Z'))).toBe('unknown')
    const renamed = observePackRating(lower, reading(200, '2026-10-30T19:00:00Z', 'alt'))!
    expect(renamed.comparisons).toBe(0)
    expect(renamed.likelyOpenedAt).toBeUndefined()
  })

  it('ignores invalid/out-of-order readings and treats a reset-spanning scan only as a baseline', () => {
    const first = observePackRating(undefined, reading(100))!
    expect(observePackRating(first, reading(110, '2026-10-30T14:00:00Z'))).toBe(first)
    expect(observePackRating(first, reading(Number.NaN))).toBe(first)
    const span = observePackRating(first, { ...reading(120, '2026-10-31T11:00:02Z'), startedAt: '2026-10-31T10:59:59Z' })!
    expect(span.comparisons).toBe(0)
    expect(openingStatus(span, 'main', new Date(span.lastCheckedAt))).toBe('unknown')
  })

  it('persists optional targets and evidence while tolerating old or malformed data', () => {
    const observation = observePackRating(undefined, reading(100))!
    const tracker = { id: 't', plannedPassId: 'p', ratingTarget: 380, accounts: [{ id: 'a', name: 'Main', username: 'main', rating: 100, opensPacks: true, packObservation: observation, realProfile: { username: 'main', avatarUrl: 'https://media.realapp.com/example.webp' } }] }
    const hydrated = normalizeData({ ...createEmptyData(), packTrackers: [tracker] }).packTrackers![0]!
    expect(hydrated).toMatchObject(tracker)
    expect(estimatePackProgress(hydrated).remaining).toBe(280)
    const legacy = normalizeData({ ...createEmptyData(), packTrackers: [{ ...tracker, ratingTarget: -1, accounts: [{ ...tracker.accounts[0], packObservation: { day: 'wrong' }, realProfile: { username: 'main', avatarUrl: 'https://evil.test/a' } }] }] }).packTrackers![0]!
    expect(estimatePackProgress(legacy).remaining).toBe(3280)
    expect(legacy.accounts[0]!.packObservation).toBeUndefined()
    expect(legacy.accounts[0]!.realProfile?.avatarUrl).toBeUndefined()
    expect(estimatePackProgress({ ...hydrated, ratingTarget: 1380 }).remaining).toBe(1280)
    expect(estimatePackProgress({ ...hydrated, ratingTarget: 380, accounts: [{ ...hydrated.accounts[0]!, rating: 400 }] }).atTarget).toBe(true)
  })

  it('accepts supplied media URLs without inventing paths or accepting foreign URLs', () => {
    expect(safeAccountAvatarUrl('https://media.realapp.com/example.webp')).toBe('https://media.realapp.com/example.webp')
    for (const value of ['a925f5f3', 'http://media.realapp.com/a', 'https://evil.test/a', 'https://media.realapp.com.evil.test/a', 'https://user:secret@media.realapp.com/a']) expect(safeAccountAvatarUrl(value)).toBeUndefined()
  })
})
