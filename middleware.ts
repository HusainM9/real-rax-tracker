import { next } from '@vercel/functions'
import {
  authConfigured,
  getSessionCookieName,
  readCookie,
  verifySessionToken,
} from './lib/authCookie'

export const config = {
  matcher: ['/((?!assets/|robots\\.txt).*)'],
}

function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/api/auth/')
}

export default async function middleware(request: Request) {
  if (!authConfigured()) {
    return next()
  }

  const { pathname } = new URL(request.url)

  if (isPublicPath(pathname)) {
    return next()
  }

  const token = readCookie(request, getSessionCookieName())
  if (await verifySessionToken(token)) {
    return next()
  }

  if (pathname.startsWith('/api/')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', pathname)
  return Response.redirect(loginUrl)
}
