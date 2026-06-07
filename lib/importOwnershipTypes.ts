export type ImportOwnershipPass = {
  name: string
  sport: string
  season: string
  seasonYear: number
  entityId: number
  rarityLabel?: string
  externalKey: string
  passKind: 'player' | 'team'
}

export type ImportOwnershipSnapshot = {
  realUsername: string
  clientId: string
  importedAt: string
  passes: ImportOwnershipPass[]
}

export type StoredImportOwnershipSnapshot = ImportOwnershipSnapshot & {
  updatedAt: string
}

const MAX_PASSES = 2500

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

  return {
    realUsername,
    clientId,
    importedAt,
    passes,
  }
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
  }
}
