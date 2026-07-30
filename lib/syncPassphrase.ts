import { normalizeRealUsername } from './importOwnershipTypes'

/** Strip accidental surrounding quotes from env values (common in copied .env.local). */
export function stripEnvQuotes(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/** Peppers that may have been used historically to hash account passwords. */
export function syncPepperCandidates(): string[] {
  const candidates = [
    stripEnvQuotes(process.env.TRACKER_SYNC_SECRET),
    stripEnvQuotes(process.env.AUTH_SESSION_SECRET),
    stripEnvQuotes(process.env.BASIC_AUTH_PASSWORD),
    'dev-sync-pepper',
  ].filter((value) => value.length > 0)
  return [...new Set(candidates)]
}

export function preferredSyncPepper(): string {
  return syncPepperCandidates()[0] ?? 'dev-sync-pepper'
}

async function hashWithPepper(
  normalizedUsername: string,
  trimmedPassphrase: string,
  pepper: string,
): Promise<string> {
  const payload = `${pepper}:${normalizedUsername}:${trimmedPassphrase}`
  const bytes = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashSyncPassphrase(
  username: string,
  passphrase: string,
  pepper: string = preferredSyncPepper(),
): Promise<string> {
  const normalizedUsername = normalizeRealUsername(username)
  const trimmedPassphrase = passphrase.trim()
  return hashWithPepper(normalizedUsername, trimmedPassphrase, pepper)
}

/**
 * True when the password matches the stored hash under any configured pepper.
 * Needed because older accounts may have been hashed with BASIC_AUTH_PASSWORD
 * before AUTH_SESSION_SECRET / TRACKER_SYNC_SECRET existed.
 */
export async function matchesSyncPassphrase(
  username: string,
  passphrase: string,
  expectedHash: string,
): Promise<boolean> {
  if (!expectedHash) return false
  const normalizedUsername = normalizeRealUsername(username)
  const trimmedPassphrase = passphrase.trim()
  for (const pepper of syncPepperCandidates()) {
    const hash = await hashWithPepper(normalizedUsername, trimmedPassphrase, pepper)
    if (hash === expectedHash) return true
  }
  return false
}
