import type { AdminEvent, AdminUserSummary } from '../../../lib/adminEventTypes'

export type EventsResponse = {
  events: AdminEvent[]
  total: number
  storageConfigured: boolean
}
export type UsersResponse = {
  users: AdminUserSummary[]
  storageConfigured: boolean
}
export type OwnershipSnapshotSummary = {
  realUsername: string
  importedAt: string
  updatedAt: string
  passCount: number
  legendaryPlusCount: number
  raxRowCount: number
}
export type OwnershipSnapshotsResponse = {
  snapshots: OwnershipSnapshotSummary[]
  storageConfigured: boolean
}

export type OwnershipLookupResponse = {
  ownership: {
    realUsername: string
    importedAt: string
    updatedAt: string
    passes: Array<{ rarityLabel?: string; earnings?: Array<{ claimDay: string; baseRaxEarned: number }> }>
  } | null
  storageConfigured: boolean
}

export type CatalogImportResponse = {
  ok: boolean
  mode: 'manual-upsert'
  passesUpserted?: number
  rowsUpserted?: number
  skippedRows?: number
  error?: string
}

export type TrackerProfileLookupResponse = {
  profile: {
    username: string
    updatedAt: string
    cardCount: number
    performanceCount: number
  } | null
  storageConfigured: boolean
  error?: string
}

export type ShopCrawlLogEvent = {
  type: string
  message: string
}

export type ShopCrawlLogLine = {
  id: number
  type: string
  message: string
}

export type ShopEarningsCrawlResponse = {
  ok: boolean
  upserted: number
  pagesFetched: number
  earningsFetched: number
  earningsFailed: number
  dailyRowsUpserted: number
  nextBefore: number
  done: boolean
  jobsTotal: number
  maxPages?: number
  delayMs?: number
  earningsConcurrency?: number
  cursor: {
    jobIndex: number
    before: number
    sport: string
    season: number
    entityType: 'player' | 'team'
  }
  skipped?: Array<{ sport: string; season: number; entityType: string; reason: string }>
  failures?: string[]
  log?: ShopCrawlLogEvent[]
  error?: string
}

export const LIVE_SHOP_CRAWL_SPORTS = [
  { label: 'NBA', value: 'nba' },
  { label: 'WNBA', value: 'wnba' },
  { label: 'NFL', value: 'nfl' },
  { label: 'CFB', value: 'ncaaf' },
  { label: 'MLB', value: 'mlb' },
  { label: 'NHL', value: 'nhl' },
  { label: 'CBB', value: 'ncaam' },
  { label: 'Golf', value: 'golf' },
  { label: 'FC', value: 'soccer' },
] as const

export const CURRENT_SPLIT_SEASON_YEAR = '2026'
export const CURRENT_SPLIT_SEASON_SPORTS = ['nfl', 'ncaaf', 'soccer'] as const

export const EVENT_TYPE_LABELS: Record<AdminEvent['type'], string> = {
  import_complete: 'Import complete',
  pass_no_earnings: 'No earnings',
  pass_fetch_error: 'Fetch error',
}
