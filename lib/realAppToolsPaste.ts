export type RealAppToolsRow = {
  day?: unknown
  earnings?: unknown
  player_box_score_id?: unknown
  playerBoxScoreIds?: unknown
}

export type ParsedBaseEarningsRow = {
  claimDay: string
  baseRaxEarned: number
}

export type RealAppToolsBaseParseResult = {
  rows: ParsedBaseEarningsRow[]
  skipped: number
}

export function getRealAppToolsRows(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (typeof input !== 'object' || input === null) return []

  const record = input as { rows?: unknown; earnings?: unknown }
  if (Array.isArray(record.rows)) return record.rows
  if (Array.isArray(record.earnings)) return record.earnings

  return []
}

function parseClaimDay(day: string): string | null {
  return /^(\d{4}-\d{2}-\d{2})/.exec(day)?.[1] ?? null
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  return fence ? fence[1]!.trim() : trimmed
}

function extractJsonSlice(text: string): string {
  const startObj = text.indexOf('{')
  const startArr = text.indexOf('[')
  let start = -1
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj
  else if (startArr >= 0) start = startArr
  if (start < 0) return text

  const open = text[start]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return text.slice(start)
}

function repairRowsOrEarningsFragment(text: string): string | null {
  const match = text.match(/^(?:"?)(rows|earnings)"?\s*:\s*([\s\S]+)$/i)
  if (!match) return null

  const key = match[1]!.toLowerCase()
  let value = match[2]!.trim().replace(/,\s*$/, '')

  if (value.endsWith('}') && value.startsWith('[')) {
    value = value.replace(/\}\s*$/, '')
  }

  return `{"${key}": ${value}}`
}

export function normalizeRealAppToolsPaste(raw: string): string {
  let text = stripCodeFences(stripBom(raw.trim()))

  if (text.startsWith('{') || text.startsWith('[')) {
    return text
  }

  const repaired = repairRowsOrEarningsFragment(text)
  if (repaired) return repaired

  if (text.includes('{') || text.includes('[')) {
    text = extractJsonSlice(text)
    if (text.startsWith('{') || text.startsWith('[')) return text
    const repairedSlice = repairRowsOrEarningsFragment(text)
    if (repairedSlice) return repairedSlice
  }

  return text
}

export function parseRealAppToolsJson(text: string): unknown {
  const normalized = normalizeRealAppToolsPaste(text)
  const candidates = [normalized]
  const trimmed = normalized.trim()

  if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
    candidates.push(`${trimmed}}`, `${trimmed}]}`, `${trimmed}}}`)
  }

  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

function parseBaseDailyRow(row: RealAppToolsRow): ParsedBaseEarningsRow | null {
  const day = typeof row.day === 'string' ? row.day : ''
  const baseEarnings = Number(row.earnings)
  const claimDay = parseClaimDay(day)

  if (!claimDay || !Number.isFinite(baseEarnings) || baseEarnings <= 0) {
    return null
  }

  return { claimDay, baseRaxEarned: baseEarnings }
}

export function parseRealAppToolsBaseRows(rawJson: string): RealAppToolsBaseParseResult {
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

  const rows: ParsedBaseEarningsRow[] = []
  let skipped = 0
  for (const item of inputRows) {
    const row = parseBaseDailyRow(item)
    if (!row) {
      skipped += 1
      continue
    }
    rows.push(row)
  }

  return { rows, skipped }
}
