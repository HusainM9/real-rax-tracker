import { describe, expect, it } from 'vitest'
import { rankAndRecommendAsync, recommendationCapsForSports } from './passRecommendation'
import { rankAndRecommendReference } from '../testing/rankingReference'
import { createEmptyData } from './storage'
import type { CatalogImportProfile } from './catalogApi'
import type { Sport } from '../types/rax'

const sports: Sport[] = ['NBA', 'NHL', 'NFL', 'UFC']
const profiles = sports.flatMap((sport, sportIndex) => Array.from({ length: 24 }, (_, index): CatalogImportProfile => ({
  externalKey: `${sportIndex * 1000 + index + 1}|2025|${sport}`,
  entityId: sportIndex * 1000 + index + 1, sport, passKind: sport === 'UFC' ? 'team' : 'player',
  seasonYear: 2025, seasonLabel: '2025-26', name: `${sport} Player ${String(index).padStart(2, '0')}`,
  rowCount: 3, totalBaseRax: index + 3, cachedAt: '2026-10-30T00:00:00Z', rows: [
    { claimDay: '2025-01-01', baseRaxEarned: index + 1 },
    { claimDay: `2025-02-${String(index + 1).padStart(2, '0')}`, baseRaxEarned: 1 },
    { claimDay: `2024-02-${String(index + 1).padStart(2, '0')}`, baseRaxEarned: 1 },
  ],
})))
const cases = [[...sports], ['NBA'], ['NHL'], ['NFL'], ['NBA', 'NHL'], ['NBA', 'NFL'], ['NBA', 'NHL', 'NFL']] as Sport[][]

describe('ranking and greedy bundle full-engine parity', () => {
  for (const selected of cases) {
    it.each([1, 3, 5, 10, 20])(`${selected.join('+')}: %i requested picks preserve rankings and greedy order`, async (size) => {
      const data = createEmptyData()
      const pool = profiles.filter((profile) => selected.includes(profile.sport as Sport))
      const caps = recommendationCapsForSports(selected)
      const before = JSON.stringify(data)
      const expected = rankAndRecommendReference(data, pool, size, { analysisCap: caps.analysisCap })
      const actual = await rankAndRecommendAsync(data, pool, size, { caps })
      expect(actual).toEqual(expected)
      expect(actual.bundle.picks).toHaveLength(size)
      expect(JSON.stringify(data)).toBe(before)
    })
  }

  it('honors cancellation between ranking batches without returning partial recommendations', async () => {
    const controller = new AbortController()
    const pending = rankAndRecommendAsync(createEmptyData(), profiles, 20, {
      signal: controller.signal, batchSize: 1,
      onProgress: () => controller.abort(),
    })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does no ranking work for a signal cancelled before invocation', async () => {
    const controller = new AbortController()
    controller.abort()
    let reported = false
    await expect(rankAndRecommendAsync(createEmptyData(), profiles, 20, {
      signal: controller.signal, onProgress: () => { reported = true },
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(reported).toBe(false)
  })
})
