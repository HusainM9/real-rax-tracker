export type ImportOwnershipEarningRow = {
  claimDay: string
  baseRaxEarned: number
  playerBoxScoreId?: number | null
}

export type ImportOwnershipPass = {
  name: string
  sport: string
  season: string
  seasonYear: number
  entityId: number
  rarityLabel?: string
  externalKey: string
  passKind: 'player' | 'team'
  earnings?: ImportOwnershipEarningRow[]
}

export type ImportOwnershipSnapshot = {
  realUsername: string
  clientId: string
  importedAt: string
  passes: ImportOwnershipPass[]
  /** Meowbot rarity map — keeps admin cache import aligned with live username import. */
  rarities?: Record<string, string[]>
}

export type StoredImportOwnershipSnapshot = ImportOwnershipSnapshot & {
  updatedAt: string
}

const MAX_PASSES = 2500
const MAX_EARNINGS_PER_PASS = 400
const MAX_TOTAL_EARNINGS = 50000

const SPORTS = new Set([
  'NBA',
  'WNBA',
  'NFL',
  'CFB',
  'MLB',
  'NHL',
  'CBB',
  'Golf',
  'FC',
  'UFC',
  'Other',
])

export function normalizeRealUsername(value: string): string {
  return value.replace(/^@/, '').trim().toLowerCase()
}

export function validateImportOwnershipSnapshot(input: unknown): ImportOwnershipSnapshot | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const realUsername =
    typeof record.realUsername === 'string' ? normalizeRealUsername(record.realUsername) : ''
  const clientId = typeof record.clientId === 'string' ? record.clientId.trim() : ''
  const importedAt = typeof record.importedAt === 'string' ? record.importedAt : ''
  const rawPasses = Array.isArray(record.passes) ? record.passes.slice(0, MAX_PASSES) : []

  if (!realUsername || !clientId || rawPasses.length === 0) return null

  const passes = rawPasses
    .map(validateImportOwnershipPass)
    .filter((pass): pass is ImportOwnershipPass => pass !== null)

  if (passes.length === 0) return null

  const rarities = validateImportOwnershipRarities(record.rarities)

  return {
    realUsername,
    clientId,
    importedAt,
    passes,
    ...(rarities ? { rarities } : {}),
  }
}

function validateImportOwnershipRarities(input: unknown): Record<string, string[]> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  const rarities: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(record).slice(0, 5000)) {
    if (!Array.isArray(value)) continue
    const labels = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean)
    if (labels.length > 0) {
      rarities[key.trim().slice(0, 120)] = labels
    }
  }
  return Object.keys(rarities).length > 0 ? rarities : undefined
}

function validateImportOwnershipPass(input: unknown): ImportOwnershipPass | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.trim().slice(0, 200) : ''
  const sport = typeof record.sport === 'string' && SPORTS.has(record.sport) ? record.sport : ''
  const season = typeof record.season === 'string' ? record.season.trim().slice(0, 120) : ''
  const seasonYear = Number(record.seasonYear)
  const entityId = Number(record.entityId)
  const externalKey =
    typeof record.externalKey === 'string' ? record.externalKey.trim().slice(0, 120) : ''
  const passKind = record.passKind === 'team' ? 'team' : record.passKind === 'player' ? 'player' : null

  if (!name || !sport || !Number.isFinite(seasonYear) || !Number.isFinite(entityId) || !externalKey || !passKind) {
    return null
  }

  return {
    name,
    sport,
    season,
    seasonYear,
    entityId,
    rarityLabel:
      typeof record.rarityLabel === 'string' ? record.rarityLabel.trim().slice(0, 80) : undefined,
    externalKey,
    passKind,
    earnings: validateImportOwnershipEarnings(record.earnings),
  }
}

function validateImportOwnershipEarnings(input: unknown): ImportOwnershipEarningRow[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined

  const rows: ImportOwnershipEarningRow[] = []
  for (const item of input.slice(0, MAX_EARNINGS_PER_PASS)) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const claimDay =
      typeof record.claimDay === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(record.claimDay)?.[1] ?? '' : ''
    const baseRaxEarned = Number(record.baseRaxEarned)
    if (!claimDay || !Number.isFinite(baseRaxEarned) || baseRaxEarned <= 0) continue
    rows.push({
      claimDay,
      baseRaxEarned,
      playerBoxScoreId:
        record.playerBoxScoreId === null || record.playerBoxScoreId === undefined
          ? undefined
          : Number.isFinite(Number(record.playerBoxScoreId))
            ? Number(record.playerBoxScoreId)
            : undefined,
    })
  }

  return rows.length > 0 ? rows : undefined
}

export function trimOwnershipSnapshotEarnings(snapshot: ImportOwnershipSnapshot): ImportOwnershipSnapshot {
  let totalRows = 0
  const passes = snapshot.passes.map((pass) => {
    if (!pass.earnings || pass.earnings.length === 0) return pass
    const remaining = MAX_TOTAL_EARNINGS - totalRows
    if (remaining <= 0) return { ...pass, earnings: undefined }
    const earnings = pass.earnings.slice(0, Math.min(MAX_EARNINGS_PER_PASS, remaining))
    totalRows += earnings.length
    return { ...pass, earnings }
  })
  return { ...snapshot, passes }
}
