import { next } from '@vercel/functions'
import {
  authConfigured,
  getSessionCookieName,
  readCookie,
  verifySessionToken,
} from './lib/authCookie'

export const config = {
  matcher: ['/((?!robots\\.txt).*)'],
}

function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/api/auth/')
}

function assetRefererAllowsLoginBundle(request: Request): boolean {
  const referer = request.headers.get('referer')
  if (!referer) return false

  try {
    const refUrl = new URL(referer)
    const reqUrl = new URL(request.url)
    return refUrl.origin === reqUrl.origin && refUrl.pathname === '/login'
  } catch {
    return false
  }
}

async function hasValidSession(request: Request): Promise<boolean> {
  const token = readCookie(request, getSessionCookieName())
  return verifySessionToken(token)
}

export default async function middleware(request: Request) {
  if (!authConfigured()) {
    return next()
  }

  const { pathname } = new URL(request.url)

  if (pathname.startsWith('/assets/')) {
    if ((await hasValidSession(request)) || assetRefererAllowsLoginBundle(request)) {
      return next()
    }
    return new Response('Unauthorized', { status: 401 })
  }

  if (isPublicPath(pathname)) {
    return next()
  }

  if (await hasValidSession(request)) {
    return next()
  }

  if (pathname.startsWith('/api/')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', pathname)
  return Response.redirect(loginUrl)
}
