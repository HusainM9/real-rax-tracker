import {
  getSessionCookieName,
  readCookie,
  verifySessionToken,
} from '../../lib/authCookie'
import {
  getAdminCookieName,
  verifyAdminSessionToken,
} from '../../lib/adminAuth'

export async function hasAppSession(request: Request): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true
  const token = readCookie(request, getSessionCookieName())
  return verifySessionToken(token)
}

export async function hasAdminSession(request: Request): Promise<boolean> {
  if (process.env.NODE_ENV === 'development') return true
  const token = readCookie(request, getAdminCookieName())
  return verifyAdminSessionToken(token)
}

export async function requireAppSession(request: Request): Promise<Response | null> {
  if (await hasAppSession(request)) return null
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function requireAdminSession(request: Request): Promise<Response | null> {
  const appDenied = await requireAppSession(request)
  if (appDenied) return appDenied
  if (await hasAdminSession(request)) return null
  return Response.json({ error: 'Admin session required' }, { status: 401 })
}
