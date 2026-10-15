import { fetchCatalogPassSummaries } from './catalogApi'
import {
  DEFAULT_RANK_EXCLUDED_SPORT_SEASONS,
  sportSeasonFilterKey,
} from './passRecommendation'
import type { Sport } from '../types/rax'

const SPORT_SUMMARY_FETCH_CONCURRENCY = 4

export async function loadSportCatalogSummaries(
  sports: Sport[],
  summaryLimitForSport: (sport: Sport) => number,
  signal: AbortSignal,
  onSportStart?: (sport: Sport, index: number, total: number) => void,
  seasonYearForSport?: (sport: Sport) => number | undefined,
): Promise<{
  bySport: Map<Sport, Awaited<ReturnType<typeof fetchCatalogPassSummaries>>['results']>
  storageConfigured: boolean
}> {
  const bySport = new Map<Sport, Awaited<ReturnType<typeof fetchCatalogPassSummaries>>['results']>()
  let storageConfigured = true

  for (let waveStart = 0; waveStart < sports.length; waveStart += SPORT_SUMMARY_FETCH_CONCURRENCY) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const wave = sports.slice(waveStart, waveStart + SPORT_SUMMARY_FETCH_CONCURRENCY)
    const waveResults = await Promise.all(
      wave.map(async (sport, offset) => {
        const sportIndex = waveStart + offset
        onSportStart?.(sport, sportIndex, sports.length)
        const result = await fetchCatalogPassSummaries(
          {
            sport,
            seasonYear: seasonYearForSport?.(sport),
            limit: summaryLimitForSport(sport),
          },
          signal,
        )
        return { sport, result }
      }),
    )

    for (const { sport, result } of waveResults) {
      if (!result.storageConfigured) {
        storageConfigured = false
      }
      bySport.set(sport, result.results)
    }
  }

  return { bySport, storageConfigured }
}
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}
export function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize))
}
export type CatalogSportSeasonOption = {
  sport: Sport
  seasonYear: number
  seasonLabel: string
}

export type ExcludedSportSeason = {
  key: string
  sport: Sport
  seasonLabel: string
}

export function formatExcludedSportSeason(entry: ExcludedSportSeason): string {
  return `${entry.sport} · ${entry.seasonLabel}`
}

export function createDefaultExcludedSportSeasons(): ExcludedSportSeason[] {
  return DEFAULT_RANK_EXCLUDED_SPORT_SEASONS.map((entry) => ({
    key: sportSeasonFilterKey(entry.sport, entry.seasonLabel),
    sport: entry.sport,
    seasonLabel: entry.seasonLabel,
  }))
}
