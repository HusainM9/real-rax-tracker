import { normalizeRealUsername } from './importOwnershipTypes'
import {
  SESSION_MAX_AGE_SECONDS,
  getSigningSecret,
  signPayload,
  toBase64Url,
} from './authCookie'

const COOKIE_NAME = 'rax_account_session'

function encodePayload(expiresAt: string, username: string, credentialsUpdatedAt: string): string {
  const raw = credentialsUpdatedAt
    ? `${expiresAt}\n${username}\n${credentialsUpdatedAt}`
    : `${expiresAt}\n${username}`
  return toBase64Url(new TextEncoder().encode(raw))
}

function decodePayload(encoded: string): {
  expiresAt: string
  username: string
  credentialsUpdatedAt: string
} | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padLength = (4 - (padded.length % 4)) % 4
    const binary = atob(padded + '='.repeat(padLength))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const raw = new TextDecoder().decode(bytes)
    const [expiresAt, username, credentialsUpdatedAt = ''] = raw.split('\n')
    if (!expiresAt || !username) return null
    return { expiresAt, username, credentialsUpdatedAt }
  } catch {
    return null
  }
}

/** False after an admin/user password change that the session predates. */
export function sessionMatchesCredentials(
  tokenCredentialsUpdatedAt: string | undefined,
  storedCredentialsUpdatedAt: string | undefined,
): boolean {
  const stored = storedCredentialsUpdatedAt ?? ''
  if (!stored) return true
  return (tokenCredentialsUpdatedAt ?? '') === stored
}

export function getAccountCookieName(): string {
  return COOKIE_NAME
}

export async function createAccountSessionToken(
  username: string,
  credentialsUpdatedAt = '',
): Promise<string | null> {
  const secret = getSigningSecret()
  if (!secret) return null

  const normalized = normalizeRealUsername(username)
  if (!normalized) return null

  const expiresAt = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  const payload = encodePayload(expiresAt, normalized, credentialsUpdatedAt)
  const signature = await signPayload(payload, secret)
  return `${payload}.${signature}`
}

export async function verifyAccountSessionToken(
  token: string | null | undefined,
): Promise<
  | { ok: true; username: string; credentialsUpdatedAt: string }
  | { ok: false; username?: never; credentialsUpdatedAt?: never }
> {
  if (!token) return { ok: false }

  const secret = getSigningSecret()
  if (!secret) return { ok: false }

  const separator = token.lastIndexOf('.')
  if (separator < 0) return { ok: false }

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = await signPayload(payload, secret)
  if (signature !== expected) return { ok: false }

  const decoded = decodePayload(payload)
  if (!decoded) return { ok: false }

  const expiresAt = Number(decoded.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false }

  const username = normalizeRealUsername(decoded.username)
  if (!username) return { ok: false }

  return { ok: true, username, credentialsUpdatedAt: decoded.credentialsUpdatedAt }
}

export function buildAccountSessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`
}

export function clearAccountSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}
