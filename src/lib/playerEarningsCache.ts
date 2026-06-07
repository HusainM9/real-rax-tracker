import type {
  CachedPlayerEarningsProfile,
  RaxTrackerData,
  SavedCardEarningsRow,
  Sport,
} from '../types/rax'

export function playerEarningsCacheKey(input: {
  passKind: 'player' | 'team'
  sport: Sport
  seasonYear: number
  entityId: number
}): string {
  return `${input.passKind}|${input.sport}|${input.seasonYear}|${input.entityId}`
}

export function cachedEarningsToJson(profile: CachedPlayerEarningsProfile): string {
  return JSON.stringify(
    {
      rows: profile.rows.map((row) => ({
        day: row.claimDay,
        earnings: row.baseRaxEarned ?? row.raxEarned,
      })),
    },
    null,
    2,
  )
}

export function upsertCachedPlayerEarnings(
  current: RaxTrackerData,
  profiles: CachedPlayerEarningsProfile[],
): RaxTrackerData {
  if (profiles.length === 0) return current

  const byKey = new Map((current.cachedPlayerEarnings ?? []).map((profile) => [profile.cacheKey, profile]))
  for (const profile of profiles) {
    if (profile.rows.length === 0) continue
    const rows = mergeRows(byKey.get(profile.cacheKey)?.rows ?? [], profile.rows)
    byKey.set(profile.cacheKey, {
      ...byKey.get(profile.cacheKey),
      ...profile,
      rows,
    })
  }

  return {
    ...current,
    cachedPlayerEarnings: [...byKey.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.sport.localeCompare(b.sport),
    ),
  }
}

function mergeRows(
  existingRows: SavedCardEarningsRow[],
  incomingRows: SavedCardEarningsRow[],
): SavedCardEarningsRow[] {
  const rowsByDay = new Map(existingRows.map((row) => [row.claimDay, row]))
  for (const row of incomingRows) {
    rowsByDay.set(row.claimDay, row)
  }
  return [...rowsByDay.values()].sort((a, b) => b.claimDay.localeCompare(a.claimDay))
}
