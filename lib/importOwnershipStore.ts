import { kv } from '@vercel/kv'
import {
  validateImportOwnershipSnapshot,
  type ImportOwnershipSnapshot,
  type StoredImportOwnershipSnapshot,
} from './importOwnershipTypes'
import { adminStorageConfigured } from './adminEventStore'
import { legendaryPlusRarityFilter, passMatchesRarityFilter } from './rarityFilter'

const OWNERSHIP_PREFIX = 'rax:ownership:'
const OWNERSHIP_USERNAMES_KEY = 'rax:ownership:usernames'

export type ImportOwnershipSnapshotSummary = {
  realUsername: string
  importedAt: string
  updatedAt: string
  passCount: number
  legendaryPlusCount: number
  raxRowCount: number
}

function ownershipKey(realUsername: string): string {
  return `${OWNERSHIP_PREFIX}${realUsername}`
}

export async function upsertImportOwnershipSnapshot(
  input: ImportOwnershipSnapshot,
): Promise<boolean> {
  if (!adminStorageConfigured()) return false

  const stored: StoredImportOwnershipSnapshot = {
    ...input,
    updatedAt: new Date().toISOString(),
  }
  await kv.set(ownershipKey(input.realUsername), stored)
  await kv.sadd(OWNERSHIP_USERNAMES_KEY, input.realUsername)
  return true
}

export async function getImportOwnershipSnapshot(
  realUsername: string,
): Promise<StoredImportOwnershipSnapshot | null> {
  if (!adminStorageConfigured()) return null

  const stored = await kv.get<unknown>(ownershipKey(realUsername))
  const validated = validateImportOwnershipSnapshot(stored)
  if (!validated || !stored || typeof stored !== 'object') return null

  return {
    ...validated,
    updatedAt:
      typeof (stored as Record<string, unknown>).updatedAt === 'string'
        ? ((stored as Record<string, unknown>).updatedAt as string)
        : validated.importedAt,
  }
}

export async function listImportOwnershipUsernames(): Promise<string[]> {
  if (!adminStorageConfigured()) return []
  return kv.smembers(OWNERSHIP_USERNAMES_KEY)
}

function ownershipPassSportRaw(sport: string): string {
  switch (sport.trim()) {
    case 'NBA':
      return 'nba'
    case 'WNBA':
      return 'wnba'
    case 'NFL':
      return 'nfl'
    case 'CFB':
      return 'ncaaf'
    case 'MLB':
      return 'mlb'
    case 'NHL':
      return 'nhl'
    case 'CBB':
      return 'ncaam'
    case 'Golf':
      return 'golf'
    case 'FC':
      return 'fc'
    case 'UFC':
      return 'ufc'
    default:
      return sport.trim().toLowerCase()
  }
}

function summarizeOwnershipSnapshot(
  snapshot: StoredImportOwnershipSnapshot,
): ImportOwnershipSnapshotSummary {
  const rarities = snapshot.rarities ?? {}
  const legendaryPlusCount = snapshot.passes.filter((pass) =>
    passMatchesRarityFilter(
      {
        entityId: pass.entityId,
        season: pass.seasonYear,
        sportRaw: ownershipPassSportRaw(pass.sport),
      },
      rarities,
      pass.rarityLabel,
      legendaryPlusRarityFilter(),
    ),
  ).length
  const raxRowCount = snapshot.passes.reduce(
    (sum, pass) => sum + (pass.earnings?.length ?? 0),
    0,
  )

  return {
    realUsername: snapshot.realUsername,
    importedAt: snapshot.importedAt,
    updatedAt: snapshot.updatedAt,
    passCount: snapshot.passes.length,
    legendaryPlusCount,
    raxRowCount,
  }
}

export async function listImportOwnershipSnapshotSummaries(): Promise<
  ImportOwnershipSnapshotSummary[]
> {
  if (!adminStorageConfigured()) return []

  const usernames = await listImportOwnershipUsernames()
  const summaries = await Promise.all(
    usernames.map(async (username) => {
      const snapshot = await getImportOwnershipSnapshot(username)
      return snapshot ? summarizeOwnershipSnapshot(snapshot) : null
    }),
  )

  return summaries
    .filter((summary): summary is ImportOwnershipSnapshotSummary => summary !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
