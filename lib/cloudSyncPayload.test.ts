import { describe, expect, it } from 'vitest'
import {
  compactTrackerProfileForCloudSync,
  trackerProfileJsonByteLength,
} from './cloudSyncPayload'

describe('compactTrackerProfileForCloudSync', () => {
  it('removes cached player earnings', () => {
    const compacted = compactTrackerProfileForCloudSync({
      cards: [],
      performances: [],
      cachedPlayerEarnings: [{ cacheKey: 'x', rows: [{ claimDay: '2024-01-01', raxEarned: 1, note: '' }] }],
    }) as Record<string, unknown>

    expect(compacted.cachedPlayerEarnings).toBeUndefined()
  })

  it('strips rawJson when structured rows exist', () => {
    const compacted = compactTrackerProfileForCloudSync({
      cards: [],
      performances: [],
      savedCardProfiles: [
        {
          id: '1',
          rawJson: '{"rows":[{"day":"2024-01-01","earnings":100}]}',
          rows: [{ claimDay: '2024-01-01', raxEarned: 100, note: '' }],
        },
      ],
      potentialCards: [
        {
          id: '2',
          rawJson: '{"rows":[{"day":"2024-01-02","earnings":50}]}',
          rows: [{ claimDay: '2024-01-02', raxEarned: 50, note: '' }],
        },
      ],
    }) as {
      savedCardProfiles: Array<{ rawJson: string }>
      potentialCards: Array<{ rawJson: string }>
    }

    expect(compacted.savedCardProfiles[0]?.rawJson).toBe('')
    expect(compacted.potentialCards[0]?.rawJson).toBe('')
  })

  it('reduces serialized size for cache-heavy payloads', () => {
    const heavy = {
      cards: [],
      performances: [],
      cachedPlayerEarnings: Array.from({ length: 40 }, (_, index) => ({
        cacheKey: `player|NBA|2024|${index}`,
        entityId: index,
        sport: 'NBA',
        season: '2024',
        seasonYear: 2024,
        passKind: 'player',
        name: `Player ${index}`,
        externalKey: `ext-${index}`,
        source: 'username_import',
        updatedAt: '2024-01-01T00:00:00.000Z',
        rows: Array.from({ length: 120 }, (_, rowIndex) => ({
          claimDay: `2024-${String((rowIndex % 12) + 1).padStart(2, '0')}-01`,
          raxEarned: rowIndex + 1,
          baseRaxEarned: rowIndex + 1,
          note: '',
        })),
      })),
      savedCardProfiles: [
        {
          id: '1',
          rawJson: JSON.stringify({ rows: Array.from({ length: 120 }, (_, i) => ({ day: `2024-01-${i + 1}`, earnings: i })) }),
          rows: [{ claimDay: '2024-01-01', raxEarned: 1, note: '' }],
        },
      ],
    }

    const before = trackerProfileJsonByteLength(heavy)
    const after = trackerProfileJsonByteLength(compactTrackerProfileForCloudSync(heavy))
    expect(after).toBeLessThan(before / 2)
  })
})
