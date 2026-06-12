import type {
  CatalogDailyEarningInput,
  CatalogPassInput,
} from './meowbotCatalogStore'
import { filterDailyRowsToPassSeason } from './seasonClaimWindow'

type CachedProfileInput = {
  entityId?: unknown
  sport?: unknown
  season?: unknown
  seasonYear?: unknown
  passKind?: unknown
  name?: unknown
  rarityLabel?: unknown
  externalKey?: unknown
  rows?: unknown
  updatedAt?: unknown
}

type CachedRowInput = {
  claimDay?: unknown
  raxEarned?: unknown
  baseRaxEarned?: unknown
}

export type CatalogProfilePayload = {
  passes: CatalogPassInput[]
  dailyEarnings: CatalogDailyEarningInput[]
  skipped: number
}

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : null
}

function stringValue(input: unknown): string {
  return typeof input === 'string' ? input.trim() : ''
}

function numberValue(input: unknown): number | null {
  const value = Number(input)
  return Number.isFinite(value) ? value : null
}

function claimDayValue(input: unknown): string {
  const value = stringValue(input)
  return /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? ''
}

function parseProfile(input: CachedProfileInput): CatalogPassInput | null {
  const entityId = numberValue(input.entityId)
  const seasonYear = numberValue(input.seasonYear)
  const externalKey = stringValue(input.externalKey)
  const name = stringValue(input.name)
  const sport = stringValue(input.sport)
  const passKind = input.passKind === 'team' ? 'team' : input.passKind === 'player' ? 'player' : null

  if (!entityId || !seasonYear || !externalKey || !name || !sport || !passKind) return null

  return {
    externalKey,
    entityId,
    passKind,
    sport,
    seasonYear,
    seasonLabel: stringValue(input.season) || String(seasonYear),
    name,
    rarityLabel: stringValue(input.rarityLabel) || undefined,
    sourceUpdatedAt: stringValue(input.updatedAt) || undefined,
  }
}

function parseRows(
  externalKey: string,
  rows: unknown,
  seasonYear: number,
  sport: string,
  seasonLabel?: string,
): CatalogDailyEarningInput[] {
  if (!Array.isArray(rows)) return []

  const parsed: CatalogDailyEarningInput[] = []
  for (const item of rows) {
    const row = record(item) as CachedRowInput | null
    if (!row) continue
    const claimDay = claimDayValue(row.claimDay)
    const baseRaxEarned = numberValue(row.baseRaxEarned ?? row.raxEarned)
    if (!claimDay || !baseRaxEarned || baseRaxEarned <= 0) continue
    parsed.push({ externalKey, claimDay, baseRaxEarned })
  }
  return filterDailyRowsToPassSeason(parsed, seasonYear, sport, seasonLabel)
}

export function cachedProfilesToCatalogPayload(input: unknown): CatalogProfilePayload {
  const profiles = Array.isArray(input) ? input : []
  const passes: CatalogPassInput[] = []
  const dailyEarnings: CatalogDailyEarningInput[] = []
  let skipped = 0

  for (const item of profiles) {
    const profile = record(item) as CachedProfileInput | null
    if (!profile) {
      skipped += 1
      continue
    }

    const pass = parseProfile(profile)
    if (!pass) {
      skipped += 1
      continue
    }

    const rows = parseRows(pass.externalKey, profile.rows, pass.seasonYear, pass.sport, pass.seasonLabel)
    if (rows.length === 0) {
      skipped += 1
      continue
    }

    passes.push({
      ...pass,
      totalBaseRax: rows.reduce((sum, row) => sum + row.baseRaxEarned, 0),
    })
    dailyEarnings.push(...rows)
  }

  return { passes, dailyEarnings, skipped }
}

