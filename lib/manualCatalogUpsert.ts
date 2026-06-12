import { normalizeRealAppToolsPaste, parseRealAppToolsBaseRows } from './realAppToolsPaste'
import { filterDailyRowsToPassSeason } from './seasonClaimWindow'
import type {
  CatalogDailyEarningInput,
  CatalogPassInput,
  CatalogPassKind,
} from './meowbotCatalogStore'

export type ManualCatalogUpsertInput = {
  entityId: number
  seasonYear: number
  sport: string
  passKind: CatalogPassKind
  name: string
  rarityLabel?: string
  seasonLabel?: string
  externalKey?: string
  rawJson: string
}

export type ManualCatalogUpsertPayload = {
  pass: CatalogPassInput
  dailyEarnings: CatalogDailyEarningInput[]
  skipped: number
}

export function buildCatalogExternalKey(
  entityId: number,
  seasonYear: number,
  sport: string,
): string {
  return `${entityId}|${seasonYear}|${sport.trim()}`
}

function getRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (typeof input !== 'object' || input === null) return []

  const record = input as { rows?: unknown; earnings?: unknown }
  if (Array.isArray(record.rows)) return record.rows
  if (Array.isArray(record.earnings)) return record.earnings

  return []
}

function claimDayValue(day: unknown): string {
  return typeof day === 'string' ? (/^(\d{4}-\d{2}-\d{2})/.exec(day)?.[1] ?? '') : ''
}

function boxScoresByClaimDay(rawJson: string): Map<string, number | null> {
  const map = new Map<string, number | null>()
  try {
    const parsed = JSON.parse(normalizeRealAppToolsPaste(rawJson)) as unknown
    for (const item of getRows(parsed)) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as {
        day?: unknown
        player_box_score_id?: unknown
        playerBoxScoreIds?: unknown
      }
      const claimDay = claimDayValue(row.day)
      if (!claimDay) continue
      if (row.player_box_score_id !== undefined && row.player_box_score_id !== null) {
        const id = Number(row.player_box_score_id)
        map.set(claimDay, Number.isFinite(id) ? id : null)
        continue
      }
      if (Array.isArray(row.playerBoxScoreIds) && row.playerBoxScoreIds.length > 0) {
        const id = Number(row.playerBoxScoreIds[0])
        map.set(claimDay, Number.isFinite(id) ? id : null)
      }
    }
  } catch {
    return map
  }
  return map
}

export function manualCatalogUpsertPayload(
  input: ManualCatalogUpsertInput,
): ManualCatalogUpsertPayload {
  const sport = input.sport.trim()
  const name = input.name.trim()
  if (!sport) throw new Error('Sport is required.')
  if (!name) throw new Error('Name is required.')
  if (!input.rawJson.trim()) throw new Error('Paste realapp.com JSON with daily earnings.')

  const externalKey =
    input.externalKey?.trim() || buildCatalogExternalKey(input.entityId, input.seasonYear, sport)

  const parsed = parseRealAppToolsBaseRows(input.rawJson)

  if (parsed.rows.length === 0) {
    throw new Error('No valid daily earnings rows were found in the JSON paste.')
  }

  const boxScores = boxScoresByClaimDay(input.rawJson)
  const dailyEarnings = filterDailyRowsToPassSeason(
    parsed.rows.map((row) => ({
      externalKey,
      claimDay: row.claimDay,
      baseRaxEarned: row.baseRaxEarned,
      playerBoxScoreId: boxScores.get(row.claimDay) ?? null,
    })),
    input.seasonYear,
    sport,
    input.seasonLabel,
  )

  if (dailyEarnings.length === 0) {
    throw new Error('No daily earnings rows fall within this pass season window.')
  }

  const totalBaseRax = dailyEarnings.reduce((sum, row) => sum + row.baseRaxEarned, 0)
  const pass: CatalogPassInput = {
    externalKey,
    entityId: input.entityId,
    passKind: input.passKind,
    sport,
    seasonYear: input.seasonYear,
    seasonLabel: input.seasonLabel?.trim() || String(input.seasonYear),
    name,
    rarityLabel: input.rarityLabel?.trim() || undefined,
    hasEarnings: true,
    totalBaseRax,
    sourceUpdatedAt: new Date().toISOString(),
  }

  return { pass, dailyEarnings, skipped: parsed.skipped }
}
