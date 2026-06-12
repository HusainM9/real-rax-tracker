import { filterDailyRowsToPassSeason } from '../../lib/seasonClaimWindow'
import type { CatalogImportProfile } from './catalogApi'

export type CatalogProfileRowsInput = Pick<
  CatalogImportProfile,
  'rows' | 'seasonYear' | 'seasonLabel' | 'sport'
>

export function filteredCatalogProfileRows(profile: CatalogProfileRowsInput) {
  return filterDailyRowsToPassSeason(
    profile.rows,
    profile.seasonYear,
    profile.sport,
    profile.seasonLabel,
  )
}

export function catalogProfileToJson(profile: Pick<CatalogImportProfile, 'rows'>): string {
  return JSON.stringify(
    {
      rows: profile.rows.map((row) => ({
        day: row.claimDay,
        earnings: row.baseRaxEarned,
        ...(row.playerBoxScoreId ? { player_box_score_id: row.playerBoxScoreId } : {}),
      })),
    },
    null,
    2,
  )
}

export function catalogProfileToFilteredJson(profile: CatalogProfileRowsInput): string {
  return catalogProfileToJson({ rows: filteredCatalogProfileRows(profile) })
}
