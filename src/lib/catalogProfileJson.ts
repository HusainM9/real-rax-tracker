import type { CatalogImportProfile } from './catalogApi'

export function catalogProfileToJson(
  profile: Pick<CatalogImportProfile, 'rows'>,
): string {
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
