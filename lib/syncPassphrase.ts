import { normalizeRealUsername } from './importOwnershipTypes'

export async function hashSyncPassphrase(username: string, passphrase: string): Promise<string> {
  const normalizedUsername = normalizeRealUsername(username)
  const trimmedPassphrase = passphrase.trim()
  const pepper =
    process.env.TRACKER_SYNC_SECRET?.trim() ||
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.BASIC_AUTH_PASSWORD?.trim() ||
    'dev-sync-pepper'
  const payload = `${pepper}:${normalizedUsername}:${trimmedPassphrase}`
  const bytes = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
