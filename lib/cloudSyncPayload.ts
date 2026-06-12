function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stripRawJsonWhenRowsPresent(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (!Array.isArray(value.rows) || value.rows.length === 0) return value
  return { ...value, rawJson: '' }
}

/** Drop bulky cache and duplicate JSON blobs before cloud sync. Rows remain the source of truth. */
export function compactTrackerProfileForCloudSync(data: unknown): unknown {
  if (!isRecord(data)) return data

  const compacted: Record<string, unknown> = { ...data }
  delete compacted.cachedPlayerEarnings
  delete compacted.savedSellRankings

  if (Array.isArray(data.potentialCards)) {
    compacted.potentialCards = data.potentialCards.map(stripRawJsonWhenRowsPresent)
  }
  if (Array.isArray(data.savedCardProfiles)) {
    compacted.savedCardProfiles = data.savedCardProfiles.map(stripRawJsonWhenRowsPresent)
  }

  return compacted
}

export function trackerProfileJsonByteLength(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data)).length
}
