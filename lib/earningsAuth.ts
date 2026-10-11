import {
  SESSION_MAX_AGE_SECONDS,
  getSigningSecret,
  readCookie,
  signPayload,
} from './authCookie'

const COOKIE_NAME = 'rax_earnings_access'
const DEFAULT_PASSWORD = 'mate'

function configuredPassword(): string {
  return process.env.EARNINGS_ACCESS_PASSWORD?.trim() || DEFAULT_PASSWORD
}

export function earningsPasswordMatches(password: string): boolean {
  return password === configuredPassword()
}

export function getEarningsCookieName(): string {
  return COOKIE_NAME
}

export async function createEarningsSessionToken(): Promise<string | null> {
  const secret = getSigningSecret()
  if (!secret) return null
  const expiresAt = String(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  const signature = await signPayload(`earnings:${expiresAt}`, secret)
  return `${expiresAt}.${signature}`
}

export async function verifyEarningsSessionToken(
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false
  const secret = getSigningSecret()
  if (!secret) return false
  const separator = token.lastIndexOf('.')
  if (separator < 0) return false
  const expiresAt = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (signature !== await signPayload(`earnings:${expiresAt}`, secret)) return false
  const expiresAtMs = Number(expiresAt)
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()
}

export async function hasEarningsSession(request: Request): Promise<boolean> {
  return verifyEarningsSessionToken(readCookie(request, COOKIE_NAME))
}

export async function requireEarningsSession(request: Request): Promise<Response | null> {
  if (await hasEarningsSession(request)) return null
  return Response.json({ error: 'Earnings access required.' }, { status: 401 })
}

export function buildEarningsCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`
}

export function clearEarningsCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}
