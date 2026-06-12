import type {
  CatalogDailyEarningInput,
  CatalogPassInput,
  CatalogPassKind,
} from './meowbotCatalogStore'
import { claimDayInPassSeason } from './seasonClaimWindow'

export type NormalizedMeowbotCatalog = {
  passes: CatalogPassInput[]
  dailyEarnings: CatalogDailyEarningInput[]
  skipped: number
}

const SPORT_MAP: Record<string, string> = {
  nba: 'NBA',
  wnba: 'WNBA',
  nfl: 'NFL',
  ncaaf: 'CFB',
  cfb: 'CFB',
  mlb: 'MLB',
  nhl: 'NHL',
  ncaam: 'CBB',
  cbb: 'CBB',
  golf: 'Golf',
  fc: 'FC',
  soccer: 'FC',
  ufc: 'UFC',
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

function passKindValue(input: unknown): CatalogPassKind {
  return stringValue(input).toLowerCase() === 'team' ? 'team' : 'player'
}

function sportValue(input: unknown): string {
  const raw = stringValue(input)
  if (!raw) return 'Other'
  return SPORT_MAP[raw.toLowerCase()] ?? raw.toUpperCase()
}

function seasonLabelFromYear(seasonYear: number, sport: string): string {
  if (['MLB', 'WNBA', 'Golf', 'UFC'].includes(sport)) return String(seasonYear)
  return `${seasonYear - 1}-${String(seasonYear).slice(-2)}`
}

function claimDayValue(input: unknown): string {
  const value = stringValue(input)
  return /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] ?? ''
}

function rowsFrom(input: Record<string, unknown>): unknown[] {
  for (const key of ['rows', 'dailyEarnings', 'daily_earnings', 'earnings']) {
    const value = input[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function buildExternalKey(entityId: number, seasonYear: number, sport: string): string {
  return `${entityId}|${seasonYear}|${sport}`
}

function parsePass(input: unknown): CatalogPassInput | null {
  const item = record(input)
  if (!item) return null

  const entityId = numberValue(item.entityId ?? item.entity_id ?? item.playerId ?? item.teamId)
  const seasonYear = numberValue(item.seasonYear ?? item.season_year ?? item.season)
  const sport = sportValue(item.sport ?? item.sportRaw ?? item.sport_raw)
  const name =
    stringValue(item.name) ||
    stringValue(item.playerName ?? item.player_name) ||
    stringValue(item.teamName ?? item.team_name)

  if (!entityId || !seasonYear || !name) return null

  return {
    externalKey: stringValue(item.externalKey ?? item.external_key) || buildExternalKey(entityId, seasonYear, sport),
    entityId,
    passKind: passKindValue(item.passKind ?? item.pass_kind ?? item.kind),
    sport,
    seasonYear,
    seasonLabel:
      stringValue(item.seasonLabel ?? item.season_label) || seasonLabelFromYear(seasonYear, sport),
    name,
    rarityLabel: stringValue(item.rarityLabel ?? item.rarity_label) || undefined,
    sourceUpdatedAt: stringValue(item.sourceUpdatedAt ?? item.source_updated_at) || undefined,
  }
}

function parseDailyRow(input: unknown, externalKey?: string): CatalogDailyEarningInput | null {
  const item = record(input)
  if (!item) return null

  const resolvedExternalKey = stringValue(item.externalKey ?? item.external_key) || externalKey || ''
  const claimDay = claimDayValue(item.claimDay ?? item.claim_day ?? item.day)
  const baseRaxEarned = numberValue(item.baseRaxEarned ?? item.base_rax_earned ?? item.earnings)
  if (!resolvedExternalKey || !claimDay || !baseRaxEarned || baseRaxEarned <= 0) return null

  return {
    externalKey: resolvedExternalKey,
    claimDay,
    baseRaxEarned,
    playerBoxScoreId: numberValue(item.playerBoxScoreId ?? item.player_box_score_id),
  }
}

function arrayFromPayload(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  const root = record(payload)
  if (!root) return []
  const items: unknown[] = []
  for (const key of keys) {
    const value = root[key]
    if (Array.isArray(value)) items.push(...value)
  }
  return items
}

export function normalizeGlobalMeowbotCatalog(payload: unknown): NormalizedMeowbotCatalog {
  const passesByKey = new Map<string, CatalogPassInput>()
  const dailyEarnings: CatalogDailyEarningInput[] = []
  let skipped = 0

  const passItems = arrayFromPayload(payload, ['passes', 'players', 'teams', 'data'])
  for (const item of passItems) {
    const pass = parsePass(item)
    if (!pass) {
      skipped += 1
      continue
    }

    passesByKey.set(pass.externalKey, pass)
    for (const row of rowsFrom(record(item) ?? {})) {
      const daily = parseDailyRow(row, pass.externalKey)
      if (!daily) {
        skipped += 1
        continue
      }
      if (!claimDayInPassSeason(daily.claimDay, pass.seasonYear, pass.sport, pass.seasonLabel)) {
        skipped += 1
        continue
      }
      dailyEarnings.push(daily)
    }
  }

  const topLevelRows = arrayFromPayload(payload, ['dailyEarnings', 'daily_earnings', 'rows', 'earnings'])
  for (const row of topLevelRows) {
    const daily = parseDailyRow(row)
    if (!daily) {
      skipped += 1
      continue
    }
    const pass = passesByKey.get(daily.externalKey)
    if (pass && !claimDayInPassSeason(daily.claimDay, pass.seasonYear, pass.sport, pass.seasonLabel)) {
      skipped += 1
      continue
    }
    dailyEarnings.push(daily)
  }

  return {
    passes: [...passesByKey.values()],
    dailyEarnings,
    skipped,
  }
}

export async function fetchGlobalMeowbotCatalog(url: string, token?: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: token?.trim() ? { Authorization: `Bearer ${token.trim()}` } : undefined,
  })
  if (!response.ok) {
    throw new Error(`Meowbot catalog fetch failed (${response.status}).`)
  }
  return response.json()
}

