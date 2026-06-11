import {
  getRealAppToolsRows,
  normalizeRealAppToolsPaste,
  parseRealAppToolsJson,
  type RealAppToolsRow,
} from '../../lib/realAppToolsPaste'
import { computeOtdRax, type OtdPassKind } from './otdRax'

export type ParsedRealAppToolsRow = {
  claimDay: string
  raxEarned: number
  baseRaxEarned?: number
  note: string
}

export type RealAppToolsParseResult = {
  rows: ParsedRealAppToolsRow[]
  skipped: number
}

export type DailyRowImportOptions = {
  sport?: string
  rarityLabel?: string
  applyOtdMultiplier?: boolean
  passKind?: OtdPassKind
}

export { normalizeRealAppToolsPaste }

function parseClaimDay(day: string): string | null {
  return /^(\d{4}-\d{2}-\d{2})/.exec(day)?.[1] ?? null
}

function boxScoreIdFromRow(row: RealAppToolsRow): string {
  if (row.player_box_score_id !== undefined && row.player_box_score_id !== null) {
    return String(row.player_box_score_id)
  }
  if (Array.isArray(row.playerBoxScoreIds) && row.playerBoxScoreIds.length > 0) {
    return String(row.playerBoxScoreIds[0])
  }
  return ''
}

function parseDailyRow(
  row: RealAppToolsRow,
  options: DailyRowImportOptions,
): ParsedRealAppToolsRow | null {
  const day = typeof row.day === 'string' ? row.day : ''
  const baseEarnings = Number(row.earnings)
  const claimDay = parseClaimDay(day)

  if (!claimDay || !Number.isFinite(baseEarnings) || baseEarnings <= 0) {
    return null
  }

  const boxScoreId = boxScoreIdFromRow(row)
  const sourceLabel = Array.isArray(row.playerBoxScoreIds) ? 'realapp.com' : 'realapp.tools'

  const raxEarned =
    options.applyOtdMultiplier && options.sport
      ? computeOtdRax(
          baseEarnings,
          options.sport,
          options.rarityLabel,
          options.passKind ?? 'player',
        )
      : baseEarnings

  if (raxEarned <= 0) return null

  return {
    claimDay,
    raxEarned,
    baseRaxEarned: baseEarnings,
    note: `${sourceLabel} source ${claimDay}${
      boxScoreId ? ` · box score ${boxScoreId}` : ''
    }${options.applyOtdMultiplier ? ' · OTD adjusted' : ''}`,
  }
}

function parseDailyRows(
  inputRows: RealAppToolsRow[],
  options: DailyRowImportOptions = {},
): RealAppToolsParseResult {
  const rows: ParsedRealAppToolsRow[] = []
  let skipped = 0

  for (const item of inputRows) {
    const parsed = parseDailyRow(item, options)
    if (!parsed) {
      skipped += 1
      continue
    }
    rows.push(parsed)
  }

  return { rows, skipped }
}

export function parseRealAppToolsRows(
  rawJson: string,
  options: DailyRowImportOptions = {},
): RealAppToolsParseResult {
  let parsed: unknown
  try {
    parsed = parseRealAppToolsJson(rawJson)
  } catch (error) {
    if (error instanceof SyntaxError) {
      const hint =
        /earnings|rows/i.test(rawJson) && !rawJson.trim().startsWith('{')
          ? ' Your paste looks like a partial copy — select the whole Response body starting with {.'
          : ''
      throw new Error(`Invalid JSON.${hint} (${error.message})`)
    }
    throw error
  }

  const inputRows = getRealAppToolsRows(parsed) as RealAppToolsRow[]
  if (inputRows.length === 0) {
    throw new Error(
      'Paste a JSON array, or an object with a rows or earnings array (realapp.tools or realapp.com).',
    )
  }

  return parseDailyRows(inputRows, options)
}

export function parseRealAppToolsDailyRows(
  inputRows: RealAppToolsRow[],
  options: DailyRowImportOptions = {},
): RealAppToolsParseResult {
  return parseDailyRows(inputRows, options)
}
