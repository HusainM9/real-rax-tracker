const COOKIE_NAME = 'rax_session'
/** Site gate and account sessions both last 30 days. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function sessionSecret(): string | undefined {
  const raw =
    process.env.AUTH_SESSION_SECRET?.trim() || process.env.BASIC_AUTH_PASSWORD?.trim() || ''
  if (!raw) return undefined
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    const stripped = raw.slice(1, -1).trim()
    return stripped || undefined
  }
  return raw
}

export function getSigningSecret(): string | undefined {
  return sessionSecret()
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

export { signPayload, toBase64Url }

export function getSessionCookieName(): string {
  return COOKIE_NAME
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined

  for (const part of header.split(';')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator)
    if (key === name) return decodeURIComponent(trimmed.slice(separator + 1))
  }

  return undefined
}

export async function createSessionToken(): Promise<string | null> {
  const secret = sessionSecret()
  if (!secret) return null

  const expiresAt = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  const signature = await signPayload(expiresAt, secret)
  return `${expiresAt}.${signature}`
}

export async function verifySessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false

  const secret = sessionSecret()
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

export function buildSessionCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export function authConfigured(): boolean {
  const raw = process.env.BASIC_AUTH_PASSWORD?.trim() ?? ''
  const password =
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
      ? raw.slice(1, -1).trim()
      : raw
  return Boolean(password && sessionSecret())
}
