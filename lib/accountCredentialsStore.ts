import { kv } from '@vercel/kv'
import { sessionMatchesCredentials } from './accountAuth'
import { adminStorageConfigured } from './adminEventStore'
import { normalizeRealUsername } from './importOwnershipTypes'

const AUTH_PREFIX = 'rax:tracker-auth:'
const PROFILE_PREFIX = 'rax:tracker-profile:'

export type TrackerProfileAuth = {
  passphraseHash: string
  credentialsUpdatedAt: string
}

type ProfileAuthFallback = {
  passphraseHash?: string
  credentialsUpdatedAt?: string
}

export function authKey(username: string): string {
  return `${AUTH_PREFIX}${normalizeRealUsername(username)}`
}

function profileKey(username: string): string {
  return `${PROFILE_PREFIX}${normalizeRealUsername(username)}`
}

export function newCredentialsUpdatedAt(): string {
  return new Date().toISOString()
}

/** Password hash lives on its own KV key so collection saves cannot roll it back. */
export async function persistProfileAuth(
  username: string,
  passphraseHash: string,
  credentialsUpdatedAt: string,
): Promise<void> {
  await kv.set(authKey(username), {
    passphraseHash,
    credentialsUpdatedAt,
  })
}

export async function deleteProfileAuth(username: string): Promise<void> {
  await kv.del(authKey(username))
}

export async function getProfileAuth(
  username: string,
  profile?: ProfileAuthFallback | null,
): Promise<TrackerProfileAuth | null> {
  const storedAuth = await kv.get<TrackerProfileAuth | null>(authKey(username))
  if (storedAuth?.passphraseHash) {
    return {
      passphraseHash: storedAuth.passphraseHash,
      credentialsUpdatedAt: storedAuth.credentialsUpdatedAt ?? '',
    }
  }

  const existing =
    profile !== undefined
      ? profile
      : await kv.get<ProfileAuthFallback | null>(profileKey(username))
  if (!existing?.passphraseHash) return null

  const auth: TrackerProfileAuth = {
    passphraseHash: existing.passphraseHash,
    credentialsUpdatedAt: existing.credentialsUpdatedAt ?? '',
  }
  await persistProfileAuth(username, auth.passphraseHash, auth.credentialsUpdatedAt)
  return auth
}

/** True when the account is gone or its password was changed after this session was issued. */
export async function accountSessionIsRevoked(
  username: string,
  tokenCredentialsUpdatedAt: string,
): Promise<boolean> {
  if (!adminStorageConfigured()) return false
  const normalized = normalizeRealUsername(username)
  if (!normalized) return true
  const auth = await getProfileAuth(normalized)
  if (!auth) return true
  return !sessionMatchesCredentials(tokenCredentialsUpdatedAt, auth.credentialsUpdatedAt)
}
