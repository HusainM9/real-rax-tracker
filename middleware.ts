import { next } from '@vercel/functions'
import {
  authConfigured,
  getSessionCookieName,
  readCookie,
  verifySessionToken,
} from './lib/authCookie'
import {
  getAccountCookieName,
  verifyAccountSessionToken,
} from './lib/accountAuth'
import { accountSessionIsRevoked } from './lib/accountCredentialsStore'
import {
  getAdminCookieName,
  verifyAdminSessionToken,
} from './lib/adminAuth'
import {
  getEarningsCookieName,
  verifyEarningsSessionToken,
} from './lib/earningsAuth'

export const config = {
  matcher: ['/((?!robots\\.txt).*)'],
}

function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/api/auth/')
}

function isAccountAuthPath(pathname: string): boolean {
  return (
    pathname === '/account' ||
    pathname === '/api/account/login' ||
    pathname === '/api/account/register' ||
    pathname === '/api/account/logout' ||
    pathname === '/api/account/session'
  )
}

function isAdminLoginPath(pathname: string): boolean {
  return pathname === '/admin/login' || pathname === '/api/admin/login'
}

function isAdminProtectedPath(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname === '/api/admin/events' ||
    pathname === '/api/admin/users'
  )
}

function isAdminEventPost(pathname: string, method: string): boolean {
  return pathname === '/api/admin/events' && method === 'POST'
}

async function hasValidSession(request: Request): Promise<boolean> {
  const token = readCookie(request, getSessionCookieName())
  return verifySessionToken(token)
}

async function hasValidAccountSession(request: Request): Promise<boolean> {
  const token = readCookie(request, getAccountCookieName())
  const result = await verifyAccountSessionToken(token)
  if (!result.ok) return false
  return !(await accountSessionIsRevoked(result.username, result.credentialsUpdatedAt))
}

async function hasValidAdminSession(request: Request): Promise<boolean> {
  const token = readCookie(request, getAdminCookieName())
  return verifyAdminSessionToken(token)
}

export default async function middleware(request: Request) {
  const { pathname } = new URL(request.url)
  const method = request.method.toUpperCase()

  if (pathname.startsWith('/assets/')) {
    return next()
  }

  if (pathname === '/earnings/access' || pathname.startsWith('/api/earnings/')) {
    return next()
  }

  if (
    pathname === '/earnings' ||
    pathname === '/api/account/earnings' ||
    pathname === '/api/account/earnings-tracking'
  ) {
    const token = readCookie(request, getEarningsCookieName())
    if (await verifyEarningsSessionToken(token)) return next()
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Earnings access required.' }, { status: 401 })
    }
    const accessUrl = new URL('/earnings/access', request.url)
    accessUrl.searchParams.set('next', pathname)
    return Response.redirect(accessUrl)
  }

  // Cron handlers authenticate Vercel's request with CRON_SECRET themselves.
  if (pathname.startsWith('/api/cron/')) return next()

  if (!authConfigured()) {
    return next()
  }

  if (isPublicPath(pathname)) {
    return next()
  }

  const appSession = await hasValidSession(request)

  if (isAdminEventPost(pathname, method)) {
    if (appSession) return next()
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!appSession) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (isAdminLoginPath(pathname)) {
      return next()
    }
    if (pathname === '/api/admin/session' || pathname === '/api/admin/logout') {
      return next()
    }
    if (isAdminProtectedPath(pathname) && method === 'GET') {
      if (await hasValidAdminSession(request)) return next()
      return Response.json({ error: 'Admin session required' }, { status: 401 })
    }
    return next()
  }

  if (isAdminLoginPath(pathname)) {
    if (appSession) return next()
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return Response.redirect(loginUrl)
  }

  if (isAdminProtectedPath(pathname)) {
    if (!appSession) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return Response.redirect(loginUrl)
    }
    if (!(await hasValidAdminSession(request))) {
      const adminLoginUrl = new URL('/admin/login', request.url)
      adminLoginUrl.searchParams.set('next', pathname)
      return Response.redirect(adminLoginUrl)
    }
    return next()
  }

  // Account auth endpoints + page: need site session only
  if (isAccountAuthPath(pathname)) {
    if (!appSession) {
      if (pathname.startsWith('/api/')) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return Response.redirect(loginUrl)
    }
    return next()
  }

  if (!appSession) {
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return Response.redirect(loginUrl)
  }

  // Site session present — require account session for app + account data APIs
  const accountOk = await hasValidAccountSession(request)
  if (!accountOk) {
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'Account login required' }, { status: 401 })
    }
    const accountUrl = new URL('/account', request.url)
    accountUrl.searchParams.set('next', pathname)
    return Response.redirect(accountUrl)
  }

  return next()
}
