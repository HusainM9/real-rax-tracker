import { kv } from '@vercel/kv'
import {
  validateImportOwnershipSnapshot,
  type ImportOwnershipSnapshot,
  type StoredImportOwnershipSnapshot,
} from './importOwnershipTypes'
import { adminStorageConfigured } from './adminEventStore'

const OWNERSHIP_PREFIX = 'rax:ownership:'
const OWNERSHIP_USERNAMES_KEY = 'rax:ownership:usernames'

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
