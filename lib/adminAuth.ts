const COOKIE_NAME = 'rax_admin_session'
const MAX_AGE_SECONDS = 60 * 60 * 8

function adminSecret(): string | undefined {
  return process.env.ADMIN_PASSWORD?.trim() || process.env.AUTH_SESSION_SECRET?.trim()
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

export function getAdminCookieName(): string {
  return COOKIE_NAME
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim() && adminSecret())
}

export function readAdminPasswordEnv(): string | undefined {
  return process.env.ADMIN_PASSWORD?.trim()
}

export async function createAdminSessionToken(): Promise<string | null> {
  const secret = adminSecret()
  if (!secret) return null

  const expiresAt = String(Date.now() + MAX_AGE_SECONDS * 1000)
  const signature = await signPayload(expiresAt, secret)
  return `${expiresAt}.${signature}`
}

export async function verifyAdminSessionToken(
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false

  const secret = adminSecret()
  if (!secret) return false

  const separator = token.lastIndexOf('.')
  if (separator < 0) return false

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = await signPayload(payload, secret)
  if (signature !== expected) return false

  const expiresAt = Number(payload)
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

export function buildAdminSessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`
}

export function clearAdminSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}
