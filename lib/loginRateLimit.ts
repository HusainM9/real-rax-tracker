import { getSigningSecret } from './authCookie'

const COOKIE_NAME = 'rax_login_rl'
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
const MIN_FAILURE_DELAY_MS = 750

type RateLimitPayload = {
  count: number
  windowStart: number
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

function readCookie(request: Request, name: string): string | undefined {
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

async function decodeRateLimitCookie(token: string | undefined): Promise<RateLimitPayload | null> {
  if (!token) return null

  const secret = getSigningSecret()
  if (!secret) return null

  const separator = token.lastIndexOf('.')
  if (separator < 0) return null

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = await signPayload(payload, secret)
  if (signature !== expected) return null

  try {
    const parsed = JSON.parse(payload) as RateLimitPayload
    if (
      typeof parsed.count !== 'number' ||
      typeof parsed.windowStart !== 'number' ||
      !Number.isFinite(parsed.count) ||
      !Number.isFinite(parsed.windowStart)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function encodeRateLimitCookie(payload: RateLimitPayload): Promise<string | null> {
  const secret = getSigningSecret()
  if (!secret) return null

  const body = JSON.stringify(payload)
  const signature = await signPayload(body, secret)
  return `${body}.${signature}`
}

function buildRateLimitCookieHeader(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api/auth/login; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`
}

function clearRateLimitCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=; Path=/api/auth/login; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
}

export function getRateLimitCookieName(): string {
  return COOKIE_NAME
}

export async function delayFailedLoginAttempt(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, MIN_FAILURE_DELAY_MS))
}

export async function checkLoginRateLimit(request: Request): Promise<{
  allowed: boolean
  retryAfterSeconds: number
}> {
  const now = Date.now()
  const current = await decodeRateLimitCookie(readCookie(request, COOKIE_NAME))

  if (!current || now - current.windowStart >= WINDOW_MS) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (current.count >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((current.windowStart + WINDOW_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

export async function recordFailedLoginAttempt(
  request: Request,
): Promise<{ headers: Record<string, string> }> {
  const now = Date.now()
  const current = await decodeRateLimitCookie(readCookie(request, COOKIE_NAME))
  const windowStart =
    current && now - current.windowStart < WINDOW_MS ? current.windowStart : now
  const count = current && now - current.windowStart < WINDOW_MS ? current.count + 1 : 1

  const token = await encodeRateLimitCookie({ count, windowStart })
  if (!token) return { headers: {} }

  const maxAgeSeconds = Math.ceil((windowStart + WINDOW_MS - now) / 1000)
  return {
    headers: {
      'Set-Cookie': buildRateLimitCookieHeader(token, Math.max(maxAgeSeconds, 1)),
    },
  }
}

export function clearLoginRateLimitHeaders(): Record<string, string> {
  return { 'Set-Cookie': clearRateLimitCookieHeader() }
}

export const LOGIN_RATE_LIMIT = {
  maxAttempts: MAX_ATTEMPTS,
  windowMs: WINDOW_MS,
}
