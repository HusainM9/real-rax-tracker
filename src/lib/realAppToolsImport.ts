import { computeOtdRax, type OtdPassKind } from './otdRax'

export type ParsedRealAppToolsRow = {
  claimDay: string
  raxEarned: number
  baseRaxEarned?: number
  note: string
}

type RealAppToolsRow = {
  day?: unknown
  earnings?: unknown
  player_box_score_id?: unknown
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

function getRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (
    typeof input === 'object' &&
    input !== null &&
    Array.isArray((input as { rows?: unknown }).rows)
  ) {
    return (input as { rows: unknown[] }).rows
  }
  return []
}

function parseClaimDay(day: string): string | null {
  return /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)?.[0] ?? null
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

  const boxScoreId =
    row.player_box_score_id === undefined || row.player_box_score_id === null
      ? ''
      : String(row.player_box_score_id)

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
    note: `realapp.tools source ${claimDay}${
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

export function parseRealAppToolsRows(rawJson: string): RealAppToolsParseResult {
  const parsed = JSON.parse(rawJson) as unknown
  const inputRows = getRows(parsed)
  if (inputRows.length === 0) {
    throw new Error('Paste either a JSON array of rows or an object with a rows array.')
  }

  return parseDailyRows(inputRows as RealAppToolsRow[])
}

export function parseRealAppToolsDailyRows(
  inputRows: RealAppToolsRow[],
  options: DailyRowImportOptions = {},
): RealAppToolsParseResult {
  return parseDailyRows(inputRows, options)
}
